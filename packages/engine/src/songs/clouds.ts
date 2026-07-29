import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Cumulus. Ambient house, after the Orb.
//
// The reference is a record made almost entirely out of an 808 and a 303 with someone
// talking over the top, which means the two machines in this box are already the right
// ones and the job is all in how they are set.
//
// **The swing is the song.** 0.42, which is by a distance the heaviest here — Sundown is
// the only other swung track and it sits at 0.28. At this depth the offbeats fall so late
// that the whole thing lopes, and loping is the difference between house and ambient
// house. Everything else in the set is either dead straight or nearly.
//
// **Dub, not space.** Sundown gets its room from leaving gaps. This gets it from ECHO: the
// clap and the cowbell are sent hard to a long delay and the repeats are most of the
// arrangement, which is how the genre has always worked. The delay is doing more musical
// work here than any drum voice except the kick.
//
// **And it is cheerful**, which nothing else here is. The line is major pentatonic — no
// third-to-fourth tension, no leading note, nothing that resolves anywhere because nothing
// needs to. Runner is the only other major song and it is major the way a fanfare is; this
// is major the way a nursery rhyme is.

// A clear sky. Kick, shaker, and the sub.
const clear = pattern(
  'clear',
  'Clear',
  {
    '808.bd': 'X... .... x... ....',
    '808.ma': '..x. ..x. ..x. ..x.',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . .' },
)

// Drift. The clap arrives, and with it the delay that carries the rest of the record.
const drift = pattern(
  'drift',
  'Drift',
  {
    '808.bd': 'X... .... x... ....',
    '808.cp': '.... X... .... X...',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.oh': '..x. .... ..x. ....',
  },
  {
    // Major pentatonic — root, second, fifth, sixth, octave. Slides on the way up, so it
    // bounces rather than steps.
    '303.a': '0a . 4s 4 | 7 . 9s 9 | 12a . 9 7 | 4 . 0 .',
    '303.b': '0a . . . | . . . . | . . . . | . . . .',
  },
)

// Cumulus. Everything, and the cowbell — which is either the best or the worst decision
// on this record and is definitely the most 1990 one.
const cumulus = pattern(
  'cumulus',
  'Cumulus',
  {
    '808.bd': 'X... .... x... ..x.',
    '808.cp': '.... X... .... X...',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.oh': '..x. .... ..x. ..x.',
    '808.cb': '.... ..x. .... ....',
    '808.rs': '.x.. .... .x.. ....',
  },
  {
    '303.a': '0a . 4s 4 | 7 . 9s 9 | 16a . 12 9 | 7 . 4 .',
    '303.b': '0a . . . | . . . . | 5a . . . | . . . .',
  },
)

// Sunshine. Up an octave, the whole thing grinning.
const sunshine = pattern(
  'sunshine',
  'Sunshine',
  {
    '808.bd': 'X... .... x... ..x.',
    '808.cp': '.... X... .... X..x',
    '808.ma': '..xx ..x. ..xx ..x.',
    '808.oh': '..x. ..x. ..x. ..x.',
    '808.cb': '.... ..x. .... ..x.',
    '808.ht': '.... .... .... x...',
  },
  {
    '303.a': '12a . 16s 16 | 19 . 21s 21 | 24a . 21 19 | 16 . 12 .',
    '303.b': '0a . . . | . . . . | 7a . . . | . . . .',
  },
)

// A break in it. Kick gone, delay left holding everything up.
const gap = pattern(
  'gap',
  'Gap',
  {
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.cp': '.... .... .... X...',
  },
  { '303.a': '0a . 4s 4 | 7 . 9s 9 | . . . . | . . . .' },
)

export function cloudsSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // A round, soft 808 kick with the decay well up — no click, nothing to cut through,
  // because there is nothing here it needs to cut through.
  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.6, tune: 0.3, colour: 0.16, level: 0.74 }
  // The clap is the thing the delay chews on, so it is bright and short.
  kit.params['808.cp'] = { ...kit.params['808.cp'], decay: 0.42, level: 0.52, pan: 0.46 }
  kit.params['808.ma'] = { ...kit.params['808.ma'], decay: 0.2, tone: 0.62, level: 0.32, pan: 0.56 }
  kit.params['808.oh'] = { ...kit.params['808.oh'], decay: 0.42, tone: 0.5, level: 0.35, pan: 0.6 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.34, tune: 0.52, level: 0.28, pan: 0.64 }
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.2, tune: 0.6, level: 0.25, pan: 0.36 }
  kit.params['808.ht'] = { ...kit.params['808.ht'], decay: 0.4, tune: 0.66, colour: 0.3, level: 0.32 }

  if (kit.bass) {
    // Burbling rather than squelching. Resonance up where it whistles, but the envelope is
    // gentle and the decay long, so it bubbles along instead of spitting — Acieed is the
    // same synth with the envelope wide open and the decay short.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.5,
      wave: 0,
      cutoff: 0.31,
      resonance: 0.66,
      envMod: 0.34,
      decay: 0.6,
      accent: 0.5,
      level: 0.54,
    }
    // Warm and round underneath. Not a sub you feel — one you notice is missing.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.14,
      wave: 1,
      cutoff: 0.17,
      resonance: 0.2,
      envMod: 0.12,
      decay: 0.72,
      accent: 0.24,
      level: 0.48,
    }
  }

  // Almost everything to the delay. This is the arrangement.
  kit.sends = {
    '808.cp': { delay: 0.66, reverb: 0.34 },
    '808.oh': { delay: 0.3, reverb: 0.3 },
    '808.cb': { delay: 0.62, reverb: 0.3 },
    '808.rs': { delay: 0.5, reverb: 0.26 },
    '808.ht': { delay: 0.48, reverb: 0.36 },
    '303.a': { delay: 0.44, reverb: 0.36 },
  }

  return {
    bpm: 116,
    // The heaviest swing in the box, and the whole reason this does not sound like house.
    swing: 0.42,
    patterns: clonePatterns([clear, drift, cumulus, sunshine, gap]),
    chain: [
      { pattern: 'clear', repeat: 2 },
      { pattern: 'drift', repeat: 6 },
      { pattern: 'cumulus', repeat: 8 },
      { pattern: 'gap', repeat: 2 },
      { pattern: 'sunshine', repeat: 8 },
      { pattern: 'cumulus', repeat: 6 },
      { pattern: 'gap', repeat: 2 },
      { pattern: 'sunshine', repeat: 8 },
      { pattern: 'drift', repeat: 6 },
      { pattern: 'clear', repeat: 2 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A long delay, well fed, and dark — a dub delay loses its top end with every pass,
      // and it is that darkening that makes the repeats sit behind the record rather than
      // on top of it. The room is big and soft to match.
      delayTime: 0.75,
      delayFeedback: 0.6,
      delayTone: 0.3,
      reverbSize: 0.6,
      reverbDamping: 0.5,
    },
  }
}
