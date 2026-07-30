import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Cubik/Olympic. Manchester rave at 124bpm: a lurching square-wave hook, bright bleeps
// and an 808 pattern that keeps changing which side of the beat it lands on.
//
// This is not another acid track. The 303s are used as two aggressively resonant synth
// voices: A is the rude low riff, B is a high answering stab. Short envelopes and large
// interval jumps make them sound sampled and punched-in rather than like lines winding
// round a scale.

const blocks = pattern(
  'blocks',
  'Blocks',
  {
    '808.bd': 'X... .... ..x. ....',
    '808.ch': '..x. ..x. ..x. ..x.',
    '808.cb': '.... .... x... ....',
  },
  {
    '303.a': '0a . . . | . . 3s 0 | . . 10a . | . . . .',
  },
)

const cubik = pattern(
  'cubik',
  'Cubik',
  {
    '808.bd': 'X... ..x. .... X...',
    '808.cp': '.... X... .... X...',
    '808.ch': 'x.xx x.xx x.xx x.xx',
    '808.oh': '..x. ..x. ..x. ..x.',
    '808.cb': '.... ..x. .... x...',
    '808.rs': '...x .... .x.. ....',
  },
  {
    '303.a': '0a . 0 . | 3s 0 . 10a | . 10 7 . | 3s 0a . .',
    // Octaves and fifths answer the riff without turning the two resonant filters into
    // a stack of minor thirds and sevenths once the delay starts repeating them.
    '303.b': '. . 19a . | . 24 . . | 12a . . 19 | . . 12a .',
  },
)

const olympic = pattern(
  'olympic',
  'Olympic',
  {
    '808.bd': 'X... .... ..x. X...',
    '808.cp': '.... X... .... X...',
    '808.ch': 'x.x. x.xx x.x. x.xx',
    '808.oh': '..x. ..x. ..x. ..x.',
    '808.cb': '..x. .... ..x. ....',
    '808.mt': '.... ...x .... .x..',
  },
  {
    '303.a': '0a . 7 . | 3s 0 . 10a | 12 . 10 . | 3s 0a . .',
    '303.b': '12 . 19a . | 24 . 19 . | 12a . 12 . | 19 . 24a .',
  },
)

const inversion = pattern(
  'inversion',
  'Inversion',
  {
    '808.bd': 'X... ..x. .... X..x',
    '808.cp': '.... X... .... X..x',
    '808.ch': 'x.xx x.xx xxxx x.xx',
    '808.oh': '..x. ..x. ..x. x.x.',
    '808.cb': '..x. .... x.x. ....',
    '808.rs': '...x .x.. ...x .x..',
    '808.lt': '.... .... x... ....',
  },
  {
    '303.a': '12a . 10 . | 3s 0 . 10a | . 7 10 . | 3s 0a . .',
    '303.b': '24a . 19 . | 24 . 12a . | 19 . 12 . | 24a . 19 .',
  },
)

const whiteout = pattern(
  'whiteout',
  'Whiteout',
  {
    '808.bd': 'X... .... .... ....',
    '808.oh': 'x... .... .... ....',
    '808.cb': '.... .... ..x. ....',
  },
  {
    '303.b': '24a . . . | . . . . | 19s 12 . . | . . . .',
  },
)

export function cubikSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((voice) => voice.id))

  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.56, tune: 0.28, colour: 0.48, level: 0.72 }
  kit.params['808.cp'] = { ...kit.params['808.cp'], decay: 0.42, tone: 0.62, level: 0.56, pan: 0.54 }
  kit.params['808.ch'] = { ...kit.params['808.ch'], decay: 0.13, tone: 0.76, level: 0.34, pan: 0.42 }
  kit.params['808.oh'] = { ...kit.params['808.oh'], decay: 0.32, tone: 0.72, level: 0.38, pan: 0.62 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.34, tune: 0.72, tone: 0.6, level: 0.34, pan: 0.66 }
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.2, tune: 0.62, level: 0.3, pan: 0.32 }
  kit.params['808.mt'] = { ...kit.params['808.mt'], decay: 0.44, tune: 0.58, colour: 0.58, level: 0.36 }
  kit.params['808.lt'] = { ...kit.params['808.lt'], decay: 0.58, tune: 0.24, colour: 0.52, level: 0.4 }

  if (kit.bass) {
    // Square wave into the nonlinear ladder with resonance at the edge: blunt, nasal and
    // audibly overloaded on the accents. This is the record's "fruity" low synth.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.34,
      wave: 1,
      cutoff: 0.25,
      resonance: 0.94,
      envMod: 0.78,
      decay: 0.18,
      accent: 0.94,
      level: 0.62,
    }
    // The bright bleep. Short, high and hard-panned by its delay rather than by the voice.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.66,
      wave: 0,
      cutoff: 0.48,
      resonance: 0.64,
      envMod: 0.64,
      decay: 0.12,
      accent: 0.76,
      level: 0.42,
    }
  }

  kit.sends = {
    '808.cp': { delay: 0.16, reverb: 0.34 },
    '808.oh': { delay: 0.12, reverb: 0.24 },
    '808.cb': { delay: 0.38, reverb: 0.28 },
    '808.rs': { delay: 0.32, reverb: 0.18 },
    '808.mt': { delay: 0.22, reverb: 0.2 },
    '808.lt': { delay: 0.12, reverb: 0.18 },
    '303.a': { delay: 0.18, reverb: 0.1 },
    '303.b': { delay: 0.44, reverb: 0.2 },
  }

  return {
    bpm: 124,
    swing: 0.08,
    patterns: clonePatterns([blocks, cubik, olympic, inversion, whiteout]),
    chain: [
      { pattern: 'blocks', repeat: 4 },
      { pattern: 'cubik', repeat: 8 },
      { pattern: 'olympic', repeat: 8 },
      { pattern: 'whiteout', repeat: 2 },
      { pattern: 'inversion', repeat: 8 },
      { pattern: 'cubik', repeat: 6 },
      { pattern: 'whiteout', repeat: 2 },
      { pattern: 'inversion', repeat: 8 },
      { pattern: 'olympic', repeat: 6 },
      { pattern: 'blocks', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      delayTime: 0.25,
      delayFeedback: 0.48,
      delayTone: 0.62,
      reverbSize: 0.34,
      reverbDamping: 0.38,
    },
  }
}
