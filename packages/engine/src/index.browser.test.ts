import { describe, expect, it } from 'vitest'
import { DriftboxEngine } from './index.js'
import { defaultSong } from './songs/index.js'

const peak = (buffer: AudioBuffer): number => {
  let value = 0
  for (const sample of buffer.getChannelData(0)) value = Math.max(value, Math.abs(sample))
  return value
}

async function render(destinationGain?: number): Promise<number> {
  const sampleRate = 44_100
  const context = new OfflineAudioContext(1, sampleRate, sampleRate)
  let destination: AudioNode | undefined
  if (destinationGain !== undefined) {
    const bus = context.createGain()
    bus.gain.value = destinationGain
    bus.connect(context.destination)
    destination = bus
  }

  const engine = new DriftboxEngine(defaultSong(), {
    context: context as unknown as AudioContext,
    destination,
  })
  engine.trigger('808.bd', 0.05, 1)
  const buffer = await context.startRendering()
  engine.dispose()
  return peak(buffer)
}

describe('a hosted engine output', () => {
  it('routes the complete mix through a supplied destination without bypassing it', async () => {
    expect(await render()).toBeGreaterThan(0.05)
    expect(await render(0)).toBe(0)
  })
})
