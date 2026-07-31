import { describe, expect, it } from 'vitest'
import { Rack } from './index.js'
import type { Patch } from './types.js'

describe('a host-fed rack source in Web Audio', () => {
  it('crosses a stereo worklet input and follows an ordinary rack cable', async () => {
    const sampleRate = 22_050
    const context = new OfflineAudioContext(2, sampleRate / 4, sampleRate)
    const patch: Patch = {
      modules: [
        { id: 'song', type: 'groovebox' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['song', 'tr808-l'], to: ['out', 'in'] }],
    }
    const rack = new Rack(context)
    rack.patch = patch
    expect(await rack.start()).toBe(true)
    rack.output?.connect(context.destination)

    const source = context.createConstantSource()
    source.offset.value = 0.2
    source.connect(rack.input(0)!)
    source.start(0)

    const rendered = await context.startRendering()
    const left = rendered.getChannelData(0)
    let average = 0
    for (const sample of left) average += sample
    average /= left.length

    expect(average).toBeCloseTo(0.2, 3)
    expect(rendered.getChannelData(1)).toEqual(left)
    rack.stop()
  })
})
