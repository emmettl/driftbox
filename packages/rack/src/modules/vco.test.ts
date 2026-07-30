import { describe, expect, it } from 'vitest'
import { VcoProcessor } from './vco.js'

// Whether an oscillator is band-limited is not a matter of opinion, and it is not something
// you can hear reliably either — aliasing on a sawtooth sounds like a slightly wrong
// sawtooth until you play a scale and notice the shimmer standing still. So it is measured:
// against an additively-synthesised reference that is band-limited by construction, and
// against the naive version that this is supposed to be better than.

const SR = 44100
const BASE = 65.40639132514966

const SAW = 0
const PULSE = 1
const TRIANGLE = 2

/** The tune in semitones that puts the oscillator at `frequency` with no CV. */
const tuneFor = (frequency: number) => 12 * Math.log2(frequency / BASE)

function run(
  frequency: number,
  samples: number,
  shape = SAW,
  width = 0.5,
  Constructor: typeof VcoProcessor = VcoProcessor,
): Float64Array {
  const vco = new Constructor(SR)
  const zero = new Float32Array(samples)
  const params = [
    new Float32Array(samples).fill(tuneFor(frequency)),
    new Float32Array(samples).fill(shape),
    new Float32Array(samples).fill(width),
  ]
  const out = new Float32Array(samples)
  vco.process([zero, zero], [out], params, samples)
  return Float64Array.from(out)
}

/**
 * A sawtooth with every harmonic up to Nyquist and not one above it — the thing PolyBLEP is
 * an approximation of. `2*frac(t) - 1` has the series -(2/π)·Σ sin(2πnt)/n.
 */
function reference(frequency: number, samples: number): Float64Array {
  const harmonics = Math.floor(SR * 0.5 / frequency)
  const out = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    // The VCO advances its phase before it writes, so sample i is at phase (i+1)·dt.
    const t = ((i + 1) * frequency) / SR
    let sum = 0
    for (let n = 1; n <= harmonics; n++) sum += Math.sin(2 * Math.PI * n * t) / n
    out[i] = (-2 / Math.PI) * sum
  }
  return out
}

/** The naive version: the discontinuity landing wherever the sample grid happens to be. */
function naive(frequency: number, samples: number): Float64Array {
  const out = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    const t = (((i + 1) * frequency) / SR) % 1
    out[i] = 2 * t - 1
  }
  return out
}

function rms(data: Float64Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

function difference(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i]
  return out
}

/** Energy at one frequency, by correlating against a sine and a cosine at it. Same trick as
 *  `ladder.test.ts` in the engine. */
function magnitudeAt(data: Float64Array, frequency: number): number {
  let re = 0
  let im = 0
  for (let i = 0; i < data.length; i++) {
    // Phase (i+1), matching the VCO: it advances before it writes.
    const phase = (2 * Math.PI * frequency * (i + 1)) / SR
    re += data[i] * Math.cos(phase)
    im += data[i] * Math.sin(phase)
  }
  return (2 * Math.hypot(re, im)) / data.length
}

const mean = (data: Float64Array) => data.reduce((sum, x) => sum + x, 0) / data.length
const peak = (data: Float64Array) => data.reduce((max, x) => Math.max(max, Math.abs(x)), 0)

/** The first index where `ok` fails, or −1. One assertion per array rather than one per sample —
 *  see the comment on the same helper in `modules/svf.test.ts`. */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

describe('the oscillator', () => {
  it('suppresses the images a naive saw folds back', () => {
    // Aliasing is measurable exactly rather than approximately. Pick a frequency and a
    // harmonic whose image lands somewhere no harmonic of the fundamental is: a band-limited
    // saw has precisely nothing there, so whatever is there is alias and nothing else.
    //
    //   5000Hz, 8th harmonic at 40000 → folds to 4100
    //   5000Hz, 7th harmonic at 35000 → folds to 9100
    //   2000Hz, 22nd harmonic at 44000 → folds to 100... and 2100 is clear of every harmonic
    //   3000Hz, 14th harmonic at 42000 → folds to 2100
    //
    // Measured when this was written: 98x, 17x, 398x and 408x of suppression — 25dB at the
    // worst of them. A wrong SIGN on the correction would double the discontinuity instead of
    // removing it, so this is also the test that the blep goes the right way.
    const samples = SR
    for (const [frequency, image] of [
      [5000, 4100],
      [5000, 9100],
      [2000, 2100],
      [3000, 2100],
    ]) {
      const ideal = magnitudeAt(reference(frequency, samples), image)
      const blepped = magnitudeAt(run(frequency, samples), image)
      const raw = magnitudeAt(naive(frequency, samples), image)

      expect(ideal).toBeLessThan(1e-9)
      expect(raw).toBeGreaterThan(0.01)
      expect(blepped).toBeLessThan(raw / 10)
      expect(blepped).toBeLessThan(0.01)
    }
  })

  it('keeps the harmonics it is supposed to have', () => {
    // The other half of the claim, and the one PolyBLEP is weaker at: removing the images must
    // not cost the sound its top end. At 220Hz the first three harmonics land within 0.1% of
    // an ideal saw's 2/(πn). They roll off as the pitch rises — at 5kHz the third harmonic is
    // 3dB down on ideal — which is PolyBLEP's known in-band error and the price of it being
    // two multiplies rather than a wavetable.
    const samples = SR
    const audio = run(220, samples)
    for (const harmonic of [1, 2, 3]) {
      expect(magnitudeAt(audio, 220 * harmonic)).toBeCloseTo(2 / (Math.PI * harmonic), 3)
    }

    // And it is still recognisably the same waveform up high, rather than something PolyBLEP
    // has flattened into a sine.
    const high = run(5000, samples)
    expect(magnitudeAt(high, 5000)).toBeGreaterThan(0.9 * (2 / Math.PI))
    expect(magnitudeAt(high, 10000)).toBeGreaterThan(0.7 * (1 / Math.PI))
  })

  it('is closer to a band-limited saw than a naive one is', () => {
    // Broadband this time, which is a blunter measure — it mixes the alias PolyBLEP removes
    // with the top-end it costs, so the margin is a modest 2.3x to 2.6x across the range
    // rather than the 25dB the alias test shows. Worth keeping anyway: it is the one check
    // that would fail if the correction were doing net harm.
    for (const frequency of [500, 2000, 5000]) {
      const samples = Math.ceil(SR / 10)
      const ideal = reference(frequency, samples)
      const blepped = rms(difference(run(frequency, samples), ideal))
      const raw = rms(difference(naive(frequency, samples), ideal))
      expect(blepped).toBeLessThan(raw / 2)
    }
  })

  it('stays inside its range', () => {
    // PolyBLEP overshoots a little around the discontinuity, which is expected and fine. A
    // module whose output quietly exceeded ±1 would make every level and trim downstream of
    // it wrong.
    for (const shape of [SAW, PULSE, TRIANGLE]) {
      for (const frequency of [55, 440, 4000]) {
        expect(peak(run(frequency, 4096, shape))).toBeLessThan(1.2)
      }
    }
    expect(peak(run(440, 4096, SAW))).toBeGreaterThan(0.9)
  })

  it('makes three different waveforms', () => {
    const samples = 4096
    const saw = run(440, samples, SAW)
    const pulse = run(440, samples, PULSE)
    const triangle = run(440, samples, TRIANGLE)

    // A square is all peak and no slope, a triangle is all slope: RMS separates them cleanly
    // where a peak measurement would not.
    expect(rms(pulse)).toBeGreaterThan(0.9)
    expect(rms(saw)).toBeCloseTo(1 / Math.sqrt(3), 1)
    expect(rms(triangle)).toBeCloseTo(1 / Math.sqrt(3), 1)
    expect(rms(difference(saw, triangle))).toBeGreaterThan(0.3)
  })

  it('moves the pulse width where the knob says', () => {
    // The mean of a ±1 pulse is 2·width − 1, so this measures the duty cycle directly rather
    // than trusting that a width knob does something.
    for (const width of [0.1, 0.5, 0.9]) {
      const audio = run(441, Math.ceil(SR / 4), PULSE, width)
      expect(mean(audio)).toBeCloseTo(2 * width - 1, 1)
    }
  })

  it('reads its pitch per sample rather than once a block', () => {
    // The whole reason for owning the graph instead of using native nodes: any inlet can be
    // modulated at audio rate. A sweep applied per sample and the same sweep applied once a
    // block are different sounds, and only one of them is a modular.
    const samples = 2048
    const vco = new VcoProcessor(SR)
    const sweep = new Float32Array(samples)
    for (let i = 0; i < samples; i++) sweep[i] = (2 * i) / samples
    const params = [
      new Float32Array(samples),
      new Float32Array(samples),
      new Float32Array(samples).fill(0.5),
    ]
    const out = new Float32Array(samples)
    vco.process([sweep, new Float32Array(samples)], [out], params, samples)

    // Two octaves up over the window, so the second half must have far more zero crossings
    // than the first.
    const crossings = (from: number, to: number) => {
      let count = 0
      for (let i = from + 1; i < to; i++) if (out[i - 1] <= 0 && out[i] > 0) count++
      return count
    }
    expect(crossings(samples / 2, samples)).toBeGreaterThan(crossings(0, samples / 2) * 2)
  })

  it('deviates by one carrier frequency for an FM input of 1', () => {
    // Linear FM with the index in units of the carrier, so the timbre holds still as you play
    // up the keyboard. A constant FM input of 1.0 is therefore just an octave up.
    const samples = Math.ceil(SR / 4)
    const vco = new VcoProcessor(SR)
    const params = [
      new Float32Array(samples).fill(tuneFor(220)),
      new Float32Array(samples),
      new Float32Array(samples).fill(0.5),
    ]
    const out = new Float32Array(samples)
    vco.process([new Float32Array(samples), new Float32Array(samples).fill(1)], [out], params, samples)

    let crossings = 0
    for (let i = 1; i < samples; i++) if (out[i - 1] <= 0 && out[i] > 0) crossings++
    expect((crossings * SR) / samples).toBeCloseTo(440, -1)
  })

  it('goes quiet rather than backwards when FM drives it through zero', () => {
    // Through-zero FM is a real feature and this is not it. What matters is that a negative
    // frequency does not run the phase backwards and produce a NaN or a DC offset that the
    // rest of the patch inherits.
    const samples = 2048
    const vco = new VcoProcessor(SR)
    const params = [
      new Float32Array(samples).fill(tuneFor(220)),
      new Float32Array(samples),
      new Float32Array(samples).fill(0.5),
    ]
    const out = new Float32Array(samples)
    vco.process([new Float32Array(samples), new Float32Array(samples).fill(-4)], [out], params, samples)

    expect(firstBad(out, Number.isFinite)).toBe(-1)
    expect(peak(Float64Array.from(out))).toBeLessThan(1.2)
  })

  it('still works when serialised into a scope of its own', () => {
    // `worklet.ts` ships this class to the audio thread as `VcoProcessor.toString()`, and an
    // AudioWorkletGlobalScope shares no scope with this module. If it ever grows a reference
    // to an import, a module constant, or a compiler helper emitted alongside it, this throws
    // a ReferenceError here rather than going silent in the browser.
    const Rebuilt = new Function(
      `"use strict"; return ${VcoProcessor.toString()}`,
    )() as typeof VcoProcessor

    for (const shape of [SAW, PULSE, TRIANGLE]) {
      const original = run(440, 2048, shape)
      const copy = run(440, 2048, shape, 0.5, Rebuilt)
      expect([...copy]).toEqual([...original])
    }
  })
})
