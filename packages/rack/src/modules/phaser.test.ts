import { describe, expect, it } from 'vitest'
import { PHASER_MODULE, PhaserProcessor } from './phaser.js'

const SR = 48000
const FRAMES = 24000
const ORDER = ['rate', 'center', 'depth', 'feedback', 'mix'] as const

function parameters(overrides: Partial<Record<(typeof ORDER)[number], number>> = {}) {
  return ORDER.map((id) => {
    const def = PHASER_MODULE.params.find((param) => param.id === id)!
    return new Float32Array(FRAMES).fill(overrides[id] ?? def.default)
  })
}

function tone(
  frequency: number,
  overrides: Partial<Record<(typeof ORDER)[number], number>> = {},
  sweep = 0,
) {
  const input = Float32Array.from(
    { length: FRAMES },
    (_, i) => Math.sin((2 * Math.PI * frequency * i) / SR),
  )
  const outLeft = new Float32Array(FRAMES)
  const outRight = new Float32Array(FRAMES)
  new PhaserProcessor(SR).process(
    [input, input, new Float32Array(FRAMES).fill(sweep)],
    [outLeft, outRight],
    parameters(overrides),
    FRAMES,
  )
  return { input, outLeft, outRight }
}

function rms(signal: Float32Array): number {
  let energy = 0
  for (let i = FRAMES / 2; i < FRAMES; i++) energy += signal[i] * signal[i]
  return Math.sqrt(energy / (FRAMES / 2))
}

describe('the phaser', () => {
  it('passes both stereo channels exactly when its mix is dry', () => {
    const left = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i * 0.031) * 0.7)
    const right = Float32Array.from({ length: FRAMES }, (_, i) => Math.cos(i * 0.047) * 0.4)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)
    new PhaserProcessor(SR).process(
      [left, right, new Float32Array(FRAMES)],
      [outLeft, outRight],
      parameters({ mix: 0 }),
      FRAMES,
    )
    expect(outLeft).toEqual(left)
    expect(outRight).toEqual(right)
  })

  it('keeps magnitude flat through the allpass chain alone', () => {
    const rendered = tone(800, { center: 800, depth: 0, feedback: 0, mix: 1 })
    expect(rms(rendered.outLeft)).toBeCloseTo(rms(rendered.input), 2)
  })

  it('creates a deep notch only when allpass and dry meet', () => {
    const notched = tone(800, { center: 800, depth: 0, feedback: 0, mix: 0.5 })
    expect(rms(notched.outLeft)).toBeLessThan(rms(notched.input) * 0.12)
  })

  it('moves that notch by octaves from the Sweep inlet', () => {
    const atCenter = tone(1600, { center: 800, depth: 0, feedback: 0, mix: 0.5 }, 1)
    const withoutSweep = tone(1600, { center: 800, depth: 0, feedback: 0, mix: 0.5 }, 0)
    expect(rms(atCenter.outLeft)).toBeLessThan(rms(withoutSweep.outLeft) * 0.35)
  })

  it('opens a centred mono source into stereo motion', () => {
    const rendered = tone(500, { rate: 3, center: 900, depth: 0.9, feedback: 0.4, mix: 0.6 })
    let difference = 0
    for (let i = FRAMES / 2; i < FRAMES; i++) {
      difference += Math.abs(rendered.outLeft[i] - rendered.outRight[i])
    }
    expect(difference / (FRAMES / 2)).toBeGreaterThan(0.05)
  })

  it('recovers after non-finite input instead of poisoning six stages', () => {
    const processor = new PhaserProcessor(SR)
    const hostile = new Float32Array(FRAMES).fill(Number.POSITIVE_INFINITY)
    const zero = new Float32Array(FRAMES)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)
    processor.process([hostile, zero, zero], [outLeft, outRight], parameters(), FRAMES)
    expect([...outLeft, ...outRight].every(Number.isFinite)).toBe(true)

    const input = Float32Array.from({ length: FRAMES }, (_, i) => Math.sin(i * 0.04))
    processor.process([input, input, zero], [outLeft, outRight], parameters(), FRAMES)
    expect(Math.max(...outLeft)).toBeGreaterThan(0.1)
  })
})
