import { describe, expect, it } from 'vitest'
import { renderMix } from '../stems.js'
import { paperCitiesSong } from './papercities.js'
import { offsetSong } from './offset.js'
import { hothouseSong } from './hothouse.js'
import { daydreamSong } from './daydream.js'
import { switchbackSong } from './switchback.js'
import { firstLightSong } from './firstlight.js'
import { smallHoursSong } from './smallhours.js'
import { orrerySong } from './orrery.js'

describe.each([
  ['Paper Cities', paperCitiesSong, 34],
  ['Offset', offsetSong, 12],
  ['Hothouse', hothouseSong, 34],
  ['Daydream Receiver', daydreamSong, 16],
  ['Switchback', switchbackSong, 13],
  ['First Light', firstLightSong, 28],
  ['Small Hours', smallHoursSong, 16],
  ['Orrery', orrerySong, 35],
] as const)('%s through the audio engine', (_, build, busiestBar) => {
  it('renders audible, bounded stereo excerpts from the introduction and developed arrangement', async () => {
    const song = build()
    for (const bar of [0, busiestBar]) {
      const mix = await renderMix(song, {
        start: bar * 240 / song.bpm, duration: 4 * 240 / song.bpm,
        tail: 2, sampleRate: 22_050,
      })
      const left = mix.getChannelData(0)
      const right = mix.getChannelData(1)
      let peak = 0, energy = 0, difference = 0, finite = true
      for (let i = 0; i < left.length; i++) {
        finite &&= Number.isFinite(left[i]) && Number.isFinite(right[i])
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
        energy += left[i] ** 2 + right[i] ** 2
        difference += Math.abs(left[i] - right[i])
      }
      expect(finite).toBe(true)
      expect(peak).toBeGreaterThan(0.02)
      expect(peak).toBeLessThanOrEqual(1.001)
      expect(Math.sqrt(energy / (left.length * 2))).toBeGreaterThan(0.002)
      expect(difference / left.length).toBeGreaterThan(1e-5)
    }
  })
})
