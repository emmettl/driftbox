import {
  defaultFx,
  defaultKit,
  type BassStep,
  type Pattern,
  type Song,
  type StepValue,
} from './index.js'
import { ALL_VOICES } from './index.js'

// The patterns the box opens on. Written in a step notation rather than as arrays of
// numbers, because a drum pattern is a picture and should look like one in source:
//
//   X = accent   x = normal   . = rest   space = ignored, for grouping into beats

export function steps(notation: string): StepValue[] {
  return notation
    .replace(/\s/g, '')
    .split('')
    .map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : 0))
}

/**
 * A bassline, one whitespace-separated token per step.
 *
 *   .      rest
 *   0      a note, in semitones above the synth's root
 *   7a     accented
 *   12s    slides into whatever comes next
 *   0as    both
 *   |      ignored, for grouping into beats
 *
 * Wordier than the drum notation because a bass step carries three things rather than
 * one, but it keeps the same property: the line is legible as a line in the source.
 */
export function bassSteps(notation: string): BassStep[] {
  return notation
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '|')
    .map((token) => {
      if (token === '.') return { note: null, accent: false, slide: false }
      const [, digits, flags] = /^(-?\d+)([as]*)$/.exec(token) ?? []
      if (digits === undefined) throw new Error(`Unreadable bass step: ${token}`)
      return {
        note: Number(digits),
        accent: flags.includes('a'),
        slide: flags.includes('s'),
      }
    })
}

function pattern(
  id: string,
  name: string,
  tracks: Record<string, string>,
  bassLines: Record<string, string> = {},
  length = 16,
): Pattern {
  const out: Record<string, StepValue[]> = {}
  for (const [voice, notation] of Object.entries(tracks)) out[voice] = steps(notation)

  const bass: Record<string, BassStep[]> = {}
  for (const [voice, notation] of Object.entries(bassLines)) bass[voice] = bassSteps(notation)

  return { id, name, length, tracks: out, bass }
}

// Slow, swung, lots of space. The kick leaves the second half of the bar alone so the
// hats can carry it, which is most of why this reads as hazy rather than as a groove.
//
// The 303s stay out of each other's way: A plays the figure, B holds a long slide
// underneath it. Two lines doing the same thing an octave apart is the obvious use of
// having two, and the least interesting one.
const drift = pattern(
  'drift',
  'Drift',
  {
    '808.bd': 'X... .... ..x. .... ',
    '808.sd': '.... X... .... x...',
    '808.cp': '.... X... .... ....',
    '808.ch': 'x.x. x.x. x.x. x.x.',
    '808.oh': '..x. .... ..x. ..x.',
    '808.ma': '.x.x .x.x .x.x .x.x',
  },
  {
    '303.a': '0a . . 0 | . . 12s 12 | . 0 . . | 10 . 7 .',
    '303.b': '. . . . | 0a . . . | . . . 7s | 7 . . .',
  },
)

// The same tempo with the bar filled in — a chorus to the one above.
const neon = pattern(
  'neon',
  'Neon',
  {
    '808.bd': 'X... ..x. ..X. .x..',
    '808.sd': '.... X... .... X...',
    '808.cp': '.... X... .... X..x',
    '808.ch': 'x.xx x.xx x.xx x.xx',
    '808.oh': '..x. .... ..x. ....',
    '808.cb': '.... .... x... ..x.',
    '808.mt': '.... .... .... x.x.',
  },
  {
    // Slides on the way up, accents on the way down. Repeated notes at one pitch with
    // the odd octave jump is the whole acid vocabulary, and it works because the filter
    // envelope makes every repeat land differently.
    '303.a': '0a . 0 12s | 12 . 0 . | 3a . 3 . | 0 . 10s 10',
  },
)

// Almost nothing. Useful as an intro, and as the thing the game plays when the level
// is calm — the arrangement has somewhere to go from here. No bass at all, so the
// chain has one more place to go when it drops into Drift.
const haze = pattern('haze', 'Haze', {
  '808.bd': 'X... .... .... ....',
  '808.sd': '.... .... .... x...',
  '808.ch': '..x. ..x. ..x. ..x.',
  '808.ma': '.... .x.. .... .x..',
})

// The 909 side: four to the floor, offbeat open hat, clap on the backbeat. The oldest
// trick in the machine and still the clearest demonstration of what a 909 is for — and
// the one pattern here where a 303 is doing what a 303 was famous for.
const pulse = pattern(
  'pulse',
  'Pulse',
  {
    '909.bd': 'X... x... X... x...',
    '909.cp': '.... X... .... X...',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '909.oh': '..x. ..x. ..x. ..x.',
    '909.rim': '.... ..x. .... ..x.',
  },
  {
    '303.a': '0a . 0 . | 12s 12 . 0 | . 0 3a . | 0 . 12s 12',
  },
)

const PATTERNS = [drift, neon, haze, pulse]

export function defaultSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // A few knobs moved off centre so the box does not open sounding like a test tone.
  // Long 808 kick, soft hats, a clap with some room around it.
  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.72, tune: 0.38, colour: 0.35 }
  kit.params['808.sd'] = { ...kit.params['808.sd'], decay: 0.42, colour: 0.55, level: 0.7 }
  kit.params['808.cp'] = { ...kit.params['808.cp'], decay: 0.6, level: 0.55, pan: 0.62 }
  kit.params['808.ch'] = { ...kit.params['808.ch'], decay: 0.3, level: 0.5, pan: 0.42 }
  kit.params['808.oh'] = { ...kit.params['808.oh'], decay: 0.45, level: 0.45, pan: 0.58 }
  kit.params['808.ma'] = { ...kit.params['808.ma'], level: 0.32, pan: 0.66 }
  // The 909 side sits a little lower than default. Four-to-the-floor puts its kick on
  // every beat under a backbeat clap, and at level 0.8 the shipped pattern peaked over
  // full scale even through the bus compressor. Measured, not guessed.
  kit.params['909.bd'] = { ...kit.params['909.bd'], decay: 0.45, colour: 0.4, level: 0.68 }
  kit.params['909.cp'] = { ...kit.params['909.cp'], level: 0.58, pan: 0.56 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.28, level: 0.46 }
  kit.params['909.oh'] = { ...kit.params['909.oh'], decay: 0.4, level: 0.42, pan: 0.58 }
  kit.params['909.rim'] = { ...kit.params['909.rim'], level: 0.5, pan: 0.38 }

  // The two 303s are set up as a pair rather than as two of the same thing: A is the
  // bright one that squelches, B sits an octave down with the filter mostly shut and
  // barely any envelope, so it reads as a bass part rather than as a second lead.
  if (kit.bass) {
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      cutoff: 0.3,
      resonance: 0.78,
      envMod: 0.62,
      decay: 0.38,
      accent: 0.7,
      // Measured through the real bus, like the drum levels above. Worth recording what
      // that showed, because it is the opposite of what you would expect: adding the
      // basslines does not raise the output peak at all, it lowers it slightly (Drift
      // 0.984 -> 0.982, Neon 0.977 -> 0.964). Sustained bass sits under the compressor's
      // threshold long enough to pull the transients down with it. So the headroom on
      // these is set by the drums, and turning the 303s down buys nothing.
      level: 0.62,
    }
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.22,
      wave: 1,
      cutoff: 0.2,
      resonance: 0.4,
      envMod: 0.28,
      decay: 0.6,
      accent: 0.4,
      level: 0.5,
    }
  }

  // Sends. Sparingly, and not on the low end: reverb on a kick is mud, and delay on a
  // kick fills in exactly the space the pattern was leaving on purpose. What wants the
  // room is the backbeat and the things above it — the clap most of all, since a clap
  // with air around it is half of what makes a slow pattern sound like a record.
  kit.sends = {
    '808.sd': { delay: 0.12, reverb: 0.3 },
    '808.cp': { delay: 0.22, reverb: 0.45 },
    '808.oh': { delay: 0.1, reverb: 0.22 },
    '808.ma': { delay: 0, reverb: 0.18 },
    '808.cb': { delay: 0.3, reverb: 0.2 },
    '808.rs': { delay: 0.26, reverb: 0.16 },
    '909.cp': { delay: 0.14, reverb: 0.28 },
    '909.rim': { delay: 0.3, reverb: 0.18 },
    '909.oh': { delay: 0.08, reverb: 0.16 },
    // A little on the lead 303 and none at all on the low one. The same rule as the
    // kick: the part holding the bottom end down should stay dry, or it stops holding.
    '303.a': { delay: 0.16, reverb: 0.14 },
  }

  return {
    bpm: 102,
    swing: 0.28,
    patterns: PATTERNS,
    // An arrangement rather than a loop: an intro, a long middle, and a chorus that
    // does not outstay itself. The repeat counts are the point — writing this as a flat
    // list of bars would be nine entries to scroll past.
    chain: [
      { pattern: 'haze', repeat: 2 },
      { pattern: 'drift', repeat: 4 },
      { pattern: 'neon', repeat: 2 },
      { pattern: 'drift', repeat: 4 },
      { pattern: 'pulse', repeat: 4 },
    ],
    kit,
    fx: defaultFx(),
  }
}
