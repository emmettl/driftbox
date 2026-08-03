import { describe, expect, it } from 'vitest'
import { IMAGER_MODULE, ImagerProcessor } from './imager.js'

const SR = 48000
const FRAMES = 8192
const ORDER = ['lowWidth', 'highWidth', 'crossover'] as const

function parameterBuffers(overrides: Partial<Record<(typeof ORDER)[number], number>> = {}) {
  return ORDER.map((id) => {
    const def = IMAGER_MODULE.params.find((param) => param.id === id)!
    return new Float32Array(FRAMES).fill(overrides[id] ?? def.default)
  })
}

function sideGain(
  frequency: number,
  overrides: Partial<Record<(typeof ORDER)[number], number>>,
): number {
  const side = Float32Array.from(
    { length: FRAMES },
    (_, i) => Math.sin((2 * Math.PI * frequency * i) / SR),
  )
  const right = Float32Array.from(side, (sample) => -sample)
  const outLeft = new Float32Array(FRAMES)
  const outRight = new Float32Array(FRAMES)
  new ImagerProcessor(SR).process(
    [side, right],
    [outLeft, outRight],
    parameterBuffers(overrides),
    FRAMES,
  )

  let inputEnergy = 0
  let outputEnergy = 0
  for (let i = FRAMES / 2; i < FRAMES; i++) {
    inputEnergy += side[i] * side[i]
    const outputSide = (outLeft[i] - outRight[i]) * 0.5
    outputEnergy += outputSide * outputSide
  }
  return Math.sqrt(outputEnergy / inputEnergy)
}

describe('the stereo imager', () => {
  it('is transparent at its defaults', () => {
    const left = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i * 0.031) * 0.7)
    const right = Float32Array.from({ length: FRAMES }, (_, i) => Math.cos(i * 0.047) * 0.4)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)

    new ImagerProcessor(SR).process(
      [left, right],
      [outLeft, outRight],
      parameterBuffers(),
      FRAMES,
    )

    for (let i = 0; i < FRAMES; i++) {
      expect(outLeft[i]).toBeCloseTo(left[i], 6)
      expect(outRight[i]).toBeCloseTo(right[i], 6)
    }
  })

  it('collapses to the centre when both widths are zero', () => {
    const left = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i * 0.02))
    const right = Float32Array.from({ length: FRAMES }, (_, i) => Math.cos(i * 0.03))
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)

    new ImagerProcessor(SR).process(
      [left, right],
      [outLeft, outRight],
      parameterBuffers({ lowWidth: 0, highWidth: 0 }),
      FRAMES,
    )

    for (let i = 0; i < FRAMES; i++) {
      expect(outLeft[i]).toBeCloseTo((left[i] + right[i]) * 0.5, 6)
      expect(outRight[i]).toBeCloseTo(outLeft[i], 7)
    }
  })

  it('keeps a centred signal centred at every width', () => {
    const centre = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i * 0.04) * 0.6)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)

    new ImagerProcessor(SR).process(
      [centre, centre],
      [outLeft, outRight],
      parameterBuffers({ lowWidth: 0, highWidth: 2 }),
      FRAMES,
    )

    expect(outLeft).toEqual(centre)
    expect(outRight).toEqual(centre)
  })

  it('centres the low side while leaving the high side wide', () => {
    const settings = { lowWidth: 0, highWidth: 1, crossover: 250 }
    expect(sideGain(40, settings)).toBeLessThan(0.2)
    expect(sideGain(6000, settings)).toBeGreaterThan(0.95)
  })

  it('moves the band boundary with the crossover control', () => {
    const lowCrossover = sideGain(500, { lowWidth: 0, highWidth: 1, crossover: 80 })
    const highCrossover = sideGain(500, { lowWidth: 0, highWidth: 1, crossover: 1600 })
    expect(lowCrossover).toBeGreaterThan(0.95)
    expect(highCrossover).toBeLessThan(0.4)
  })

  it('recovers after a non-finite input instead of poisoning its crossover state', () => {
    const processor = new ImagerProcessor(SR)
    const hostile = new Float32Array(FRAMES).fill(Number.POSITIVE_INFINITY)
    const zero = new Float32Array(FRAMES)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)
    processor.process([hostile, zero], [outLeft, outRight], parameterBuffers(), FRAMES)
    expect([...outLeft].every(Number.isFinite)).toBe(true)

    const tone = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i * 0.04))
    processor.process([tone, zero], [outLeft, outRight], parameterBuffers(), FRAMES)
    expect(Math.max(...outLeft)).toBeGreaterThan(0.4)
    expect([...outRight].every(Number.isFinite)).toBe(true)
  })
})
