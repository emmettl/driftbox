import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { Graph } from '../graph.js'
import { MODULES } from './index.js'
import type { ModuleDef, Patch } from '../types.js'
import { VOCODER_BAND_COUNTS, VOCODER_MODULE, VocoderProcessor } from './vocoder.js'

// Does it actually vocode? That is one claim and it is measurable: give it a broadband carrier and a
// modulator with energy in one narrow place, and the output should have energy in that place and much less
// everywhere else. Everything below is variations on that measurement.

const SR = 44100
const FRAMES = 128

const at = (id: string) => VOCODER_MODULE.params.findIndex((p) => p.id === id)

interface Options {
  bands?: number
  attack?: number
  release?: number
  shift?: number
  dry?: number
}

/** Deterministic broadband noise. A real carrier for a vocoder is a saw or a pad; noise is the honest
 *  test signal because it has equal energy everywhere, so any shaping in the output came from the bank. */
const noise = () => {
  let seed = 987654321
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x3fffffff - 1
  }
}

const sine = (hz: number, amplitude = 1) => (i: number) =>
  Math.sin((2 * Math.PI * hz * i) / SR) * amplitude

/** Run carrier and modulator through, and return every output sample. */
function run(
  carrier: (i: number) => number,
  modulator: (i: number) => number,
  blocks: number,
  options: Options = {},
): number[] {
  const processor = new VocoderProcessor(SR)
  const params = VOCODER_MODULE.params.map(
    (p) => new Float32Array(FRAMES).fill(options[p.id as keyof Options] ?? p.default),
  )
  const out: number[] = []
  let n = 0
  for (let b = 0; b < blocks; b++) {
    const c = new Float32Array(FRAMES)
    const m = new Float32Array(FRAMES)
    for (let i = 0; i < FRAMES; i++, n++) {
      c[i] = carrier(n)
      m[i] = modulator(n)
    }
    const outlets = [new Float32Array(FRAMES)]
    processor.process([c, m], outlets, params, FRAMES)
    out.push(...outlets[0])
  }
  return out
}

/**
 * Magnitude at one frequency, by Goertzel.
 *
 * A whole FFT would be more than this needs: there are a handful of frequencies worth asking about and
 * Goertzel answers exactly one each time, in ten lines, with no dependency.
 */
function magnitudeAt(samples: number[], hz: number): number {
  // The settled second half, so the bank's start-up is not what gets measured.
  const tail = samples.slice(Math.floor(samples.length / 2))
  const w = (2 * Math.PI * hz) / SR
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (const sample of tail) {
    const s0 = sample + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / tail.length
}

describe('the vocoder', () => {
  it('puts the carrier where the modulator has energy, and not elsewhere', () => {
    // The whole device in one assertion. Noise in, a 300Hz sine as the modulator, and the output should be
    // noise shaped into a bump around 300Hz.
    const out = run(noise(), sine(300), 120)
    const near = magnitudeAt(out, 300)
    const far = magnitudeAt(out, 4000)
    expect(near).toBeGreaterThan(far * 8)
  })

  it('follows the modulator when it moves', () => {
    // Same carrier, a modulator two and a half octaves up: whichever frequency the modulator sits at is
    // where the output peaks. The assertion that a fixed resonance could not fake.
    //
    // Measured, at the default 16 bands:
    //
    //            @300     @2000    @4000
    //   mod 300  0.104    0.040    0.010
    //   mod 2000 0.030    0.110    0.020
    //
    // The diagonal is unambiguous — each run peaks exactly where its modulator sits — so that is what is
    // asserted. The off-diagonal is **not** zero, and that is the design rather than a defect: the bands
    // overlap, because a bank with gaps between its bands sounds worse than one without. A tighter ratio
    // here would be asserting the filters are steeper than a vocoder wants them to be, and would fail the
    // day somebody sensibly widened them.
    const low = run(noise(), sine(300), 120)
    const high = run(noise(), sine(2000), 120)

    // Each run peaks at its own modulator's frequency.
    expect(magnitudeAt(low, 300)).toBeGreaterThan(magnitudeAt(low, 2000))
    expect(magnitudeAt(low, 300)).toBeGreaterThan(magnitudeAt(low, 4000))
    expect(magnitudeAt(high, 2000)).toBeGreaterThan(magnitudeAt(high, 300))
    expect(magnitudeAt(high, 2000)).toBeGreaterThan(magnitudeAt(high, 4000))

    // And each frequency is loudest in the run whose modulator is there. 2.5×, against a measured 3.5×
    // and 2.8× — enough margin to be a real claim, not so much that it pins the filter width.
    expect(magnitudeAt(low, 300)).toBeGreaterThan(magnitudeAt(high, 300) * 2.5)
    expect(magnitudeAt(high, 2000)).toBeGreaterThan(magnitudeAt(low, 2000) * 2.5)
  })

  it('is silent when the modulator is', () => {
    // A vocoder with nothing to say says nothing, however loud the carrier. This is also why the dry knob
    // exists — silence and a broken patch look identical otherwise.
    const out = run(noise(), () => 0, 60)
    const peak = Math.max(...out.map(Math.abs))
    expect(peak).toBeLessThan(1e-6)
  })

  it('passes the carrier through when the dry knob is up', () => {
    const out = run(sine(500), () => 0, 60, { dry: 1 })
    expect(magnitudeAt(out, 500)).toBeGreaterThan(0.1)
  })

  it('moves the formants up when the shift is positive, without moving the modulator', () => {
    // The control people actually play, and the reason it is on the front panel of the BV512. The
    // modulator does not move; where its energy lands on the carrier does.
    const plain = run(noise(), sine(300), 120, { shift: 0 })
    const up = run(noise(), sine(300), 120, { shift: 5 })
    // The bump has left 300Hz...
    expect(magnitudeAt(up, 300)).toBeLessThan(magnitudeAt(plain, 300) * 0.6)
    // ...and gone somewhere above it.
    expect(magnitudeAt(up, 1200)).toBeGreaterThan(magnitudeAt(plain, 1200))
  })

  it('goes quiet rather than wrapping when the shift pushes bands off the end', () => {
    // Wrapping would fold the top of the spectrum onto the bottom, which sounds like a fault rather than
    // like a voice moved. The far end of the shift range should thin the sound out, not scramble it.
    const out = run(noise(), sine(300), 120, { shift: 12 })
    for (const value of out) expect(Number.isFinite(value)).toBe(true)
    expect(magnitudeAt(out, 300)).toBeLessThan(magnitudeAt(run(noise(), sine(300), 120), 300))
  })

  it('works at every band count, and each is a different sound', () => {
    const outputs = VOCODER_BAND_COUNTS.map((_, selector) =>
      run(noise(), sine(300), 120, { bands: selector }),
    )
    for (const out of outputs) {
      for (const value of out) expect(Number.isFinite(value)).toBe(true)
      // Each still puts energy where the modulator is.
      expect(magnitudeAt(out, 300)).toBeGreaterThan(magnitudeAt(out, 4000) * 3)
    }
    // And they are not the same signal — 8 bands is a robot and 32 is nearly intelligible, which is why
    // the choice is stepped rather than a knob.
    expect(outputs[0]).not.toEqual(outputs[2])
  })

  it('does not carry state across a change of band count', () => {
    // Those integrators were holding a different frequency; reusing them is a click at best. Checked by
    // running one band count, then another, and asserting the second is what it would have been fresh.
    const processor = new VocoderProcessor(SR)
    const params = VOCODER_MODULE.params.map(
      (p) => new Float32Array(FRAMES).fill(p.default),
    )
    const carrier = noise()
    const feed = () => {
      const c = new Float32Array(FRAMES)
      const m = new Float32Array(FRAMES)
      for (let i = 0; i < FRAMES; i++) {
        c[i] = carrier()
        m[i] = 0
      }
      const outlets = [new Float32Array(FRAMES)]
      processor.process([c, m], outlets, params, FRAMES)
      return outlets[0]
    }
    params[at('bands')].fill(0)
    feed()
    params[at('bands')].fill(2)
    // A silent modulator means a silent output; if state survived the rebuild it would ring here.
    const after = feed()
    for (const value of after) expect(Math.abs(value)).toBeLessThan(1e-6)
  })

  it('stays finite with both inlets hostile and every band engaged', () => {
    const out = run(
      (i) => (i % 2 ? 4 : -4),
      (i) => (i % 3 ? 4 : -4),
      120,
      { bands: 2, attack: 0.0005, release: 0.001, dry: 1 },
    )
    for (const value of out) {
      expect(Number.isFinite(value)).toBe(true)
      expect(Math.abs(value)).toBeLessThanOrEqual(4)
    }
  })

  it('declares its params in the order the processor reads them', () => {
    expect(VOCODER_MODULE.params.map((p) => p.id)).toEqual([
      'bands',
      'attack',
      'release',
      'shift',
      'dry',
    ])
  })

  it('names its band choices to match what the selector actually builds', () => {
    // The selector is 0..2 and the processor turns it into 8/16/32 with a shift. If the labels and that
    // arithmetic ever disagree, the faceplate would be lying about what you picked.
    expect(VOCODER_MODULE.params[at('bands')].labels).toEqual(
      VOCODER_BAND_COUNTS.map(String),
    )
    VOCODER_BAND_COUNTS.forEach((count, selector) => expect(8 << selector).toBe(count))
  })
})

describe('the vocoder in a compiled patch', () => {
  // Everything above tests the class with arrays this file built, so it cannot catch the inlets being
  // wired the wrong way round — carrier and mod swapped would pass every assertion up there and be
  // obviously wrong the moment anybody used it. This goes through `compile` and the `Graph`, which is the
  // only way to check that `inlets[0]` really is the port called `carrier`.
  const build = (patch: Patch) => {
    const modules: Record<string, ModuleDef['processor']> = {}
    const deps: Record<string, unknown> = {}
    for (const def of Object.values(MODULES)) {
      modules[def.type] = def.processor
      for (const [key, dep] of Object.entries(def.deps ?? {})) deps[key] = dep
    }
    const graph = new Graph(SR, FRAMES, modules, deps)
    graph.setPlan(compile(patch, MODULES))
    const out: number[] = []
    for (let b = 0; b < 200; b++) {
      const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
      graph.process(channels)
      out.push(...channels[0])
    }
    return out
  }

  /** Noise into one named inlet, a tuned oscillator into the other, straight to the output. */
  const patchWith = (carrierFrom: string, modFrom: string): Patch => ({
    modules: [
      { id: 'osc', type: 'vco', params: { tune: 0, shape: 0 } },
      { id: 'noise', type: 'noise' },
      { id: 'voc', type: 'vocoder', params: { bands: 1, dry: 0 } },
      { id: 'out', type: 'out', params: { level: 1 } },
    ],
    cables: [
      { from: [carrierFrom, carrierFrom === 'noise' ? 'white' : 'out'], to: ['voc', 'carrier'] },
      { from: [modFrom, modFrom === 'noise' ? 'white' : 'out'], to: ['voc', 'mod'] },
      { from: ['voc', 'out'], to: ['out', 'in'] },
    ],
  })

  it('compiles and makes a sound', () => {
    const out = build(patchWith('noise', 'osc'))
    expect(Math.max(...out.map(Math.abs))).toBeGreaterThan(0.001)
    for (const value of out) expect(Number.isFinite(value)).toBe(true)
  })

  it('has carrier and mod the right way round', () => {
    // A tonal modulator on a noise carrier gives a shaped-noise output whose energy follows the tone.
    // Swap them and the output is a noise-shaped tone, which has energy spread everywhere instead. The
    // two are plainly different, and only one of them peaks near the oscillator's pitch.
    const right = build(patchWith('noise', 'osc'))
    const swapped = build(patchWith('osc', 'noise'))
    // The VCO's default tune of 0 is C2, ~65Hz — below the bank's 110Hz bottom, so measure its second
    // harmonic, which a saw has plenty of and which sits inside the range.
    const tone = magnitudeAt(right, 131)
    expect(tone).toBeGreaterThan(magnitudeAt(right, 4000) * 2)
    expect(right).not.toEqual(swapped)
  })
})
