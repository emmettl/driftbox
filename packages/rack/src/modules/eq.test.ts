import { describe, expect, it } from 'vitest'
import { EQ_MODULE, EqProcessor } from './eq.js'

// An EQ is judged by its response curve, so that is what these measure — one frequency at a time with a
// Goertzel, the same ten lines `vocoder.test.ts` uses and for the same reason: there are a handful of
// frequencies worth asking about, and Goertzel answers exactly one each time with no dependency.
//
// The properties that matter are the ones a wrong cookbook formula breaks silently: flat means flat, a
// shelf leaves the far end alone, a band's gain in dB is the gain you asked for, and Q does something.

const SR = 44100
const FRAMES = 4096
const ORDER = ['low', 'lowFreq', 'mid', 'midFreq', 'q', 'high', 'highFreq'] as const

type Knobs = Partial<Record<(typeof ORDER)[number], number>>

/** A sine at `hz` through the EQ, both channels. The right gets a different signal so leakage would show. */
function through(hz: number, knobs: Knobs = {}, rightHz = hz) {
  const processor = new EqProcessor(SR)
  const left = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR))
  const right = Float32Array.from({ length: FRAMES }, (_, i) =>
    Math.sin((2 * Math.PI * rightHz * i) / SR),
  )
  const params = ORDER.map((id) => {
    const def = EQ_MODULE.params.find((p) => p.id === id)!
    return new Float32Array(FRAMES).fill(knobs[id] ?? def.default)
  })
  const outLeft = new Float32Array(FRAMES)
  const outRight = new Float32Array(FRAMES)
  processor.process([left, right], [outLeft, outRight], params, FRAMES)
  return { left: outLeft, right: outRight, dryLeft: left }
}

function magnitudeAt(samples: Float32Array, hz: number): number {
  // The settled second half, so the filter's start-up transient is not what gets measured.
  const from = Math.floor(samples.length / 2)
  const w = (2 * Math.PI * hz) / SR
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = from; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const n = samples.length - from
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / n
}

/** How much the EQ changed a tone, in dB. */
const gainAt = (hz: number, knobs: Knobs) => {
  const { left } = through(hz, knobs)
  const flat = through(hz, {}).left
  return 20 * Math.log10(magnitudeAt(left, hz) / magnitudeAt(flat, hz))
}

describe('the EQ', () => {
  it('is flat at its defaults, which is what lets it be dropped into a chain', () => {
    // Every band at zero must be arithmetically the identity, not merely close: an EQ that coloured the
    // sound before it was touched would be a bug nobody could see, only hear.
    const { left, dryLeft } = through(440)
    for (let i = 0; i < FRAMES; i++) expect(left[i]).toBeCloseTo(dryLeft[i], 5)
  })

  it('gives the low shelf the gain written on the knob', () => {
    // Well below the corner, where a shelf has reached its full lift. The `/40` in the cookbook's `A` is
    // exactly what makes this true, and getting it wrong gives half the dB or twice them.
    expect(gainAt(50, { low: 6, lowFreq: 200 })).toBeCloseTo(6, 0)
    expect(gainAt(50, { low: -6, lowFreq: 200 })).toBeCloseTo(-6, 0)
  })

  it('leaves the other end of the spectrum alone', () => {
    // What makes it a shelf rather than a gain knob. A low shelf that moved 8kHz would be a tilt.
    expect(Math.abs(gainAt(8000, { low: 12, lowFreq: 120 }))).toBeLessThan(0.5)
    expect(Math.abs(gainAt(60, { high: 12, highFreq: 6000 }))).toBeLessThan(0.5)
  })

  it('gives the high shelf the gain written on the knob', () => {
    expect(gainAt(14000, { high: 6, highFreq: 5000 })).toBeCloseTo(6, 0)
  })

  it('puts the mid band exactly where it is pointed', () => {
    // The thing nothing in the rack could do before: take 6dB out at one frequency and leave its
    // neighbours. A cut is the harder direction — the cookbook's peaking filter is not symmetric in the
    // code even though it is in the response, so both directions are worth asserting.
    expect(gainAt(1000, { mid: -6, midFreq: 1000, q: 2 })).toBeCloseTo(-6, 0)
    expect(gainAt(1000, { mid: 6, midFreq: 1000, q: 2 })).toBeCloseTo(6, 0)
    expect(Math.abs(gainAt(100, { mid: -6, midFreq: 1000, q: 2 }))).toBeLessThan(1)
    expect(Math.abs(gainAt(8000, { mid: -6, midFreq: 1000, q: 2 }))).toBeLessThan(1)
  })

  it('narrows the mid band as Q rises', () => {
    // Q is the one control the shelves deliberately do not have, so it had better do something.
    const wide = Math.abs(gainAt(500, { mid: 12, midFreq: 1000, q: 0.4 }))
    const narrow = Math.abs(gainAt(500, { mid: 12, midFreq: 1000, q: 6 }))
    // At the centre both are the full 12dB; an octave down, the narrow one has already let go.
    expect(gainAt(1000, { mid: 12, midFreq: 1000, q: 6 })).toBeCloseTo(12, 0)
    expect(narrow).toBeLessThan(wide / 2)
  })

  it('applies one curve to both channels and keeps them apart', () => {
    // Stereo because of where an EQ sits, not because the curve differs per side. Two independent state
    // sets sharing coefficients is what that means — and a state array indexed wrongly would show up here
    // as one channel filtering the other's signal.
    const knobs = { mid: -12, midFreq: 1000, q: 3 }
    const { left, right } = through(1000, knobs, 1000)
    expect(magnitudeAt(right, 1000)).toBeCloseTo(magnitudeAt(left, 1000), 6)

    // Different signals per channel: the left is notched at its own frequency and the right is not.
    const split = through(1000, knobs, 6000)
    expect(20 * Math.log10(magnitudeAt(split.left, 1000) / magnitudeAt(through(1000, {}).left, 1000)))
      .toBeCloseTo(-12, 0)
    expect(magnitudeAt(split.right, 6000)).toBeGreaterThan(magnitudeAt(split.left, 1000))
  })

  it('recovers rather than staying poisoned if it ever goes non-finite', () => {
    // The state reset exists because a biquad given a hostile coefficient can run away, and a NaN reaching
    // an AudioNode silences it for the life of the context. Feeding it an infinity is the cheapest way to
    // prove the recovery, and a filter that stayed dead afterwards would pass a finiteness check while
    // being permanently silent.
    const processor = new EqProcessor(SR)
    const params = ORDER.map((id) => {
      const def = EQ_MODULE.params.find((p) => p.id === id)!
      return new Float32Array(FRAMES).fill(def.default)
    })
    const hostile = new Float32Array(FRAMES).fill(Number.POSITIVE_INFINITY)
    const zero = new Float32Array(FRAMES)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)
    processor.process([hostile, zero], [outLeft, outRight], params, FRAMES)
    for (const x of outLeft) expect(Number.isFinite(x)).toBe(true)

    const tone = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / SR))
    processor.process([tone, zero], [outLeft, outRight], params, FRAMES)
    expect(magnitudeAt(outLeft, 440)).toBeGreaterThan(0.1)
  })
})
