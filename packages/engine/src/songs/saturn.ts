import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Rings of Saturn. After the Photek tune, and breakbeat rather than four to the floor.
//
// Three things had to be solved to get a drum & bass record out of a step sequencer.
//
// **Two bars, not one.** Every other song here is a one-bar pattern, which is right for
// house and useless for this: the whole character of a break is that it does not repeat
// every bar. The kick lands somewhere different second time round and the snare gets
// displaced late in the phrase, and you cannot write either of those in sixteen steps.
// So these are 32 — two bars of sixteenths at 170 — and the two halves deliberately
// disagree.
//
// **Ghosts, out of a notation with no ghosts.** `X` and `x` are the only velocities, and
// a Photek break is mostly the notes *between* the backbeat: the quiet taps that make it
// swing without any swing being applied. The way out is to ghost on a different, quieter
// VOICE rather than at a lower velocity — the 808 rimshot, which is a woody click a long
// way under a 909 snare, doing all the in-between work while the 909 does the backbeat.
// That is also how these patterns would have been programmed on the hardware.
//
// **Space.** This is a dark, sparse record; the drums are busy and almost nothing else is.
// One sub, a handful of notes, and a great deal of reverb on the snare and nothing else.
//
// Dead straight. Drum & bass gets its swing from where the hits are, and any swing applied
// on top of programming this dense just smears it.

const BARS = 32

// Holding orbit. Sub, a ride, and the rimshot already ticking — the break is not here yet.
const orbit = pattern(
  'orbit',
  'Orbit',
  {
    '909.rd': 'x... .... x... .... x... .... x... ....',
    '808.rs': '.... ..x. .... .... .... ..x. .... ..x.',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . . | 0a . . . | . . . . | . . . . | . . . .' },
  BARS,
)

// The break. Kick on the one and then displaced, snare on two and four, and the rimshot
// filling every gap between them.
const breaks = pattern(
  'break',
  'Break',
  {
    '909.bd': 'X... .... ..x. .... .... x... .... ..x.',
    '909.sd': '.... X... .... X... .... X... .... X...',
    '808.rs': '..x. .x.. x.x. .x.x ..x. .x.. x..x .x..',
    '909.ch': 'x.x. x.x. x.x. x.x. x.x. x.x. x.x. x.x.',
    '909.oh': '.... ..x. .... .... .... ..x. .... ....',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . . | 0a . . . | . . . . | . . . . | . . . .' },
  BARS,
)

// The tune arrives. Same break, and four notes over the top of it in two bars.
const rings = pattern(
  'rings',
  'Rings',
  {
    '909.bd': 'X... .... ..x. .... .... x... .... ..x.',
    '909.sd': '.... X... .... X... .... X... .... X...',
    '808.rs': '..x. .x.. x.x. .x.x ..x. .x.. x..x .x..',
    '909.ch': 'x.x. x.x. x.x. x.x. x.x. x.x. x.x. x.x.',
    '909.oh': '.... ..x. .... .... .... ..x. ..x. ....',
  },
  {
    // Minor, and almost nothing. The reverb does more work here than the notes do.
    '303.a': '. . . . | 0a . . . | . . . . | . . 3s . | . . . . | 7a . . . | . . 10 . | . . . .',
    '303.b': '0a . . . | . . . . | . . . . | . . . . | 5a . . . | . . . . | . . . . | . . . .',
  },
  BARS,
)

// The second half turns over. Kick doubled early, snare pushed late in bar two — the bar
// that stops the break sounding like a loop.
const fold = pattern(
  'fold',
  'Fold',
  {
    '909.bd': 'X... ..x. .... x... X..x .... ..x. ....',
    '909.sd': '.... X... .... X..x .... X... ..x. X...',
    '808.rs': '..x. .x.x x.x. .x.. ..xx .x.. x.x. .xx.',
    '909.ch': 'x.x. x.xx x.x. x.x. x.x. x.xx x.x. x.xx',
    '909.oh': '.... ..x. .... .... ..x. .... .... ..x.',
  },
  {
    '303.a': '. . . . | 0a . . . | . . . . | . . 3s . | . . . . | 10a . . . | . . 7 . | . . . .',
    '303.b': '0a . . . | . . . . | . . . . | . . . . | 3a . . . | . . . . | . . . . | . . . .',
  },
  BARS,
)

// Impact. One bar of the phrase, everything gone but a crash, a low tom and the sub —
// this is the section the visual puts a hole in the planet on.
const impact = pattern(
  'impact',
  'Impact',
  {
    '909.bd': 'X... .... .... .... .... .... .... ....',
    '909.cr': 'x... .... .... .... .... .... .... ....',
    '808.lt': '.... .... ..x. .... .... .... .... ..x.',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . . . . | . . . . | . . . . | . . . . | . . . .' },
  BARS,
)

// The roll back in. Rimshot into a straight snare run — a fill written on two voices,
// because the whole point is that the quiet part and the loud part are different sounds.
const roll = pattern(
  'roll',
  'Roll',
  {
    '909.bd': 'X... .... .... .... X... .... .... ....',
    '808.rs': '..x. .x.. x.x. xxxx .... .... .... ....',
    '909.sd': '.... .... .... .... x.x. x.xx xxxx XXXX',
    '909.ch': 'x.x. x.x. x.x. x.x. x.x. x.x. xxxx xxxx',
  },
  {},
  BARS,
)

// Drift. No drums at all. Sub, a ride, and the melody with nothing to compete with.
const drift = pattern(
  'drift',
  'Drift',
  { '909.rd': 'x... .... .... .... x... .... .... ....' },
  {
    '303.a': '0a . . . | . . . . | . . 3s . | . . . . | 7a . . . | . . . . | . . 10 . | . . . .',
    '303.b': '0a . . . | . . . . | . . . . | . . . . | 5a . . . | . . . . | . . . . | . . . .',
  },
  BARS,
)

export function saturnSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // A 909 kick tuned short and low. At 170 anything with a tail on it smears into the
  // next hit and the break stops being legible.
  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.18, tune: 0.3, colour: 0.45, level: 0.5 }
  // The snare is the record: tuned high and tight, and the only thing sent hard to the
  // reverb. Everything else is dry, which is what makes it sound like it is in a room the
  // size of a planet while the drums stay right in front of you.
  kit.params['909.sd'] = { ...kit.params['909.sd'], decay: 0.22, tune: 0.62, tone: 0.7, level: 0.46 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.1, tone: 0.75, level: 0.2, pan: 0.44 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.22, tone: 0.7, level: 0.26, pan: 0.58 }
  kit.params['909.rd'] = { ...kit.params['909.rd'], decay: 0.6, tone: 0.66, level: 0.22, pan: 0.56 }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.85, tone: 0.55, level: 0.3 }
  // The ghost voice. Quiet, dry, and panned slightly off centre so it sits beside the
  // snare rather than underneath it.
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.2, tune: 0.5, level: 0.26, pan: 0.42 }
  kit.params['808.lt'] = { ...kit.params['808.lt'], decay: 0.7, tune: 0.15, colour: 0.3, level: 0.34 }

  if (kit.bass) {
    // The sub. Almost no filter movement, almost no resonance, a long decay — one note
    // that simply sits there for two bars. On this record the bass is a floor, not a part.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.06,
      wave: 0,
      cutoff: 0.1,
      resonance: 0.14,
      envMod: 0.08,
      decay: 0.85,
      accent: 0.2,
      level: 0.56,
    }
    // And the one melodic voice: a thin, closed, faraway sound. Not a lead — a signal.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.72,
      wave: 1,
      cutoff: 0.22,
      resonance: 0.44,
      envMod: 0.3,
      decay: 0.5,
      accent: 0.5,
      level: 0.34,
    }
  }

  kit.sends = {
    '909.sd': { delay: 0.22, reverb: 0.52 },
    '808.rs': { delay: 0.14, reverb: 0.16 },
    '909.oh': { delay: 0.1, reverb: 0.22 },
    '909.rd': { delay: 0.16, reverb: 0.4 },
    '909.cr': { delay: 0.08, reverb: 0.6 },
    '808.lt': { delay: 0.2, reverb: 0.44 },
    '303.a': { delay: 0.42, reverb: 0.5 },
  }

  return {
    bpm: 170,
    swing: 0,
    patterns: clonePatterns([orbit, breaks, rings, fold, impact, roll, drift]),
    // Each entry here is one pass of a 32-step pattern, so two musical bars. The
    // arrangement is a jungle arrangement: get in, break down, come back harder, and put
    // the biggest hole in it right before the end.
    chain: [
      { pattern: 'orbit', repeat: 1 },
      { pattern: 'break', repeat: 6 },
      { pattern: 'rings', repeat: 6 },
      { pattern: 'fold', repeat: 4 },
      { pattern: 'impact', repeat: 1 },
      { pattern: 'drift', repeat: 4 },
      { pattern: 'roll', repeat: 1 },
      { pattern: 'rings', repeat: 6 },
      { pattern: 'fold', repeat: 6 },
      { pattern: 'impact', repeat: 1 },
      { pattern: 'break', repeat: 4 },
      { pattern: 'orbit', repeat: 3 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A long delay and a very big room. This is the only song here where the reverb is
      // a location rather than a sheen.
      delayTime: 0.375,
      delayFeedback: 0.42,
      delayTone: 0.5,
      reverbSize: 0.78,
      reverbDamping: 0.55,
    },
  }
}
