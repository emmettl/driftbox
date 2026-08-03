import { describe, expect, it } from 'vitest'
import { loopTime } from './looper-display.js'

describe('looper faceplate time', () => {
  it('distinguishes an empty pedal from a very short take', () => {
    expect(loopTime(0)).toBe('EMPTY')
    expect(loopTime(0.125)).toBe('0:00.1')
  })

  it('formats the whole thirty-second capacity without losing tenths', () => {
    expect(loopTime(9.96)).toBe('0:10.0')
    expect(loopTime(30)).toBe('0:30.0')
    expect(loopTime(61.25)).toBe('1:01.3')
  })
})
