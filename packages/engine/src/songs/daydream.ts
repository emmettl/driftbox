import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { clonePatterns, pattern } from './notation.js'

// Four chords implied by the two mono voices: I, vi, IV, V. The rack supplies their
// simultaneous voicings, but the melody and moving bass make the harmony audible here.
const roots = [0, 9, 5, 7]
const names = ['Meadow', 'Photograph', 'September', 'Receiver']
const melodies = [
  '12 . . . | 16s 16 . 19 | . . 16 . | 14 . 12 .',
  '16 . . . | 21 . . 19 | . . 16 . | 14 . . .',
  '17 . . . | 21s 21 . 19 | . . 17 . | 16 . 14 .',
  '19 . . . | 23 . . 21 | . . 19 . | 16 . 14 .',
]
const PATTERNS = ['tune', 'picture', 'memory'].flatMap((edition) => roots.map((root, i) => pattern(
  `${edition}-${i}`, `${names[i]}${edition === 'tune' ? ' · Tuning' : edition === 'memory' ? ' · Memory' : ''}`,
  edition === 'memory' ? { '808.rs': '.... .... ..x. ....' } : {
    '808.bd': 'X... ..x. .... x...',
    '808.ch': '..x. .x.. ..x. .x..',
    ...(edition === 'picture' ? {
      '808.sd': '.... X... .... X...', '909.rim': '...x .... .... ...x',
      '808.oh': '.... .... .... ..x.',
    } : {}),
  }, {
    '303.a': melodies[i],
    '303.b': `${root} . . . | . . . . | ${root}s ${root} . . | . . . .`,
  },
)))

export function daydreamSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  const voice = (id: string, knobs: Partial<(typeof kit.params)[string]>) => {
    kit.params[id] = { ...kit.params[id], ...knobs }
  }
  voice('808.bd', { decay: 0.28, tune: 0.35, level: 0.56 })
  voice('808.sd', { decay: 0.2, tone: 0.32, colour: 0.34, level: 0.38, pan: 0.53 })
  voice('808.ch', { decay: 0.1, tone: 0.4, level: 0.2, pan: 0.35 })
  voice('808.oh', { decay: 0.22, tone: 0.36, level: 0.18, pan: 0.63 })
  voice('808.rs', { decay: 0.12, level: 0.2, pan: 0.68 })
  voice('909.rim', { decay: 0.14, level: 0.18, pan: 0.65 })
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 0.7, wave: 0, cutoff: 0.24,
      resonance: 0.16, envMod: 0.18, decay: 0.54, accent: 0.28, level: 0.37 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.2, wave: 0, cutoff: 0.1,
      resonance: 0.06, envMod: 0.06, decay: 0.62, accent: 0.24, level: 0.4 }
  }
  kit.sends = { '303.a': { delay: 0.35, reverb: 0.32 }, '303.b': { delay: 0, reverb: 0.08 },
    '808.sd': { delay: 0, reverb: 0.12 }, '909.rim': { delay: 0.12, reverb: 0.14 } }
  return {
    bpm: 96, swing: 0.16, patterns: clonePatterns(PATTERNS),
    chain: ['tune', 'picture', 'memory', 'picture'].flatMap((edition) =>
      roots.map((_, i) => ({ pattern: `${edition}-${i}`, repeat: 4 }))),
    kit,
    fx: { ...defaultFx(), delayTime: 0.4688, delayFeedback: 0.32, delayTone: 0.28,
      reverbSize: 0.55, reverbDamping: 0.68 },
  }
}
