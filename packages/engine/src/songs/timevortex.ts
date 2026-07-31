import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Time Vortex. Radiophonic science fiction built from the box's two monosynths.
//
// The character comes from three simple moves. The low 303 plays a six-hit gallop that
// never quite lets the downbeat settle; the high one answers with a narrow, sliding minor
// melody; and a dark dotted delay turns every exposed note into another voice. It nods to
// a very familiar television time machine without transcribing its theme note for note.
//
// The percussion is deliberately closer to a tape-loop pulse than a dance backbeat. Toms,
// rimshots and noise tick around the ostinato, while the kick only arrives once the vortex
// is open. That leaves enough empty space for the repeats to become part of the tune.

// A signal in the dark. The six-note low pulse is already present, with only a quiet rim
// and maraca to show where the bar is.
const signal = pattern(
  'signal',
  'Signal',
  {
    '808.ma': '..x. ..x. ..x. ..x.',
    '909.rim': '.... .... x... ....',
  },
  { '303.b': '0a . . 0 | . . 0 . | 0a . . 0 | . . 0 .' },
)

// The doors open. A rising minor phrase slides through the pulse rather than sitting on
// it, and the low tom answers at the end of each half-bar.
const vortex = pattern(
  'vortex',
  'Vortex',
  {
    '808.bd': 'X... .... X... ....',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.lt': '.... ..x. .... ..x.',
    '909.rim': '.... .... x... ....',
  },
  {
    '303.a': '12a . 12s 15 | . 19a 18s 15 | 12a . 10s 12 | . 15a 13 12',
    '303.b': '0a . . 0 | . . 0 . | 0a . . 0 | . . 0 .',
  },
)

// Flight. The pulse stays invariant while the lead reaches higher and the toms start to
// chase each other across the stereo field.
const flight = pattern(
  'flight',
  'Flight',
  {
    '808.bd': 'X... .... X... ....',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.lt': '.... ..x. .... ....',
    '808.mt': '.... .... .... ..x.',
    '909.rim': '.... x... .... x...',
  },
  {
    '303.a': '12a . 15s 19 | . 18a 15 12 | 10a . 13s 17 | . 15a 13 10',
    '303.b': '0a . . 0 | . . 0 . | 0a . . 0 | . . 0 .',
  },
)

// Full turbulence. Still no conventional snare backbeat: the metallic ride and doubled
// pulse make it larger without turning the radiophonic loop into a club groove.
const turbulence = pattern(
  'turbulence',
  'Turbulence',
  {
    '808.bd': 'X... ..x. X... ..x.',
    '808.ma': '..x. ..x. ..x. ..x.',
    '808.lt': '.... ..x. .... ....',
    '808.mt': '.... .... .... ..x.',
    '909.rim': '.... x... .... x...',
    '909.rd': 'x... .... x... ....',
    '909.oh': '.... ..x. .... ..x.',
  },
  {
    '303.a': '19a . 18s 15 | 12a . 10s 12 | 15a . 13s 10 | 12a . . .',
    '303.b': '0a . . 0 | . . 0 . | 0a . . 0 | . . 0 .',
  },
)

// Regeneration. One impact, then the melody falls through the delay while the pulse is
// briefly absent. Silence under the lead makes the return of the ostinato feel enormous.
const regeneration = pattern(
  'regeneration',
  'Regeneration',
  {
    '808.bd': 'X... .... .... ....',
    '909.cr': 'x... .... .... ....',
    '808.ht': '.... .... x... ....',
  },
  { '303.a': '24as 19 18s 15 | 13as 12 10s 7 | 5a . 3s 0 | . . . .' },
)

// The machine recedes, leaving the original transmission and its echoes behind.
const dissolve = pattern(
  'dissolve',
  'Dissolve',
  {
    '808.ma': '..x. .... ..x. ....',
    '909.rim': '.... .... x... ....',
  },
  {
    '303.a': '12a . . . | 10 . . . | 7 . . . | 3s 0 . .',
    '303.b': '0a . . 0 | . . 0 . | 0a . . 0 | . . 0 .',
  },
)

export function timeVortexSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((voice) => voice.id))

  // A rounded, short kick underneath the synth pulse rather than competing with it.
  kit.params['808.bd'] = {
    ...kit.params['808.bd'],
    decay: 0.42,
    tune: 0.2,
    colour: 0.16,
    level: 0.54,
  }
  // Dry ticks at the centre, with the tuned toms spread around them like tape edits.
  kit.params['808.ma'] = { ...kit.params['808.ma'], decay: 0.12, tone: 0.44, level: 0.18, pan: 0.58 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.22, pan: 0.38 }
  kit.params['808.lt'] = { ...kit.params['808.lt'], decay: 0.58, tune: 0.18, colour: 0.3, level: 0.34, pan: 0.36 }
  kit.params['808.mt'] = { ...kit.params['808.mt'], decay: 0.5, tune: 0.44, colour: 0.36, level: 0.3, pan: 0.66 }
  kit.params['808.ht'] = { ...kit.params['808.ht'], decay: 0.72, tune: 0.7, colour: 0.42, level: 0.36 }
  kit.params['909.rd'] = { ...kit.params['909.rd'], decay: 0.68, tone: 0.38, level: 0.18, pan: 0.62 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.26, tone: 0.48, level: 0.2, pan: 0.7 }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.92, tone: 0.34, level: 0.34 }

  if (kit.bass) {
    // The signal: a thin square wave, high enough to sing but filtered until the slides
    // sound more like spliced tape than an acid line.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.7,
      wave: 1,
      cutoff: 0.28,
      resonance: 0.48,
      envMod: 0.24,
      decay: 0.76,
      accent: 0.46,
      level: 0.4,
    }
    // The engine: a low sawtooth with little envelope movement and enough decay to bind
    // the six separate hits into one restless, continuous pulse.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.12,
      wave: 0,
      cutoff: 0.14,
      resonance: 0.24,
      envMod: 0.16,
      decay: 0.7,
      accent: 0.34,
      level: 0.58,
    }
  }

  kit.sends = {
    '808.ma': { delay: 0.28, reverb: 0.34 },
    '909.rim': { delay: 0.46, reverb: 0.38 },
    '808.lt': { delay: 0.34, reverb: 0.46 },
    '808.mt': { delay: 0.4, reverb: 0.5 },
    '808.ht': { delay: 0.42, reverb: 0.58 },
    '909.rd': { delay: 0.3, reverb: 0.54 },
    '909.oh': { delay: 0.24, reverb: 0.38 },
    '909.cr': { delay: 0.18, reverb: 0.68 },
    '303.a': { delay: 0.62, reverb: 0.56 },
    '303.b': { delay: 0.08, reverb: 0.16 },
  }

  return {
    bpm: 142,
    // A pronounced lilt makes the straight sixteenth grid breathe like a hand-spliced
    // compound-time loop without making the toms collapse into a shuffle.
    swing: 0.46,
    patterns: clonePatterns([signal, vortex, flight, turbulence, regeneration, dissolve]),
    chain: [
      { pattern: 'signal', repeat: 4 },
      { pattern: 'vortex', repeat: 8 },
      { pattern: 'flight', repeat: 8 },
      { pattern: 'turbulence', repeat: 8 },
      { pattern: 'regeneration', repeat: 1 },
      { pattern: 'signal', repeat: 3 },
      { pattern: 'flight', repeat: 8 },
      { pattern: 'turbulence', repeat: 8 },
      { pattern: 'regeneration', repeat: 1 },
      { pattern: 'dissolve', repeat: 5 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A dark dotted-eighth echo: long feedback creates the phantom voices, while the
      // damping keeps the repeats receding instead of crowding the lead.
      delayTime: 0.25,
      delayFeedback: 0.64,
      delayTone: 0.24,
      reverbSize: 0.82,
      reverbDamping: 0.62,
    },
  }
}
