import { describe, expect, it } from 'vitest'
import { AUDIO_INPUT_MODULE, AudioInputProcessor } from './audio-input.js'

const frames = 4
const params = (level: number, channel: number) => [
  new Float32Array(frames).fill(level),
  new Float32Array(frames).fill(channel),
]

describe('audio input', () => {
  it('copies the selected live-input channel at the module level', () => {
    const processor = new AudioInputProcessor()
    const out = new Float32Array(frames)
    const hostInputs = Array.from({ length: 5 }, () => [] as Float32Array[])
    hostInputs[4] = [
      Float32Array.from([0.1, 0.2, 0.3, 0.4]),
      Float32Array.from([-0.1, -0.2, -0.3, -0.4]),
    ]

    processor.process([], [out], params(2, 1), frames, undefined, hostInputs)

    expect([...out]).toEqual([
      expect.closeTo(-0.2),
      expect.closeTo(-0.4),
      expect.closeTo(-0.6),
      expect.closeTo(-0.8),
    ])
  })

  it('uses the mono channel when the right channel is absent', () => {
    const processor = new AudioInputProcessor()
    const out = new Float32Array(frames)
    const hostInputs = Array.from({ length: 5 }, () => [] as Float32Array[])
    hostInputs[4] = [Float32Array.from([0.1, 0.2, 0.3, 0.4])]

    processor.process([], [out], params(1, 1), frames, undefined, hostInputs)

    expect([...out]).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
      expect.closeTo(0.4),
    ])
  })

  it('is a monophonic host source', () => {
    expect(AUDIO_INPUT_MODULE.poly).toBe(false)
  })
})
