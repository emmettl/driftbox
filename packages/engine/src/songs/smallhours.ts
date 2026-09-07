import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { clonePatterns, pattern } from './notation.js'

// ii9 – V13 – Imaj9 – IVmaj9. The two monosynths imply the voicings with bass
// roots and upper extensions; Small Hours ++ supplies their simultaneous sevenths.
const roots = [2, 7, 0, 5]
const names = ['Last Platform', 'Passing Windows', 'Empty Carriage', 'Homeward']
const melody = [
  '. . 17 . | . 21 . . | 24s 24 . . | . . 16 .',
  '. . 23 . | . 21 . . | 17 . . . | . . 14 .',
  '16 . . . | . . 23 . | . 19 . . | 14s 14 . .',
  '. . 21 . | . . 16 . | 19 . . . | . . 12 .',
]
const PATTERNS = ['platform', 'windows', 'afterglow'].flatMap((edition) => roots.map((root, i) => pattern(
  `${edition}-${i}`, `${names[i]}${edition === 'platform' ? ' · Waiting' : edition === 'afterglow' ? ' · Afterglow' : ''}`,
  edition === 'afterglow' ? { '808.rs': '.... .... .... ..x.' } : {
    '808.bd': 'X... .... ..x. ....', '808.ch': '..x. ..x. .x.. ..x.',
    '808.rs': '.... x... .... x...',
    ...(edition === 'windows' ? { '808.sd': '.... x... .... x...', '808.ma': '...x .... ...x ....' } : {}),
  }, {
    '303.a': melody[i],
    '303.b': `${root}s ${root} . . | . . . . | . . ${root + 7} . | . ${root} . .`,
  },
)))

export function smallHoursSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  const knobs: Record<string, Partial<(typeof kit.params)[string]>> = {
    '808.bd': { decay: 0.23, tune: 0.4, level: 0.48 },
    '808.sd': { decay: 0.17, tone: 0.24, colour: 0.23, level: 0.17, pan: 0.54 },
    '808.rs': { decay: 0.1, level: 0.32, pan: 0.6 },
    '808.ch': { decay: 0.09, tone: 0.3, level: 0.18, pan: 0.35 },
    '808.ma': { decay: 0.12, level: 0.12, pan: 0.72 },
  }
  for (const [id, params] of Object.entries(knobs)) kit.params[id] = { ...kit.params[id], ...params }
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 0.75, wave: 0, cutoff: 0.21,
      resonance: 0.12, envMod: 0.15, decay: 0.44, accent: 0.2, level: 0.36 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.25, wave: 0, cutoff: 0.1,
      resonance: 0.05, envMod: 0.06, decay: 0.45, accent: 0.2, level: 0.42 }
  }
  kit.sends = { '303.a': { delay: 0.25, reverb: 0.42 }, '303.b': { delay: 0, reverb: 0.06 },
    '808.rs': { delay: 0.08, reverb: 0.24 }, '808.sd': { delay: 0, reverb: 0.19 } }
  return {
    bpm: 78, swing: 0.24, patterns: clonePatterns(PATTERNS),
    chain: ['platform', 'windows', 'afterglow', 'windows'].flatMap((edition) =>
      roots.map((_, i) => ({ pattern: `${edition}-${i}`, repeat: 4 }))),
    kit,
    fx: { ...defaultFx(), delayTime: 0.5769, delayFeedback: 0.3, delayTone: 0.24,
      reverbSize: 0.58, reverbDamping: 0.7 },
  }
}
