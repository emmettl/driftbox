import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { clonePatterns, pattern } from './notation.js'

// Paper Cities. The high voice asks a short question, and the refrain answers it.
// A dry backbeat keeps the swung hats and rounded bass from turning into ambient house.
const drums = {
  '808.bd': 'X... ...x ..x. ....',
  '909.sd': '.... X... .... X...',
  '808.ch': 'x.x. .xx. x.x. .x.x',
  '808.rs': '.... ...x .... ..x.',
}
const bass = '0a . . . | . . 7 . | 10s 10 . . | . 3 . .'
const question = '. . 12 . | 15 . 19s 19 | . . 17 . | 15 . . .'
const answer = '. . 19 . | 22 . 19 . | 17s 17 15 . | 12 . . .'
const PATTERNS = [
  pattern('fold', 'First Fold', { '808.ch': 'x... ..x. x... ..x.', '808.rs': '.... .... .... ..x.' }, {
    '303.a': '. . 12 . | . . . . | . . 15 . | . . . .',
  }),
  pattern('street', 'Side Street', drums, { '303.b': bass }),
  pattern('windows', 'Windows', drums, { '303.a': question, '303.b': bass }),
  pattern('reply', 'Open Windows', { ...drums, '808.oh': '.... ..x. .... ....' }, {
    '303.a': answer, '303.b': '5a . . . | . . 12 . | 3s 3 . . | . 7 . .',
  }),
  pattern('courtyard', 'Courtyard', { '808.rs': '.... x... .... x...', '808.ch': '..x. .... ..x. ....' }, {
    '303.a': '12 . . . | . . 15 . | . . 10 . | . . . .',
    '303.b': '5a . . . | . . . . | 3 . . . | . . . .',
  }),
  pattern('rooftops', 'Rooftops', {
    ...drums, '808.bd': 'X... ...x ..x. ...x', '808.oh': '.... ..x. .... ..x.',
    '909.sd': '.... X... ...x X..x',
  }, { '303.a': answer, '303.b': bass }),
  pattern('close', 'Last Fold', { '808.rs': '.... x... .... ....' }, {
    '303.a': '12 . . . | . . . . | . . . . | . . . .',
    '303.b': '0 . . . | . . . . | . . . . | . . . .',
  }),
]

export function paperCitiesSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  const voice = (id: string, knobs: Partial<(typeof kit.params)[string]>) => {
    kit.params[id] = { ...kit.params[id], ...knobs }
  }
  voice('808.bd', { decay: 0.38, tune: 0.3, level: 0.7 })
  voice('909.sd', { decay: 0.24, tone: 0.38, colour: 0.44, level: 0.48, pan: 0.52 })
  voice('808.ch', { decay: 0.13, tone: 0.44, level: 0.25, pan: 0.38 })
  voice('808.rs', { decay: 0.16, tune: 0.52, level: 0.25, pan: 0.68 })
  voice('808.oh', { decay: 0.25, tone: 0.42, level: 0.23, pan: 0.6 })
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 0.75, wave: 0, cutoff: 0.22,
      resonance: 0.2, envMod: 0.24, decay: 0.4, accent: 0.35, level: 0.38 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.25, wave: 0, cutoff: 0.1,
      resonance: 0.08, envMod: 0.1, decay: 0.62, accent: 0.4, level: 0.56 }
  }
  kit.swing = { '808.bd': 0.39, '909.sd': 0.36, '808.ch': 0.64, '808.rs': 0.6 }
  kit.sends = {
    '909.sd': { delay: 0, reverb: 0.17 }, '808.rs': { delay: 0.22, reverb: 0.12 },
    '303.a': { delay: 0.32, reverb: 0.3 }, '303.b': { delay: 0, reverb: 0.04 },
  }
  return {
    bpm: 86, swing: 0.28, patterns: clonePatterns(PATTERNS),
    chain: [
      { pattern: 'fold', repeat: 4 }, { pattern: 'street', repeat: 4 },
      { pattern: 'windows', repeat: 4 }, { pattern: 'reply', repeat: 4 },
      { pattern: 'windows', repeat: 4 }, { pattern: 'reply', repeat: 4 },
      { pattern: 'courtyard', repeat: 4 }, { pattern: 'street', repeat: 2 },
      { pattern: 'windows', repeat: 4 }, { pattern: 'rooftops', repeat: 4 },
      { pattern: 'reply', repeat: 4 }, { pattern: 'close', repeat: 4 },
    ],
    kit,
    fx: { ...defaultFx(), delayTime: 0.5233, delayFeedback: 0.3, delayTone: 0.3,
      reverbSize: 0.4, reverbDamping: 0.65 },
  }
}
