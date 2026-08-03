import { describe, expect, it } from 'vitest'
import { bassSteps } from './notation.js'

describe('bassline notation', () => {
  it('can author a paused pitch and a silent slide', () => {
    expect(bassSteps('5p 7ps 12as .')).toEqual([
      { note: 5, accent: false, slide: false, gate: false },
      { note: 7, accent: false, slide: true, gate: false },
      { note: 12, accent: true, slide: true },
      { note: null, accent: false, slide: false },
    ])
  })
})
