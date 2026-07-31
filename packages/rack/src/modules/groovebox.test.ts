import { describe, expect, it } from 'vitest'
import { GROOVEBOX_SECTIONS } from '@driftbox/engine'
import {
  GROOVEBOX_MODULE,
  GROOVEBOX_PORTS,
  GrooveboxProcessor,
} from './groovebox.js'

const frames = 4
const outputs = () =>
  GROOVEBOX_MODULE.outlets.map(() => new Float32Array(frames).fill(-999))
const params = (values: Record<string, number | number[]> = {}) =>
  GROOVEBOX_MODULE.params.map((def) => {
    const value = values[def.id] ?? def.default
    return typeof value === 'number' ? new Float32Array(frames).fill(value) : new Float32Array(value)
  })

describe('the hosted groovebox source', () => {
  it('copies every stereo host input to its matching pair of rack outlets', () => {
    const inputs = Array.from({ length: 4 }, (_, section) => [
      new Float32Array(frames).fill(section * 10 + 1),
      new Float32Array(frames).fill(section * 10 + 2),
    ])
    const out = outputs()

    new GrooveboxProcessor().process([], out, params(), frames, undefined, inputs)

    for (let section = 0; section < 4; section++) {
      expect([...out[section * 2]]).toEqual(new Array(frames).fill(section * 10 + 1))
      expect([...out[section * 2 + 1]]).toEqual(new Array(frames).fill(section * 10 + 2))
    }
  })

  it('duplicates a mono host input and writes silence for an absent one', () => {
    const mono = new Float32Array([0.1, 0.2, 0.3, 0.4])
    const out = outputs()

    new GrooveboxProcessor().process([], out, params(), frames, undefined, [[mono]])

    expect(out[0]).toEqual(mono)
    expect(out[1]).toEqual(mono)
    for (const silent of out.slice(2)) expect([...silent]).toEqual([0, 0, 0, 0])
  })

  it('applies sample-accurate level and balance pan to one section without touching the others', () => {
    const inputs = Array.from({ length: 4 }, () => [
      new Float32Array(frames).fill(0.8),
      new Float32Array(frames).fill(0.4),
    ])
    const ports = GROOVEBOX_PORTS.tr808
    const out = outputs()

    new GrooveboxProcessor().process(
      [],
      out,
      params({
        [ports.level]: [0.25, 0.5, 0.75, 1],
        [ports.pan]: [-1, -0.5, 0.5, 1],
      }),
      frames,
      undefined,
      inputs,
    )

    ;[0.2, 0.4, 0.3, 0].forEach((sample, i) => expect(out[0][i]).toBeCloseTo(sample))
    ;[0, 0.1, 0.3, 0.4].forEach((sample, i) => expect(out[1][i]).toBeCloseTo(sample))
    expect(out[2]).toEqual(inputs[1][0])
    expect(out[3]).toEqual(inputs[1][1])
  })

  it('silences only the muted authored machine', () => {
    const inputs = Array.from({ length: 4 }, (_, section) => [
      new Float32Array(frames).fill(section + 1),
      new Float32Array(frames).fill(section + 1),
    ])
    const out = outputs()

    new GrooveboxProcessor().process(
      [],
      out,
      params({ [GROOVEBOX_PORTS['303.a'].mute]: 1 }),
      frames,
      undefined,
      inputs,
    )

    expect([...out[4]]).toEqual([0, 0, 0, 0])
    expect([...out[5]]).toEqual([0, 0, 0, 0])
    expect(out[6]).toEqual(inputs[3][0])
    expect(out[7]).toEqual(inputs[3][1])
  })

  it('keeps the processor slots and the public section-control ids in one stable order', () => {
    expect(GROOVEBOX_MODULE.params.map((param) => param.id)).toEqual(
      GROOVEBOX_SECTIONS.flatMap((section) => {
        const ports = GROOVEBOX_PORTS[section]
        return [ports.level, ports.pan, ports.mute]
      }),
    )
  })

  it('publishes one post-strip reading for every authored machine', () => {
    const processor = new GrooveboxProcessor(48_000, {}, 'song')
    const inputs = Array.from({ length: 4 }, (_, section) => [
      new Float32Array(frames).fill((section + 1) * 0.1),
      new Float32Array(frames).fill((section + 1) * 0.1),
    ])

    processor.process(
      [],
      outputs(),
      params({
        [GROOVEBOX_PORTS.tr909.level]: 0.5,
        [GROOVEBOX_PORTS['303.a'].mute]: 1,
      }),
      frames,
      undefined,
      inputs,
    )

    const readings = processor.meters()
    expect(readings.map((reading) => reading.id)).toEqual([
      'song:tr808',
      'song:tr909',
      'song:303.a',
      'song:303.b',
    ])
    expect(readings[0].level).toBeCloseTo(0.1)
    expect(readings[1].level).toBeCloseTo(0.1)
    expect(readings[2].level).toBe(0)
    expect(readings[3].level).toBeCloseTo(0.4)
    expect(readings.every((reading) => reading.waveform.length === 48)).toBe(true)
  })
})
