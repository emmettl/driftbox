import { describe, expect, it } from 'vitest'
import { DEFAULT_FX } from './effects.js'
import { MasterEffects } from './master-effects.js'

const energy = (data: Float32Array, from: number, to: number): number => {
  let total = 0
  for (let index = from; index < to; index++) total += Math.abs(data[index])
  return total / Math.max(1, to - from)
}

describe('the authored master insert chain', () => {
  it('opens the pattern-controlled filter envelope on an authored step', async () => {
    const rate = 16_000
    const context = new OfflineAudioContext(1, rate, rate)
    const effects = new MasterEffects(context)
    effects.output.connect(context.destination)
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 1_000
    oscillator.connect(effects.input)
    oscillator.start(0)
    oscillator.stop(1)

    const fx = {
      ...DEFAULT_FX,
      pcfAmount: 1,
      pcfCutoff: 0,
      pcfResonance: 0.2,
      pcfEnv: 1,
      pcfDecay: 0.25,
      compressor: 0,
    }
    effects.update(fx, 0, 0)
    effects.update(fx, 0.35, 1)

    const data = (await context.startRendering()).getChannelData(0)
    const closed = energy(data, Math.floor(rate * 0.2), Math.floor(rate * 0.3))
    const opened = energy(data, Math.floor(rate * 0.36), Math.floor(rate * 0.43))
    expect(opened).toBeGreaterThan(closed * 3)
  })
})
