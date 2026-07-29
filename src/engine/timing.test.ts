import { describe, expect, it } from 'vitest'
import { STEPS_PER_BEAT, secondsPerStep, stepTime, swingDelay } from './timing'

describe('tempo', () => {
  it('divides a beat into sixteenths', () => {
    // 120bpm is half a second a beat, so a sixteenth is an eighth of a second.
    expect(secondsPerStep(120)).toBeCloseTo(0.125)
    expect(secondsPerStep(60)).toBeCloseTo(0.25)
    expect(secondsPerStep(140) * STEPS_PER_BEAT * 140).toBeCloseTo(60)
  })
})

describe('swing', () => {
  it('leaves the on-beats alone', () => {
    for (const step of [0, 2, 4, 6, 14, 32]) {
      expect(swingDelay(step, 0.8, 0.125)).toBe(0)
    }
  })

  it('delays only the off-beats, and by more as it is turned up', () => {
    const light = swingDelay(1, 0.3, 0.125)
    const heavy = swingDelay(1, 0.9, 0.125)
    expect(light).toBeGreaterThan(0)
    expect(heavy).toBeGreaterThan(light)
  })

  it('is straight at zero', () => {
    for (let step = 0; step < 16; step++) expect(swingDelay(step, 0, 0.125)).toBe(0)
  })

  it('never pushes an off-beat past the step that follows it', () => {
    // Otherwise the sixteenths reorder and the pattern plays back scrambled.
    const stepSeconds = 0.125
    for (const swing of [0, 0.25, 0.5, 0.75, 1]) {
      expect(swingDelay(1, swing, stepSeconds)).toBeLessThan(stepSeconds)
    }
  })
})

describe('step times', () => {
  it('advances monotonically, swing or not', () => {
    for (const swing of [0, 0.4, 0.67, 1]) {
      let previous = -Infinity
      for (let step = 0; step < 64; step++) {
        const time = stepTime(10, step, 128, swing)
        expect(time).toBeGreaterThan(previous)
        previous = time
      }
    }
  })

  it('does not accumulate error over a long run', () => {
    // Computed from the origin rather than by repeated addition, so bar 200 is exactly
    // where it should be rather than a few milliseconds adrift.
    const bars = 200
    const steps = bars * 16
    const expected = 10 + steps * secondsPerStep(120)
    expect(stepTime(10, steps, 120, 0)).toBeCloseTo(expected, 9)
  })
})
