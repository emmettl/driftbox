import { describe, expect, it } from 'vitest'
import { ALLIGATOR_BANDS, ALLIGATOR_MODULE, AlligatorProcessor } from './alligator.js'

// The claims `alligator.ts` makes, measured: that the three bands really are a low, a middle and a top;
// that their gates are independent, which is the entire reason the device exists; and that a gate edge
// does not click, which is what separates it from a VCA with a square wave in its CV.

const SR = 44100
const FRAMES = 128

const at = (id: string) => ALLIGATOR_MODULE.params.findIndex((p) => p.id === id)

/** Run a signal through, with a chosen gate state per band; returns every sample of each outlet. */
function run(
  signal: (i: number) => number,
  blocks: number,
  gates: number[] = [1, 1, 1],
  tweak: (params: Float32Array[]) => void = () => {},
) {
  const processor = new AlligatorProcessor(SR)
  const params = ALLIGATOR_MODULE.params.map((p) => new Float32Array(FRAMES).fill(p.default))
  tweak(params)

  const out: number[][] = ALLIGATOR_MODULE.outlets.map(() => [])
  let n = 0
  for (let b = 0; b < blocks; b++) {
    const audio = new Float32Array(FRAMES)
    for (let i = 0; i < FRAMES; i++) audio[i] = signal(n++)
    const inlets = [audio, ...gates.map((g) => new Float32Array(FRAMES).fill(g))]
    const outlets = ALLIGATOR_MODULE.outlets.map(() => new Float32Array(FRAMES))
    processor.process(inlets, outlets, params, FRAMES)
    outlets.forEach((buffer, band) => out[band].push(...buffer))
  }
  return out
}

const sine = (hz: number) => (i: number) => Math.sin((2 * Math.PI * hz * i) / SR)

/** RMS of the settled second half, so the filter's and envelope's start-up is not measured. */
const rms = (values: number[]) => {
  const tail = values.slice(Math.floor(values.length / 2))
  return Math.sqrt(tail.reduce((sum, v) => sum + v * v, 0) / tail.length)
}

describe('the alligator', () => {
  it('splits into a low, a middle and a top', () => {
    // The fixed LP/BP/HP split is the device — the thing you cannot get by patching three SVFs without
    // deciding this exact arrangement yourself.
    const low = run(sine(60), 80)
    expect(rms(low[0])).toBeGreaterThan(rms(low[2]) * 10)

    const high = run(sine(9000), 80)
    expect(rms(high[2])).toBeGreaterThan(rms(high[0]) * 10)
  })

  it('passes the middle band most strongly at its own frequency', () => {
    const centre = ALLIGATOR_MODULE.params[at('freq2')].default
    const on = run(sine(centre), 80)
    const off = run(sine(centre * 12), 80)
    expect(rms(on[1])).toBeGreaterThan(rms(off[1]) * 5)
  })

  it('gates each band independently, which is the whole reason it exists', () => {
    // Low open, middle and top shut. A device that could only gate everything at once would be a VCA.
    const out = run(sine(60), 80, [1, 0, 0])
    expect(rms(out[0])).toBeGreaterThan(0.05)
    expect(rms(out[1])).toBeLessThan(1e-3)
    expect(rms(out[2])).toBeLessThan(1e-3)
  })

  it('does not click when a gate opens', () => {
    // A raw gate multiplied into audio steps from 0 to full in one sample, twice per hit. The per-band
    // envelope is what makes this a rhythm rather than a fault, so the ramp has to be measurable.
    const out = run(sine(200), 8, [1, 1, 1])
    // Biggest sample-to-sample jump in the first few milliseconds of the low band.
    let biggest = 0
    for (let i = 1; i < 256; i++) {
      const step = Math.abs(out[0][i] - out[0][i - 1])
      if (step > biggest) biggest = step
    }
    expect(biggest).toBeLessThan(0.1)
  })

  it('falls away over the decay when the gate drops, and a longer decay falls slower', () => {
    const tail = (decay: number) => {
      const processor = new AlligatorProcessor(SR)
      const params = ALLIGATOR_MODULE.params.map((p) => new Float32Array(FRAMES).fill(p.default))
      params[at('decay1')].fill(decay)
      const audio = new Float32Array(FRAMES)
      for (let i = 0; i < FRAMES; i++) audio[i] = Math.sin((2 * Math.PI * 60 * i) / SR)

      const open = [audio, ...[1, 1, 1].map((g) => new Float32Array(FRAMES).fill(g))]
      const shut = [audio, ...[0, 0, 0].map((g) => new Float32Array(FRAMES).fill(g))]
      const outlets = () => ALLIGATOR_MODULE.outlets.map(() => new Float32Array(FRAMES))
      for (let b = 0; b < 40; b++) processor.process(open, outlets(), params, FRAMES)

      const collected: number[] = []
      for (let b = 0; b < 10; b++) {
        const out = outlets()
        processor.process(shut, out, params, FRAMES)
        collected.push(...out[0])
      }
      return rms(collected)
    }
    const short = tail(0.01)
    const long = tail(1.5)
    expect(long).toBeGreaterThan(short * 5)
  })

  it('scales each band by its own level', () => {
    const plain = run(sine(60), 80)
    const quiet = run(sine(60), 80, [1, 1, 1], (params) => params[at('level1')].fill(0.25))
    expect(rms(quiet[0])).toBeLessThan(rms(plain[0]) * 0.4)
    // And only that band.
    expect(rms(quiet[2])).toBeCloseTo(rms(plain[2]), 5)
  })

  it('stays finite with resonance at the top and a hostile input', () => {
    // The damping is deliberately short of zero because an undamped resonator is an infinity waiting for a
    // transient. This is the assertion that keeps it that way.
    const out = run((i) => (i % 2 ? 4 : -4), 80, [1, 1, 1], (params) => {
      for (let band = 1; band <= ALLIGATOR_BANDS; band++) params[at(`res${band}`)].fill(1)
    })
    for (const band of out) for (const value of band) expect(Number.isFinite(value)).toBe(true)
  })

  it('declares one gate inlet and one outlet per band', () => {
    expect(ALLIGATOR_MODULE.outlets).toHaveLength(ALLIGATOR_BANDS)
    // An audio inlet, then a gate each.
    expect(ALLIGATOR_MODULE.inlets).toHaveLength(ALLIGATOR_BANDS + 1)
    expect(ALLIGATOR_MODULE.inlets[0].id).toBe('in')
  })

  it('declares its params in the blocks the processor reads them in', () => {
    // Load-bearing: the processor indexes params[1 + band], params[1 + bands + band] and so on, so
    // inserting one at the front would silently retune a band rather than fail.
    expect(ALLIGATOR_MODULE.params.map((p) => p.id)).toEqual([
      'attack',
      'freq1', 'freq2', 'freq3',
      'res1', 'res2', 'res3',
      'decay1', 'decay2', 'decay3',
      'level1', 'level2', 'level3',
    ])
  })
})
