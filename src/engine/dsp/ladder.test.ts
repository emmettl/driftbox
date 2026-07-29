import { describe, expect, it } from 'vitest'
import { Ladder } from './ladder'

// The ladder is pure arithmetic on numbers, so the things that actually make it a 303
// filter — that it self-oscillates, that it does so at the frequency you asked for,
// that it is four poles and not two — are measurable here rather than by ear. That is
// the same trick the voices use, applied one level lower down.

const SR = 44100

/** Run `samples` samples through a fresh filter and hand back what came out. */
function run(
  samples: number,
  input: (i: number) => number,
  cutoff: number,
  resonance: number,
): Float64Array {
  const filter = new Ladder(SR)
  const out = new Float64Array(samples)
  for (let i = 0; i < samples; i++) out[i] = filter.process(input(i), cutoff, resonance)
  return out
}

function rms(data: Float64Array, from = 0, to = data.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / (to - from))
}

/** Energy at one frequency, by correlating against a sine and cosine at it. */
function magnitudeAt(data: Float64Array, frequency: number, from = 0): number {
  let re = 0
  let im = 0
  for (let i = from; i < data.length; i++) {
    const phase = (2 * Math.PI * frequency * i) / SR
    re += data[i] * Math.cos(phase)
    im += data[i] * Math.sin(phase)
  }
  const n = data.length - from
  return (2 * Math.hypot(re, im)) / n
}

/** Zero crossings per second, which for a near-sine ring is twice its frequency. */
function ringFrequency(data: Float64Array, from: number): number {
  let crossings = 0
  for (let i = from + 1; i < data.length; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) crossings++
  }
  return (crossings * SR) / (data.length - from)
}

const sine = (frequency: number, gain = 0.5) => (i: number) =>
  gain * Math.sin((2 * Math.PI * frequency * i) / SR)

describe('the ladder filter', () => {
  it('passes what is below the cutoff and stops what is above it', () => {
    const settle = Math.floor(SR * 0.05)
    const total = settle + SR

    const input = 0.5 / Math.SQRT2 // RMS of a 0.5-amplitude sine
    const low = run(total, sine(100), 1000, 0.1)
    const high = run(total, sine(8000), 1000, 0.1)

    // Not all of it: a ladder subtracts its feedback from its input, so even a little
    // resonance costs some passband. Most of it, though — if this drops much further
    // the gain compensation in `process` has stopped working.
    expect(rms(low, settle)).toBeGreaterThan(input * 0.7)
    expect(rms(high, settle)).toBeLessThan(rms(low, settle) * 0.05)
  })

  it('rolls off at four poles rather than two', () => {
    // Two octaves above the corner, 24dB/octave should cost about 48dB — a factor of
    // 250. A biquad at 12dB/octave would only lose about 16, and that difference is
    // the entire reason this filter exists instead of a BiquadFilterNode.
    const settle = Math.floor(SR * 0.05)
    const total = settle + SR
    const cutoff = 500

    const at = (frequency: number) =>
      magnitudeAt(run(total, sine(frequency), cutoff, 0.1), frequency, settle)

    expect(at(cutoff) / at(cutoff * 4)).toBeGreaterThan(60)
  })

  it('self-oscillates at full resonance', () => {
    // A kick of input to get it going, then nothing. A four-pole ladder with enough
    // feedback keeps ringing on its own; this is the squelch at the top of the knob,
    // and it is the property a biquad cannot be talked into.
    const kick = (i: number) => (i < 8 ? 0.6 : 0)
    const total = Math.floor(SR * 0.6)
    const tail = Math.floor(SR * 0.4)

    const ringing = run(total, kick, 900, 1)
    expect(rms(ringing, tail)).toBeGreaterThan(0.1)
  })

  it('stops ringing when resonance is backed off', () => {
    const kick = (i: number) => (i < 8 ? 0.6 : 0)
    const total = Math.floor(SR * 0.6)
    const tail = Math.floor(SR * 0.4)

    // Same excitation, half the feedback: this one has to die away, or the knob does
    // nothing musical and every note squeals.
    expect(rms(run(total, kick, 900, 0.5), tail)).toBeLessThan(0.005)
  })

  it('self-oscillates at roughly the cutoff it was asked for', () => {
    // Tracking is what Huovilainen's tuning polynomials buy. Without them the pitch of
    // the self-oscillation drifts flat as the cutoff rises, and a resonant sweep stops
    // sounding like it is going anywhere near where the knob says.
    const kick = (i: number) => (i < 8 ? 0.6 : 0)
    const total = Math.floor(SR * 0.5)
    const settled = Math.floor(SR * 0.3)

    for (const cutoff of [300, 900, 2400]) {
      const ringing = run(total, kick, cutoff, 1)
      const measured = ringFrequency(ringing, settled)
      expect(Math.abs(measured - cutoff) / cutoff).toBeLessThan(0.12)
    }
  })

  it('stays bounded however hard it is driven', () => {
    // The tanh in each stage is inside the feedback loop, so a self-oscillating filter
    // limits itself instead of running away. Without it, full resonance plus a loud
    // input is an infinity in the audio graph and the tab goes silent for good.
    const loud = (i: number) => 4 * Math.sin((2 * Math.PI * 60 * i) / SR)
    const out = run(SR, loud, 400, 1)

    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true)
      expect(Math.abs(out[i])).toBeLessThan(2)
    }
  })

  it('is silent from a reset state with no input', () => {
    const out = run(1000, () => 0, 1000, 1)
    expect(rms(out)).toBe(0)
  })

  it('still works when serialised into a scope of its own', () => {
    // `worklet.ts` ships this filter to the audio thread as `Ladder.toString()`, and an
    // AudioWorkletGlobalScope shares no scope with this module. A `new Function` body
    // is the same deal, so this reproduces the failure exactly: if the class ever grows
    // a reference to an import, a module constant, or a compiler helper emitted
    // alongside it, this throws a ReferenceError here rather than going silent in the
    // browser the first time somebody plays a bassline.
    const Rebuilt = new Function(`"use strict"; return ${Ladder.toString()}`)() as typeof Ladder

    const original = new Ladder(SR)
    const copy = new Rebuilt(SR)
    for (let i = 0; i < 2000; i++) {
      const x = Math.sin(i * 0.05) * 0.5
      expect(copy.process(x, 900, 0.8)).toBe(original.process(x, 900, 0.8))
    }
  })
})
