import { describe, expect, it } from 'vitest'
import { PING_PONG_MODULE, PingPongProcessor } from './ping-pong.js'

// A power-of-two sample rate makes the short test delays exactly representable as Float32 values. The
// assertions can then describe the topology rather than the rounding error in decimal milliseconds.
const SR = 1024

function fill(value: number, frames: number): Float32Array {
  return new Float32Array(frames).fill(value)
}

function render(
  frames: number,
  options: { time?: number; feedback?: number; timeCv?: number; feedbackCv?: number } = {},
) {
  const input = new Float32Array(frames)
  input[0] = 1
  const outLeft = new Float32Array(frames)
  const outRight = new Float32Array(frames)
  new PingPongProcessor(SR).process(
    [input, fill(options.timeCv ?? 0, frames), fill(options.feedbackCv ?? 0, frames)],
    [outLeft, outRight],
    [fill(options.time ?? 4 / SR, frames), fill(options.feedback ?? 0.5, frames)],
    frames,
  )
  return { outLeft, outRight }
}

describe('the ping-pong delay', () => {
  it('declares one mono input and one stereo output', () => {
    expect(PING_PONG_MODULE.inlets[0].stereo).not.toBe(true)
    expect(PING_PONG_MODULE.outlets).toEqual([{ id: 'out', name: 'Out', stereo: true }])
  })

  it('sends consecutive repeats to alternating speakers', () => {
    const { outLeft, outRight } = render(20)
    expect(outLeft[4]).toBeCloseTo(1, 7)
    expect(outRight[4]).toBe(0)
    expect(outLeft[8]).toBe(0)
    expect(outRight[8]).toBeCloseTo(0.5, 7)
    expect(outLeft[12]).toBeCloseTo(0.25, 7)
    expect(outRight[12]).toBe(0)
    expect(outLeft[16]).toBe(0)
    expect(outRight[16]).toBeCloseTo(0.125, 7)
  })

  it('is wet only and produces no repeat when feedback is zero', () => {
    const { outLeft, outRight } = render(16, { feedback: 0 })
    expect(outLeft[0]).toBe(0)
    expect(outRight[0]).toBe(0)
    expect(outLeft[4]).toBe(1)
    expect(Math.max(...outRight)).toBe(0)
    expect(Math.max(...outLeft.slice(5))).toBe(0)
  })

  it('halves its time for one octave of positive time CV', () => {
    const { outLeft } = render(12, { time: 8 / SR, timeCv: 1, feedback: 0 })
    expect(outLeft[3]).toBe(0)
    expect(outLeft[4]).toBeCloseTo(1, 7)
  })

  it('adds feedback CV and clamps the loop short of infinity', () => {
    const boosted = render(16, { feedback: 0.25, feedbackCv: 0.25 })
    expect(boosted.outRight[8]).toBeCloseTo(0.5, 7)

    const clamped = render(16, { feedback: 0.98, feedbackCv: 8 })
    expect(clamped.outRight[8]).toBeCloseTo(0.98, 7)
  })

  it('interpolates fractional delay times without stepping to a whole sample', () => {
    const { outLeft } = render(12, { time: 4.5 / SR, feedback: 0 })
    expect(outLeft[4]).toBeCloseTo(0.5, 7)
    expect(outLeft[5]).toBeCloseTo(0.5, 7)
  })

  it('contains non-finite input so the delay lines recover', () => {
    const frames = 16
    const processor = new PingPongProcessor(SR)
    const hostile = fill(Number.POSITIVE_INFINITY, frames)
    const zero = fill(0, frames)
    const outLeft = new Float32Array(frames)
    const outRight = new Float32Array(frames)
    const params = [fill(4 / SR, frames), fill(0.5, frames)]
    processor.process([hostile, zero, zero], [outLeft, outRight], params, frames)
    processor.process([zero, zero, zero], [outLeft, outRight], params, frames)
    expect([...outLeft, ...outRight].every(Number.isFinite)).toBe(true)
  })
})
