import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { clonePatterns, pattern, steps } from './notation.js'

// Offset. A fifteen-step rim figure meets a sixteen-step foundation every fifteen bars.
// Drum-lane lengths restart at a transport bar, so the moving part is deliberately
// written across the whole cycle. Each resulting bar is still an ordinary editable clip.
const rim = steps('X.. x.. .x. .x. x..')
const bell = steps('... .x. ... x.. ...')
const weave = Array.from({ length: 15 }, (_, bar) => {
  const p = pattern(`weave-${bar}`, `Weave ${String(bar + 1).padStart(2, '0')}`, {
    '808.bd': 'X... .... x... ....',
    '808.ma': '..x. ..x. ..x. ..x.',
    '909.lt': '.... x... .... x...',
    '808.ch': 'x... x... x... x...',
  }, {
    '303.a': bar % 3 === 0 ? '12 . . . | . . . . | . . 19 . | . . . .' : '. . . . | . . . . | . . . . | . . . .',
    '303.b': `${[0, 0, 7, 5, 0][Math.floor(bar / 3)]}a . . . | . . . . | . . . . | . . . .`,
  })
  p.tracks['808.rs'] = Array.from({ length: 16 }, (_, step) => rim[(bar * 16 + step) % 15])
  p.tracks['808.cb'] = Array.from({ length: 16 }, (_, step) => bell[(bar * 16 + step) % 15])
  return p
})
const PATTERNS = [
  pattern('warp', 'Warp', { '808.bd': 'X... .... x... ....', '808.ma': '..x. ..x. ..x. ..x.' }),
  ...weave,
  pattern('selvedge', 'Selvedge', { '808.ma': '..x. ..x. ..x. ..x.', '808.rs': 'x... .... .... ....' }, {
    '303.a': '12 . . . | . . . . | 19 . . . | . . . .',
  }),
]

export function offsetSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  const voice = (id: string, knobs: Partial<(typeof kit.params)[string]>) => {
    kit.params[id] = { ...kit.params[id], ...knobs }
  }
  voice('808.bd', { decay: 0.24, tune: 0.38, level: 0.6 })
  voice('808.rs', { decay: 0.12, tune: 0.65, level: 0.5, pan: 0.3 })
  voice('808.cb', { decay: 0.16, tune: 0.42, level: 0.25, pan: 0.7 })
  voice('808.ma', { decay: 0.12, level: 0.24, pan: 0.62 })
  voice('808.ch', { decay: 0.08, tone: 0.35, level: 0.15, pan: 0.44 })
  voice('909.lt', { decay: 0.24, tune: 0.48, level: 0.28 })
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 0.65, wave: 1, cutoff: 0.28,
      resonance: 0.32, envMod: 0.26, decay: 0.17, accent: 0.34, level: 0.26 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.15, wave: 0, cutoff: 0.1,
      resonance: 0.08, envMod: 0.06, decay: 0.44, accent: 0.3, level: 0.4 }
  }
  kit.sends = {
    '808.rs': { delay: 0, reverb: 0.15 }, '808.cb': { delay: 0, reverb: 0.22 },
    '303.a': { delay: 0.3, reverb: 0.25 }, '303.b': { delay: 0, reverb: 0.04 },
  }
  const cycle = () => weave.map((p) => ({ pattern: p.id, repeat: 1 }))
  return {
    bpm: 110, swing: 0, patterns: clonePatterns(PATTERNS),
    chain: [{ pattern: 'warp', repeat: 4 }, ...cycle(), ...cycle(),
      { pattern: 'selvedge', repeat: 4 }, ...cycle(), { pattern: 'warp', repeat: 4 }],
    kit,
    fx: { ...defaultFx(), delayTime: 0.4091, delayFeedback: 0.28, delayTone: 0.5,
      reverbSize: 0.3, reverbDamping: 0.52 },
  }
}
