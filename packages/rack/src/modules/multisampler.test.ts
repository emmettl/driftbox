import { describe, expect, it } from 'vitest'
import {
  MULTISAMPLER_MODULE,
  MultisamplerProcessor,
  multisampleSlot,
  packMultisampleZones,
  unpackMultisampleZones,
  type MultisampleZone,
} from './multisampler.js'

const SR = 48_000
const FRAMES = 16
const ramp = (length: number) => Float32Array.from({ length }, (_, index) => index)
const constant = (length: number, value: number) => new Float32Array(length).fill(value)

const zone = (over: Partial<MultisampleZone> = {}): MultisampleZone => ({
  root: 60,
  low: 0,
  high: 127,
  velocityLow: 0,
  velocityHigh: 1,
  loopStart: 0,
  loopEnd: 1,
  loop: false,
  sampleRate: SR,
  ...over,
})

function params(frames = FRAMES, over: Partial<Record<'tune' | 'attack' | 'release' | 'velocity' | 'level', number>> = {}) {
  return MULTISAMPLER_MODULE.params.map((def) => new Float32Array(frames).fill(over[def.id as keyof typeof over] ?? (def.id === 'level' ? 1 : def.id === 'attack' ? 0 : def.default)))
}

function process(
  processor: MultisamplerProcessor,
  note: number,
  velocity: number,
  gate: (index: number) => number = () => 1,
  frames = FRAMES,
  over: Parameters<typeof params>[1] = {},
) {
  const pitch = new Float32Array(frames).fill((note - 36) / 12)
  const gateIn = Float32Array.from({ length: frames }, (_, index) => gate(index))
  const velocityIn = new Float32Array(frames).fill(velocity)
  const out = new Float32Array(frames)
  const env = new Float32Array(frames)
  processor.process([pitch, gateIn, velocityIn], [out, env], params(frames, over), frames)
  return { out, env }
}

function instrument(zones: MultisampleZone[], samples: Float32Array[]) {
  const values = new Map<string, Float32Array>([['zones', Float32Array.from(packMultisampleZones(zones))]])
  samples.forEach((sample, index) => values.set(multisampleSlot(index), sample))
  return new MultisamplerProcessor(SR, {}, 'instrument', { get: (slot) => values.get(slot) })
}

describe('the multisample instrument', () => {
  it('packs portable zone metadata without putting PCM in the patch', () => {
    const zones = [zone({ root: 48, low: 24, high: 59, loop: true, loopStart: 0.2, loopEnd: 0.8 })]
    expect(unpackMultisampleZones(packMultisampleZones(zones))).toEqual(zones)
    expect(multisampleSlot(3)).toBe('sample3')
  })

  it('plays the recording mapped to the pressed key', () => {
    const player = instrument(
      [zone({ root: 48, low: 0, high: 59 }), zone({ root: 72, low: 60, high: 127 })],
      [constant(100, 0.2), constant(100, 0.7)],
    )
    expect(process(player, 48, 1).out[0]).toBeCloseTo(0.2)

    const high = instrument(
      [zone({ root: 48, low: 0, high: 59 }), zone({ root: 72, low: 60, high: 127 })],
      [constant(100, 0.2), constant(100, 0.7)],
    )
    expect(process(high, 72, 1).out[0]).toBeCloseTo(0.7)
  })

  it('chooses velocity layers sharing the same key range', () => {
    const zones = [
      zone({ velocityLow: 0, velocityHigh: 0.49 }),
      zone({ velocityLow: 0.5, velocityHigh: 1 }),
    ]
    expect(process(instrument(zones, [constant(100, 0.25), constant(100, 0.8)]), 60, 0.3).out[0]).toBeCloseTo(0.25 * 0.3)
    expect(process(instrument(zones, [constant(100, 0.25), constant(100, 0.8)]), 60, 0.9).out[0]).toBeCloseTo(0.8 * 0.9)
  })

  it('plays relative to the root key and honours the source sample rate', () => {
    expect([...process(instrument([zone()], [ramp(100)]), 72, 1).out.slice(0, 4)]).toEqual([0, 2, 4, 6])
    const halfRate = instrument([zone({ sampleRate: SR / 2 })], [ramp(100)])
    expect([...process(halfRate, 60, 1).out.slice(0, 4)]).toEqual([0, 0.5, 1, 1.5])
  })

  it('loops between its zone points only while the gate is held', () => {
    const player = instrument([zone({ loop: true, loopStart: 0.2, loopEnd: 0.6 })], [ramp(10)])
    const held = process(player, 60, 1, () => 1, 10).out
    expect([...held.slice(0, 10)]).toEqual([0, 1, 2, 3, 4, 5, 2, 3, 4, 5])

    const released = process(player, 60, 1, () => 0, 8, { release: 0.001 })
    expect(released.out.some((sample) => sample !== 0)).toBe(true)
    expect(released.env[released.env.length - 1]).toBeLessThan(released.env[0])
  })

  it('latches the zone on the gate edge while pitch remains bendable', () => {
    const player = instrument(
      [zone({ root: 48, low: 0, high: 59 }), zone({ root: 72, low: 60, high: 127 })],
      [constant(200, 0.3), constant(200, -0.8)],
    )
    process(player, 48, 1, () => 1, 4)
    const bent = process(player, 72, 1, () => 1, 4)
    expect(bent.out.every((sample) => sample >= 0)).toBe(true)
  })

  it('is silent outside every key or velocity range and without PCM', () => {
    expect(process(instrument([zone({ low: 48, high: 60 })], [constant(20, 1)]), 80, 1).out.every((x) => x === 0)).toBe(true)
    expect(process(instrument([zone()], []), 60, 1).out.every((x) => x === 0)).toBe(true)
  })

  it('falls back to one full-keyboard root-C4 zone when only sample0 exists', () => {
    const sample = constant(20, 0.4)
    const player = new MultisamplerProcessor(SR, {}, 'instrument', {
      get: (slot) => (slot === 'sample0' ? sample : undefined),
    })
    expect(process(player, 60, 1).out[0]).toBeCloseTo(0.4)
  })

  it('is explicitly polyphonic and exposes a velocity-controlled envelope', () => {
    expect(MULTISAMPLER_MODULE.poly).toBe(true)
    expect(MULTISAMPLER_MODULE.inlets.map((port) => port.id)).toEqual(['pitch', 'gate', 'velocity'])
    expect(MULTISAMPLER_MODULE.outlets.map((port) => port.id)).toEqual(['out', 'env'])
  })
})
