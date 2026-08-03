import { describe, expect, it } from 'vitest'
import { NOTE_ECHO_MODULE, NoteEchoProcessor } from './note-echo.js'
import type { Transport } from '../types.js'

const SR = 1000
const FRAMES = 32
const constant = (value: number, frames = FRAMES) => new Float32Array(frames).fill(value)

function params(over: Record<string, number> = {}, frames = FRAMES) {
  return NOTE_ECHO_MODULE.params.map((param) => constant(over[param.id] ?? param.default, frames))
}

function run(
  processor: NoteEchoProcessor,
  over: Record<string, number> = {},
  frames = FRAMES,
  transport?: Transport,
) {
  const pitch = constant(2, frames)
  const gate = Float32Array.from({ length: frames }, (_, index) => index < 2 ? 1 : 0)
  const velocity = constant(0.8, frames)
  const out = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)]
  processor.process([pitch, gate, velocity], out, params(over, frames), frames, transport)
  return out
}

const player = (steps?: number[]) => new NoteEchoProcessor(SR, {}, 'echo', {
  get: (slot) => slot === 'steps' && steps ? Float32Array.from(steps) : undefined,
})

describe('the note echo', () => {
  it('passes the dry note and adds the requested number of repeats', () => {
    const [, gate] = run(player(), { sync: 0, time: 4, repeats: 3, gate: 0.5 })
    expect([...gate.slice(0, 14)]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1])
  })

  it('transposes and changes velocity linearly on every repeat', () => {
    const [pitch, gate, velocity] = run(player(), {
      sync: 0,
      time: 4,
      repeats: 2,
      pitch: 3,
      velocity: 0.75,
      gate: 0.5,
    })
    expect(pitch[4]).toBeCloseTo(2.25)
    expect(velocity[4]).toBeCloseTo(0.6)
    expect(pitch[8]).toBeCloseTo(2.5)
    expect(velocity[8]).toBeCloseTo(0.4)
    expect(gate[4]).toBe(1)
    expect(gate[8]).toBe(1)
  })

  it('uses musical divisions when tempo sync is enabled', () => {
    const transport: Transport = { tempo: 120, running: true, beat: 0, beatsPerBlock: 0.1 }
    const [, gate] = run(player(), { sync: 1, division: 3, repeats: 1, gate: 0.5 }, 140, transport)
    // A sixteenth at 120 BPM is 125ms; SR is 1000 for a frame-to-millisecond assertion.
    expect(gate[124]).toBe(0)
    expect(gate[125]).toBe(1)
  })

  it('lets patch data mute dry and individual repeats without moving later echoes', () => {
    const steps = Array.from({ length: 17 }, () => 1)
    steps[0] = 0
    steps[2] = 0
    const [, gate] = run(player(steps), { sync: 0, time: 4, repeats: 3, gate: 0.5 })
    expect([...gate.slice(0, 14)]).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1])
  })

  it('starts a fresh train when its allocated voice is retriggered', () => {
    const processor = player()
    const pitch = constant(1, 12)
    const gate = Float32Array.from([1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    const velocity = constant(1, 12)
    const out = [new Float32Array(12), new Float32Array(12), new Float32Array(12)]
    processor.process([pitch, gate, velocity], out, params({ sync: 0, time: 4, repeats: 1 }, 12), 12)
    expect(out[1][4]).toBe(0)
    expect(out[1][7]).toBe(1)
  })

  it('is a polyphonic pitch, gate and velocity transform', () => {
    expect(NOTE_ECHO_MODULE.poly).toBe(true)
    expect(NOTE_ECHO_MODULE.inlets.map((port) => port.id)).toEqual(['pitch', 'gate', 'velocity'])
    expect(NOTE_ECHO_MODULE.outlets.map((port) => port.id)).toEqual(['pitch', 'gate', 'velocity'])
  })
})
