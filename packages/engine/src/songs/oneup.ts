import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// 1UP. The platformer one.
//
// Chiptune written on a drum machine, which is a stranger brief than it sounds. A NES tune
// gets its character from having three voices and no drums worth the name, so everything —
// bass, melody, percussion — is carried by pitch. This box is the opposite: eleven drum
// voices and two monosynths. The way to sound like the reference is therefore not to
// imitate its instruments but its HABITS.
//
// **Arpeggios instead of chords.** With one voice you cannot play a triad, so you play its
// three notes in turn, fast, and the ear hears a chord. That is the sound, and it is also
// why chiptune melodies move constantly — the movement is the harmony. The 303 here runs
// straight sixteenths through a major triad and almost never repeats a note.
//
// **Major, and cheerfully so.** Only Cumulus and Runner are major, and neither is bouncy.
// This is the one that skips.
//
// **A hook every four bars, not every sixteen.** Game music loops in short phrases because
// it has to sit under something for an hour without a structure. So the sections here are
// short and the arrangement gets on with it.
//
// 162bpm, straight, and the fastest thing here after Rings of Saturn.
//
// The line stays inside 0..24 because that is what the grid can show, and a note nobody can
// see or edit may as well not be there. An arpeggio wants to keep climbing and this is the
// one thing stopping it — there is a test, and it caught two notes off the top of this.

// Start screen. Kick and hat, and the arpeggio already going.
const start = pattern(
  'start',
  'Start',
  {
    '909.bd': 'X... .... X... ....',
    '909.ch': 'x.x. x.x. x.x. x.x.',
  },
  { '303.a': '0 4 7 12 | 7 4 0 4 | 0 4 7 12 | 7 4 7 4' },
)

// Running. The bassline starts bouncing and the clap lands on the backbeat.
const run = pattern(
  'run',
  'Run',
  {
    '909.bd': 'X... ..x. X... ....',
    '909.cp': '.... X... .... X...',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '909.oh': '..x. .... ..x. ....',
  },
  {
    '303.a': '0 4 7 12 | 7 4 0 4 | 5 9 12 17 | 12 9 5 9',
    // The bounce. Root and octave alternating is what a platformer bassline is.
    '303.b': '0a . 12 . | 0a . 12 . | 5a . 17 . | 5a . 17 .',
  },
)

// Coin. Cowbell and a rimshot doing the pick-up blips, and the line an octave up.
const coin = pattern(
  'coin',
  'Coin',
  {
    '909.bd': 'X... ..x. X... ..x.',
    '909.cp': '.... X... .... X...',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '808.cb': '..x. .... ..x. ..x.',
    '909.rim': '.... ..x. .... ....',
  },
  {
    '303.a': '12 16 19 24 | 19 16 12 16 | 17 21 24 21 | 24 21 17 21',
    '303.b': '0a . 12 . | 0a . 12 . | 5a . 17 . | 5a . 17 .',
  },
)

// One-up. Everything, and the line reaching for the top of the grid.
const oneup = pattern(
  'oneup',
  '1UP',
  {
    '909.bd': 'X..x ..x. X..x ..x.',
    '909.cp': '.... X... .... X..x',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '909.oh': '..x. ..x. ..x. ..x.',
    '808.cb': '..x. .... ..x. ..x.',
    '909.ht': '.... .... .... x...',
  },
  {
    '303.a': '12 16 19 24 | 21 19 16 12 | 19 24 21 24 | 19 16 12 7',
    '303.b': '0a . 12 . | 3a . 15 . | 5a . 17 . | 7a . 19 .',
  },
)

// Game over. The one place it stops skipping — everything drops out but a falling line.
const over = pattern(
  'over',
  'Game Over',
  { '909.bd': 'X... .... .... ....', '909.cr': 'x... .... .... ....' },
  { '303.a': '12a . 7 . | 3a . 0 . | . . . . | . . . .' },
)

export function oneupSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.24, tune: 0.42, colour: 0.5, level: 0.58 }
  kit.params['909.cp'] = { ...kit.params['909.cp'], decay: 0.34, level: 0.44, pan: 0.5 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.1, tone: 0.76, level: 0.26, pan: 0.46 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.24, tone: 0.72, level: 0.3, pan: 0.58 }
  // The blips. Bright, short and panned wide — these are the coin and the pick-up.
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.22, tune: 0.78, level: 0.26, pan: 0.66 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.24, pan: 0.34 }
  kit.params['909.ht'] = { ...kit.params['909.ht'], decay: 0.26, tune: 0.72, colour: 0.4, level: 0.28 }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.7, tone: 0.6, level: 0.3 }

  if (kit.bass) {
    // The lead. A square wave with the filter well open and the envelope short, so every
    // sixteenth is a separate blip rather than a phrase — an arpeggio has to articulate or
    // it stops sounding like a chord and starts sounding like a slide.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.66,
      wave: 1,
      cutoff: 0.56,
      resonance: 0.3,
      envMod: 0.34,
      decay: 0.16,
      accent: 0.5,
      level: 0.46,
    }
    // And the bounce underneath. Round, short, and octave-jumping.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.2,
      wave: 0,
      cutoff: 0.24,
      resonance: 0.22,
      envMod: 0.2,
      decay: 0.28,
      accent: 0.42,
      level: 0.5,
    }
  }

  kit.sends = {
    '909.cp': { delay: 0.14, reverb: 0.24 },
    '909.oh': { delay: 0.12, reverb: 0.2 },
    '808.cb': { delay: 0.4, reverb: 0.22 },
    '909.rim': { delay: 0.44, reverb: 0.2 },
    '909.ht': { delay: 0.3, reverb: 0.26 },
    '909.cr': { delay: 0.1, reverb: 0.4 },
    '303.a': { delay: 0.26, reverb: 0.16 },
  }

  return {
    bpm: 162,
    swing: 0,
    patterns: clonePatterns([start, run, coin, oneup, over]),
    // Short sections, because game music never makes you wait. Nothing holds for more than
    // eight bars and the whole thing turns over twice inside a minute.
    chain: [
      { pattern: 'start', repeat: 2 },
      { pattern: 'run', repeat: 6 },
      { pattern: 'coin', repeat: 6 },
      { pattern: 'oneup', repeat: 8 },
      { pattern: 'over', repeat: 1 },
      { pattern: 'run', repeat: 6 },
      { pattern: 'coin', repeat: 6 },
      { pattern: 'oneup', repeat: 8 },
      { pattern: 'over', repeat: 1 },
      { pattern: 'start', repeat: 2 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A sixteenth slap and a small bright room. Nothing here is supposed to sound far
      // away — an arcade cabinet has one speaker and no reverb at all.
      delayTime: 0,
      delayFeedback: 0.26,
      delayTone: 0.72,
      reverbSize: 0.24,
      reverbDamping: 0.3,
    },
  }
}
