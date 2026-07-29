import { defaultKit, type Pattern, type Song, type StepValue } from './engine'
import { ALL_VOICES } from './engine'

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

function pattern(
  id: string,
  name: string,
  tracks: Record<string, string>,
  length = 16,
): Pattern {
  const out: Record<string, StepValue[]> = {}
  for (const [voice, notation] of Object.entries(tracks)) out[voice] = steps(notation)
  return { id, name, length, tracks: out }
}

// Slow, swung, lots of space. The kick leaves the second half of the bar alone so the
// hats can carry it, which is most of why this reads as hazy rather than as a groove.
const drift = pattern('drift', 'Drift', {
  '808.bd': 'X... .... ..x. .... ',
  '808.sd': '.... X... .... x...',
  '808.cp': '.... X... .... ....',
  '808.ch': 'x.x. x.x. x.x. x.x.',
  '808.oh': '..x. .... ..x. ..x.',
  '808.ma': '.x.x .x.x .x.x .x.x',
})

// The same tempo with the bar filled in — a chorus to the one above.
const neon = pattern('neon', 'Neon', {
  '808.bd': 'X... ..x. ..X. .x..',
  '808.sd': '.... X... .... X...',
  '808.cp': '.... X... .... X..x',
  '808.ch': 'x.xx x.xx x.xx x.xx',
  '808.oh': '..x. .... ..x. ....',
  '808.cb': '.... .... x... ..x.',
  '808.mt': '.... .... .... x.x.',
})

// Almost nothing. Useful as an intro, and as the thing the game plays when the level
// is calm — the arrangement has somewhere to go from here.
const haze = pattern('haze', 'Haze', {
  '808.bd': 'X... .... .... ....',
  '808.sd': '.... .... .... x...',
  '808.ch': '..x. ..x. ..x. ..x.',
  '808.ma': '.... .x.. .... .x..',
})

// The 909 side: four to the floor, offbeat open hat, clap on the backbeat. The oldest
// trick in the machine and still the clearest demonstration of what a 909 is for.
const pulse = pattern('pulse', 'Pulse', {
  '909.bd': 'X... x... X... x...',
  '909.cp': '.... X... .... X...',
  '909.ch': 'x.x. x.x. x.x. x.x.',
  '909.oh': '..x. ..x. ..x. ..x.',
  '909.rim': '.... ..x. .... ..x.',
})

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

  return {
    bpm: 102,
    swing: 0.28,
    patterns: PATTERNS,
    chain: ['haze', 'drift', 'drift', 'neon'],
    kit,
  }
}
