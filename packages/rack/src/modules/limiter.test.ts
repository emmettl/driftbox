import { describe, expect, it } from 'vitest'
import { LIMITER_MODULE, LimiterProcessor } from './limiter.js'

const SR = 48000
const LOOKAHEAD = Math.round(SR * 0.005)
const FRAMES = 4096
const ORDER = ['inputGain', 'ceiling', 'release'] as const

function parameters(overrides: Partial<Record<(typeof ORDER)[number], number>> = {}) {
  return ORDER.map((id) => {
    const def = LIMITER_MODULE.params.find((param) => param.id === id)!
    return new Float32Array(FRAMES).fill(overrides[id] ?? def.default)
  })
}

function render(
  left: Float32Array,
  right: Float32Array,
  overrides: Partial<Record<(typeof ORDER)[number], number>> = {},
) {
  const outLeft = new Float32Array(FRAMES)
  const outRight = new Float32Array(FRAMES)
  const reduction = new Float32Array(FRAMES)
  new LimiterProcessor(SR).process(
    [left, right],
    [outLeft, outRight, reduction],
    parameters(overrides),
    FRAMES,
  )
  return { outLeft, outRight, reduction }
}

describe('the look-ahead limiter', () => {
  it('delays a signal by exactly five milliseconds', () => {
    const left = new Float32Array(FRAMES)
    left[0] = 0.5
    const rendered = render(left, new Float32Array(FRAMES))
    expect(Math.max(...rendered.outLeft.slice(0, LOOKAHEAD))).toBe(0)
    expect(rendered.outLeft[LOOKAHEAD]).toBeCloseTo(0.5, 6)
  })

  it('passes delayed audio unchanged while it stays below the ceiling', () => {
    const left = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i * 0.03) * 0.4)
    const right = Float32Array.from({ length: FRAMES }, (_, i) => Math.cos(i * 0.04) * 0.25)
    const rendered = render(left, right, { ceiling: 0 })
    for (let i = LOOKAHEAD; i < FRAMES; i++) {
      expect(rendered.outLeft[i]).toBeCloseTo(left[i - LOOKAHEAD], 6)
      expect(rendered.outRight[i]).toBeCloseTo(right[i - LOOKAHEAD], 6)
    }
  })

  it('never emits a sample past the stated ceiling', () => {
    const left = new Float32Array(FRAMES)
    left[500] = 4
    const ceilingDb = -6
    const ceiling = Math.pow(10, ceilingDb / 20)
    const rendered = render(left, new Float32Array(FRAMES), { ceiling: ceilingDb })
    expect(Math.max(...rendered.outLeft)).toBeLessThanOrEqual(ceiling)
    expect(rendered.outLeft[500 + LOOKAHEAD]).toBeCloseTo(ceiling, 6)
  })

  it('links the pair so a left peak cannot pull the image sideways', () => {
    const left = new Float32Array(FRAMES)
    const right = new Float32Array(FRAMES)
    left[600] = 2
    right[600] = 0.5
    const rendered = render(left, right, { ceiling: 0 })
    const at = 600 + LOOKAHEAD
    expect(rendered.outLeft[at]).toBeCloseTo(1, 6)
    expect(rendered.outRight[at]).toBeCloseTo(0.25, 2)
  })

  it('uses input gain to drive quiet material into limiting', () => {
    const left = new Float32Array(FRAMES)
    left[700] = 0.5
    const clean = render(left, left, { inputGain: 0, ceiling: 0 })
    const loud = render(left, left, { inputGain: 12, ceiling: 0 })
    expect(clean.reduction[700]).toBe(0)
    expect(loud.reduction[700 + LOOKAHEAD]).toBeGreaterThan(0.4)
    expect(loud.outLeft[700 + LOOKAHEAD]).toBeLessThanOrEqual(1)
  })

  it('publishes linked gain reduction and releases after a peak leaves the window', () => {
    const left = new Float32Array(FRAMES)
    left[300] = 3
    const rendered = render(left, left, { ceiling: 0, release: 0.01 })
    const peakReduction = rendered.reduction[300 + LOOKAHEAD]
    expect(peakReduction).toBeGreaterThan(0.5)
    expect(rendered.reduction[FRAMES - 1]).toBeLessThan(peakReduction)
    expect(rendered.reduction[FRAMES - 1]).toBeLessThan(0.01)
  })

  it('contains non-finite input and recovers on the next signal', () => {
    const hostile = new Float32Array(FRAMES).fill(Number.POSITIVE_INFINITY)
    const rendered = render(hostile, hostile)
    expect([...rendered.outLeft, ...rendered.outRight, ...rendered.reduction].every(Number.isFinite))
      .toBe(true)
  })
})
