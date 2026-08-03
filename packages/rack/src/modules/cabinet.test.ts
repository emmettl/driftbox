import { describe, expect, it } from 'vitest'
import { CABINET_MODULE, CabinetProcessor } from './cabinet.js'

const SR = 48000
const FRAMES = 24000
const ORDER = ['cabinet', 'drive', 'bass', 'mid', 'treble', 'level'] as const

function parameters(overrides: Partial<Record<(typeof ORDER)[number], number>> = {}) {
  return ORDER.map((id) => {
    const def = CABINET_MODULE.params.find((param) => param.id === id)!
    return new Float32Array(FRAMES).fill(overrides[id] ?? def.default)
  })
}

function sine(frequency: number, level = 0.25): Float32Array {
  return Float32Array.from(
    { length: FRAMES },
    (_, i) => Math.sin((2 * Math.PI * frequency * i) / SR) * level,
  )
}

function render(
  frequency: number,
  overrides: Partial<Record<(typeof ORDER)[number], number>> = {},
  driveCv = 0,
) {
  const input = sine(frequency)
  const outLeft = new Float32Array(FRAMES)
  const outRight = new Float32Array(FRAMES)
  new CabinetProcessor(SR).process(
    [input, input, new Float32Array(FRAMES).fill(driveCv)],
    [outLeft, outRight],
    parameters(overrides),
    FRAMES,
  )
  return outLeft
}

function magnitudeAt(signal: Float32Array, frequency: number): number {
  let real = 0
  let imaginary = 0
  for (let i = FRAMES / 2; i < FRAMES; i++) {
    const phase = (2 * Math.PI * frequency * i) / SR
    real += signal[i] * Math.cos(phase)
    imaginary -= signal[i] * Math.sin(phase)
  }
  return (2 * Math.hypot(real, imaginary)) / (FRAMES / 2)
}

function rms(signal: Float32Array): number {
  let energy = 0
  for (let i = FRAMES / 2; i < FRAMES; i++) energy += signal[i] * signal[i]
  return Math.sqrt(energy / (FRAMES / 2))
}

describe('the amp and cabinet', () => {
  it('offers three named speaker voicings', () => {
    const cabinet = CABINET_MODULE.params[0]
    expect(cabinet.stepped).toBe(true)
    expect(cabinet.labels).toEqual(['Combo', 'Stack', 'Bright'])
  })

  it('removes direct-interface fizz above the guitar speaker range', () => {
    const low = magnitudeAt(render(500, { drive: 0.5 }), 500)
    const high = magnitudeAt(render(8000, { drive: 0.5 }), 8000)
    expect(high).toBeLessThan(low * 0.5)
  })

  it('makes Bright more open than Stack without changing module type', () => {
    const stack = magnitudeAt(render(8000, { cabinet: 1, drive: 0.5 }), 8000)
    const bright = magnitudeAt(render(8000, { cabinet: 2, drive: 0.5 }), 8000)
    expect(bright).toBeGreaterThan(stack * 2)
  })

  it('adds preamp harmonics as Drive rises', () => {
    const clean = render(400, { drive: 0.5, cabinet: 2 })
    const driven = render(400, { drive: 12, cabinet: 2 })
    const cleanThird = magnitudeAt(clean, 1200)
    const drivenThird = magnitudeAt(driven, 1200)
    expect(drivenThird).toBeGreaterThan(cleanThird * 5)
  })

  it('lets a cable drive the preamp', () => {
    const clean = render(400, { drive: 0.5, cabinet: 2 }, 0)
    const modulated = render(400, { drive: 0.5, cabinet: 2 }, 0.8)
    expect(magnitudeAt(modulated, 1200)).toBeGreaterThan(magnitudeAt(clean, 1200) * 4)
  })

  it('gives each tone control ownership of its band', () => {
    const bassFlat = magnitudeAt(render(100, { drive: 0.5 }), 100)
    const bassUp = magnitudeAt(render(100, { drive: 0.5, bass: 12 }), 100)
    const midFlat = magnitudeAt(render(800, { drive: 0.5 }), 800)
    const midUp = magnitudeAt(render(800, { drive: 0.5, mid: 12 }), 800)
    const trebleFlat = magnitudeAt(render(5000, { drive: 0.5 }), 5000)
    const trebleUp = magnitudeAt(render(5000, { drive: 0.5, treble: 12 }), 5000)
    expect(bassUp).toBeGreaterThan(bassFlat * 1.8)
    expect(midUp).toBeGreaterThan(midFlat * 1.8)
    expect(trebleUp).toBeGreaterThan(trebleFlat * 1.8)
  })

  it('keeps stereo channels independent', () => {
    const left = sine(700, 0.4)
    const zero = new Float32Array(FRAMES)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)
    new CabinetProcessor(SR).process(
      [left, zero, zero],
      [outLeft, outRight],
      parameters(),
      FRAMES,
    )
    expect(rms(outLeft)).toBeGreaterThan(0.1)
    expect(rms(outRight)).toBe(0)
  })

  it('recovers after non-finite input without poisoning the speaker state', () => {
    const processor = new CabinetProcessor(SR)
    const hostile = new Float32Array(FRAMES).fill(Number.NaN)
    const zero = new Float32Array(FRAMES)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)
    processor.process([hostile, zero, zero], [outLeft, outRight], parameters(), FRAMES)
    expect([...outLeft, ...outRight].every(Number.isFinite)).toBe(true)

    const input = sine(440)
    processor.process([input, input, zero], [outLeft, outRight], parameters(), FRAMES)
    expect(rms(outLeft)).toBeGreaterThan(0.05)
  })
})
