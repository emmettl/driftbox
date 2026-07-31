import { describe, expect, it } from 'vitest'
import { meterLabel, meterPosition, waveformPoints } from './meter-display.js'

describe('meter faceplate arithmetic', () => {
  it('maps the display from −48dB through +3dB', () => {
    expect(meterPosition(0)).toBe(0)
    expect(meterPosition(10 ** (-48 / 20))).toBeCloseTo(0)
    expect(meterPosition(1)).toBeCloseTo(48 / 51)
    expect(meterPosition(10 ** (3 / 20))).toBeCloseTo(1)
    expect(meterPosition(100)).toBe(1)
  })

  it('labels silence and level without leaking non-finite text', () => {
    expect(meterLabel(0)).toBe('−∞ dB')
    expect(meterLabel(1)).toBe('+0.0 dB')
    expect(meterLabel(0.5)).toBe('-6.0 dB')
  })

  it('turns a clipped waveform into bounded SVG points', () => {
    expect(waveformPoints(Float32Array.from([-2, 0, 2]), 100, 50)).toBe(
      '0.0,46.0 50.0,25.0 100.0,4.0',
    )
    expect(waveformPoints(new Float32Array(0), 100, 50)).toBe('0,25 100,25')
  })
})
