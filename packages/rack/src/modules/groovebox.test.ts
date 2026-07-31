import { describe, expect, it } from 'vitest'
import { GROOVEBOX_MODULE, GrooveboxProcessor } from './groovebox.js'

const frames = 4
const outputs = () =>
  GROOVEBOX_MODULE.outlets.map(() => new Float32Array(frames).fill(-999))

describe('the hosted groovebox source', () => {
  it('copies every stereo host input to its matching pair of rack outlets', () => {
    const inputs = Array.from({ length: 4 }, (_, section) => [
      new Float32Array(frames).fill(section * 10 + 1),
      new Float32Array(frames).fill(section * 10 + 2),
    ])
    const out = outputs()

    new GrooveboxProcessor().process([], out, [], frames, undefined, inputs)

    for (let section = 0; section < 4; section++) {
      expect([...out[section * 2]]).toEqual(new Array(frames).fill(section * 10 + 1))
      expect([...out[section * 2 + 1]]).toEqual(new Array(frames).fill(section * 10 + 2))
    }
  })

  it('duplicates a mono host input and writes silence for an absent one', () => {
    const mono = new Float32Array([0.1, 0.2, 0.3, 0.4])
    const out = outputs()

    new GrooveboxProcessor().process([], out, [], frames, undefined, [[mono]])

    expect(out[0]).toEqual(mono)
    expect(out[1]).toEqual(mono)
    for (const silent of out.slice(2)) expect([...silent]).toEqual([0, 0, 0, 0])
  })
})
