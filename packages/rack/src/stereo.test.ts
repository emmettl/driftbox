import { describe, expect, it } from 'vitest'
import { channelCount, folds, slotCount, wire } from './stereo.js'
import type { Port } from './types.js'

const mono = (id: string): Port => ({ id, name: id })
const stereo = (id: string): Port => ({ id, name: id, stereo: true })

describe('how many buffers a port owns', () => {
  it('is one unless the port says otherwise', () => {
    // The whole reason this change costs the other twenty-seven modules nothing: silence means mono.
    expect(channelCount(mono('in'))).toBe(1)
    expect(channelCount(stereo('in'))).toBe(2)
  })

  it('adds up across a side of a module', () => {
    expect(slotCount([mono('a'), stereo('b'), mono('c')])).toBe(4)
  })

  it('is zero for a module with no ports at all', () => {
    expect(slotCount([])).toBe(0)
  })
})

describe('wiring one port to another', () => {
  it('carries both channels between two stereo ports', () => {
    expect(wire([7, 8], 2)).toEqual([7, 8])
  })

  it('centres a mono source into a stereo destination', () => {
    // The same buffer twice — no copy and no allocation, which is the same trick every unconnected inlet
    // in the patch already plays with the zero buffer.
    expect(wire([7], 2)).toEqual([7, 7])
  })

  it('takes the left channel into a mono destination', () => {
    // Reason's rule, and its jacks say so: "L (Mono)". A sum would cost a scratch buffer and a copy per
    // block and would add 6dB to any centred signal. The Mixer is one module away for anybody who wants it.
    expect(wire([7, 8], 1)).toEqual([7])
  })

  it('passes a mono source to a mono destination unchanged', () => {
    expect(wire([7], 1)).toEqual([7])
  })

  it('is total, so an unconnected inlet still reads silence on every channel', () => {
    // The property that must not break: no module ever has to branch on whether it is patched.
    expect(wire([0], 1)).toEqual([0])
    expect(wire([0], 2)).toEqual([0, 0])
    expect(wire([], 2)).toEqual([0, 0])
  })
})

describe('explaining a fold', () => {
  it('is only a fold when a stereo source meets a mono destination', () => {
    expect(folds(stereo('out'), mono('in'))).toBe(true)
    expect(folds(stereo('out'), stereo('in'))).toBe(false)
    expect(folds(mono('out'), mono('in'))).toBe(false)
    // Not a fold: a mono source widens without losing anything.
    expect(folds(mono('out'), stereo('in'))).toBe(false)
  })
})
