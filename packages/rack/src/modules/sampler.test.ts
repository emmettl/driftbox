import { describe, expect, it } from 'vitest'
import { SAMPLER_MODULE, SamplerProcessor } from './sampler.js'

// The sampler, and mostly the slicing — which is the whole reason it exists. A break you can only loop is a drum
// loop; a break you can retrigger by slice is jungle.
//
// The test signal is a ramp, so a sample's *value* says where in the buffer it came from. That makes "did it play
// the right slice" a direct read rather than an inference, and it is what most of these assertions rest on.

const SR = 44100
const ORDER = ['slices', 'slice', 'start', 'loop', 'reverse'] as const

/** A buffer whose value at index i is i, so any sample reveals its own position. */
const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i)

interface Options {
  slices?: number
  slice?: number
  start?: number
  loop?: number
  reverse?: number
  pitch?: number
  sliceCv?: number
  /** Which samples the trigger is high for. */
  trig?: (i: number) => boolean
}

function run(sample: Float32Array | undefined, frames: number, options: Options = {}) {
  const data = { get: (slot: string) => (slot === 'sample' ? sample : undefined) }
  const processor = new SamplerProcessor(SR, {}, 's', data)

  const trig = new Float32Array(frames)
  const fire = options.trig ?? ((i: number) => i === 0)
  for (let i = 0; i < frames; i++) trig[i] = fire(i) ? 1 : 0

  const params = ORDER.map((id) => {
    const def = SAMPLER_MODULE.params.find((p) => p.id === id)!
    return new Float32Array(frames).fill(options[id] ?? def.default)
  })
  const out = new Float32Array(frames)
  const eoc = new Float32Array(frames)
  processor.process(
    [trig, new Float32Array(frames).fill(options.sliceCv ?? 0), new Float32Array(frames).fill(options.pitch ?? 0)],
    [out, eoc],
    params,
    frames,
  )
  return { out, eoc, processor, data, params }
}

describe('the sampler', () => {
  it('is silent with no sample loaded', () => {
    // A patch is usually built before a break is loaded into it, and a module that stopped writing its outlets
    // would leave the previous block's audio in the tail.
    const { out, eoc } = run(undefined, 64)
    expect([...out]).toEqual(Array(64).fill(0))
    expect([...eoc]).toEqual(Array(64).fill(0))
  })

  it('is silent until it is triggered', () => {
    const { out } = run(ramp(1000), 32, { trig: () => false })
    expect([...out]).toEqual(Array(32).fill(0))
  })

  it('plays from the start of the buffer on a trigger', () => {
    const { out } = run(ramp(1000), 8, { slices: 1 })
    // The ramp reveals the read position directly: 0, 1, 2 …
    expect([...out].slice(0, 4)).toEqual([0, 1, 2, 3])
  })

  it('plays the slice it was asked for', () => {
    // The point of the module. A 1000-sample buffer in ten slices puts slice 3 at sample 300.
    expect(run(ramp(1000), 4, { slices: 10, slice: 3 }).out[0]).toBe(300)
    expect(run(ramp(1000), 4, { slices: 10, slice: 7 }).out[0]).toBe(700)
    expect(run(ramp(1600), 4, { slices: 16, slice: 15 }).out[0]).toBe(1500)
  })

  it('stops at the end of its slice', () => {
    // Not at the end of the buffer. A slice that ran on into the next one would make every chop the same chop.
    const { out } = run(ramp(100), 40, { slices: 10 })
    // Slice 0 is samples 0-9, then silence.
    expect([...out].slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect([...out].slice(10, 40)).toEqual(Array(30).fill(0))
  })

  it('latches the slice at the trigger rather than following the knob', () => {
    // Reading it per sample would make a slice change mid-play jump the playhead into the middle of a different
    // drum, which is a glitch rather than an edit.
    const sample = ramp(1000)
    const data = { get: () => sample }
    const processor = new SamplerProcessor(SR, {}, 's', data)
    const frames = 16

    const params = ORDER.map((id) => {
      const def = SAMPLER_MODULE.params.find((p) => p.id === id)!
      return new Float32Array(frames).fill(def.default)
    })
    params[0].fill(10) // slices
    // The slice knob moves halfway through the block.
    for (let i = 0; i < frames; i++) params[1][i] = i < 8 ? 2 : 9

    const trig = new Float32Array(frames)
    trig[0] = 1
    const out = new Float32Array(frames)
    processor.process(
      [trig, new Float32Array(frames), new Float32Array(frames)],
      [out, new Float32Array(frames)],
      params,
      frames,
    )
    // Started in slice 2 at sample 200 and carried straight on, ignoring the knob.
    expect([...out].slice(0, 4)).toEqual([200, 201, 202, 203])
    expect(out[10]).toBe(210)
  })

  it('retriggers from the top of the new slice', () => {
    const { out } = run(ramp(1000), 20, {
      slices: 10,
      slice: 4,
      trig: (i) => i === 0 || i === 10,
    })
    expect(out[0]).toBe(400)
    // A second trigger restarts rather than continuing.
    expect(out[10]).toBe(400)
  })

  it('selects a slice from a CV across the whole set', () => {
    // Which is what makes a sample-and-hold on noise into a break mangler.
    expect(run(ramp(1000), 4, { slices: 10, slice: 0, sliceCv: 0.5 }).out[0]).toBe(500)
    expect(run(ramp(1000), 4, { slices: 10, slice: 0, sliceCv: 0.2 }).out[0]).toBe(200)
  })

  it('wraps a slice selection past the end instead of sticking on the last one', () => {
    // A sequencer or a random source sweeping past the end should come back round, not hammer slice 31.
    expect(run(ramp(1000), 4, { slices: 10, slice: 0, sliceCv: 1.3 }).out[0]).toBe(300)
    expect(run(ramp(1000), 4, { slices: 10, slice: 0, sliceCv: -0.2 }).out[0]).toBe(800)
  })

  it('plays backwards when reversed', () => {
    const { out } = run(ramp(100), 12, { slices: 10, slice: 5, reverse: 1 })
    // Slice 5 is samples 50-59; reversed it starts at 59 and counts down.
    expect([...out].slice(0, 4)).toEqual([59, 58, 57, 56])
  })

  it('loops within its slice rather than running on', () => {
    const { out } = run(ramp(100), 25, { slices: 10, slice: 0, loop: 1 })
    expect([...out].slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    // Back to the top of the same slice, not on into slice 1.
    expect([...out].slice(10, 14)).toEqual([0, 1, 2, 3])
  })

  it('starts partway in when the start knob is up', () => {
    const { out } = run(ramp(100), 8, { slices: 10, slice: 2, start: 0.5 })
    // Slice 2 is 20-29; half way in is 25.
    expect(out[0]).toBe(25)
  })

  it('plays an octave up at twice the rate', () => {
    // Octaves, like every other pitch inlet in the rack — so a break plays a fourth up from the same CV that
    // takes an oscillator up a fourth.
    const { out } = run(ramp(1000), 8, { slices: 1, pitch: 1 })
    expect([...out].slice(0, 4)).toEqual([0, 2, 4, 6])
    const down = run(ramp(1000), 8, { slices: 1, pitch: -1 })
    expect([...down.out].slice(0, 4)).toEqual([0, 0.5, 1, 1.5])
  })

  it('interpolates rather than stepping when the rate is not one', () => {
    // A break pitched down is the sound of the genre, and stepping the read pointer by whole samples turns that
    // into a buzz. A ramp interpolated is still a ramp, so the values land exactly between.
    const { out } = run(ramp(1000), 6, { slices: 1, pitch: -1 })
    for (let i = 1; i < 6; i++) expect(out[i] - out[i - 1]).toBeCloseTo(0.5, 6)
  })

  it('fires end-of-cycle when a slice finishes', () => {
    // What turns a chopped break into a pattern that plays itself: one slice triggering the next thing.
    const { eoc } = run(ramp(100), 30, { slices: 10 })
    let pulses = 0
    for (let i = 0; i < 30; i++) if (eoc[i] >= 0.5 && (i === 0 || eoc[i - 1] < 0.5)) pulses++
    expect(pulses).toBe(1)
  })

  it('notices a different break by identity alone', () => {
    // The whole change-detection protocol. A new array is new data; nothing subscribes to anything.
    let sample = ramp(100)
    const data = { get: () => sample }
    const processor = new SamplerProcessor(SR, {}, 's', data)
    const frames = 8
    const params = ORDER.map((id) => {
      const def = SAMPLER_MODULE.params.find((p) => p.id === id)!
      return new Float32Array(frames).fill(def.default)
    })
    params[0].fill(1)

    const trig = new Float32Array(frames)
    trig[0] = 1
    const first = new Float32Array(frames)
    processor.process([trig, new Float32Array(frames), new Float32Array(frames)], [first, new Float32Array(frames)], params, frames)
    expect(first[0]).toBe(0)

    // Swapped for a buffer whose values are offset, so the change is visible in the output.
    sample = Float32Array.from({ length: 100 }, (_, i) => 1000 + i)
    const second = new Float32Array(frames)
    processor.process([trig, new Float32Array(frames), new Float32Array(frames)], [second, new Float32Array(frames)], params, frames)
    expect(second[0]).toBe(1000)
  })

  it('survives a buffer too short to slice', () => {
    for (const length of [0, 1]) {
      const { out } = run(ramp(length), 16, { slices: 16 })
      expect([...out]).toEqual(Array(16).fill(0))
    }
  })

  it('stays finite at the edges of the buffer', () => {
    // The last slice's interpolation reads index+1, which is past the end.
    const { out } = run(ramp(100), 200, { slices: 1, pitch: 1, loop: 1 })
    for (const x of out) expect(Number.isFinite(x)).toBe(true)
  })
})
