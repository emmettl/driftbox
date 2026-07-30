import type { Song } from '../pattern.js'
import { acidSong } from './acid.js'
import { chillwaveSong } from './chillwave.js'
import { darkwaveSong } from './darkwave.js'
import { ascendSong } from './ascend.js'
import { runnerSong } from './runner.js'
import { cloudsSong } from './clouds.js'
import { pumpSong } from './pump.js'
import { oneupSong } from './oneup.js'
import { cyclesSong } from './cycles.js'
import { defconSong } from './defcon.js'
import { saturnSong } from './saturn.js'
import { transmissionSong } from './transmission.js'
import { cubikSong } from './cubik.js'
import { mobiliseSong } from './mobilise.js'

export * from './notation.js'

// The songs the box ships with.
//
// Fourteen songs demonstrate the range of the same small set of machines.
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
  /**
   * The visual this song was written to be seen with, as an opaque id the host resolves.
   *
   * A string rather than anything typed, deliberately: the engine has no idea what a
   * scene is and must not learn. It is a hint travelling with the music — a host that
   * has no visuals ignores it, and one with its own set can map it however it likes.
   */
  visual?: string
  build: () => Song
}

// Ordered as a listening sequence, not as they were written. Acieed and Ascend used to sit
// next to each other and open with the same four bars — literally the same pattern, a 909
// kick on the floor and a closed hat on the "e", differing only in tempo — so the set
// sounded like one track restarting. They are now three apart, and the arc runs gentle,
// hard, dark, abstract, building, fast.
export const SONGS: SongPreset[] = [
  {
    id: 'chillwave',
    visual: 'sunset',
    name: 'Sundown',
    blurb: 'Chillwave — slow, swung, lots of space',
    build: chillwaveSong,
  },
  {
    id: 'acid',
    visual: 'web',
    name: 'Acieed',
    blurb: 'Acid house — 126bpm, straight, 303 doing its thing',
    build: acidSong,
  },
  {
    id: 'darkwave',
    visual: 'water',
    name: 'Undertow',
    blurb: 'Darkwave — 82bpm, no snare, mostly room',
    build: darkwaveSong,
  },
  {
    id: 'cycles',
    visual: 'cycles',
    name: 'Light Cycles',
    blurb: 'Electro — 128bpm, broken kick, clap for a backbeat, no snare at all',
    build: cyclesSong,
  },
  {
    id: 'transmission',
    visual: 'lifeforms',
    name: 'Transmission',
    blurb: 'ISDN-era FSOL — 104bpm, nothing lines up, no backbeat at all',
    build: transmissionSong,
  },
  {
    id: 'defcon',
    visual: 'defcon',
    name: 'Defcon',
    blurb: 'Downtempo — 68bpm, built on the tritone, the slowest thing here',
    build: defconSong,
  },
  {
    id: 'clouds',
    visual: 'clouds',
    name: 'Cumulus',
    blurb: 'Ambient house — 116bpm, the heaviest swing here, and the only cheerful one',
    build: cloudsSong,
  },
  {
    id: 'pump',
    visual: 'dancers',
    name: 'Pump',
    blurb: 'Hip house — 124bpm, a 303 playing stabs instead of a line',
    build: pumpSong,
  },
  {
    id: 'ascend',
    visual: 'wireframe',
    name: 'Ascend',
    blurb: 'Trance — 138bpm, straight, built to arrive rather than sit there',
    build: ascendSong,
  },
  {
    id: 'oneup',
    visual: 'jumpman',
    name: '1UP',
    blurb: 'Chiptune — 162bpm, a 303 arpeggiating because one voice cannot play a chord',
    build: oneupSong,
  },
  {
    id: 'saturn',
    visual: 'saturn',
    name: 'Rings of Saturn',
    blurb: 'Breakbeat — 170bpm, two-bar patterns, ghosts on the rimshot',
    build: saturnSong,
  },
  {
    id: 'runner',
    visual: 'trench',
    name: 'Runner',
    blurb: 'Upbeat — 150bpm, toms not hats, and a major line that leaps',
    build: runnerSong,
  },
  {
    id: 'cubik',
    visual: 'cubik',
    name: 'Cübik Olympic',
    blurb: 'Manchester rave — 124bpm, distorted square stabs and rippling 808s',
    build: cubikSong,
  },
  {
    id: 'mobilise',
    visual: 'convoy',
    name: 'Mobilise',
    blurb: 'Industrial electro — 90bpm, rolling riff, toms for caterpillar tracks',
    build: mobiliseSong,
  },
]

export function songPresetById(id: string): SongPreset | undefined {
  return SONGS.find((preset) => preset.id === id)
}

/** What the box opens on, and what `reset` goes back to. */
export function defaultSong(): Song {
  return SONGS[0].build()
}

export {
  acidSong,
  oneupSong,
  pumpSong,
  cloudsSong,
  cyclesSong,
  defconSong,
  ascendSong,
  chillwaveSong,
  darkwaveSong,
  runnerSong,
  saturnSong,
  transmissionSong,
  cubikSong,
  mobiliseSong,
}
