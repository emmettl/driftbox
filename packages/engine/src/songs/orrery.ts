import { ALL_VOICES } from '../kit.js'
import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { AUTOMATION_TARGET } from '../automation.js'
import { bassSteps, clonePatterns, pattern } from './notation.js'

// Five- and seven-beat melodies meet every 35 beats. Their alignment also meets the
// four-beat percussion after 35 bars. Author that entire cycle as editable 16-step
// clips, so crossing a bar never resets either melodic phrase.
const inner = bassSteps('12a . . . | . . 19 . | . . . . | 24 . . . | . . 19 .')
const outer = bassSteps('0a . . . | . . . . | 7s 7 . . | . . . . | 12 . . . | . . . . | 7 . . .')
const PATTERNS = Array.from({ length: 35 }, (_, bar) => {
  const p = pattern(`orbit-${bar}`, bar === 0 ? 'Conjunction' : `Epicycle ${String(bar + 1).padStart(2, '0')}`, {
    '808.ch': 'x... .... .... ....', '808.ma': '.... ..x. .... ..x.',
    '808.rs': 'X... .... .... ....',
  })
  p.bass = {
    '303.a': Array.from({ length: 16 }, (_, i) => ({ ...inner[(bar * 16 + i) % inner.length] })),
    '303.b': Array.from({ length: 16 }, (_, i) => ({ ...outer[(bar * 16 + i) % outer.length] })),
  }
  return p
})

export function orrerySong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))
  kit.params['808.ch'] = { ...kit.params['808.ch'], decay: 0.08, tone: 0.3, level: 0.1, pan: 0.33 }
  kit.params['808.ma'] = { ...kit.params['808.ma'], decay: 0.1, level: 0.14, pan: 0.68 }
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.12, tune: 0.6, level: 0.2, pan: 0.5 }
  if (kit.bass) {
    kit.bass['303.a'] = { ...kit.bass['303.a'], tune: 0.8, wave: 0, cutoff: 0.31,
      resonance: 0.25, envMod: 0.24, decay: 0.55, accent: 0.36, level: 0.32 }
    kit.bass['303.b'] = { ...kit.bass['303.b'], tune: 0.3, wave: 0, cutoff: 0.17,
      resonance: 0.1, envMod: 0.12, decay: 0.68, accent: 0.26, level: 0.4 }
  }
  kit.sends = { '303.a': { delay: 0.42, reverb: 0.4 }, '303.b': { delay: 0.18, reverb: 0.22 },
    '808.rs': { delay: 0.15, reverb: 0.35 }, '808.ma': { delay: 0, reverb: 0.15 } }
  return {
    bpm: 92, swing: 0, patterns: clonePatterns(PATTERNS),
    chain: Array.from({ length: 2 }, () => PATTERNS.map((p) => ({ pattern: p.id, repeat: 1 }))).flat(),
    kit,
    fx: { ...defaultFx(), delayTime: 0.4891, delayFeedback: 0.38, delayTone: 0.44,
      reverbSize: 0.66, reverbDamping: 0.54 },
    automation: [{ target: AUTOMATION_TARGET.bass('303.a', 'cutoff'), interpolation: 'linear',
      points: [{ bar: 0, index: 0, value: 0.24 }, { bar: 17, index: 0, value: 0.4 },
        { bar: 34, index: 15, value: 0.27 }, { bar: 52, index: 0, value: 0.46 },
        { bar: 69, index: 15, value: 0.24 }] }],
  }
}
