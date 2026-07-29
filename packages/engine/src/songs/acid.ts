import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Acid house. 126bpm, dead straight, and a 303 doing the thing it is famous for.
//
// The drums are almost aggressively plain — 909 kick on every beat, clap on two and four,
// open hat on the offbeat — because that is the job. Nothing in the kit is asking for
// attention; the whole record is the bassline moving under a straight beat, which is why
// it works and why it is so easy to get wrong by making the drums interesting.
//
// The 303 settings are the point. Resonance near the top, envelope modulation high, a
// short decay so every note re-opens the filter, and slides and accents on nearly every
// other step. Same synth as the darkwave song; entirely different instrument.

// The bare machine. Four on the floor and nothing else — used as an intro, and to drop
// back to when the acid has been going long enough.
const four = pattern('four', 'Four', {
  '909.bd': 'X... x... X... x...',
  '909.ch': '..x. ..x. ..x. ..x.',
})

// The record. Kick, clap, offbeat open hat, and a line that never sits still.
const acid = pattern(
  'acid',
  'Acid',
  {
    '909.bd': 'X... x... X... x...',
    '909.cp': '.... X... .... X...',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '909.oh': '..x. ..x. ..x. ..x.',
  },
  {
    // Root, octave, minor third, minor seventh. Slides on the way up and accents on the
    // landings — an acid line is mostly one note, and it is the filter that makes each
    // repeat different.
    '303.a': '0a . 0 12s | 12 . 0 3a | . 3 0 . | 10s 10 0a .',
  },
)

// Higher, busier, and with the second 303 an octave down holding the root. The peak.
const squelch = pattern(
  'squelch',
  'Squelch',
  {
    '909.bd': 'X... x... X... x...',
    '909.cp': '.... X... .... X..x',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '909.oh': '..x. ..x. ..x. ..x.',
    '909.rim': '..x. .... ..x. ....',
  },
  {
    '303.a': '12a . 12 15s | 15 . 12 10a | . 10 12 . | 22s 22 12a .',
    '303.b': '0a . . . | . . . . | 0a . . . | . . . .',
  },
)

// Drums out, 303 alone. The oldest trick in house and still the one that gets a reaction
// — the beat comes back and everything is louder without anything having changed.
const strip = pattern(
  'strip',
  'Strip',
  { '909.ch': '..x. ..x. ..x. ..x.' },
  { '303.a': '0a . 0 12s | 12 . 0 3a | . 3 0 . | 10s 10 0a .' },
)

export function acidSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // 909, short and driven. The kick is the loudest thing here by a distance and does not
  // want a long tail — at 126bpm a long kick just makes everything muddy.
  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.3, tune: 0.42, colour: 0.62, level: 0.72 }
  kit.params['909.cp'] = { ...kit.params['909.cp'], decay: 0.44, level: 0.6, pan: 0.54 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.2, tone: 0.62, level: 0.44 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.34, tone: 0.6, level: 0.46, pan: 0.58 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.42, pan: 0.36 }

  if (kit.bass) {
    // The settings the whole genre is made of: resonance near the top, envelope modulation
    // high, and a SHORT decay — so the filter slams shut between notes and every repeat
    // opens it again. A long decay here and the line turns into a pad.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.5,
      wave: 0,
      cutoff: 0.18,
      resonance: 0.92,
      envMod: 0.86,
      decay: 0.26,
      accent: 0.85,
      level: 0.6,
    }
    // The square, an octave down, doing nothing but holding the root under it.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.14,
      wave: 1,
      cutoff: 0.16,
      resonance: 0.3,
      envMod: 0.2,
      decay: 0.5,
      accent: 0.3,
      level: 0.46,
    }
  }

  // Dry, mostly. A short slap on the clap and a little delay on the 303 is as far as this
  // goes — reverb on a house record this fast turns the low end to soup.
  kit.sends = {
    '909.cp': { delay: 0.16, reverb: 0.2 },
    '909.oh': { delay: 0.1, reverb: 0.12 },
    '909.rim': { delay: 0.28, reverb: 0.14 },
    '303.a': { delay: 0.22, reverb: 0.08 },
  }

  return {
    bpm: 126,
    // Straight. Swing on an acid house record is somebody else's genre.
    swing: 0.04,
    patterns: clonePatterns([four, acid, squelch, strip]),
    chain: [
      { pattern: 'four', repeat: 2 },
      { pattern: 'acid', repeat: 8 },
      { pattern: 'squelch', repeat: 8 },
      { pattern: 'strip', repeat: 4 },
      { pattern: 'acid', repeat: 8 },
      { pattern: 'squelch', repeat: 8 },
      { pattern: 'strip', repeat: 2 },
      { pattern: 'four', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A tight sixteenth delay — short enough to thicken the line rather than to answer
      // it — and a small bright room.
      delayTime: 0,
      delayFeedback: 0.34,
      delayTone: 0.66,
      reverbSize: 0.24,
      reverbDamping: 0.4,
    },
  }
}
