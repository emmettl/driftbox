import { describe, expect, it } from 'vitest'
import { SvfProcessor } from './svf.js'

// The claims in `svf.ts` are that it is two poles rather than four, that all four responses come
// out at once and are the responses they say they are, and that it stays stable where Chamberlin's
// topology would not. All four are measurable.

const SR = 44100
const LP = 0
const HP = 1
const BP = 2
const NOTCH = 3

function run(
  input: (i: number) => number,
  cutoff: number,
  resonance: number,
  samples = SR,
): Float64Array[] {
  const svf = new SvfProcessor(SR)
  const signal = new Float32Array(samples)
  for (let i = 0; i < samples; i++) signal[i] = input(i)
  const zero = new Float32Array(samples)
  const outs = [0, 1, 2, 3].map(() => new Float32Array(samples))
  const params = [
    new Float32Array(samples).fill(cutoff),
    new Float32Array(samples).fill(resonance),
  ]
  svf.process([signal, zero, zero], outs, params, samples)
  return outs.map((o) => Float64Array.from(o))
}

const sine = (frequency: number, gain = 0.5) => (i: number) =>
  gain * Math.sin((2 * Math.PI * frequency * i) / SR)

function magnitudeAt(data: Float64Array, frequency: number, from: number): number {
  let re = 0
  let im = 0
  for (let i = from; i < data.length; i++) {
    const phase = (2 * Math.PI * frequency * i) / SR
    re += data[i] * Math.cos(phase)
    im += data[i] * Math.sin(phase)
  }
  return (2 * Math.hypot(re, im)) / (data.length - from)
}

const SETTLE = Math.floor(SR * 0.1)
const at = (outs: Float64Array[], which: number, frequency: number) =>
  magnitudeAt(outs[which], frequency, SETTLE)

/**
 * The first index where `ok` fails, or −1.
 *
 * Not an `expect()` per sample. Vitest's `expect` is not free, and half a second of audio across
 * four outlets at three cutoffs is 264,000 of them — which passed locally in about three seconds and
 * blew the 5s per-test timeout on CI. That is the worst shape of failure to leave lying around,
 * because it reads as flakiness and is arithmetic. One assertion per array, and the index comes back
 * so a real failure still says where.
 */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

describe('the state-variable filter', () => {
  it('passes what is below the cutoff on LP and what is above it on HP', () => {
    const low = run(sine(100), 1000, 0)
    const high = run(sine(8000), 1000, 0)

    expect(at(low, LP, 100)).toBeGreaterThan(0.45)
    expect(at(high, LP, 8000)).toBeLessThan(0.02)
    expect(at(high, HP, 8000)).toBeGreaterThan(0.45)
    expect(at(low, HP, 100)).toBeLessThan(0.02)
  })

  it('rolls off at two poles, not four', () => {
    // This is the whole reason it exists next to the Ladder. Two octaves above the corner costs
    // about 24dB at 12dB/octave — a factor of 16 — where the Ladder's four poles cost 48dB and a
    // factor of 250. `ladder.test.ts` asserts the other side of the same comparison.
    const corner = 500
    const magnitude = (frequency: number) => at(run(sine(frequency), corner, 0), LP, frequency)
    const ratio = magnitude(corner) / magnitude(corner * 4)

    expect(ratio).toBeGreaterThan(8)
    expect(ratio).toBeLessThan(40)
  })

  it('peaks at the cutoff on BP and rejects it on notch', () => {
    // The two outlets nobody would get for free from a mode knob set to lowpass.
    const corner = 1000
    const outs = run(sine(corner), corner, 0)

    // The bandpass gain at the corner is exactly 1/k, and k is the damping — which at resonance 0
    // is 2. So a 0.5 input comes out at 0.25 and not at 0.5, which is the filter being right rather
    // than quiet: a bandpass with no resonance is a very wide, very gentle bump. Turning the knob up
    // is what makes it a bandpass anybody would describe as one.
    expect(at(outs, BP, corner)).toBeCloseTo(0.25, 2)
    expect(at(run(sine(corner), corner, 0.9), BP, corner)).toBeGreaterThan(1.5)

    expect(at(outs, NOTCH, corner)).toBeLessThan(0.05)
    // A notch only notches at its corner: two octaves away it should be nearly untouched.
    expect(at(run(sine(corner * 4), corner, 0), NOTCH, corner * 4)).toBeGreaterThan(0.4)
  })

  it('is a highpass plus a lowpass at every frequency', () => {
    // The identity the comment claims. Worth pinning because `notch` is computed by a shortcut
    // (`v0 - k*v1`) rather than by adding the two, and a sign slip there would be invisible.
    const outs = run(sine(700), 1400, 0.5)
    for (let i = SETTLE; i < SETTLE + 500; i++) {
      expect(outs[NOTCH][i]).toBeCloseTo(outs[HP][i] + outs[LP][i], 5)
    }
  })

  it('raises the peak as resonance comes up', () => {
    const corner = 1000
    const flat = at(run(sine(corner), corner, 0), LP, corner)
    const resonant = at(run(sine(corner), corner, 0.9), LP, corner)
    expect(resonant / flat).toBeGreaterThan(3)
  })

  it('stays stable at a cutoff a Chamberlin filter would not survive', () => {
    // The reason for the topology-preserving transform and its `tan` prewarping. Chamberlin's
    // two-multiply form goes unstable above about a sixth of the sample rate, which is exactly where
    // a filter sweep is most exciting — so the failure would be a sweep that blows up at the top.
    for (const cutoff of [12000, 17000, 18000]) {
      const outs = run(sine(1000, 0.9), cutoff, 1, SR / 2)
      for (const which of [LP, HP, BP, NOTCH]) {
        expect(
          firstBad(outs[which], (x) => Number.isFinite(x) && Math.abs(x) < 20),
          `outlet ${which} at ${cutoff}Hz`,
        ).toBe(-1)
      }
    }
  })

  it('does not self-oscillate at full resonance', () => {
    // Deliberately unlike the Ladder, which does and is meant to. The damping bottoms out at 0.04
    // rather than 0, so a transient rings and then dies instead of ringing forever.
    const kick = (i: number) => (i < 8 ? 0.8 : 0)
    const outs = run(kick, 900, 1, Math.floor(SR * 0.8))
    const tail = outs[BP].slice(Math.floor(SR * 0.6))
    let sum = 0
    for (const x of tail) sum += x * x
    expect(Math.sqrt(sum / tail.length)).toBeLessThan(0.01)
  })

  it('sweeps from a cable without stepping', () => {
    // The cutoff inlet is read per sample. If it were only read once a block, a fast sweep would
    // move in 2.9ms stairs and a filter envelope would buzz at 344Hz.
    const samples = SR
    const svf = new SvfProcessor(SR)
    const signal = new Float32Array(samples)
    const sweep = new Float32Array(samples)
    for (let i = 0; i < samples; i++) {
      signal[i] = 0.5 * Math.sin((2 * Math.PI * 2000 * i) / SR)
      sweep[i] = (4 * i) / samples
    }
    const outs = [0, 1, 2, 3].map(() => new Float32Array(samples))
    svf.process(
      [signal, sweep, new Float32Array(samples)],
      outs,
      [new Float32Array(samples).fill(200), new Float32Array(samples).fill(0.3)],
      samples,
    )

    // Four octaves up from 200Hz crosses the 2kHz test tone, so the lowpass output must go from
    // nearly nothing to nearly all of it.
    const early = Float64Array.from(outs[LP].slice(0, 2000))
    const late = Float64Array.from(outs[LP].slice(samples - 2000))
    const level = (d: Float64Array) => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)
    expect(level(late) / (level(early) + 1e-9)).toBeGreaterThan(5)
  })
})
