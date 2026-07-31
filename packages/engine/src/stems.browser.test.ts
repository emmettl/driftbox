import { describe, expect, it } from 'vitest'
import { songBars } from './pattern.js'
import { planSong } from './schedule.js'
import { acidSong } from './songs/index.js'
import { renderStems } from './stems.js'

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
