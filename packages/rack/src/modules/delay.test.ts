import { describe, expect, it } from 'vitest'
import { DelayProcessor } from './delay.js'

const SR = 44100

function run(
  input: (i: number) => number,
  time: number,
  feedback: number,
  samples: number,
  timeCv: (i: number) => number = () => 0,
): Float64Array {
  const signal = new Float32Array(samples)
  const cv = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    signal[i] = input(i)
    cv[i] = timeCv(i)
  }
  const out = new Float32Array(samples)
  new DelayProcessor(SR).process(
    [signal, cv, new Float32Array(samples)],
    [out],
    [new Float32Array(samples).fill(time), new Float32Array(samples).fill(feedback)],
    samples,
  )
  return Float64Array.from(out)
}

/** Where the loudest sample is, in seconds. */
function peakAt(data: Float64Array, from = 0): number {
  let best = from
  for (let i = from; i < data.length; i++) {
    if (Math.abs(data[i]) > Math.abs(data[best])) best = i
  }
  return best / SR
}

const click = (at: number) => (i: number) => (i === at ? 1 : 0)

describe('the delay', () => {
  it('delays by the time it was asked for', () => {
    for (const time of [0.01, 0.1, 0.5]) {
      const data = run(click(0), time, 0, Math.ceil((time + 0.05) * SR))
      expect(peakAt(data)).toBeCloseTo(time, 3)
    }
  })

  it('repeats, quieter each time, and stops', () => {
    const time = 0.05
    const data = run(click(0), time, 0.5, Math.ceil(0.5 * SR))
    const echo = (n: number) => Math.abs(data[Math.round(n * time * SR)])

    expect(echo(1)).toBeCloseTo(1, 2)
    expect(echo(2)).toBeCloseTo(0.5, 2)
    expect(echo(3)).toBeCloseTo(0.25, 2)
    expect(echo(8)).toBeLessThan(0.01)
  })

  it('never sustains forever, even with the feedback knob at its top', () => {
    // 0.98 rather than 1: at exactly 1 the line never decays and every rounding error that enters it
    // stays there, so a delay left running quietly climbs until it is louder than what went in.
    const data = run(click(0), 0.01, 1, Math.ceil(4 * SR))
    const tail = data.slice(Math.floor(3.5 * SR))
    let peak = 0
    for (const x of tail) peak = Math.max(peak, Math.abs(x))
    expect(peak).toBeLessThan(0.01)
  })

  it('outputs wet only', () => {
    // No mix knob, deliberately — a mix knob inside a delay is a hidden two-channel mixer, and once
    // every module has one you cannot tell what a patch does by looking at the cables. So nothing
    // comes out before the first echo.
    const data = run(click(0), 0.1, 0.5, Math.ceil(0.09 * SR))
    for (const x of data) expect(Math.abs(x)).toBeLessThan(1e-6)
  })

  it('halves the time for one octave of CV', () => {
    // Octaves, like every other frequency-shaped inlet in the rack, so the same CV depth does the
    // same musical thing wherever the knob is set.
    const data = run(click(0), 0.2, 0, Math.ceil(0.3 * SR), () => 1)
    expect(peakAt(data)).toBeCloseTo(0.1, 3)
    const down = run(click(0), 0.1, 0, Math.ceil(0.3 * SR), () => -1)
    expect(peakAt(down)).toBeCloseTo(0.2, 3)
  })

  it('sweeps without stepping', () => {
    // The point of a fractional read. Stepping the pointer by whole samples turns a slow sweep into
    // a stairway of clicks, and chorus and flanging are exactly a delay whose time is swept by a few
    // milliseconds. A sweep of a steady tone must stay smooth sample to sample.
    const samples = Math.ceil(0.5 * SR)
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 300 * i) / SR)
    const data = run(tone, 0.02, 0, samples, (i) => (0.5 * i) / samples)

    let biggest = 0
    for (let i = Math.floor(0.1 * SR) + 1; i < samples; i++) {
      biggest = Math.max(biggest, Math.abs(data[i] - data[i - 1]))
    }
    // A 300Hz sine at 44.1kHz moves at most about 0.021 per sample. A whole-sample jump in the read
    // pointer would show up as a step far larger than that.
    expect(biggest).toBeLessThan(0.05)
  })

  it('recovers from a NaN instead of being poisoned by it', () => {
    // A NaN in a delay line is fed back into itself, so without the guard one bad sample silences the
    // module for the lifetime of the patch — and the Graph's output clamp cannot help, because the
    // corruption is inside the line rather than on the way out.
    const samples = Math.ceil(0.3 * SR)
    const signal = new Float32Array(samples)
    for (let i = 0; i < samples; i++) {
      signal[i] = i < 100 ? Number.NaN : 0.5 * Math.sin((2 * Math.PI * 200 * i) / SR)
    }
    const out = new Float32Array(samples)
    new DelayProcessor(SR).process(
      [signal, new Float32Array(samples), new Float32Array(samples)],
      [out],
      [new Float32Array(samples).fill(0.01), new Float32Array(samples).fill(0.5)],
      samples,
    )

    for (const x of out) expect(Number.isFinite(x)).toBe(true)
    // And it is still a delay afterwards, not a silenced one.
    let energy = 0
    for (let i = Math.floor(0.2 * SR); i < samples; i++) energy += out[i] * out[i]
    expect(Math.sqrt(energy / (samples - Math.floor(0.2 * SR)))).toBeGreaterThan(0.1)
  })

  it('is a comb filter at the bottom of the knob', () => {
    // A couple of milliseconds is short enough that the delay stops being an echo and becomes a
    // resonator, which is why the range goes that low.
    //
    // Measured as PERIODICITY rather than as pitch, and that distinction cost a wrong test first
    // time round: a comb resonates at every multiple of 1/T, not only at 1/T, so which partial
    // dominates depends entirely on what excited it. Counting zero crossings measured 1780Hz on a
    // 400Hz comb and both numbers were correct. Correlating the output against itself at a lag of
    // exactly T is the property that actually defines the thing.
    const period = Math.round(SR / 400)
    const data = run((i) => (i < 32 ? 1 : 0), period / SR, 0.9, Math.ceil(0.2 * SR))

    const correlation = (lag: number) => {
      let top = 0
      let left = 0
      let right = 0
      for (let i = Math.floor(0.05 * SR); i < data.length - lag; i++) {
        top += data[i] * data[i + lag]
        left += data[i] * data[i]
        right += data[i + lag] * data[i + lag]
      }
      return top / Math.sqrt(left * right)
    }

    expect(correlation(period)).toBeGreaterThan(0.9)
    // And not merely correlated with everything: half a period along it should not line up.
    expect(correlation(Math.round(period / 2))).toBeLessThan(0.6)
  })
})
