import { describe, expect, it } from 'vitest'
import { audioTrackPosition, audioTrackStart } from './audio-track-display.js'

describe('audio track positions', () => {
  it('shows zero as bar one, step one', () => {
    expect(audioTrackPosition(0)).toEqual({ bar: 1, step: 1 })
  })

  it('round-trips positions at bar boundaries', () => {
    expect(audioTrackPosition(16)).toEqual({ bar: 2, step: 1 })
    expect(audioTrackStart(2, 1)).toBe(16)
    expect(audioTrackStart(4, 16)).toBe(63)
  })

  it('clamps edits to the module range', () => {
    expect(audioTrackStart(0, 0)).toBe(0)
    expect(audioTrackStart(80, 20)).toBe(1023)
    expect(audioTrackPosition(2000)).toEqual({ bar: 64, step: 16 })
  })
})
