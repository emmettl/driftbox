import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Ascend. The Rez one — trance, and built to arrive rather than to sit there.
//
// Rez's soundtrack works by accumulation: a bare pulse, then a layer, then another,
// each one arriving on a boundary you can feel coming, and the pay-off is that you have
// been waiting for it. So the arrangement here is the composition. Six patterns that are
// mostly the same pattern with more in it, and a chain that adds one thing at a time and
// then takes everything away twice.
//
// The 303 is doing a third job again. Acid uses it for squelch and darkwave for drone;
// this is a *melodic* line — sixteenths, moving constantly, slides on almost every step
// so it reads as one continuous phrase rather than as separate notes. The filter opens
// as the track builds, which on a 303 is done by the cutoff knob and here by playing the
// same figure with more of it audible.
//
// Fast and dead straight. Any swing at all and it stops being this genre.

// The pulse. Kick, an offbeat open hat, and the sub holding the root — where every Rez
// stage starts.
//
// The open hat and the drone are here to keep this off Acieed's opening, which was the
// same kick and the same closed hat on the "e" and therefore the same four bars at a
// different tempo. An offbeat open hat is the most trance sound there is and the one thing
// an acid intro never does, so four bars in you already know which record this is.
const pulse = pattern(
  'pulse',
  'Pulse',
  {
    '909.bd': 'X... x... X... x...',
    '909.oh': '..x. ..x. ..x. ..x.',
  },
  { '303.b': '0a . . . | . . . . | 0a . . . | . . . .' },
)

// The line arrives. Sixteenths on the 303, sliding through almost all of it.
const vector = pattern(
  'vector',
  'Vector',
  {
    '909.bd': 'X... x... X... x...',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '909.oh': '..x. ..x. ..x. ..x.',
  },
  {
    // Minor, and climbing. 0 3 7 10 is the minor seventh chord walked upward, and the
    // slides between them are what make it a phrase instead of four notes.
    '303.a': '0a 3s 3 7s | 7 10s 10 12 | 15a 12 10 7 | 5s 5 3 0',
  },
)

// Clap on the backbeat and the low 303 underneath. The first thing that feels like a
// track rather than a loop.
const circuit = pattern(
  'circuit',
  'Circuit',
  {
    '909.bd': 'X... x... X... x...',
    '909.cp': '.... X... .... X...',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '909.oh': '..x. ..x. ..x. ..x.',
  },
  {
    '303.a': '0a 3s 3 7s | 7 10s 10 12 | 15a 12 10 7 | 5s 5 3 0',
    '303.b': '0a . . . | . . . . | 0a . . . | . . . .',
  },
)

// Everything, and the ride. The top of the climb.
const ascend = pattern(
  'ascend',
  'Ascend',
  {
    '909.bd': 'X... x... X... x...',
    '909.cp': '.... X... .... X..x',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '909.oh': '..x. ..x. ..x. ..x.',
    '909.rd': 'x... .... x... ....',
    '909.rim': '..x. .... ..x. ....',
  },
  {
    // An octave up, and reaching further at the top of the bar.
    '303.a': '12a 15s 15 19s | 19 22s 22 24 | 22a 19 15 12 | 17s 17 15 12',
    '303.b': '0a . . . | . . . . | 3a . . . | . . . .',
  },
)

// The drop. Line only, no drums — the oldest trick in trance and the one Rez leans on
// hardest, because everything comes back louder without anything having changed.
const suspend = pattern(
  'suspend',
  'Suspend',
  { '909.ch': '..x. ..x. ..x. ..x.' },
  { '303.a': '0a 3s 3 7s | 7 10s 10 12 | 15a 12 10 7 | 5s 5 3 0' },
)

// Crash and hold. One bar, used as a hinge between sections.
const surge = pattern(
  'surge',
  'Surge',
  {
    '909.bd': 'X... .... .... ....',
    '909.cr': 'x... .... .... ....',
    '909.ch': 'x.xx x.xx x.xx x.xx',
  },
  { '303.a': '24a . . . | . . . . | . . . . | . . . .' },
)

export function ascendSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // A 909 doing what a 909 is for at this tempo: short, tight, and loud.
  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.26, tune: 0.44, colour: 0.55, level: 0.7 }
  kit.params['909.cp'] = { ...kit.params['909.cp'], decay: 0.4, level: 0.56, pan: 0.54 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.16, tone: 0.72, level: 0.4 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.3, tone: 0.7, level: 0.44, pan: 0.6 }
  kit.params['909.rd'] = { ...kit.params['909.rd'], decay: 0.55, tone: 0.68, level: 0.3, pan: 0.62 }
  kit.params['909.cr'] = { ...kit.params['909.cr'], decay: 0.72, tone: 0.6, level: 0.34 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.36, pan: 0.36 }

  if (kit.bass) {
    // Melodic rather than squelchy: resonance high enough to sing, envelope modest, and
    // a decay long enough that consecutive sixteenths run into each other. Acid wants the
    // filter slamming shut between notes; this wants the opposite.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.52,
      wave: 0,
      cutoff: 0.34,
      resonance: 0.62,
      envMod: 0.45,
      decay: 0.55,
      accent: 0.6,
      level: 0.54,
    }
    // The sub. One note a bar, holding the root under everything.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.1,
      wave: 1,
      cutoff: 0.12,
      resonance: 0.2,
      envMod: 0.12,
      decay: 0.7,
      accent: 0.2,
      level: 0.5,
    }
  }

  // A short delay on the line so the sixteenths smear into each other, and enough room on
  // the top end to give it somewhere to happen. The kick stays completely dry.
  kit.sends = {
    '909.cp': { delay: 0.2, reverb: 0.26 },
    '909.oh': { delay: 0.14, reverb: 0.2 },
    '909.rd': { delay: 0.2, reverb: 0.34 },
    '909.cr': { delay: 0.12, reverb: 0.42 },
    '909.rim': { delay: 0.34, reverb: 0.2 },
    '303.a': { delay: 0.3, reverb: 0.22 },
  }

  return {
    bpm: 138,
    // Dead straight. Swing here would make it house, and this is not house.
    swing: 0,
    patterns: clonePatterns([pulse, vector, circuit, ascend, suspend, surge]),
    // The arrangement IS the composition: one thing added at a time, taken away twice,
    // and every section long enough that you feel the next one coming.
    chain: [
      { pattern: 'pulse', repeat: 2 },
      { pattern: 'vector', repeat: 6 },
      { pattern: 'circuit', repeat: 8 },
      { pattern: 'surge', repeat: 1 },
      { pattern: 'ascend', repeat: 8 },
      { pattern: 'suspend', repeat: 4 },
      { pattern: 'ascend', repeat: 8 },
      { pattern: 'circuit', repeat: 8 },
      { pattern: 'surge', repeat: 1 },
      { pattern: 'ascend', repeat: 8 },
      { pattern: 'suspend', repeat: 2 },
      { pattern: 'vector', repeat: 4 },
      { pattern: 'pulse', repeat: 4 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A sixteenth delay — too short to answer the line, just long enough to thicken it
      // — and a bright, medium room. Trance reverb is a sheen, not a cathedral.
      delayTime: 0,
      delayFeedback: 0.4,
      delayTone: 0.72,
      reverbSize: 0.38,
      reverbDamping: 0.3,
    },
  }
}
