import { describe, expect, it } from 'vitest'
import { TUNER_MODULE, TunerProcessor } from './tuner.js'

const SR = 48_000
const FRAMES = 128

function param(value: number): Float32Array {
  return new Float32Array(FRAMES).fill(value)
}

function feed(frequency: number, seconds = 0.3, mute = 0, harmonic = 0): {
  processor: TunerProcessor
  input: Float32Array
  output: Float32Array
} {
  const processor = new TunerProcessor(SR)
  let input = new Float32Array(FRAMES)
  let output = new Float32Array(FRAMES)
  const blocks = Math.ceil((seconds * SR) / FRAMES)
  for (let block = 0; block < blocks; block++) {
    input = Float32Array.from({ length: FRAMES }, (_, index) => {
      const at = block * FRAMES + index
      return (
        Math.sin((2 * Math.PI * frequency * at) / SR) * 0.4 +
        Math.sin((4 * Math.PI * frequency * at) / SR) * harmonic
      )
    })
    output = new Float32Array(FRAMES)
    processor.process([input], [output], [param(440), param(mute)], FRAMES)
  }
  return { processor, input, output }
}

describe('the chromatic tuner', () => {
  it('passes the instrument through sample for sample', () => {
    const { input, output } = feed(440)
    expect([...output]).toEqual([...input])
  })

  it('mutes the through path without muting its detector', () => {
    const { processor, output } = feed(440, 0.3, 1)
    expect(output.every((sample) => sample === 0)).toBe(true)
    expect(processor.meter().frequency).toBeCloseTo(440, 0)
  })

  it.each([
    ['low E', 82.4069],
    ['concert A', 440],
    ['high E', 659.255],
  ])('finds %s within one cent', (_name, frequency) => {
    const reading = feed(frequency).processor.meter()
    const cents = 1200 * Math.log2((reading.frequency ?? 0) / frequency)
    expect(Math.abs(cents)).toBeLessThan(1)
    expect(reading.clarity).toBeGreaterThan(0.9)
  })

  it('prefers the fundamental when a bright signal has a strong second harmonic', () => {
    const reading = feed(110, 0.3, 0, 0.3).processor.meter()
    expect(reading.frequency).toBeCloseTo(110, 0)
  })

  it('blanks rather than recycling an old note when the input falls silent', () => {
    const { processor } = feed(220)
    processor.process(
      [new Float32Array(FRAMES)],
      [new Float32Array(FRAMES)],
      [param(440), param(0)],
      FRAMES,
    )
    expect(processor.meter()).toMatchObject({ frequency: 0, clarity: 0 })
  })

  it('keeps reference pitch and silent tuning in patch state and runs once', () => {
    expect(TUNER_MODULE.params.map((entry) => entry.id)).toEqual(['reference', 'mute'])
    expect(TUNER_MODULE.poly).toBe(false)
  })
})
