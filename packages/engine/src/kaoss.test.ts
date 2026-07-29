import { describe, expect, it } from 'vitest'
import { kaossReadout } from './kaoss.js'

// `Kaoss` itself owns filter nodes and is verified by measurement (recipe 8 in
// docs/VERIFYING-AUDIO.md). What is testable here is the mapping from a position on the
// pad to a filter setting — which is the part that decides whether the gesture feels
// like anything, and the part most likely to be broken by a well-meaning tidy-up.

describe('the pad mapping', () => {
  it('is open in the middle, so letting go is silent', () => {
    // A pad whose centre was not a true bypass would mean the mix changed the instant you
    // touched it anywhere, and never quite came back.
    expect(kaossReadout(0.5, 0).mode).toBe('open')
    expect(kaossReadout(0.5, 1).mode).toBe('open')
  })

  it('sweeps a lowpass to the left and a highpass to the right', () => {
    expect(kaossReadout(0.1, 0.5).mode).toBe('low')
    expect(kaossReadout(0.9, 0.5).mode).toBe('high')
  })

  it('shuts further the further left you go', () => {
    let previous = Infinity
    for (let x = 0.48; x >= 0; x -= 0.02) {
      const { hz } = kaossReadout(x, 0.5)
      expect(hz).toBeLessThan(previous)
      previous = hz
    }
  })

  it('opens further the further right you go', () => {
    let previous = 0
    for (let x = 0.52; x <= 1; x += 0.02) {
      const { hz } = kaossReadout(x, 0.5)
      expect(hz).toBeGreaterThan(previous)
      previous = hz
    }
  })

  it('stays where a filter can usefully be', () => {
    // A lowpass under about 80Hz and a highpass over about 6kHz are both silence, which
    // makes the corners of the pad dead travel rather than an effect.
    for (let x = 0; x <= 1; x += 0.01) {
      const { mode, hz } = kaossReadout(x, 0.5)
      if (mode === 'low') expect(hz).toBeGreaterThanOrEqual(89)
      if (mode === 'high') expect(hz).toBeLessThanOrEqual(6001)
    }
  })

  it('gives most of its travel to the useful range, not the top octave', () => {
    // Exponential, because cutoff is heard as a ratio. Linear would put half the sweep
    // between 10kHz and 20kHz, where almost nothing happens: the midpoint of the left
    // half should be nowhere near the arithmetic mean of its ends.
    const middle = kaossReadout(0.25, 0.5).hz
    expect(middle).toBeLessThan((90 + 20000) / 4)
  })

  it('takes resonance from the vertical, independent of the horizontal', () => {
    expect(kaossReadout(0.2, 1).q).toBeGreaterThan(kaossReadout(0.2, 0).q)
    expect(kaossReadout(0.2, 0.7).q).toBeCloseTo(kaossReadout(0.8, 0.7).q, 10)
  })

  it('keeps resonance short of the point a biquad clips the master on its own', () => {
    expect(kaossReadout(0.1, 1).q).toBeLessThanOrEqual(12)
  })

  it('survives a pointer that has left the element', () => {
    // Pointer capture keeps reporting outside the box, so out-of-range coordinates are
    // routine rather than exceptional.
    for (const [x, y] of [
      [-3, -3],
      [4, 4],
      [-0.2, 0.5],
      [1.2, 0.5],
    ]) {
      const { hz, q } = kaossReadout(x, y)
      expect(Number.isFinite(hz)).toBe(true)
      expect(Number.isFinite(q)).toBe(true)
      expect(q).toBeGreaterThanOrEqual(0)
    }
  })
})
