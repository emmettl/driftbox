import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Runner. Upbeat and driving, for the trench.
//
// The trap with "upbeat and driving" is writing the trance song again, and this already
// has one of those. Three things keep it apart:
//
// **Toms carry it, not hats.** A tom pattern rolling under the beat is propulsion in a
// way sixteenth hats are not — hats are a shimmer on top, toms are the thing pushing.
// Both machines' toms are in here, at different tunings, which is also the first shipped
// song to use more than one of them.
//
// **The line is MAJOR and it leaps.** Everything else here is minor and mostly stepwise.
// This is a major arpeggio thrown across two octaves — 0, 7, 12, 16, 19 — which is the
// sound of something heroic rather than something menacing, and it is most of why this
// reads as a chase rather than a threat.
//
// **It never sits still.** No section repeats more than four bars before something moves.

// Engines only. A tom pulse and a kick, waiting.
const idle = pattern(
  'idle',
  'Idle',
  {
    '909.bd': 'X... .... X... ....',
    '909.lt': '..x. .... ..x. ..x.',
    '909.ch': '..x. ..x. ..x. ..x.',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . .' },
)

// The run. Toms rolling underneath, and the line arrives.
const run = pattern(
  'run',
  'Run',
  {
    '909.bd': 'X... x..x X... x...',
    '909.lt': '..x. ..x. ..x. ..x.',
    '909.mt': '.... x... .... x..x',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '909.cp': '.... X... .... X...',
  },
  {
    // Major, and thrown across two octaves.
    '303.a': '0a . 7 12 | 16s 16 12 7 | 12a . 19 16 | 12 7 0 .',
    '303.b': '0a . . . | . . . . | 5a . . . | . . . .',
  },
)

// Tighter. The trench narrows: toms double up, hats go to sixteenths.
const dive = pattern(
  'dive',
  'Dive',
  {
    '909.bd': 'X..x x..x X..x x...',
    '909.lt': '..x. ..xx ..x. ..xx',
    '909.mt': '.x.. x... .x.. x...',
    '909.ht': '.... ..x. .... ..x.',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '909.cp': '.... X... .... X..x',
  },
  {
    '303.a': '12a 16 19 24 | 19s 19 16 12 | 16a 19 24 19 | 16 12 7 5',
    '303.b': '0a . . . | . . . . | 7a . . . | . . . .',
  },
)

// The shot. One bar, everything stops but a crash and the top of the line.
const lock = pattern(
  'lock',
  'Lock',
  {
    '909.bd': 'X... .... .... ....',
    '909.cr': 'x... .... .... ....',
    '909.ht': '.... ..x. .... ..x.',
  },
  { '303.a': '24a . . . | . . . . | . . . . | . . . .' },
)

// Out the other side. Sparse, and slowing nothing down.
const clear = pattern(
  'clear',
  'Clear',
  {
    '909.bd': 'X... .... X... ....',
    '909.rd': 'x... x... x... x...',
    '909.lt': '..x. .... ..x. ....',
  },
  { '303.a': '0a . . 7 | . . 12 . | . . . . | 7s 7 5 .' },
)

export function runnerSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.28, tune: 0.4, colour: 0.6, level: 0.42 }
  kit.params['909.cp'] = { ...kit.params['909.cp'], decay: 0.36, level: 0.29, pan: 0.56 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.15, tone: 0.68, level: 0.24 }
  // The toms are the engine room, so they are the loudest thing after the kick, tuned
  // apart far enough that the roll reads as a figure rather than as a rumble.
  //
  // These levels were set against the RAW bus sum, not the compressed output. Six voices
  // this dense pin the master compressor, and once it is pinned its peak stops responding
  // to level at all — rendering this pattern with every voice at 0.05 and at 0.9 gave the
  // same ~0.95. Judged that way the mix looked broken and no amount of trimming fixed it.
  // Pre-compressor it peaks around 1.7–2.1 depending on the render — the noise-based
  // voices vary — against about 1.8 for acid and 2.3 for chillwave. That is where a song
  // this busy belongs.
  kit.params['909.lt'] = { ...kit.params['909.lt'], decay: 0.4, tune: 0.25, colour: 0.4, level: 0.27 }
  kit.params['909.mt'] = { ...kit.params['909.mt'], decay: 0.36, tune: 0.5, colour: 0.4, level: 0.26 }
  kit.params['909.ht'] = { ...kit.params['909.ht'], decay: 0.3, tune: 0.7, colour: 0.4, level: 0.24 }
  kit.params['909.rd'] = { ...kit.params['909.rd'], decay: 0.5, tone: 0.7, level: 0.22, pan: 0.6 }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.8, tone: 0.62, level: 0.27 }

  if (kit.bass) {
    // Bright and open — a lead, not a bassline. The cutoff sits high enough that the
    // leaps stay audible as intervals rather than as filter movement.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.58,
      wave: 1,
      cutoff: 0.46,
      resonance: 0.5,
      envMod: 0.38,
      decay: 0.4,
      accent: 0.68,
      level: 0.52,
    }
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.12,
      wave: 0,
      cutoff: 0.15,
      resonance: 0.22,
      envMod: 0.15,
      decay: 0.62,
      accent: 0.25,
      level: 0.5,
    }
  }

  kit.sends = {
    '909.cp': { delay: 0.18, reverb: 0.24 },
    '909.lt': { delay: 0.1, reverb: 0.2 },
    '909.mt': { delay: 0.12, reverb: 0.22 },
    '909.ht': { delay: 0.2, reverb: 0.28 },
    '909.rd': { delay: 0.2, reverb: 0.36 },
    '909.cr': { delay: 0.1, reverb: 0.46 },
    '303.a': { delay: 0.26, reverb: 0.2 },
  }

  return {
    bpm: 150,
    swing: 0,
    patterns: clonePatterns([idle, run, dive, lock, clear]),
    // Short sections throughout. Nothing holds for more than eight bars and most of it
    // moves after four, because the thing being scored does not slow down either.
    chain: [
      { pattern: 'idle', repeat: 2 },
      { pattern: 'run', repeat: 8 },
      { pattern: 'dive', repeat: 8 },
      { pattern: 'lock', repeat: 1 },
      { pattern: 'clear', repeat: 3 },
      { pattern: 'run', repeat: 8 },
      { pattern: 'dive', repeat: 8 },
      { pattern: 'lock', repeat: 1 },
      { pattern: 'clear', repeat: 4 },
      { pattern: 'idle', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      delayTime: 0.25,
      delayFeedback: 0.36,
      delayTone: 0.7,
      reverbSize: 0.34,
      reverbDamping: 0.35,
    },
  }
}
