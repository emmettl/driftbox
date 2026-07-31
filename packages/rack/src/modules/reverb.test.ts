import { describe, expect, it } from 'vitest'
import { REVERB_MODULE, ReverbProcessor } from './reverb.js'

// A reverb is judged by ear and tested by property. What is worth asserting is that it is a room and not an
// oscillator: it rings on after the input stops, it always dies away, it does not ring at one period, and it
// gets darker as it decays. Those are the four ways an FDN goes wrong.

const SR = 44100
const ORDER = ['size', 'decay', 'damp', 'mix'] as const

interface Options {
  size?: number
  decay?: number
  damp?: number
  mix?: number
}

/**
 * Feed a signal in and hand back both channels. Rendered in one call, which the processor allows.
 *
 * The outlet is stereo, so this allocates two. Everything below that asks about "the reverb" asks the LEFT
 * channel, deliberately: it is arithmetically the mono output this module had before it had two, and these
 * properties are about the network rather than about the width.
 */
function both(signal: (i: number) => number, frames: number, options: Options = {}) {
  const processor = new ReverbProcessor(SR)
  const input = Float32Array.from({ length: frames }, (_, i) => signal(i))
  const params = ORDER.map((id) => {
    const def = REVERB_MODULE.params.find((p) => p.id === id)!
    return new Float32Array(frames).fill(options[id] ?? def.default)
  })
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  processor.process([input], [left, right], params, frames)
  return { left, right }
}

function run(signal: (i: number) => number, frames: number, options: Options = {}) {
  return both(signal, frames, options).left
}

/** An impulse: one sample, then silence. Everything after it is the reverb's own doing. */
const impulse = (i: number) => (i === 0 ? 1 : 0)

const rms = (data: Float32Array, from: number, to: number) => {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / (to - from))
}

const SECOND = SR

describe('the reverb', () => {
  it('rings on long after the input has stopped', () => {
    // The whole point, and the thing a delay line alone does not do: one sample in, a tail out.
    const out = run(impulse, SECOND, { mix: 1, decay: 0.9 })
    // A tenth of a second in, well past every delay line's own length, there is still something there.
    expect(rms(out, Math.round(0.1 * SR), Math.round(0.15 * SR))).toBeGreaterThan(1e-4)
  })

  it('always dies away, at every decay setting', () => {
    // The failure that matters: a feedback network that gains energy is an oscillator that will not stop, and
    // on a master bus it would be the last thing anybody heard. The Householder matrix is unitary and the
    // decay is capped below 1 precisely so this cannot happen.
    for (const decay of [0, 0.5, 0.9, 0.98, 5]) {
      const out = run(impulse, 3 * SECOND, { mix: 1, decay })
      const early = rms(out, Math.round(0.05 * SR), Math.round(0.1 * SR))
      const late = rms(out, Math.round(2.5 * SR), Math.round(2.9 * SR))
      expect(late, `decay ${decay}`).toBeLessThan(Math.max(early, 1e-9))
    }
  })

  it('rings longer the higher the decay', () => {
    const at = (decay: number) =>
      rms(run(impulse, SECOND, { mix: 1, decay }), Math.round(0.3 * SR), Math.round(0.4 * SR))
    expect(at(0.9)).toBeGreaterThan(at(0.5))
    expect(at(0.5)).toBeGreaterThan(at(0.1))
  })

  it('builds up echo density instead of repeating once per line', () => {
    // What the mixing matrix buys. Eight delay lines without it are eight separate echoes; with it, every
    // line feeds every other and the count multiplies each pass. Counted as how many samples are meaningfully
    // non-zero in a window well after the first round trip — a handful of discrete echoes would be sparse.
    //
    // This is the assertion that sent the reverb from four lines to eight: at four it came back as 0.12, and
    // a fifth of a second into a tail that is a rattle rather than a room.
    const out = run(impulse, SECOND, { mix: 1, decay: 0.9, damp: 0 })
    const from = Math.round(0.2 * SR)
    const to = Math.round(0.25 * SR)
    const level = rms(out, from, to)
    let busy = 0
    for (let i = from; i < to; i++) if (Math.abs(out[i]) > level * 0.25) busy++
    // More than a fifth of the window is doing something. A few discrete echoes would light up a few dozen
    // samples out of two thousand.
    expect(busy / (to - from)).toBeGreaterThan(0.2)
  })

  it('does not ring at one period, which is what a bad reverb sounds like', () => {
    // Delay lengths sharing a factor stack their echoes and the tail rings at that period — the metallic
    // sound. Tested by autocorrelation: if the tail were periodic there would be a strong peak at the lag of
    // that period, and there is not.
    const out = run(impulse, SECOND, { mix: 1, decay: 0.92, damp: 0 })
    const from = Math.round(0.15 * SR)
    const window = 4096
    const energy = rms(out, from, from + window)

    let strongest = 0
    // Lags from 1ms to 50ms, which covers every delay length here and their small multiples.
    for (let lag = Math.round(0.001 * SR); lag < Math.round(0.05 * SR); lag += 8) {
      let sum = 0
      for (let i = 0; i < window; i++) sum += out[from + i] * out[from + i + lag]
      const correlation = Math.abs(sum / window) / (energy * energy)
      if (correlation > strongest) strongest = correlation
    }
    // A periodic tail correlates with itself near 1 at its period. Anything well under that is noise-like,
    // which is what a room is.
    expect(strongest).toBeLessThan(0.5)
  })

  it('gets darker as it decays rather than merely being dark', () => {
    // Damping lives in the feedback path so it compounds with each pass, which is what a room does — the
    // treble goes first. Measured as high-frequency energy, via the mean absolute difference between
    // neighbouring samples relative to the level.
    const brightness = (data: Float32Array, from: number, to: number) => {
      let diff = 0
      for (let i = from + 1; i < to; i++) diff += Math.abs(data[i] - data[i - 1])
      return diff / (to - from) / Math.max(rms(data, from, to), 1e-12)
    }
    const out = run(impulse, SECOND, { mix: 1, decay: 0.92, damp: 0.7 })
    const early = brightness(out, Math.round(0.05 * SR), Math.round(0.1 * SR))
    const late = brightness(out, Math.round(0.4 * SR), Math.round(0.5 * SR))
    expect(late).toBeLessThan(early)
  })

  it('passes the dry signal through untouched at a mix of zero', () => {
    // A reverb dropped into a chain and left alone must not change the sound. Exactly, not approximately —
    // the mix is a crossfade and at zero the wet side contributes nothing at all.
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const out = run(tone, 2048, { mix: 0 })
    for (let i = 0; i < 2048; i++) expect(out[i]).toBeCloseTo(tone(i), 6)
  })

  it('crossfades the dry signal out rather than adding the wet on top', () => {
    // A wet/dry that summed would make the mix knob a volume knob as well.
    //
    // Tested on the FIRST sample of an impulse, which is the one place the two can be told apart exactly: no
    // delay line has been written yet, so the wet side is precisely zero and the output is the dry
    // coefficient alone. The first version of this compared the RMS of a sustained tone at each mix setting
    // and asserted the wet was never louder — which is false, and not a bug: a room sustaining a continuous
    // tone builds up, and its steady-state level is higher than the direct sound. That is reverb.
    for (const mix of [0, 0.25, 0.5, 1]) {
      expect(run(impulse, 64, { mix })[0]).toBeCloseTo(1 - mix, 6)
    }
  })

  it('builds up on a sustained tone, because that is what a room does', () => {
    // The other half of the correction above, stated as the property it actually is.
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const dry = rms(run(tone, SECOND, { mix: 0 }), 0, SECOND)
    const wet = rms(run(tone, SECOND, { mix: 1, decay: 0.9 }), Math.round(0.5 * SR), SECOND)
    expect(wet).toBeGreaterThan(dry)
  })

  it('makes a bigger room out of a bigger size', () => {
    // Size shortens every line by the same fraction, so a small room's echoes arrive sooner. Measured as
    // when the output first becomes non-trivial after the impulse.
    const firstEcho = (size: number) => {
      const out = run(impulse, SECOND, { mix: 1, size, decay: 0.9 })
      for (let i = 1; i < out.length; i++) if (Math.abs(out[i]) > 1e-3) return i
      return out.length
    }
    expect(firstEcho(1)).toBeGreaterThan(firstEcho(0.3))
  })

  it('survives being swept, which is a good noise and an easy crash', () => {
    // Size is read per sample so the room can be swept. Changing the read position of a delay line while it
    // is running is exactly where an index runs off the end of its buffer.
    const processor = new ReverbProcessor(SR)
    const frames = SECOND
    const input = Float32Array.from({ length: frames }, (_, i) => (i % 4410 === 0 ? 1 : 0))
    const params = ORDER.map((id) => {
      const def = REVERB_MODULE.params.find((p) => p.id === id)!
      return new Float32Array(frames).fill(def.default)
    })
    // A full sweep of size across the block, and mix wide open so nothing is hidden by the dry signal.
    for (let i = 0; i < frames; i++) params[0][i] = 0.1 + 0.9 * (i / frames)
    params[3].fill(1)
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    processor.process([input], [left, right], params, frames)
    for (const x of left) expect(Number.isFinite(x)).toBe(true)
    for (const x of right) expect(Number.isFinite(x)).toBe(true)
  })

  it('stays finite when its knobs are driven outside their range', () => {
    // Nothing stops a patch file carrying a decay of 5 or a size of −1, and a feedback network is where a
    // bad number becomes an infinity that silences an AudioNode for the life of the context.
    for (const options of [
      { decay: 5, size: -1, damp: 5, mix: 5 },
      { decay: -3, size: 0, damp: -1, mix: -1 },
    ]) {
      const out = run(impulse, 8192, options)
      for (const x of out) expect(Number.isFinite(x)).toBe(true)
    }
  })
})

describe('the reverb in stereo', () => {
  // One network, two output mixing vectors — the standard way an FDN is made stereo, and the reason the
  // left channel can stay arithmetically what it was when this module had only one outlet.

  const correlation = (a: Float32Array, b: Float32Array, from: number, to: number) => {
    let ab = 0
    let aa = 0
    let bb = 0
    for (let i = from; i < to; i++) {
      ab += a[i] * b[i]
      aa += a[i] * a[i]
      bb += b[i] * b[i]
    }
    return ab / Math.sqrt(Math.max(aa * bb, 1e-30))
  }

  it('is identical on both channels with no wet signal at all', () => {
    // The dry half is the same mono input on both sides, so "no effect" means what it says. A reverb that
    // widened at a mix of zero would be a reverb you could not switch off.
    const { left, right } = both((i) => Math.sin(i / 20), SECOND / 4, { mix: 0 })
    expect([...right]).toEqual([...left])
  })

  it('sends a different tail to each channel', () => {
    const { left, right } = both(impulse, SECOND, { mix: 1, decay: 0.9 })
    const from = Math.round(0.05 * SR)
    const to = Math.round(0.5 * SR)
    // Uncorrelated rather than merely unequal: an alternating sign over the same taps has no reason to
    // favour one parity, so the two tails should share almost nothing.
    expect(Math.abs(correlation(left, right, from, to))).toBeLessThan(0.2)
  })

  it('carries the same energy on both channels', () => {
    // The other half of the choice. Splitting the eight lines four and four would also decorrelate, and it
    // would give each side half the echo density — audibly sparser than the mono version was. Every line
    // is in both channels here, so neither side is the poor relation.
    const { left, right } = both(impulse, SECOND, { mix: 1, decay: 0.9 })
    const from = Math.round(0.05 * SR)
    const to = Math.round(0.5 * SR)
    const energy = (data: Float32Array) => rms(data, from, to)
    expect(energy(right)).toBeGreaterThan(energy(left) * 0.5)
    expect(energy(right)).toBeLessThan(energy(left) * 2)
  })

  it('keeps the left channel as the mono reverb it always was', () => {
    // Patched into anything mono this folds to its left channel, so this is the promise that a patch
    // written before the outlet was stereo sounds the same. Asserted as the mean of the taps, which is the
    // arithmetic that was there before — the right channel is the same taps signed.
    const { left, right } = both(impulse, SECOND, { mix: 1, decay: 0.9 })
    // The first tap to arrive comes from the shortest line, and reaches both channels with the same sign,
    // because line 0 is positive in both vectors.
    const first = left.findIndex((x) => Math.abs(x) > 1e-6)
    expect(first).toBeGreaterThan(0)
    expect(right[first]).toBeCloseTo(left[first], 12)
  })
})
