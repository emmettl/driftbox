import { describe, expect, it } from 'vitest'
import { DELAY_DIVISIONS, delayDivision } from './effects.js'

// `Sends` owns audio nodes, so it is verified by measurement rather than here — see
// docs/VERIFYING-AUDIO.md. What is testable without a context is the delay's tempo
// mapping, which is the part that decides whether the repeats reinforce the groove or
// smear it.

describe('the delay division', () => {
  it('always lands on a musical division of the bar', () => {
    // Snapped, not continuous. A delay that is not a division of the bar puts its
    // repeats between everything rather than between the beats.
    for (let knob = 0; knob <= 1.0001; knob += 0.01) {
      expect(DELAY_DIVISIONS).toContain(delayDivision(knob))
    }
  })

  it('covers the whole list, ends included', () => {
    const reached = new Set<number>()
    for (let knob = 0; knob <= 1.0001; knob += 0.005) reached.add(delayDivision(knob))
    expect([...reached].sort((a, b) => a - b)).toEqual([...DELAY_DIVISIONS])
  })

  it('gets longer as the knob goes up', () => {
    let previous = 0
    for (let knob = 0; knob <= 1.0001; knob += 0.01) {
      const division = delayDivision(knob)
      expect(division).toBeGreaterThanOrEqual(previous)
      previous = division
    }
  })

  it('offers the dotted eighth, and gives it the middle of the knob', () => {
    // Three sixteenths — the division that lands its repeats between the beats instead
    // of on them, which is why it is the one every record reaches for.
    expect(DELAY_DIVISIONS).toContain(3)
    expect(delayDivision(0.5)).toBe(4)
    expect(delayDivision(0.25)).toBe(3)
  })

  it('clamps a knob that has come from outside the UI', () => {
    expect(delayDivision(-5)).toBe(DELAY_DIVISIONS[0])
    expect(delayDivision(9)).toBe(DELAY_DIVISIONS[DELAY_DIVISIONS.length - 1])
  })
})
