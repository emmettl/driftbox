import type { Song } from '../pattern.js'
import { acidSong } from './acid.js'
import { chillwaveSong } from './chillwave.js'
import { darkwaveSong } from './darkwave.js'
import { ascendSong } from './ascend.js'
import { transmissionSong } from './transmission.js'

export * from './notation.js'

// The songs the box ships with.
//
// Five of them, because one demonstrates the machines and five demonstrate the range.
// They deliberately share nothing: different tempos, different kits, different halves of
// the drum rack, and — the part worth noticing — the same two 303s set up so differently
// that they do not sound like the same instrument. Acid is resonance at the top with a
// short decay so the filter slams shut between notes; darkwave is the filter mostly
// closed with the envelope barely moving. Same synth.
//
// Built rather than stored: each is a function returning a fresh Song, so loading one
// twice cannot hand back an object somebody has already edited.

export interface SongPreset {
  id: string
  name: string
  /** One line, for the picker. */
  blurb: string
  build: () => Song
}

export const SONGS: SongPreset[] = [
  {
    id: 'chillwave',
    name: 'Sundown',
    blurb: 'Chillwave — slow, swung, lots of space',
    build: chillwaveSong,
  },
  {
    id: 'darkwave',
    name: 'Undertow',
    blurb: 'Darkwave — 82bpm, no snare, mostly room',
    build: darkwaveSong,
  },
  {
    id: 'acid',
    name: 'Acieed',
    blurb: 'Acid house — 126bpm, straight, 303 doing its thing',
    build: acidSong,
  },
  {
    id: 'ascend',
    name: 'Ascend',
    blurb: 'Trance — 138bpm, straight, built to arrive rather than sit there',
    build: ascendSong,
  },
  {
    id: 'transmission',
    name: 'Transmission',
    blurb: 'ISDN-era FSOL — 104bpm, nothing lines up, no backbeat at all',
    build: transmissionSong,
  },
]

export function songPresetById(id: string): SongPreset | undefined {
  return SONGS.find((preset) => preset.id === id)
}

/** What the box opens on, and what `reset` goes back to. */
export function defaultSong(): Song {
  return SONGS[0].build()
}

export { acidSong, ascendSong, chillwaveSong, darkwaveSong, transmissionSong }
