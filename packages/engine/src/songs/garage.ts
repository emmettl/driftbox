import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Last Bus. UK garage after midnight.
//
// Garage is not house with the kick removed. Three clocks run against each other:
//
// **The backbeat stays straight.** Kick and clap have to hold the bar in place.
//
// **The small percussion lands late.** Closed hats, maracas and rimshots carry more swing
// than the song itself, so the spaces between the backbeats lean without moving them.
//
// **The bass answers the drums.** It mostly avoids the kick and turns up in the gaps. A
// four-to-the-floor sub would flatten the two-step rhythm back into house.
//
// There is no sampler here, so the clipped high 303 is used like a vocal fragment rather
// than pretending to be a singer: two or three short syllables, delayed, never a melody.

const platform = pattern(
  'platform',
  'Platform',
  {
    '909.bd': 'X... .... ..x. ....',
    '909.ch': '..x. .x.. ..x. .x..',
    '808.rs': '.... .... .... ...x',
  },
  {
    '303.b': '0a . . . | . . . 7 | . . 10 . | . 7 . .',
  },
)

const doors = pattern(
  'doors',
  'Doors',
  {
    '909.bd': 'X... .... ..x. ...x',
    '909.cp': '.... X... .... X...',
    '909.ch': '..x. .x.. ..x. .x.x',
    '909.oh': '.... ..x. .... ..x.',
    '808.rs': '...x .... .x.. ....',
  },
  {
    '303.b': '0a . . . | . . . 7 | . . 10 . | . 7 . .',
  },
)

const shuffle = pattern(
  'shuffle',
  'Shuffle',
  {
    '909.bd': 'X... ...x ..x. ....',
    '909.cp': '.... X... .... X...',
    '909.ch': '..x. .xx. ..x. .xx.',
    '909.oh': '.... ..x. .... ..x.',
    '808.rs': '...x .... .x.. ...x',
    '808.ma': '.x.. ..x. .x.. ..x.',
  },
  {
    '303.b': '0a . . . | . . 7a . | . 10 . . | 3 . 7 .',
  },
)

// The clipped high voice arrives as a call-and-response fragment. The delay supplies the
// repetitions; writing every repeat into the pattern would make it a lead line.
const nightline = pattern(
  'nightline',
  'Night Line',
  {
    '909.bd': 'X... .... ..x. ...x',
    '909.cp': '.... X... .... X...',
    '909.ch': '..x. .xx. ..x. .x.x',
    '909.oh': '.... ..x. .... ..x.',
    '808.rs': '...x .... .x.. ...x',
    '808.ma': '.x.. ..x. .x.. ..x.',
  },
  {
    '303.a': '. . 12a . | . . . . | . 15a . . | 10a . . .',
    '303.b': '0a . . . | . . 7a . | . 10 . . | 3 . 7 .',
  },
)

// Under the flyover: the clap and wet glass remain, the full beat does not.
const underpass = pattern(
  'underpass',
  'Underpass',
  {
    '909.cp': '.... X... .... X...',
    '909.ch': '..x. .... ..x. .x..',
    '808.rs': '...x .... .... ...x',
  },
  {
    '303.a': '. . 12a . | . . . . | . . . . | 10a . . .',
    '303.b': '0a . . . | . . . . | . . 10 . | . . . .',
  },
)

const lastBus = pattern(
  'lastbus',
  'Last Bus',
  {
    '909.bd': 'X... ...x ..x. ...x',
    '909.cp': '.... X... .... X..x',
    '909.ch': '..xx .xx. ..xx .xxx',
    '909.oh': '.... ..x. .... ..x.',
    '808.rs': '...x .... .x.x ...x',
    '808.ma': '.x.. ..x. .x.x ..x.',
    '808.ht': '.... .... ...x ....',
  },
  {
    '303.a': '. . 12a . | . 19 . . | . 15a . . | 10a . 12 .',
    '303.b': '0a . . . | . . 7a . | . 10 . . | 3 . 7 12',
  },
)

const PATTERNS = [platform, doors, shuffle, nightline, underpass, lastBus]

export function garageSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((voice) => voice.id))

  // Short and low rather than enormous. The sub needs the bottom octave to itself and the
  // second kick in the bar must be gone before the bass answers it.
  kit.params['909.bd'] = {
    ...kit.params['909.bd'],
    decay: 0.24,
    tune: 0.32,
    colour: 0.58,
    level: 0.62,
  }
  kit.params['909.cp'] = {
    ...kit.params['909.cp'],
    decay: 0.5,
    tone: 0.72,
    level: 0.54,
    pan: 0.52,
  }
  kit.params['909.ch'] = {
    ...kit.params['909.ch'],
    decay: 0.1,
    tone: 0.76,
    level: 0.28,
    pan: 0.42,
  }
  kit.params['909.oh'] = {
    ...kit.params['909.oh'],
    decay: 0.28,
    tone: 0.68,
    level: 0.32,
    pan: 0.62,
  }
  kit.params['808.rs'] = {
    ...kit.params['808.rs'],
    decay: 0.18,
    tune: 0.58,
    level: 0.24,
    pan: 0.34,
  }
  kit.params['808.ma'] = {
    ...kit.params['808.ma'],
    decay: 0.14,
    tone: 0.68,
    level: 0.22,
    pan: 0.66,
  }
  kit.params['808.ht'] = {
    ...kit.params['808.ht'],
    decay: 0.26,
    tune: 0.7,
    colour: 0.5,
    level: 0.24,
    pan: 0.58,
  }

  if (kit.bass) {
    // A clipped syllable: square wave, high register, short envelope and enough resonance
    // to put a vowel-like peak into it. The delay turns one hit into a phrase.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.72,
      wave: 1,
      cutoff: 0.42,
      resonance: 0.72,
      envMod: 0.58,
      decay: 0.16,
      accent: 0.76,
      level: 0.38,
    }
    // The sub is almost a sine by the time the closed ladder filter has finished with it.
    // Long enough to join the syncopated notes, but not so long that every gap fills in.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.05,
      wave: 0,
      cutoff: 0.09,
      resonance: 0.12,
      envMod: 0.08,
      decay: 0.68,
      accent: 0.34,
      level: 0.58,
    }
  }

  kit.sends = {
    '909.cp': { delay: 0.16, reverb: 0.42 },
    '909.oh': { delay: 0.2, reverb: 0.2 },
    '808.rs': { delay: 0.34, reverb: 0.22 },
    '808.ma': { delay: 0.26, reverb: 0.16 },
    '808.ht': { delay: 0.38, reverb: 0.26 },
    '303.a': { delay: 0.58, reverb: 0.3 },
    '303.b': { delay: 0.08, reverb: 0.12 },
  }

  // A UK garage bar is held together by disagreement. The kick and clap are explicitly
  // straight; hats and small percussion sit later than the song's already swung grid.
  kit.swing = {
    '909.bd': 0.33,
    '909.cp': 0.33,
    '909.ch': 0.62,
    '909.oh': 0.6,
    '808.rs': 0.56,
    '808.ma': 0.6,
    '808.ht': 0.54,
    '303.a': 0.58,
    '303.b': 0.47,
  }

  return {
    bpm: 134,
    swing: 0.34,
    patterns: clonePatterns(PATTERNS),
    chain: [
      { pattern: 'platform', repeat: 2 },
      { pattern: 'doors', repeat: 6 },
      { pattern: 'shuffle', repeat: 8 },
      { pattern: 'underpass', repeat: 2 },
      { pattern: 'nightline', repeat: 8 },
      { pattern: 'shuffle', repeat: 6 },
      { pattern: 'underpass', repeat: 2 },
      { pattern: 'lastbus', repeat: 8 },
      { pattern: 'nightline', repeat: 4 },
      { pattern: 'platform', repeat: 2 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A short dotted echo for the clipped phrase and a tiled room around the clap.
      delayTime: 0.375,
      delayFeedback: 0.42,
      delayTone: 0.5,
      reverbSize: 0.42,
      reverbDamping: 0.46,
    },
  }
}
