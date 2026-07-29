import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Pump. Hip house, aimed at the Technotronic record.
//
// Written in the idiom rather than transcribed from it — this is the genre's furniture set
// up the way that record sets it up, not its melody. What that means in practice:
//
// **A STAB, not a line.** Every other 303 part here is legato or burbling; this one is a
// chord-shaped hit with the decay almost shut, played on the offbeats. 1989 house is built
// on a brass or organ stab that lands *between* the kicks, and it is the rhythm of that
// stab — not the notes in it — that makes the style. Acid squelches, Ascend sings, Cumulus
// bubbles; this one punches and gets out of the way.
//
// **The clap is enormous.** Late-eighties house is a 909 clap with a gated room on it,
// mixed nearly as loud as the kick. It is doing the work a snare does elsewhere.
//
// **The bass jumps the octave.** Root, root, octave — the oldest bassline in dance music,
// and the one that makes a floor move at 124.
//
// Straight, because hip house is. What swings is the stab's placement, not the grid.

// The floor. Kick, an offbeat open hat, and the octave bass already jumping.
//
// Not a bare kick-and-closed-hat: that is byte-for-byte Acieed's opening, and two songs in
// one set that begin with exactly the same bar sound like the same song starting twice.
// (There is a test for it, which is how this got caught.) The open hat on the offbeat and
// the octave bass are both here on bar one because this genre never eases in.
const floor = pattern(
  'floor',
  'Floor',
  {
    '909.bd': 'X... x... X... x...',
    '909.oh': '..x. ..x. ..x. ..x.',
  },
  { '303.b': '0a . . 12 | 0a . . . | 0a . . 12 | 0a . . .' },
)

// The stab arrives. Offbeats, and immediately the whole thing is a record.
const stab = pattern(
  'stab',
  'Stab',
  {
    '909.bd': 'X... x... X... x...',
    '909.cp': '.... X... .... X...',
    '909.ch': 'x.x. x.x. x.x. x.x.',
  },
  {
    // On the "and" of every beat. The gaps are the hook.
    '303.a': '. . 0a . | . . 10a . | . . 0a . | . . 7a .',
    '303.b': '0a . . 12 | 0a . . . | 0a . . 12 | 0a . . .',
  },
)

// Pump. Open hat, cowbell, and the stab answering itself an octave up.
const pump = pattern(
  'pump',
  'Pump',
  {
    '909.bd': 'X... x... X... x...',
    '909.cp': '.... X... .... X...',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '909.oh': '..x. ..x. ..x. ..x.',
    '808.cb': '.... ..x. .... ....',
  },
  {
    '303.a': '. . 0a . | . 12 10a . | . . 0a . | . 7 5a .',
    '303.b': '0a . . 12 | 0a . . . | 0a . . 12 | 0a . 10 .',
  },
)

// The one where the rimshot and the toms come in and it stops being a loop.
const shout = pattern(
  'shout',
  'Shout',
  {
    '909.bd': 'X... x... X... x..x',
    '909.cp': '.... X... .... X..x',
    '909.ch': 'x.xx x.xx x.xx x.xx',
    '909.oh': '..x. ..x. ..x. ..x.',
    '808.cb': '.... ..x. .... ..x.',
    '909.rim': '..x. .... ..x. ....',
    '909.lt': '.... .... .... x...',
  },
  {
    '303.a': '. . 12a . | . 15 22a . | . . 12a . | . 19 17a .',
    '303.b': '0a . . 12 | 0a . . . | 5a . . 17 | 5a . . .',
  },
)

// Drop. Everything out but the clap and its room, which is the loudest silence here.
const drop = pattern(
  'drop',
  'Drop',
  { '909.cp': '.... X... .... X...', '909.oh': '..x. .... ..x. ....' },
  { '303.b': '0a . . . | . . . . | 0a . . . | . . . .' },
)

export function pumpSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.34, tune: 0.36, colour: 0.5, level: 0.66 }
  // Nearly as loud as the kick, and long. This is the sound of the year.
  kit.params['909.cp'] = { ...kit.params['909.cp'], decay: 0.62, level: 0.6, pan: 0.5 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.14, tone: 0.7, level: 0.32, pan: 0.44 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.36, tone: 0.66, level: 0.4, pan: 0.58 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.3, tune: 0.62, level: 0.3, pan: 0.62 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.3, pan: 0.36 }
  kit.params['909.lt'] = { ...kit.params['909.lt'], decay: 0.4, tune: 0.3, colour: 0.4, level: 0.44 }

  if (kit.bass) {
    // The stab. Cutoff high, resonance high, and the decay almost shut — the envelope has
    // to be finished before the next sixteenth or it stops being a stab and becomes a line.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.62,
      wave: 1,
      cutoff: 0.5,
      resonance: 0.7,
      envMod: 0.62,
      decay: 0.14,
      accent: 0.8,
      level: 0.5,
    }
    // And the octave jump underneath. Round, loud, and completely unsubtle.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.16,
      wave: 0,
      cutoff: 0.2,
      resonance: 0.3,
      envMod: 0.24,
      decay: 0.4,
      accent: 0.45,
      level: 0.56,
    }
  }

  kit.sends = {
    // The gated room on the clap, which is the one effect this genre cannot do without.
    '909.cp': { delay: 0.12, reverb: 0.46 },
    '909.oh': { delay: 0.16, reverb: 0.22 },
    '808.cb': { delay: 0.36, reverb: 0.24 },
    '909.rim': { delay: 0.42, reverb: 0.26 },
    '909.lt': { delay: 0.14, reverb: 0.3 },
    '303.a': { delay: 0.3, reverb: 0.24 },
  }

  return {
    bpm: 124,
    swing: 0,
    patterns: clonePatterns([floor, stab, pump, shout, drop]),
    chain: [
      { pattern: 'floor', repeat: 2 },
      { pattern: 'stab', repeat: 6 },
      { pattern: 'pump', repeat: 8 },
      { pattern: 'drop', repeat: 2 },
      { pattern: 'shout', repeat: 8 },
      { pattern: 'pump', repeat: 6 },
      { pattern: 'drop', repeat: 2 },
      { pattern: 'shout', repeat: 8 },
      { pattern: 'stab', repeat: 4 },
      { pattern: 'floor', repeat: 2 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A sixteenth slap on the ornaments and a bright, short room. Nothing here is meant
      // to sound far away.
      delayTime: 0,
      delayFeedback: 0.3,
      delayTone: 0.68,
      reverbSize: 0.32,
      reverbDamping: 0.28,
    },
  }
}
