import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { AUTOMATION_TARGET } from '../automation.js'
import { clonePatterns, pattern } from './notation.js'

// Hothouse. The groovebox score stands alone as a dub miniature; its rack arrangement
// adds the simultaneous minor-seventh stabs that two monophonic 303s cannot supply.
const pulse = { '909.bd': 'X... x... X... x...', '808.ch': '..x. ..x. ..x. ..x.' }
const bass = '0a . . . | . . . . | . . 7 . | . . . .'
const stab = '. . 12a . | . . . . | . . . . | . 15a . .'
const PATTERNS = [
  pattern('seed', 'Seed', { '808.rs': '.... ..x. .... ....' }, { '303.a': stab }),
  pattern('roots', 'Roots', pulse, { '303.b': bass }),
  pattern('glass', 'Under Glass', { ...pulse, '808.rs': '.... ..x. .... .x..' }, {
    '303.a': stab, '303.b': bass,
  }),
  pattern('canopy', 'Canopy', { ...pulse, '808.cp': '.... x... .... x...', '808.oh': '.... .... ..x. ....' }, {
    '303.a': '. . 12a . | . . 19 . | . . . . | . 15a . .', '303.b': bass,
  }),
  pattern('mist', 'Mist', { '808.rs': '.... ..x. .... ....', '808.oh': '.... .... ..x. ....' }, {
    '303.a': '. . 12a . | . . . . | . . . . | . . . .',
    '303.b': '0 . . . | . . . . | . . . . | . . . .',
  }),
  pattern('bloom', 'Bloom', { ...pulse, '808.cp': '.... x... .... x...', '808.rs': '.... ..x. .... .x..',
    '808.oh': '.... .... ..x. ....', '808.ma': '...x .... ...x ....' }, {
    '303.a': '. . 12a . | . . 19 . | . . 22 . | . 15a . .', '303.b': bass,
  }),
]

export function hothouseSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  const voice = (id: string, knobs: Partial<(typeof kit.params)[string]>) => {
    kit.params[id] = { ...kit.params[id], ...knobs }
  }
  voice('909.bd', { decay: 0.32, tune: 0.32, colour: 0.35, level: 0.6 })
  voice('808.ch', { decay: 0.12, tone: 0.4, level: 0.22, pan: 0.42 })
  voice('808.oh', { decay: 0.22, tone: 0.35, level: 0.22, pan: 0.62 })
  voice('808.rs', { decay: 0.13, tune: 0.45, level: 0.28, pan: 0.62 })
  voice('808.cp', { decay: 0.22, tone: 0.38, level: 0.23, pan: 0.48 })
  voice('808.ma', { decay: 0.16, level: 0.16, pan: 0.35 })
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 0.65, wave: 1, cutoff: 0.25,
      resonance: 0.42, envMod: 0.28, decay: 0.16, accent: 0.45, level: 0.29 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.15, wave: 0, cutoff: 0.09,
      resonance: 0.1, envMod: 0.05, decay: 0.58, accent: 0.3, level: 0.5 }
  }
  kit.sends = {
    '808.rs': { delay: 0.52, reverb: 0.2 }, '808.cp': { delay: 0.28, reverb: 0.25 },
    '303.a': { delay: 0.7, reverb: 0.32 }, '303.b': { delay: 0, reverb: 0.03 },
  }
  return {
    bpm: 118, swing: 0.06, patterns: clonePatterns(PATTERNS),
    chain: [{ pattern: 'seed', repeat: 4 }, { pattern: 'roots', repeat: 4 },
      { pattern: 'glass', repeat: 8 }, { pattern: 'canopy', repeat: 8 },
      { pattern: 'mist', repeat: 4 }, { pattern: 'glass', repeat: 4 },
      { pattern: 'bloom', repeat: 8 }, { pattern: 'canopy', repeat: 4 }, { pattern: 'seed', repeat: 4 }],
    kit,
    fx: { ...defaultFx(), delayTime: 0.3814, delayFeedback: 0.55, delayTone: 0.3,
      reverbSize: 0.62, reverbDamping: 0.68 },
    automation: [{ target: AUTOMATION_TARGET.bass('303.a', 'cutoff'), interpolation: 'linear',
      points: [{ bar: 0, index: 0, value: 0.2 }, { bar: 23, index: 0, value: 0.37 },
        { bar: 24, index: 0, value: 0.18 }, { bar: 39, index: 0, value: 0.42 },
        { bar: 47, index: 0, value: 0.18 }] }],
  }
}
