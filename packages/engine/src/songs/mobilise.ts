import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Mobilise. Industrial electro for the endless convoy.
//
// The reference is not a melody so much as a machine that has learned one sentence and
// refuses to stop saying it. The low 303 therefore keeps the same two-bar-shaped idea
// through almost the whole arrangement: root, tritone, octave, and a semitone fall back
// into the root. Sections do not replace the hook; they load more weight onto it.
//
// **Toms are the tracks.** The low and middle 909 toms alternate around the kick, so the
// groove rolls instead of marching four-square. There is no snare. Rimshot, cowbell and
// ride provide the metal, each quiet enough that the low machinery stays in front.
//
// **Half-time without empty time.** At 90bpm the kick has room to feel enormous, while
// the sixteenth-note riff and the toms keep the vehicle moving between it and the next
// one. Swing is nearly absent: caterpillar tracks do not shuffle.
//
// **The ending strips the convoy without switching off the motor.** Stand Down removes
// everything except one low pulse and the original phrase.

const ignition = pattern(
  'ignition',
  'Ignition',
  {
    '909.bd': 'X... .... X... ....',
    '909.lt': '..x. .... ..x. ....',
    '909.rim': '.... .... .... x...',
  },
  {
    '303.a': '0a . 0s 0 | . 6 . 0 | 0a . 12 . | 6s 5 . .',
  },
)

const advance = pattern(
  'advance',
  'Advance',
  {
    '909.bd': 'X... ..x. X... x...',
    '909.lt': '..x. x... ..x. x...',
    '909.mt': '.... ..x. .... ..x.',
    '909.rim': '.... X... .... X...',
    '909.ch': '..x. ..x. ..x. ..x.',
  },
  {
    '303.a': '0a . 0s 0 | . 6 . 0 | 0a . 12 . | 6s 5 . 0',
    // A sub shadow, not a second hook. It lands only where the tread is heaviest.
    '303.b': '0a . . . | . . 6 . | 0a . . . | . . 5 .',
  },
)

const load = pattern(
  'load',
  'Load',
  {
    '909.bd': 'X... ..x. X..x x...',
    '909.lt': '..x. x..x ..x. x...',
    '909.mt': '.... ..x. .x.. ..x.',
    '909.rim': '.... X... .... X..x',
    '909.ch': '..x. ..x. x.x. ..x.',
    '808.cb': '...x .... ..x. ....',
  },
  {
    '303.a': '0a . 0s 0 | . 6 . 0 | 0a . 12 . | 6s 5 6 0',
    '303.b': '0a . . . | 12 . 6 . | 0a . . 12 | . . 5 .',
  },
)

const incline = pattern(
  'incline',
  'Incline',
  {
    '909.bd': 'X..x ..x. X..x x...',
    '909.lt': '..xx x..x ..xx x..x',
    '909.mt': '.x.. ..x. .x.. ..x.',
    '909.ht': '.... x... .... x...',
    '909.rim': '.... X..x .... X..x',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '808.cb': '...x .... ..x. ...x',
  },
  {
    '303.a': '0a 0 0s 0 | 6 . 6 0 | 12a . 12 6 | 5s 5 6 0',
    '303.b': '0a . 12 . | 6 . 18 . | 0a . 12 . | 5 . 17 .',
  },
)

const overrun = pattern(
  'overrun',
  'Overrun',
  {
    '909.bd': 'X..x ..x. X..x x..x',
    '909.lt': '..xx x..x ..xx x..x',
    '909.mt': '.x.. .xx. .x.. .xx.',
    '909.ht': '.... x... .... x..x',
    '909.rim': '..x. X..x ..x. X..x',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '909.rd': 'x... x... x... x...',
    '808.cb': '...x .x.. ..x. ...x',
  },
  {
    '303.a': '0a 0 0s 0 | 6a 6 6 0 | 12a 12 12 6 | 5s 5 6 0',
    '303.b': '0a . 12 . | 6 . 18 . | 0a 12 24 12 | 5 . 17 6',
  },
)

const standDown = pattern(
  'stand-down',
  'Stand Down',
  {
    '909.bd': 'X... .... .... ....',
    '909.lt': '.... .... ..x. ....',
    '909.rim': '.... .... .... ...x',
  },
  {
    '303.a': '0a . 0s 0 | . 6 . 0 | 0a . 12 . | 6s 5 . .',
  },
)

const PATTERNS = [ignition, advance, load, incline, overrun, standDown]

export function mobiliseSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((voice) => voice.id))

  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.52, tune: 0.2, colour: 0.7, level: 0.7 }
  // Dark, tuned apart, and louder than the metalwork. Together these are the tread rather
  // than a conventional fill decorating a kick pattern.
  kit.params['909.lt'] = { ...kit.params['909.lt'], decay: 0.5, tune: 0.18, colour: 0.64, level: 0.42 }
  kit.params['909.mt'] = { ...kit.params['909.mt'], decay: 0.4, tune: 0.42, colour: 0.56, level: 0.34 }
  kit.params['909.ht'] = { ...kit.params['909.ht'], decay: 0.32, tune: 0.64, colour: 0.72, level: 0.24 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], decay: 0.16, level: 0.3, pan: 0.62 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.1, tone: 0.52, level: 0.2, pan: 0.38 }
  kit.params['909.rd'] = { ...kit.params['909.rd'], decay: 0.74, tone: 0.42, level: 0.24, pan: 0.58 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.24, tune: 0.38, tone: 0.44, level: 0.28, pan: 0.7 }

  if (kit.bass) {
    // The motor: square wave, nearly closed filter, maximum accent. Resonance supplies the
    // grinding upper edge without letting the line turn into an acid solo.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.24,
      wave: 1,
      cutoff: 0.18,
      resonance: 0.9,
      envMod: 0.58,
      decay: 0.5,
      accent: 0.95,
      level: 0.64,
    }
    // The weight under it. A rounder wave, very low filter and long decay join the accented
    // notes into one moving mass rather than another sequence on top.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.08,
      wave: 0,
      cutoff: 0.1,
      resonance: 0.32,
      envMod: 0.18,
      decay: 0.78,
      accent: 0.48,
      level: 0.54,
    }
  }

  kit.sends = {
    '909.rim': { delay: 0.36, reverb: 0.18 },
    '909.ht': { delay: 0.18, reverb: 0.24 },
    '909.rd': { delay: 0.18, reverb: 0.38 },
    '808.cb': { delay: 0.42, reverb: 0.22 },
    '303.a': { delay: 0.12, reverb: 0.08 },
    '303.b': { delay: 0.08, reverb: 0.08 },
  }

  return {
    bpm: 90,
    swing: 0.04,
    patterns: clonePatterns(PATTERNS),
    chain: [
      { pattern: 'ignition', repeat: 4 },
      { pattern: 'advance', repeat: 8 },
      { pattern: 'load', repeat: 8 },
      { pattern: 'incline', repeat: 8 },
      { pattern: 'overrun', repeat: 8 },
      { pattern: 'stand-down', repeat: 2 },
      { pattern: 'advance', repeat: 6 },
      { pattern: 'incline', repeat: 8 },
      { pattern: 'overrun', repeat: 8 },
      { pattern: 'stand-down', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      delayTime: 0.375,
      delayFeedback: 0.42,
      delayTone: 0.28,
      reverbSize: 0.44,
      reverbDamping: 0.68,
    },
  }
}
