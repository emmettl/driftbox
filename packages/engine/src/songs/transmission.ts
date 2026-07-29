import { defaultFx, defaultKit, type Song } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { clonePatterns, pattern } from './notation.js'

// Transmission. The ISDN-era Future Sound of London record, as far as two drum machines
// and two 303s can get to it.
//
// Three things do most of the work, and none of them are sounds:
//
// **Nothing lines up.** The patterns are 14, 12 and 16 steps long, so the sections drift
// against each other and a phrase almost never repeats where you expect it. This is the
// first song here to use a pattern length other than 16, and it is the whole reason the
// sequencer supports it. Four-square is the opposite of this record.
//
// **There is no backbeat.** No snare anywhere and no clap — a rimshot lands where it
// feels like it, and the kick is a low thud rather than a downbeat. Take away the thing
// that tells you where bar one is and everything after it feels unmoored.
//
// **The harmony is wrong on purpose.** Minor seconds (1) and tritones (6) against the
// root, held rather than resolved. The 303 is not playing a bassline; it is playing an
// interval that will not settle.

// The drone. Fourteen steps, so it slides out of phase with everything around it.
const carrier = pattern(
  'carrier',
  'Carrier',
  {
    '808.bd': 'X... .... ..x. ..',
    '808.ma': '..x. ...x .... .x',
  },
  { '303.b': '0a . . . | . . . . | . . . . | . .' },
  14,
)

// Broken percussion and nothing else. The rimshot is doing the job a snare would, and
// deliberately not doing it on two and four.
const staticNoise = pattern(
  'static',
  'Static',
  {
    '808.bd': 'X... .... ..x. ....',
    '808.rs': '..x. .... x... ..x.',
    '808.cb': '.... ..x. .... ....',
    '909.ch': '..x. ..x. ..x. ..x.',
    '808.ma': '.x.x .x.x .x.x .x.x',
  },
  { '303.b': '0a . . . | . . . . | 1s 1 . . | . . . .' },
)

// Twelve steps, and the dissonance arrives. Minor second and tritone, slid into and left
// hanging — the interval is the hook.
const interference = pattern(
  'interference',
  'Interference',
  {
    '808.bd': 'X... .... ..x.',
    '808.rs': '..x. x... ....',
    '808.lt': '.... ..x. ....',
    '909.ch': '..x. ..x. ..x.',
  },
  {
    '303.a': '. . 6s 6 | . . 1a . | . . . .',
    '303.b': '0a . . . | . . . . | . . . .',
  },
  12,
)

// The fullest it gets, which is still mostly space.
const signal = pattern(
  'signal',
  'Signal',
  {
    '808.bd': 'X... .... ..x. .x..',
    '808.rs': '..x. .... x... ..x.',
    '808.cb': '.... ..x. .... x...',
    '808.mt': '.... .... .... ..x.',
    '909.ch': 'x.x. x.x. x.x. x.x.',
    '808.ma': '.x.x .x.x .x.x .x.x',
  },
  {
    '303.a': '. . 6s 6 | . 1 . . | 13s 13 . . | 6a . . .',
    '303.b': '0a . . . | . . . . | 1s 1 . . | . . . .',
  },
)

// Everything cuts but the room. Eight steps, so even the silence is the wrong length.
const dropout = pattern(
  'dropout',
  'Dropout',
  { '808.ma': '..x. ..x.' },
  { '303.b': '0a . . . | . . . .' },
  8,
)

export function transmissionSong(): Song {
  const kit = defaultKit(ALL_VOICES.map((v) => v.id))

  // A thud rather than a kick: tuned right down, soft, with the click almost off.
  kit.params['808.bd'] = { ...kit.params['808.bd'], decay: 0.6, tune: 0.1, colour: 0.08, level: 0.66 }
  // The rimshot is the loudest percussive thing here, and drenched.
  kit.params['808.rs'] = { ...kit.params['808.rs'], decay: 0.55, tone: 0.42, level: 0.54 }
  kit.params['808.cb'] = { ...kit.params['808.cb'], decay: 0.5, tone: 0.28, level: 0.3 }
  kit.params['808.lt'] = { ...kit.params['808.lt'], decay: 0.8, tune: 0.15, level: 0.4 }
  kit.params['808.mt'] = { ...kit.params['808.mt'], decay: 0.7, tune: 0.3, level: 0.34 }
  kit.params['808.ma'] = { ...kit.params['808.ma'], level: 0.2, tone: 0.5, pan: 0.68 }
  kit.params['909.ch'] = { ...kit.params['909.ch'], decay: 0.18, tone: 0.24, level: 0.3, pan: 0.4 }

  if (kit.bass) {
    // The stab: high resonance and a fast decay, so each dissonant note arrives with a
    // squelch and gets out of the way. It is a texture, not a line.
    kit.bass['303.a'] = {
      ...kit.bass['303.a'],
      tune: 0.68,
      wave: 1,
      cutoff: 0.16,
      resonance: 0.86,
      envMod: 0.7,
      decay: 0.3,
      accent: 0.75,
      level: 0.42,
    }
    // The carrier. Filter almost shut, envelope barely moving, longest decay available —
    // a note that never really stops, which is what everything else drifts against.
    kit.bass['303.b'] = {
      ...kit.bass['303.b'],
      tune: 0.08,
      wave: 0,
      cutoff: 0.1,
      resonance: 0.18,
      envMod: 0.08,
      decay: 0.95,
      accent: 0.1,
      level: 0.6,
    }
  }

  // Nearly everything goes to the room. This is the song where the sends are the arrangement.
  kit.sends = {
    '808.bd': { delay: 0, reverb: 0.1 },
    '808.rs': { delay: 0.42, reverb: 0.7 },
    '808.cb': { delay: 0.5, reverb: 0.55 },
    '808.lt': { delay: 0.3, reverb: 0.6 },
    '808.mt': { delay: 0.34, reverb: 0.6 },
    '808.ma': { delay: 0.2, reverb: 0.5 },
    '909.ch': { delay: 0.16, reverb: 0.42 },
    '303.a': { delay: 0.55, reverb: 0.5 },
    '303.b': { delay: 0.04, reverb: 0.14 },
  }

  return {
    bpm: 104,
    // Loose rather than shuffled. Enough that it is not machine-straight, not enough to
    // become a groove — this should not be noddable.
    swing: 0.16,
    patterns: clonePatterns([carrier, staticNoise, interference, signal, dropout]),
    // The section lengths are prime-ish against the pattern lengths as well, so the whole
    // thing takes a long time to come back round to where it started.
    chain: [
      { pattern: 'carrier', repeat: 6 },
      { pattern: 'static', repeat: 6 },
      { pattern: 'interference', repeat: 5 },
      { pattern: 'signal', repeat: 8 },
      { pattern: 'dropout', repeat: 3 },
      { pattern: 'interference', repeat: 5 },
      { pattern: 'signal', repeat: 8 },
      { pattern: 'static', repeat: 4 },
      { pattern: 'dropout', repeat: 2 },
      { pattern: 'carrier', repeat: 6 },
    ],
    kit,
    fx: {
      ...defaultFx(),
      // A long delay with a lot of feedback, rolled right off — repeats that turn to mud
      // and stay there — and the biggest room available.
      delayTime: 1,
      delayFeedback: 0.68,
      delayTone: 0.2,
      reverbSize: 1,
      reverbDamping: 0.68,
    },
  }
}
