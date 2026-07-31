import { describe, expect, it } from 'vitest'
import { AUTOMATION_TARGET, setAutomationPoint } from './automation.js'
import { DEFAULT_FX } from './effects.js'
import { songBars } from './pattern.js'
import { planSong } from './schedule.js'
import { acidSong, defaultSong } from './songs/index.js'
import { renderMix, renderStems } from './stems.js'

describe('stem preview windows', () => {
  it('renders only the requested window plus its tail', async () => {
    const song = acidSong()
    const hit = planSong(song, songBars(song)).flatMap((step) => step.drums)[0]
    const start = Math.max(0, hit.time - 0.25)
    const [stem] = await renderStems(song, {
      only: [hit.voiceId],
      start,
      duration: 1,
      tail: 0.25,
      sampleRate: 8000,
      useLadder: false,
    })

    expect(stem.voiceId).toBe(hit.voiceId)
    expect(stem.buffer.duration).toBeCloseTo(1.25, 2)
    const signal = stem.buffer.getChannelData(0)
    expect(signal.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
  })
})

describe('mastered song mix', () => {
  it('renders a stereo window through the complete authored bus', async () => {
    const buffer = await renderMix(acidSong(), {
      // The two-bar intro is deliberately centred; the panned clap and open hat arrive
      // in the Acid section after it.
      duration: 5,
      tail: 0.25,
      sampleRate: 8000,
      useLadder: false,
    })

    expect(buffer.numberOfChannels).toBe(2)
    expect(buffer.duration).toBeCloseTo(5.25, 2)
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    expect(left.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
    expect(right.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
    // The acid song pans its clap, hats and rim. Identical channels would mean the
    // offline route collapsed the stereo panners before writing the file.
    expect(left.some((sample, index) => Math.abs(sample - right[index]) > 0.00001)).toBe(true)
  })

  it('applies global effect automation at its offline song time', async () => {
    const seed = defaultSong()
    const rest = { note: null, accent: false, slide: false }
    const song = {
      ...seed,
      patterns: [{
        id: 'echo',
        name: 'Echo',
        length: 4,
        tracks: {},
        bass: {
          '303.a': [
            { note: 0, accent: false, slide: false },
            rest,
            rest,
            rest,
          ],
        },
      }],
      chain: [{ pattern: 'echo', repeat: 1 }],
      kit: {
        ...seed.kit,
        sends: { '303.a': { delay: 1, reverb: 0 } },
      },
      fx: { ...(seed.fx ?? DEFAULT_FX), delayFeedback: 0 },
    }
    const automated = setAutomationPoint(
      song,
      AUTOMATION_TARGET.fx('delayFeedback'),
      0,
      1,
      1,
    )
    const options = { tail: 1, sampleRate: 8000, useLadder: false }
    const [dryEcho, repeatingEcho] = await Promise.all([
      renderMix(song, options),
      renderMix(automated, options),
    ])
    const tailAt = Math.floor(0.6 * options.sampleRate)
    const energy = (buffer: AudioBuffer) =>
      buffer.getChannelData(0).slice(tailAt).reduce((sum, sample) => sum + Math.abs(sample), 0)

    expect(energy(repeatingEcho)).toBeGreaterThan(energy(dryEcho) * 1.5)
  })
})
