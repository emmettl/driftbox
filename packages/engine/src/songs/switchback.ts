import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { clonePatterns, pattern } from './notation.js'

// Fast, but with holes. The two 303s trade clipped syllables while kick and tom figures
// interrupt one another. Whole beats disappear in the Turn section before the reply.
const PATTERNS = [
  pattern('signal', 'Signal', { '808.cb': 'X... ...x .... ..x.', '808.ch': '..x. .... ..x. ....' }, {
    '303.a': '12a . 12 . | . . . . | . . 15a . | . . . .',
  }),
  pattern('left', 'Left Turn', {
    '808.bd': 'X..x ..X. .... x.x.', '808.cp': '.... X... .... X...',
    '909.lt': '.... .... ..x. ...x', '808.ch': '..x. .xx. ..x. .xx.',
  }, { '303.a': '12a . 12 . | . . . . | . . 15a . | . 12 . .',
    '303.b': '0a . . 0 | . . 7 . | . . . . | 0 . . .' }),
  pattern('right', 'Right Turn', {
    '808.bd': 'X... .x.. ..X. ...x', '808.cp': '.... .... X... ....',
    '909.mt': '..x. .... .x.. ..x.', '909.ht': '.... ...x .... ....', '808.ch': 'x.x. ..x. x.x. ..x.',
  }, { '303.a': '. . . . | 19a . 15 . | . . . . | 12a . . .',
    '303.b': '0a . . . | . 3 . . | 7a . . . | . . 0 .' }),
  pattern('turn', 'Blind Corner', {
    '808.bd': 'X... .... .... ....', '808.cb': '...x .... .... ....',
  }, { '303.a': '12a . . . | . . . . | . . . . | . . . .' }),
  pattern('double', 'Double Back', {
    '808.bd': 'X.x. ...X ..x. x..x', '808.cp': '.... X... ..x. X...',
    '909.lt': '...x .... .x.. ....', '909.ht': '.... ..x. .... ..xx', '808.ch': '..xx ..x. .xx. ..x.',
  }, { '303.a': '12a . 15 . | . . 19a . | 15 . . . | . 12a . .',
    '303.b': '0a . . 7 | . . . . | 3a . . 0 | . . . .' }),
  pattern('exit', 'Exit Ramp', { '808.ch': '..x. .... .... ....' }, {
    '303.a': '12a . . . | . . . . | . . . . | . . . .',
  }),
]

export function switchbackSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  const voice = (id: string, knobs: Partial<(typeof kit.params)[string]>) => {
    kit.params[id] = { ...kit.params[id], ...knobs }
  }
  voice('808.bd', { decay: 0.23, tune: 0.28, level: 0.64 })
  voice('808.cp', { decay: 0.18, tone: 0.66, level: 0.42, pan: 0.52 })
  voice('808.ch', { decay: 0.08, tone: 0.62, level: 0.23, pan: 0.4 })
  voice('808.cb', { decay: 0.12, level: 0.26, pan: 0.63 })
  voice('909.lt', { decay: 0.18, tune: 0.4, level: 0.35, pan: 0.32 })
  voice('909.mt', { decay: 0.16, tune: 0.5, level: 0.3, pan: 0.62 })
  voice('909.ht', { decay: 0.13, tune: 0.65, level: 0.25, pan: 0.7 })
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 0.9, wave: 1, cutoff: 0.42,
      resonance: 0.4, envMod: 0.32, decay: 0.1, accent: 0.65, level: 0.3 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.4, wave: 0, cutoff: 0.1,
      resonance: 0.1, envMod: 0.09, decay: 0.24, accent: 0.48, level: 0.48 }
  }
  kit.sends = { '303.a': { delay: 0.09, reverb: 0.12 }, '303.b': { delay: 0, reverb: 0 },
    '808.cp': { delay: 0, reverb: 0.1 }, '909.ht': { delay: 0.1, reverb: 0.08 } }
  return {
    bpm: 160, swing: 0.03, patterns: clonePatterns(PATTERNS),
    chain: [{ pattern: 'signal', repeat: 4 },
      ...Array.from({ length: 4 }, () => [
        { pattern: 'left', repeat: 4 }, { pattern: 'right', repeat: 4 },
        { pattern: 'turn', repeat: 1 }, { pattern: 'double', repeat: 6 },
      ]).flat(), { pattern: 'exit', repeat: 4 }],
    kit,
    fx: { ...defaultFx(), delayTime: 0.1406, delayFeedback: 0.18, delayTone: 0.5,
      reverbSize: 0.22, reverbDamping: 0.45 },
  }
}
