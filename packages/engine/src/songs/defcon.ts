import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// DEFCON. The slowest and the darkest thing here.
//
// 68bpm, which is half the tempo of most of this set and a good deal under the one other
// slow song — Undertow sits at 82 and still moves. This does not move. A bar is three and a
// half seconds and most of them have four or five sounds in.
//
// **The interval is the whole song.** Everything is built on the tritone: 0 and 6, the one
// interval that refuses to resolve anywhere. Every other song here uses a minor third or a
// fifth to say "minor"; this uses the one western music spent five hundred years avoiding,
// and it is why two notes are enough to make it feel like something is wrong. The line
// underneath adds a flat second on top of it — 0, 1, 6 — which is about as unresolved as
// three notes get.
//
// No snare and no clap. A rimshot, a maraca ticking like a counter, and a kick with an
// enormous tail; the space between them is where the record actually is. Everything goes to
// the biggest room in the box.
//
// And it is written to be WATCHED. The scene launches a missile on the kick and lands it
// four seconds later, so a sparse kick pattern is not just an aesthetic choice — it is the
// firing schedule, and a bar with two kicks in it is a salvo.

// Watch. A counter ticking and a very long way down.
const watch = pattern(
  'watch',
  'Watch',
  {
    '808.ma': '..x. .... ..x. ....',
    '808.rs': '.... .... x... ....',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . .' },
)

// Condition. The first launches — one kick a bar, so one missile at a time.
const condition = pattern(
  'condition',
  'Condition',
  {
    '808.bd': 'X... .... .... ....',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.rs': '.... .... x... ....',
    '909.rim': '.... ..x. .... ....',
  },
  {
    '303.a': '0a . . . | . . . . | 6a . . . | . . . .',
    '303.b': '0a . . . | . . . . | . . . . | . . . .',
  },
)

// Exchange. Two kicks a bar is two missiles, and the line starts moving.
const exchange = pattern(
  'exchange',
  'Exchange',
  {
    '808.bd': 'X... .... ..X. ....',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.rs': '.... .... x... ..x.',
    '909.rim': '.... ..x. .... ..x.',
    '909.rd': 'x... .... .... ....',
  },
  {
    // Root, flat second, tritone. Nothing here resolves and nothing is meant to.
    '303.a': '0a . 1 . | 6a . . . | . . 1 . | 6 . 0 .',
    '303.b': '0a . . . | . . . . | 6a . . . | . . . .',
  },
)

// Full retaliation. Everything launching at once.
const retaliation = pattern(
  'retaliation',
  'Retaliation',
  {
    '808.bd': 'X... ..X. .X.. ..X.',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.rs': '.x.. .... x... ..x.',
    '909.rim': '.... ..x. .... ..x.',
    '909.rd': 'x... .... x... ....',
    '808.lt': '.... .... .... x...',
  },
  {
    '303.a': '0a . 1 . | 6a . 8 . | 6a . 1 . | 0 . 6 .',
    '303.b': '0a . . . | . . . . | 6a . . . | . . . .',
  },
)

// Impact. One bar, a crash and the low end, everything else gone.
const impact = pattern(
  'impact',
  'Impact',
  {
    '808.bd': 'X... .... .... ....',
    '909.cr': 'x... .... .... ....',
    '808.lt': '.... ..x. .... ....',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . .' },
)

// Fallout. Nothing but the drone and the counter, still ticking.
const fallout = pattern(
  'fallout',
  'Fallout',
  { '808.ma': '..x. .... .... ....' },
  {
    '303.a': '6a . . . | . . . . | . . . . | 1 . . .',
    '303.b': '0a . . . | . . . . | . . . . | . . . .',
  },
)

export function defconSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // An enormous kick. At 68bpm there is room for a tail this long and nothing to smear.
  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.86, tune: 0.16, colour: 0.2, level: 0.68 }
  // The counter. Dry, quiet, unchanging — the one thing in the arrangement that never
  // reacts to anything, which is what makes it read as a machine rather than as a part.
  kit.params['808.ma'] = { ...kit.params['808.ma'], decay: 0.14, tone: 0.5, level: 0.2, pan: 0.58 }
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.22, tune: 0.36, level: 0.26, pan: 0.4 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.22, pan: 0.62 }
  kit.params['909.rd'] = { ...kit.params['909.rd'], decay: 0.62, tone: 0.5, level: 0.18, pan: 0.44 }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.95, tone: 0.42, level: 0.34 }
  kit.params['808.lt'] = { ...kit.params['808.lt'], decay: 0.8, tune: 0.1, colour: 0.25, level: 0.34 }

  if (kit.bass) {
    // A siren rather than a lead: filter almost shut, envelope barely moving, decay long
    // enough that consecutive notes overlap into one sustained thing.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.34,
      wave: 0,
      cutoff: 0.19,
      resonance: 0.52,
      envMod: 0.18,
      decay: 0.86,
      accent: 0.42,
      level: 0.4,
    }
    // And the floor underneath it. One note, held, for the length of the record.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.04,
      wave: 0,
      cutoff: 0.09,
      resonance: 0.12,
      envMod: 0.06,
      decay: 0.92,
      accent: 0.18,
      level: 0.5,
    }
  }

  // Everything wet. This is the only song besides Rings of Saturn where the room is a
  // location, and here even the counter is in it.
  kit.sends = {
    '808.bd': { delay: 0, reverb: 0.2 },
    '808.ma': { delay: 0.4, reverb: 0.44 },
    '808.rs': { delay: 0.46, reverb: 0.5 },
    '909.rim': { delay: 0.5, reverb: 0.54 },
    '909.rd': { delay: 0.24, reverb: 0.5 },
    '909.cr': { delay: 0.12, reverb: 0.66 },
    '808.lt': { delay: 0.18, reverb: 0.5 },
    '303.a': { delay: 0.34, reverb: 0.58 },
  }

  return {
    bpm: 68,
    swing: 0,
    patterns: clonePatterns([watch, condition, exchange, retaliation, impact, fallout]),
    // Escalation and then nothing. The one bar of `impact` is placed where the visual has
    // the most in the air, so the crash lands while the map is still being hit.
    chain: [
      { pattern: 'watch', repeat: 2 },
      { pattern: 'condition', repeat: 6 },
      { pattern: 'exchange', repeat: 8 },
      { pattern: 'retaliation', repeat: 8 },
      { pattern: 'impact', repeat: 1 },
      { pattern: 'fallout', repeat: 4 },
      { pattern: 'exchange', repeat: 6 },
      { pattern: 'retaliation', repeat: 8 },
      { pattern: 'impact', repeat: 1 },
      { pattern: 'fallout', repeat: 4 },
      { pattern: 'watch', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A dotted-feeling delay and the largest room the reverb can build. At this tempo a
      // repeat arrives most of a beat later, which is long enough to be heard as an echo
      // rather than as thickness.
      delayTime: 0.5,
      delayFeedback: 0.46,
      delayTone: 0.34,
      reverbSize: 0.92,
      reverbDamping: 0.62,
    },
  }
}
