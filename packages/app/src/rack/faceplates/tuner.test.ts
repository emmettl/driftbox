import { describe, expect, it } from 'vitest'
import { tunerDisplay } from './tuner-display.js'

describe('tuner faceplate arithmetic', () => {
  it('names concert A without an error', () => {
    expect(tunerDisplay(440, 440, 0.99)).toMatchObject({
      detected: true,
      note: 'A',
      octave: 4,
      cents: 0,
    })
  })

  it('names notes across octave and accidental boundaries', () => {
    expect(tunerDisplay(82.4069, 440, 0.9)).toMatchObject({ note: 'E', octave: 2 })
    expect(tunerDisplay(277.1826, 440, 0.9)).toMatchObject({ note: 'C♯', octave: 4 })
  })

  it('measures cents against the saved reference pitch', () => {
    expect(tunerDisplay(445, 440, 0.9).cents).toBeCloseTo(19.56, 1)
    expect(tunerDisplay(445, 445, 0.9).cents).toBeCloseTo(0, 5)
  })

  it('shows no note for silence or an uncertain periodicity', () => {
    expect(tunerDisplay(0, 440, 1).detected).toBe(false)
    expect(tunerDisplay(440, 440, 0.2)).toMatchObject({ detected: false, note: '—' })
  })
})
