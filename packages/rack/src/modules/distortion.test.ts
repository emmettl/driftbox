import { describe, expect, it } from 'vitest'
import { DISTORTION_MODULE, DistortionProcessor } from './distortion.js'

const SR = 48000
const FRAMES = 24000
const ORDER = ['mode', 'amount', 'tone', 'bias', 'level'] as const

function parameters(overrides: Partial<Record<(typeof ORDER)[number], number>> = {}) {
  return ORDER.map((id) => {
    const def = DISTORTION_MODULE.params.find((param) => param.id === id)!
    return new Float32Array(FRAMES).fill(overrides[id] ?? def.default)
  })
}

function process(
  left: Float32Array,
  right: Float32Array,
  overrides: Partial<Record<(typeof ORDER)[number], number>> = {},
  cv = 0,
) {
  const outLeft = new Float32Array(FRAMES)
  const outRight = new Float32Array(FRAMES)
  new DistortionProcessor(SR).process(
    [left, right, new Float32Array(FRAMES).fill(cv)],
    [outLeft, outRight],
    parameters(overrides),
    FRAMES,
  )
  return { outLeft, outRight }
}

function sine(frequency: number, level = 0.7): Float32Array {
  return Float32Array.from(
    { length: FRAMES },
    (_, i) => Math.sin((2 * Math.PI * frequency * i) / SR) * level,
  )
}

function rms(signal: Float32Array): number {
  let energy = 0
  for (let i = FRAMES / 2; i < FRAMES; i++) energy += signal[i] * signal[i]
  return Math.sqrt(energy / (FRAMES / 2))
}

describe('the multi-mode distortion', () => {
  it('names four genuinely stepped character modes', () => {
    const mode = DISTORTION_MODULE.params[0]
    expect(mode.stepped).toBe(true)
    expect(mode.labels).toEqual(['Tube', 'Tape', 'Fuzz', 'Digital'])
  })

  it('produces a different transfer curve in every mode', () => {
    const input = sine(317, 0.45)
    const outputs = [0, 1, 2, 3].map(
      (mode) => process(input, input, { mode, amount: 0.65, tone: 18000, level: 1 }).outLeft,
    )
    for (let a = 0; a < outputs.length; a++) {
      for (let b = a + 1; b < outputs.length; b++) {
        let difference = 0
        for (let i = FRAMES / 2; i < FRAMES; i++) difference += Math.abs(outputs[a][i] - outputs[b][i])
        expect(difference / (FRAMES / 2)).toBeGreaterThan(0.01)
      }
    }
  })

  it('lets Amount CV drive the nonlinear stage', () => {
    const input = sine(440, 0.2)
    const low = process(input, input, { mode: 0, amount: 0, tone: 18000 }, 0)
    const high = process(input, input, { mode: 0, amount: 0, tone: 18000 }, 0.8)
    let difference = 0
    for (let i = FRAMES / 2; i < FRAMES; i++) difference += Math.abs(low.outLeft[i] - high.outLeft[i])
    expect(difference / (FRAMES / 2)).toBeGreaterThan(0.05)
  })

  it('uses Tone after distortion to remove high harmonics', () => {
    const input = sine(5000, 0.8)
    const dark = process(input, input, { mode: 2, amount: 0.8, tone: 400, level: 1 })
    const open = process(input, input, { mode: 2, amount: 0.8, tone: 18000, level: 1 })
    expect(rms(dark.outLeft)).toBeLessThan(rms(open.outLeft) * 0.2)
  })

  it('keeps the two stereo channels independent', () => {
    const left = sine(700, 0.5)
    const silent = new Float32Array(FRAMES)
    const rendered = process(left, silent, { mode: 1, amount: 0.6, bias: 0, tone: 18000 })
    expect(rms(rendered.outLeft)).toBeGreaterThan(0.1)
    expect(rms(rendered.outRight)).toBe(0)
  })

  it('blocks the DC made by an asymmetric curve', () => {
    const input = sine(300, 0.5)
    const rendered = process(input, input, { mode: 2, amount: 0.7, bias: 0.4, tone: 18000 })
    let mean = 0
    for (let i = FRAMES / 2; i < FRAMES; i++) mean += rendered.outLeft[i]
    expect(Math.abs(mean / (FRAMES / 2))).toBeLessThan(0.01)
  })

  it('recovers after hostile input without leaking poison across channels', () => {
    const processor = new DistortionProcessor(SR)
    const hostile = new Float32Array(FRAMES).fill(Number.NaN)
    const zero = new Float32Array(FRAMES)
    const outLeft = new Float32Array(FRAMES)
    const outRight = new Float32Array(FRAMES)
    processor.process([hostile, zero, zero], [outLeft, outRight], parameters(), FRAMES)
    expect([...outLeft, ...outRight].every(Number.isFinite)).toBe(true)

    const input = sine(440)
    processor.process([input, input, zero], [outLeft, outRight], parameters(), FRAMES)
    expect(Math.max(...outLeft)).toBeGreaterThan(0.1)
  })
})
