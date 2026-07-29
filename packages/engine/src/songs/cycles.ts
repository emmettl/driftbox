import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Light Cycles. Electro, for the grid.
//
// The trap was writing Acieed again. Both are 808-adjacent, both sit in the mid 120s, and
// left alone they would be the same record with different knobs. Two decisions keep them
// apart, and they are the two decisions that make this electro rather than house:
//
// **The kick is broken.** Acieed is four to the floor and never moves. This one puts the
// kick on the one, the "and" of two, and the four — the syncopated figure electro has used
// since Planet Rock — so the floor of the track is a pattern rather than a pulse. It is the
// single biggest difference between the two genres and it costs three characters.
//
// **The clap is the backbeat and there is no snare at all.** An 808 clap on two and four,
// with the cowbell and the rimshot doing the ornament, is the 1982 sound. A snare would
// drag it forward twenty years.
//
// The 303 is doing a fourth job. Acid squelches, darkwave drones, Ascend sings, Saturn
// signals — this one ARPEGGIATES: a hard, even, machine sixteenth line that only ever moves
// by leaps, so it turns corners rather than curving. That is the light cycle, written down.

// Power up. The grid, before anything is on it.
const boot = pattern(
  'boot',
  'Boot',
  {
    '808.bd': 'X... .... ..x. .... ',
    '808.ch': '..x. ..x. ..x. ..x. ',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . .' },
)

// The line comes up. Sixteenths that leap rather than step.
const grid = pattern(
  'grid',
  'Grid',
  {
    '808.bd': 'X... ..x. .... X... ',
    '808.cp': '.... X... .... X... ',
    '808.ch': 'x.x. x.x. x.x. x.x. ',
  },
  {
    // Root, fifth, octave, minor third above it — a shape with no steps in it anywhere.
    '303.a': '0 12 7 12 | 15 12 7 12 | 0 12 7 12 | 19 15 12 7',
    '303.b': '0a . . . | . . . . | . . . . | . . . .',
  },
)

// Cornering. Cowbell on the offbeat and the rimshot filling, which is where it stops
// sounding like a demo and starts sounding like a record.
const corner = pattern(
  'corner',
  'Corner',
  {
    '808.bd': 'X... ..x. .... X..x ',
    '808.cp': '.... X... .... X... ',
    '808.ch': 'x.x. x.x. x.x. x.x. ',
    '808.cb': '..x. .... ..x. .... ',
    '808.rs': '.... ..x. .x.. ..x. ',
  },
  {
    '303.a': '0 12 7 12 | 15 12 7 12 | 3 15 10 15 | 19 15 12 7',
    '303.b': '0a . . . | . . . . | 3a . . . | . . . .',
  },
)

// Derez. One bar, everything cut but a cymbal and the top of the line — the bar the
// visual clears the arena on.
const derez = pattern(
  'derez',
  'Derez',
  {
    '808.bd': 'X... .... .... .... ',
    '808.oh': 'x... .... .... .... ',
    '808.ht': '.... ..x. .... ..x. ',
  },
  { '303.a': '24 . . . | . . . . | . . . . | . . . .' },
)

// Full throttle. Open hat on the offbeat, toms answering, the line an octave up.
const throttle = pattern(
  'throttle',
  'Throttle',
  {
    '808.bd': 'X... ..x. .... X..x ',
    '808.cp': '.... X... .... X..x ',
    '808.ch': 'x.xx x.xx x.xx x.xx ',
    '808.oh': '..x. ..x. ..x. ..x. ',
    '808.cb': '..x. .... ..x. ..x. ',
    '808.lt': '.... .... x... .... ',
  },
  {
    '303.a': '12 24 19 24 | 15 12 7 12 | 12 24 19 24 | 22 19 15 12',
    '303.b': '0a . . . | . . . . | 7a . . . | . . . .',
  },
)

// Idle. Line and hats only — the drop, and the bar before it all comes back.
const idle = pattern(
  'idle',
  'Idle',
  { '808.ch': '..x. ..x. ..x. ..x. ' },
  { '303.a': '0 12 7 12 | 15 12 7 12 | 0 12 7 12 | 19 15 12 7' },
)

export function cyclesSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // An 808 kick with the decay well up. Electro's kick is long and boomy — it is doing the
  // job a bassline does elsewhere, which is why the sub sits so far back here.
  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.62, tune: 0.32, colour: 0.3, level: 0.72 }
  kit.params['808.cp'] = { ...kit.params['808.cp'], decay: 0.5, level: 0.52, pan: 0.52 }
  kit.params['808.ch'] = { ...kit.params['808.ch'], decay: 0.16, tone: 0.66, level: 0.35, pan: 0.46 }
  kit.params['808.oh'] = { ...kit.params['808.oh'], decay: 0.38, tone: 0.62, level: 0.38, pan: 0.58 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.3, tune: 0.6, level: 0.28, pan: 0.62 }
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.2, tune: 0.55, level: 0.3, pan: 0.38 }
  kit.params['808.lt'] = { ...kit.params['808.lt'], decay: 0.55, tune: 0.2, colour: 0.35, level: 0.42 }
  kit.params['808.ht'] = { ...kit.params['808.ht'], decay: 0.35, tune: 0.62, colour: 0.35, level: 0.35 }

  if (kit.bass) {
    // Bright, hard and even. Resonance high enough to whistle on the leaps, envelope short
    // so each sixteenth is a separate event — an arpeggiator, not a phrase. Any slide at
    // all and the corners round off, which is exactly what this must not do.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.55,
      wave: 1,
      cutoff: 0.42,
      resonance: 0.58,
      envMod: 0.5,
      decay: 0.24,
      accent: 0.6,
      level: 0.54,
    }
    // Barely there. The 808 kick is the low end on this one.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.1,
      wave: 0,
      cutoff: 0.12,
      resonance: 0.18,
      envMod: 0.1,
      decay: 0.6,
      accent: 0.2,
      level: 0.36,
    }
  }

  kit.sends = {
    '808.cp': { delay: 0.16, reverb: 0.3 },
    '808.oh': { delay: 0.12, reverb: 0.24 },
    '808.cb': { delay: 0.34, reverb: 0.26 },
    '808.rs': { delay: 0.3, reverb: 0.2 },
    '808.ht': { delay: 0.26, reverb: 0.34 },
    '808.lt': { delay: 0.14, reverb: 0.3 },
    '303.a': { delay: 0.24, reverb: 0.18 },
  }

  return {
    bpm: 128,
    // Dead straight. Electro is a machine playing a machine part; swing is the one thing
    // that would make it sound like somebody was in the room.
    swing: 0,
    patterns: clonePatterns([boot, grid, corner, derez, throttle, idle]),
    // Two bars of boot and the line is already up. The derez bars are placed where a
    // section changes, so the arena clears on the turn rather than at random.
    chain: [
      { pattern: 'boot', repeat: 2 },
      { pattern: 'grid', repeat: 6 },
      { pattern: 'corner', repeat: 8 },
      { pattern: 'derez', repeat: 1 },
      { pattern: 'throttle', repeat: 8 },
      { pattern: 'idle', repeat: 2 },
      { pattern: 'corner', repeat: 6 },
      { pattern: 'derez', repeat: 1 },
      { pattern: 'throttle', repeat: 8 },
      { pattern: 'grid', repeat: 4 },
      { pattern: 'boot', repeat: 2 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // An eighth-note delay on the ornaments and a hard, small room. Electro reverb is a
      // plate on a snare, not a hall — and there is no snare here, so it is barely used.
      delayTime: 0.25,
      delayFeedback: 0.34,
      delayTone: 0.62,
      reverbSize: 0.3,
      reverbDamping: 0.5,
    },
  }
}
