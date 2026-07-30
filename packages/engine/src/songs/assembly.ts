import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { clonePatterns, pattern } from './notation.js'

// Assembly. Minimal techno built as a production line.
//
// The conspicuous hole in a set made from an 808, a 909 and two 303s was techno itself.
// Acid, electro, trance and rave all use the same machines, but each puts a synth figure
// in front. This one is made from the drum rack: kick as flywheel, rim and cowbell as
// interlocking teeth, toms as the weight of the press, and the ride as heat once the line
// is running.
//
// The 303s are not leads. B holds a low electrical hum and A is a clipped two-note relay
// pulse, mostly root and fifth, with no winding line for the ear to follow. The arrangement
// advances by bringing parts of the mechanism online rather than by changing harmony.

const power = pattern(
  'power',
  'Power',
  {
    '909.bd': 'X... .... x... ....',
    '909.lt': '.... ..x. .... ..x.',
    '808.rs': '..x. .... .... x...',
  },
  { '303.b': '0a . . . | . . . . | 0 . . . | . . . .' },
)

const conveyor = pattern(
  'conveyor',
  'Conveyor',
  {
    '909.bd': 'X... x... X... x...',
    '909.ch': '..x. ..x. ..x. ..x.',
    '909.lt': '.... ..x. .... ..x.',
    '808.rs': '..x. .... .x.. ....',
    '808.cb': '.... .... ..x. ....',
  },
  {
    '303.a': '. . 0a . | . . 7a . | . . 0a . | . 5 7a .',
    '303.b': '0a . . . | . . . . | 0 . . . | . . . .',
  },
)

const interlock = pattern(
  'interlock',
  'Interlock',
  {
    '909.bd': 'X... x... X... x...',
    '909.ch': 'x.x. x.xx x.x. x.xx',
    '909.oh': '.... ..x. .... ..x.',
    '909.lt': '.... ..x. .... ..x.',
    '909.mt': '.... .... .x.. ....',
    '808.rs': '..x. .... .x.. ...x',
    '808.cb': '.... .x.. ..x. ....',
  },
  {
    '303.a': '. . 0a . | . 12 7a . | . . 0a . | . 5 7a .',
    '303.b': '0a . . . | . . . . | 5 . . . | . . . .',
  },
)

const assembly = pattern(
  'assembly',
  'Assembly',
  {
    '909.bd': 'X... x... X... x..x',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '909.oh': '.... ..x. .... ..x.',
    '909.rd': 'x... .... x... ....',
    '909.lt': '.... ..x. .... ..x.',
    '909.mt': '.... .... .x.. ....',
    '909.ht': '.... .... .... ...x',
    '808.rs': '..x. .... .x.. ...x',
    '808.cb': '.... .x.. ..x. ....',
  },
  {
    '303.a': '. . 12a . | . 19 12a . | . . 12a . | . 17 19a .',
    '303.b': '0a . . . | . . . . | 5 . . . | . . . .',
  },
)

// The belt stops but the room does not. The long cymbal and hum make the next restart
// feel heavier without changing a single level.
const shutdown = pattern(
  'shutdown',
  'Shutdown',
  {
    '909.bd': 'X... .... .... ....',
    '909.cr': 'x... .... .... ....',
    '808.rs': '.... .... .... ...x',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . .' },
)

const PATTERNS = [power, conveyor, interlock, assembly, shutdown]

export function assemblySong(): Song {
  const kit = defaultKit(ALL_VOICES.map((voice) => voice.id))

  // Dry, hard and close. This should sound like machinery in a room, not a festival kick.
  kit.params['909.bd'] = {
    ...kit.params['909.bd'],
    decay: 0.28,
    tune: 0.34,
    colour: 0.7,
    level: 0.72,
  }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.12, tone: 0.54, level: 0.34 }
  kit.params['909.oh'] = {
    ...kit.params['909.oh'],
    decay: 0.3,
    tone: 0.48,
    level: 0.36,
    pan: 0.62,
  }
  kit.params['909.rd'] = {
    ...kit.params['909.rd'],
    decay: 0.62,
    tone: 0.58,
    level: 0.32,
    pan: 0.58,
  }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.78, tone: 0.4, level: 0.42 }
  kit.params['909.lt'] = { ...kit.params['909.lt'], decay: 0.28, tune: 0.3, level: 0.42 }
  kit.params['909.mt'] = { ...kit.params['909.mt'], decay: 0.24, tune: 0.46, level: 0.36 }
  kit.params['909.ht'] = { ...kit.params['909.ht'], decay: 0.2, tune: 0.58, level: 0.32 }
  kit.params['808.rs'] = {
    ...kit.params['808.rs'],
    decay: 0.34,
    tone: 0.7,
    level: 0.4,
    pan: 0.34,
  }
  kit.params['808.cb'] = {
    ...kit.params['808.cb'],
    decay: 0.22,
    tone: 0.58,
    level: 0.32,
    pan: 0.7,
  }

  if (kit.bass) {
    // A relay click with pitch, not an acid line: square, short and only mildly resonant.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.5,
      wave: 1,
      cutoff: 0.44,
      resonance: 0.48,
      envMod: 0.34,
      decay: 0.16,
      accent: 0.7,
      level: 0.46,
    }
    // The electrical hum under the floor. Long enough to join the quarter notes together.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.18,
      wave: 0,
      cutoff: 0.12,
      resonance: 0.24,
      envMod: 0.16,
      decay: 0.82,
      accent: 0.3,
      level: 0.42,
    }
  }

  kit.sends = {
    '909.cr': { delay: 0.08, reverb: 0.46 },
    '909.rd': { delay: 0.1, reverb: 0.22 },
    '909.lt': { delay: 0.08, reverb: 0.16 },
    '909.mt': { delay: 0.12, reverb: 0.18 },
    '909.ht': { delay: 0.16, reverb: 0.2 },
    '808.rs': { delay: 0.3, reverb: 0.2 },
    '808.cb': { delay: 0.24, reverb: 0.14 },
    '303.a': { delay: 0.18, reverb: 0.08 },
    '303.b': { delay: 0.08, reverb: 0.18 },
  }

  // Keep the kick and low tom straight while the small metal parts lean a little. That
  // disagreement is the groove; swinging the whole machine would make it lurch.
  kit.swing = {
    '909.bd': 0.47,
    '909.lt': 0.47,
    '909.ch': 0.54,
    '909.oh': 0.54,
    '808.rs': 0.55,
    '808.cb': 0.56,
  }

  return {
    bpm: 132,
    swing: 0.08,
    patterns: clonePatterns(PATTERNS),
    chain: [
      { pattern: 'power', repeat: 4 },
      { pattern: 'conveyor', repeat: 8 },
      { pattern: 'interlock', repeat: 8 },
      { pattern: 'shutdown', repeat: 2 },
      { pattern: 'assembly', repeat: 12 },
      { pattern: 'interlock', repeat: 6 },
      { pattern: 'shutdown', repeat: 2 },
      { pattern: 'assembly', repeat: 8 },
      { pattern: 'conveyor', repeat: 4 },
      { pattern: 'power', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      delayTime: 0.375,
      delayFeedback: 0.34,
      delayTone: 0.42,
      reverbSize: 0.38,
      reverbDamping: 0.32,
    },
  }
}
