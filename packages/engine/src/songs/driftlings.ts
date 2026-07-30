import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { clonePatterns, pattern } from './notation.js'

// Written for Driftlings: small, inquisitive, and spacious enough that the player can
// think. The host swaps between these patterns as the crowd moves from calm to danger
// and, finally, home.

const burrow = pattern(
  'burrow',
  'Burrow',
  {
    '808.bd': 'X... .... ..x. ....',
    '808.rs': '.... x... .... x...',
    '808.ch': '..x. ..x. ..x. ..x.',
    '808.ma': '.x.. .x.. .x.. .x..',
  },
  {
    '303.a': '0a . . . | . 7s 7 . | 3 . . . | . 10 7 .',
  },
)

const march = pattern(
  'march',
  'Tiny March',
  {
    '808.bd': 'X... ..x. X... .x..',
    '808.sd': '.... X... .... X...',
    '808.ch': 'x.x. x.x. x.x. x.x.',
    '808.cb': '.... ..x. .... x...',
    '909.rim': '..x. .... .x.. ....',
  },
  {
    '303.a': '0a . 7 . | 3 . 10s 10 | 7 . 3 . | 5 . 0 .',
    '303.b': '. . . . | 0a . . . | . . 7s 7 | . . . .',
  },
)

const scramble = pattern(
  'scramble',
  'Scramble',
  {
    '808.bd': 'X..x ..X. x... .x..',
    '909.bd': 'x... x... x... x...',
    '808.cp': '.... X... .... X..x',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '808.mt': '..x. .... x.x. ....',
    '909.rim': '.... ..x. .... .x..',
  },
  {
    '303.a': '0a 7s 7 . | 10 . 3a . | 12s 12 10 . | 7 . 3 5',
    '303.b': '0a . . . | . . 7 . | 3a . . . | . 5s 5 .',
  },
)

const home = pattern(
  'home',
  'Home Light',
  {
    '808.bd': 'X... .... X... ....',
    '808.cp': '.... X... .... X...',
    '808.oh': '..x. .... ..x. ....',
    '808.ma': '.x.x .x.x .x.x .x.x',
  },
  {
    '303.a': '0a . 7 . | 12s 12 . 10 | 7 . 3 . | 5s 5 7 .',
    '303.b': '0a . . . | . . . . | 7a . . . | . . . .',
  },
)

const PATTERNS = [burrow, march, scramble, home]

export function driftlingsSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((voice) => voice.id))

  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.62, tune: 0.42, level: 0.7 }
  kit.params['808.sd'] = { ...kit.params['808.sd'], decay: 0.35, colour: 0.62, level: 0.5 }
  kit.params['808.cp'] = { ...kit.params['808.cp'], decay: 0.52, level: 0.48, pan: 0.58 }
  kit.params['808.ch'] = { ...kit.params['808.ch'], decay: 0.25, level: 0.36, pan: 0.4 }
  kit.params['808.oh'] = { ...kit.params['808.oh'], decay: 0.5, level: 0.34, pan: 0.62 }
  kit.params['808.ma'] = { ...kit.params['808.ma'], level: 0.24, pan: 0.68 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], level: 0.34, pan: 0.34 }
  kit.params['808.mt'] = { ...kit.params['808.mt'], decay: 0.42, level: 0.4 }
  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.3, level: 0.42 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.2, level: 0.3, pan: 0.62 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.38, pan: 0.36 }

  if (kit.bass) {
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      cutoff: 0.27,
      resonance: 0.62,
      envMod: 0.48,
      decay: 0.42,
      accent: 0.56,
      level: 0.5,
    }
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.22,
      wave: 1,
      cutoff: 0.16,
      resonance: 0.32,
      envMod: 0.22,
      decay: 0.65,
      accent: 0.34,
      level: 0.42,
    }
  }

  kit.sends = {
    '808.cp': { delay: 0.2, reverb: 0.38 },
    '808.oh': { delay: 0.12, reverb: 0.2 },
    '808.cb': { delay: 0.28, reverb: 0.16 },
    '808.rs': { delay: 0.22, reverb: 0.18 },
    '909.rim': { delay: 0.26, reverb: 0.18 },
    '303.a': { delay: 0.14, reverb: 0.12 },
  }

  return {
    bpm: 108,
    swing: 0.34,
    patterns: clonePatterns(PATTERNS),
    chain: [
      { pattern: 'burrow', repeat: 4 },
      { pattern: 'march', repeat: 8 },
      { pattern: 'burrow', repeat: 2 },
      { pattern: 'scramble', repeat: 4 },
      { pattern: 'home', repeat: 8 },
      { pattern: 'march', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      delayTime: 0.25,
      delayFeedback: 0.36,
      reverbSize: 0.52,
      reverbDamping: 0.62,
    },
  }
}
