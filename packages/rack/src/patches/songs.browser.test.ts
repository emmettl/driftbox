import { renderMix } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import { grooveboxSong } from '../groovebox.js'
import { MODULES } from '../modules/index.js'
import { renderPatch } from '../render.js'
import { SONG_PATCHES } from './songs.js'

// What the Node suite cannot answer about these.
//
// Compiling one proves every cable names a real port, and that is exactly the check a **silent** patch
// passes: an envelope that never opens, a filter parked shut, a Tracker with no clock reaching it. The
// rack's own instrument is the part of a rack++ song nobody would notice was missing — the record would
// still play, because the record is the retained groovebox song — so it is the part worth rendering.
//
// Two halves, rendered separately, because that is how the page plays them. The retained song is hosted by
// the engine and reaches the rack as four live stereo stems, which an `OfflineAudioContext` render of the
// patch alone cannot supply — so a `renderPatch` here is the rack's additions, mixed on the real desk,
// through the real sends, and nothing else. Silence in it is the bug.

const SR = 22_050

const measure = (buffer: AudioBuffer): { peak: number; rms: number } => {
  let peak = 0
  let energy = 0
  let frames = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      const sample = Math.abs(data[i])
      if (sample > peak) peak = sample
      energy += data[i] * data[i]
      frames++
    }
  }
  return { peak, rms: Math.sqrt(energy / Math.max(1, frames)) }
}

describe.each(SONG_PATCHES.map((preset) => [preset.id, preset] as const))(
  'the %s song patch in a browser',
  (id, preset) => {
    it('makes an audible, bounded sound out of what the rack adds', async () => {
      const patch = preset.build()
      const song = grooveboxSong(patch)!
      // The host runs the rack transport at the retained song's tempo. Say so here, since an offline
      // render has no host to read it from and would otherwise time four bars at 120.
      const rendered = await renderPatch(
        { ...patch, tempo: song.bpm },
        { registry: MODULES, bars: 4, tail: 1.5, sampleRate: SR },
      )

      const { peak, rms } = measure(rendered)
      expect(peak, `${id} peak`).toBeGreaterThan(0.005)
      expect(peak, `${id} peak`).toBeLessThanOrEqual(1.001)
      expect(rms, `${id} rms`).toBeGreaterThan(0.0008)
    })

    it('carries the rack’s own voice across the field it was given', async () => {
      // A channel that is panned, or sent to the Ping Pong, has to arrive as two different channels — the
      // desk's balance, the returns and the Imager are all in that path and any one of them silently
      // collapsing would leave a record that measured fine and sounded centred.
      //
      // Not asserted of every patch, because it is not true of every patch and a test that demanded it
      // would be demanding a worse mix: Last Bus puts its sub dead centre with no sends, which is where a
      // sub belongs. Read off the desk rather than listed here, so it follows the mix.
      const patch = preset.build()
      const song = grooveboxSong(patch)!
      const strip = patch.modules.find((module) => module.id === 'desk-1')?.params ?? {}
      const spread = (strip.pan5 ?? 0) !== 0 || (strip.sendA5 ?? 0) > 0 || (strip.sendB5 ?? 0) > 0

      const rendered = await renderPatch(
        { ...patch, tempo: song.bpm },
        { registry: MODULES, bars: 2, tail: 1, sampleRate: SR },
      )
      expect(rendered.numberOfChannels).toBe(2)
      if (!spread) return

      const left = rendered.getChannelData(0)
      const right = rendered.getChannelData(1)
      let difference = 0
      for (let i = 0; i < left.length; i++) difference += Math.abs(left[i] - right[i])
      expect(difference / left.length, `${id} width`).toBeGreaterThan(1e-5)
    })

    it('still plays the song it retained', async () => {
      // The other half. Crossing the Song boundary rather than the patch one, so this measures what the
      // hosted engine will actually put into the desk.
      const song = grooveboxSong(preset.build())!
      const mix = await renderMix(song, { duration: 2, tail: 0.3, sampleRate: SR })
      const { peak } = measure(mix)
      expect(peak, `${id} song`).toBeGreaterThan(0.02)
      expect(peak, `${id} song`).toBeLessThanOrEqual(1.001)
    })
  },
)
