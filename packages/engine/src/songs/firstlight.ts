import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { AUTOMATION_TARGET } from '../automation.js'
import { clonePatterns, pattern } from './notation.js'

// No drum events. A tied lower voice carries each harmony for four bars; the high
// voice places isolated notes in the room. The slow clock is an editing grid, not a beat.
const roots = [0, 5, 9, 7]
const names = ['Crystal', 'Thaw', 'Daybreak', 'Clear Glass']
const PATTERNS = roots.flatMap((root, chord) => Array.from({ length: 4 }, (_, bar) => pattern(
  `light-${chord}-${bar}`, `${names[chord]} ${bar + 1}`, {}, {
    '303.b': Array.from({ length: 16 }, () => `${root}s`).join(' '),
    '303.a': bar === 0
      ? `${root + 12} . . . | . . . . | . . . . | . . . .`
      : bar === 2 ? `. . . . | . . ${[19, 21, 16, 23][chord]} . | . . . . | . . . .`
        : '. . . . | . . . . | . . . . | . . . .',
  },
)))

export function firstLightSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 1, wave: 0, cutoff: 0.2,
      resonance: 0.22, envMod: 0.1, decay: 0.94, accent: 0.1, level: 0.24 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.5, wave: 0, cutoff: 0.14,
      resonance: 0.08, envMod: 0.04, decay: 1, accent: 0.1, level: 0.26 }
  }
  kit.sends = { '303.a': { delay: 0.58, reverb: 0.68 }, '303.b': { delay: 0.16, reverb: 0.38 } }
  return {
    bpm: 64, swing: 0, patterns: clonePatterns(PATTERNS),
    chain: Array.from({ length: 3 }, () => PATTERNS.map((p) => ({ pattern: p.id, repeat: 1 }))).flat(),
    kit,
    fx: { ...defaultFx(), delayTime: 0.7031, delayFeedback: 0.58, delayTone: 0.3,
      reverbSize: 0.85, reverbDamping: 0.62 },
    automation: [{ target: AUTOMATION_TARGET.bass('303.b', 'level'), interpolation: 'linear',
      points: [{ bar: 0, index: 0, value: 0.12 }, { bar: 4, index: 0, value: 0.26 },
        { bar: 28, index: 0, value: 0.3 }, { bar: 44, index: 0, value: 0.22 },
        { bar: 47, index: 15, value: 0.1 }] }],
  }
}
