import { describe, expect, it } from 'vitest'
import type { Transport } from '../types.js'
import { AUDIO_TRACK_MODULE, AudioTrackProcessor } from './audio-track.js'

const frames = 8
const params = (start = 0, level = 1) => [
  new Float32Array(frames).fill(start),
  new Float32Array(frames).fill(level),
]
const transport = (beat: number, running = true): Transport => ({
  tempo: 60,
  running,
  beat,
  beatsPerBlock: 2,
})

function track(left?: Float32Array, right?: Float32Array, sourceRate?: number) {
  const slots: Record<string, Float32Array | undefined> = {
    left,
    right,
    sampleRate: sourceRate ? Float32Array.of(sourceRate) : undefined,
  }
  const processor = new AudioTrackProcessor(4, {}, 'track', { get: (slot) => slots[slot] })
  const run = (at: number, start = 0, level = 1, running = true) => {
    const outputs = [new Float32Array(frames), new Float32Array(frames)]
    processor.process([], outputs, params(start, level), frames, transport(at, running))
    return outputs
  }
  return { run, slots }
}

describe('the audio track', () => {
  it('is a transport-owned stereo source', () => {
    expect(AUDIO_TRACK_MODULE.group).toBe('Sources')
    expect(AUDIO_TRACK_MODULE.inlets).toEqual([])
    expect(AUDIO_TRACK_MODULE.outlets[0]).toMatchObject({ id: 'out', stereo: true })
    expect(AUDIO_TRACK_MODULE.poly).toBe(false)
  })

  it('stays silent until its saved sixteenth position', () => {
    const { run } = track(Float32Array.from([1, 2, 3, 4]))
    // Start 4 is beat one. This block runs from beat zero up to (but not including) beat two.
    const [left, right] = run(0, 4)
    expect([...left]).toEqual([0, 0, 0, 0, 1, 2, 3, 4])
    expect([...right]).toEqual([...left])
  })

  it('preserves stereo, applies level and falls silent at the end', () => {
    const { run } = track(Float32Array.from([1, 2]), Float32Array.from([-1, -2]))
    const [left, right] = run(0, 0, 0.5)
    expect([...left]).toEqual([0.5, 1, 0, 0, 0, 0, 0, 0])
    expect([...right]).toEqual([-0.5, -1, 0, 0, 0, 0, 0, 0])
  })

  it('resets only when the transport stops and starts again', () => {
    const { run } = track(Float32Array.from({ length: 20 }, (_, index) => index + 1))
    expect([...run(0)[0]].slice(0, 3)).toEqual([1, 2, 3])
    expect([...run(2)[0]].slice(0, 3)).toEqual([9, 10, 11])
    expect([...run(4, 0, 1, false)[0]]).toEqual(Array(frames).fill(0))
    expect([...run(0)[0]].slice(0, 3)).toEqual([1, 2, 3])
  })

  it('replays when the host rewinds without processing a stopped block', () => {
    const { run } = track(Float32Array.from({ length: 20 }, (_, index) => index + 1))
    expect([...run(0)[0]].slice(0, 3)).toEqual([1, 2, 3])
    expect([...run(2)[0]].slice(0, 3)).toEqual([9, 10, 11])
    // A suspended AudioContext can receive Stop and Play messages before its next render quantum.
    expect([...run(0)[0]].slice(0, 3)).toEqual([1, 2, 3])
  })

  it('seeks into audio loaded after its start has passed', () => {
    const { run, slots } = track()
    expect([...run(2)[0]]).toEqual(Array(frames).fill(0))
    slots.left = Float32Array.from({ length: 20 }, (_, index) => index)
    // At beat two, eight samples have elapsed since a beat-zero start at four frames per beat.
    expect(run(2)[0][0]).toBe(8)
  })

  it('resamples session PCM without changing its pitch or duration', () => {
    const { run } = track(Float32Array.from([0, 2, 4, 6, 8]), undefined, 2)
    // The processor runs at 4 Hz, so a 2 Hz recording advances by half a source frame each output frame.
    expect([...run(0)[0]].slice(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})
