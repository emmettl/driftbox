import { describe, expect, it } from 'vitest'
import { SCALE_PLAYER_MODULE, ScalePlayerProcessor } from './scale-player.js'

const FRAMES = 8
const constant = (value: number, frames = FRAMES) => new Float32Array(frames).fill(value)

function params(over: Record<string, number> = {}) {
  return SCALE_PLAYER_MODULE.params.map((param) => constant(over[param.id] ?? param.default))
}

function player(customScale?: number[]) {
  return new ScalePlayerProcessor(44100, {}, 'scale', {
    get: (slot) => slot === 'customScale' && customScale
      ? Float32Array.from(customScale)
      : undefined,
  })
}

function note(
  semitones: number,
  over: Record<string, number> = {},
  customScale?: number[],
) {
  const pitch = constant(semitones / 12)
  const gate = Float32Array.from([1, 1, 0, 0, 0, 0, 0, 0])
  const velocity = constant(0.75)
  const out = [new Float32Array(FRAMES), new Float32Array(FRAMES), new Float32Array(FRAMES)]
  player(customScale).process([pitch, gate, velocity], out, params(over), FRAMES)
  return out
}

describe('the scale player', () => {
  it('passes scale notes and corrects wrong notes to the closest degree', () => {
    expect(note(4)[0][0] * 12).toBeCloseTo(4)
    expect(note(3)[0][0] * 12).toBeCloseTo(2)
    expect(note(10)[0][0] * 12).toBeCloseTo(9)
    expect(note(11, { scale: 9 })[0][0] * 12).toBeCloseTo(12)
  })

  it('chooses the lower scale tone when two are equally close', () => {
    // F# lies halfway between F and G in C major.
    expect(note(6)[0][0] * 12).toBeCloseTo(5)
  })

  it('applies the selected key in negative and positive octaves', () => {
    // F is outside D major and ties between E and F#; the downward rule chooses E.
    expect(note(5, { key: 2 })[0][0] * 12).toBeCloseTo(4)
    expect(note(-1, { key: 2 })[0][0] * 12).toBeCloseTo(-1)
  })

  it('filters a wrong note without disturbing an allowed note', () => {
    const [, wrongGate, wrongVelocity] = note(1, { filter: 1 })
    const [, rightGate, rightVelocity] = note(2, { filter: 1 })
    expect([...wrongGate]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect([...wrongVelocity]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect([...rightGate.slice(0, 3)]).toEqual([1, 1, 0])
    expect(rightVelocity[0]).toBeCloseTo(0.75)
  })

  it('latches the note decision but preserves pitch bend during the gate', () => {
    const pitch = Float32Array.from([6 / 12, 6.5 / 12, 7 / 12, 8 / 12])
    const gate = constant(1, 4)
    const velocity = constant(1, 4)
    const out = [new Float32Array(4), new Float32Array(4), new Float32Array(4)]
    player().process(
      [pitch, gate, velocity],
      out,
      SCALE_PLAYER_MODULE.params.map((param) => constant(param.default, 4)),
      4,
    )
    const bent = [...out[0]].map((value) => value * 12)
    ;[5, 5.5, 6, 7].forEach((expected, index) => expect(bent[index]).toBeCloseTo(expected))
  })

  it('reads a portable custom-scale mask and falls back safely when it is empty', () => {
    const augmented = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    expect(note(7, { scale: 13 }, augmented)[0][0] * 12).toBeCloseTo(8)
    expect(note(3, { scale: 13 }, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])[0][0] * 12)
      .toBeCloseTo(2)
  })

  it('exposes a polyphonic pitch, gate and velocity transform', () => {
    expect(SCALE_PLAYER_MODULE.poly).toBe(true)
    expect(SCALE_PLAYER_MODULE.inlets.map((port) => port.id)).toEqual(['pitch', 'gate', 'velocity'])
    expect(SCALE_PLAYER_MODULE.outlets.map((port) => port.id)).toEqual(['pitch', 'gate', 'velocity'])
  })
})
