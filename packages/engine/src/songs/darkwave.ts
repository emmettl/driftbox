import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Darkwave. Slow, minor, and mostly room.
//
// The whole thing is built around what is NOT playing. There is no snare anywhere — a
// rimshot on the backbeat and a lot of reverb behind it, which is the sound of a room
// rather than of a drummer. The 808's own kick carries the low end alone, tuned down and
// left to ring, and the hats are dark enough to sit under everything instead of on top.
//
// The 303s are used as strings rather than as acid: filter mostly shut, envelope barely
// moving, long decay. Slides everywhere and almost no accents — the opposite of the acid
// house song, and from the same two synths.

// A single kick and a room. Everything else arrives later.
const veil = pattern(
  'veil',
  'Veil',
  {
    '808.bd': 'X... .... .... ....',
    '808.ma': '.... ..x. .... ..x.',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . .' },
)

// The main figure. The kick lands off the grid on the second half — never on three —
// which is what stops this settling into a beat you can nod along to.
const undertow = pattern(
  'undertow',
  'Undertow',
  {
    '808.bd': 'X... .... ..x. .... ',
    '808.rs': '.... X... .... X...',
    '808.ch': '..x. ..x. ..x. ..x.',
    '808.ma': '.... ..x. .... ..x.',
  },
  {
    // Minor thirds and fifths, all slid together so the line has no attack in it. Note 3
    // is the minor third; 10 the minor seventh.
    '303.b': '0a . . . | . 3s 3 . | . . 7s 7 | . . . .',
    '303.a': '. . . . | . . . . | 15s 15 . . | 12 . . .',
  },
)

// The lift, such as it is: an open hat, a low tom, and the upper 303 answering.
const swell = pattern(
  'swell',
  'Swell',
  {
    '808.bd': 'X... .... ..x. ....',
    '808.rs': '.... X... .... X...',
    '808.ch': '..x. ..x. ..x. ..x.',
    '808.oh': '.... .... x... ....',
    '808.lt': '.... .... .... x...',
    '808.ma': '..x. ..x. ..x. ..x.',
  },
  {
    '303.b': '0a . . . | . 3s 3 . | 10s 10 . . | 7 . . .',
    '303.a': '. . 12s 12 | . . 10 . | . . 15s 15 | . 12 . .',
  },
)

// Nothing but the low 303 and the room it is in. The reason the rest works.
const black = pattern(
  'black',
  'Black',
  { '808.ma': '.... .... .... ..x.' },
  { '303.b': '0a . . . | . . . . | . . 3s 3 | . . . .' },
)

export function darkwaveSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // Long, low and soft. The kick is tuned right down and given a long decay so it reads
  // as a note rather than as a hit.
  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.86, tune: 0.14, colour: 0.12 }
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.7, tone: 0.3, level: 0.5 }
  // Hats dark and quiet — tone right down, so they sit under the room rather than on it.
  kit.params['808.ch'] = { ...kit.params['808.ch'], decay: 0.24, tone: 0.18, level: 0.34 }
  kit.params['808.oh'] = { ...kit.params['808.oh'], decay: 0.62, tone: 0.2, level: 0.32 }
  kit.params['808.lt'] = { ...kit.params['808.lt'], decay: 0.72, tune: 0.2, level: 0.44 }
  kit.params['808.ma'] = { ...kit.params['808.ma'], level: 0.22, tone: 0.35, pan: 0.7 }

  if (kit.bass) {
    // Strings, not acid. Filter mostly shut, envelope barely moving, long decay — and
    // almost no accent, so nothing in the line jumps out at you.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.62,
      wave: 0,
      cutoff: 0.22,
      resonance: 0.34,
      envMod: 0.18,
      decay: 0.78,
      accent: 0.2,
      level: 0.4,
    }
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.12,
      wave: 0,
      cutoff: 0.14,
      resonance: 0.22,
      envMod: 0.12,
      decay: 0.9,
      accent: 0.15,
      level: 0.56,
    }
  }

  // Heavy on the room, and the delay is long and dark. This is the song where the sends
  // are doing as much as the voices.
  kit.sends = {
    '808.bd': { delay: 0, reverb: 0.14 },
    '808.rs': { delay: 0.34, reverb: 0.62 },
    '808.ch': { delay: 0.12, reverb: 0.4 },
    '808.oh': { delay: 0.2, reverb: 0.5 },
    '808.lt': { delay: 0.26, reverb: 0.55 },
    '808.ma': { delay: 0.1, reverb: 0.44 },
    '303.a': { delay: 0.3, reverb: 0.45 },
    '303.b': { delay: 0.05, reverb: 0.18 },
  }

  return {
    bpm: 82,
    // Nearly straight. A darkwave shuffle would turn it into something else entirely.
    swing: 0.1,
    patterns: clonePatterns([veil, undertow, swell, black]),
    // Starts on the figure, not on the intro.
    //
    // This opened with four bars of Veil, which is a kick and a drone — a fine thing to
    // arrive at and a terrible thing to open with. Somebody pressing play on a track they
    // have not heard gets thirteen seconds of almost nothing before it starts. Veil
    // still earns its place, but later, where it reads as the room emptying rather than
    // as the song failing to begin.
    chain: [
      { pattern: 'undertow', repeat: 8 },
      { pattern: 'swell', repeat: 8 },
      { pattern: 'black', repeat: 3 },
      { pattern: 'undertow', repeat: 8 },
      { pattern: 'swell', repeat: 8 },
      { pattern: 'veil', repeat: 3 },
      { pattern: 'black', repeat: 2 },
      { pattern: 'undertow', repeat: 4 },
      { pattern: 'veil', repeat: 2 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A long, dark room and a slow delay. Size right up; damping high, so the tail
      // loses its top end quickly and reads as stone rather than as tile.
      delayTime: 0.75,
      delayFeedback: 0.58,
      delayTone: 0.28,
      reverbSize: 0.92,
      reverbDamping: 0.72,
    },
  }
}
