import type { Voice, VoiceParams, VoiceSpec } from '../types.js'
import { accentGain, range, ratioRange } from './common.js'

// The 909 kit. The same pure-spec approach as the 808, deliberately different character.
//
// The 909 is a hybrid: its toms, kick and snare are analogue, while its hats, ride and
// crash were 6-bit PCM, clocked at roughly 30kHz. These are rebuilt from a deterministic
// low-rate, 6-bit procedural waveform and a bank of cymbal modes. It keeps the engine
// sample-free while reproducing the limited bandwidth, grain and natural metallic spread
// that the 808's six-square-oscillator circuit cannot give them.
//
// Where the 808 kick is a long round sine that gets out of the way, the 909's is short,
// driven and front-loaded with click — it is a kick designed to be heard on a club
// system through a compressor, and the difference is mostly transient, not tuning.

function bassDrum(params: VoiceParams, accent: number): VoiceSpec {
  const base = range(params.tune, 44, 78)
  const decay = ratioRange(params.decay, 0.09, 0.85)

  return {
    duration: decay + 0.08,
    gain: accentGain(params, accent),
    // A little saturation. The 909's kick is famously thickened by whatever it is
    // played through, and a touch of soft clipping is most of that.
    drive: range(params.colour, 0, 0.55),
    sources: [
      {
        kind: 'osc',
        type: 'sine',
        // Steeper and deeper than the 808's — the sweep is audible as a "thump"
        // rather than as a settling ring.
        frequency: base * range(params.tone, 3.5, 7),
        pitch: [{ to: base, at: 0.024 }],
        gain: 1,
        amp: [
          { to: 1, at: 0.001, curve: 'lin' },
          { to: 0, at: decay },
        ],
      },
      {
        kind: 'noise',
        gain: range(params.tone, 0.15, 0.6),
        amp: [
          { to: 1, at: 0.0003, curve: 'lin' },
          { to: 0, at: 0.008 },
        ],
        filter: { type: 'highpass', frequency: 2400 },
      },
    ],
    pan: range(params.pan, -1, 1),
  }
}

function snare(params: VoiceParams, accent: number): VoiceSpec {
  const tune = ratioRange(params.tune, 0.8, 1.3)
  const snappy = range(params.colour, 0.25, 1)
  const noiseDecay = ratioRange(params.decay, 0.06, 0.45)
  const toneDecay = Math.min(noiseDecay, 0.09)

  const body = (frequency: number, gain: number) =>
    ({
      kind: 'osc' as const,
      type: 'triangle' as const,
      frequency: frequency * tune,
      pitch: [{ to: frequency * tune * 0.86, at: 0.03 }],
      gain,
      amp: [
        { to: 1, at: 0.0008, curve: 'lin' as const },
        { to: 0, at: toneDecay },
      ],
    })

  return {
    duration: Math.max(noiseDecay, toneDecay) + 0.05,
    gain: accentGain(params, accent),
    drive: 0.12,
    sources: [
      body(175, (1 - snappy * 0.45) * 0.75),
      body(330, (1 - snappy * 0.45) * 0.4),
      {
        kind: 'noise',
        gain: snappy * 1.15,
        amp: [
          { to: 1, at: 0.0008, curve: 'lin' },
          { to: 0, at: noiseDecay },
        ],
        // Brighter than the 808's noise band. This is most of the "crack".
        filter: { type: 'highpass', frequency: range(params.tone, 1400, 4200) },
      },
    ],
    pan: range(params.pan, -1, 1),
  }
}

function clap(params: VoiceParams, accent: number): VoiceSpec {
  const decay = ratioRange(params.decay, 0.1, 0.5)
  const spacing = range(params.colour, 0.005, 0.013)

  const burst = (delay: number, gain: number) =>
    ({
      kind: 'noise' as const,
      gain,
      delay,
      amp: [
        { to: 1, at: 0.0005, curve: 'lin' as const },
        { to: 0, at: 0.009 },
      ],
    })

  return {
    duration: decay + spacing * 4 + 0.05,
    gain: accentGain(params, accent) * 0.95,
    drive: 0.18,
    // Tighter and higher than the 808's clap band.
    filter: { type: 'bandpass', frequency: range(params.tone, 900, 2400), Q: 2 },
    sources: [
      burst(0, 0.75),
      burst(spacing, 0.85),
      burst(spacing * 2, 0.95),
      burst(spacing * 3, 1),
      {
        kind: 'noise',
        gain: 0.6,
        delay: spacing * 4,
        amp: [
          { to: 1, at: 0.001, curve: 'lin' },
          { to: 0, at: decay },
        ],
      },
    ],
    pan: range(params.pan, -1, 1),
  }
}

interface DigitalMetal {
  decayRange: [number, number],
  modes: readonly number[]
  bandpass: number
  q: number
  highpass: number
  pcmGain: number
  modeGain: number
  seed: number
}

/**
 * Hats, ride and crash: a generated stand-in for the 909's PCM ROM.
 *
 * The noise layer supplies the dense wash of a real cymbal and is deliberately rendered
 * at the original voice's approximate 30kHz/6-bit resolution. Quiet triangle modes add
 * the bell and plate resonances that noise alone cannot provide. Unlike the 808 bank,
 * their fundamentals sit in the audible cymbal band instead of relying on square-wave
 * harmonics selected by a filter.
 */
function digitalMetal(profile: DigitalMetal) {
  return (params: VoiceParams, accent: number): VoiceSpec => {
    const tune = ratioRange(params.tune, 0.82, 1.22)
    const decay = ratioRange(params.decay, profile.decayRange[0], profile.decayRange[1])
    const bright = ratioRange(params.tone, 0.65, 1.8)
    const definition = range(params.colour, 0.65, 1.25)
    const amp = [
      { to: 1, at: 0.0006, curve: 'lin' as const },
      { to: 0, at: decay },
    ]

    return {
      duration: decay + 0.05,
      gain: accentGain(params, accent) * 0.45,
      sources: [
        {
          kind: 'noise',
          gain: profile.pcmGain,
          amp,
          filter: { type: 'highpass', frequency: profile.highpass },
          sampleRate: 30000,
          bitDepth: 6,
          seed: profile.seed,
          playbackRate: tune,
        },
        ...profile.modes.map((frequency, index) => ({
          kind: 'osc' as const,
          type: 'triangle' as const,
          frequency: frequency * tune,
          gain: profile.modeGain * definition * (1 - index * 0.07),
          amp: [
            { to: 1, at: 0.0006, curve: 'lin' as const },
            { to: 0, at: decay * (0.55 + index * 0.07) },
          ],
        })),
      ],
      filter: { type: 'bandpass', frequency: profile.bandpass * bright, Q: profile.q },
      pan: range(params.pan, -1, 1),
    }
  }
}

function tom(baseLow: number, baseHigh: number) {
  return (params: VoiceParams, accent: number): VoiceSpec => {
    const base = range(params.tune, baseLow, baseHigh)
    const decay = ratioRange(params.decay, 0.12, 0.8)

    return {
      duration: decay + 0.05,
      gain: accentGain(params, accent),
      sources: [
        {
          kind: 'osc',
          type: 'sine',
          frequency: base * 2.4,
          pitch: [{ to: base, at: 0.09 }],
          gain: 1,
          amp: [
            { to: 1, at: 0.002, curve: 'lin' },
            { to: 0, at: decay },
          ],
        },
        {
          kind: 'noise',
          gain: range(params.colour, 0.02, 0.35),
          amp: [
            { to: 1, at: 0.001, curve: 'lin' },
            { to: 0, at: 0.05 },
          ],
          filter: { type: 'highpass', frequency: 900 },
        },
      ],
      pan: range(params.pan, -1, 1),
    }
  }
}

function rim(params: VoiceParams, accent: number): VoiceSpec {
  const decay = ratioRange(params.decay, 0.015, 0.07)
  return {
    duration: decay + 0.03,
    gain: accentGain(params, accent) * 0.75,
    sources: [
      {
        kind: 'osc',
        type: 'square',
        frequency: range(params.tune, 1600, 2600),
        pitch: [{ to: range(params.tune, 400, 700), at: 0.008 }],
        gain: 0.8,
        amp: [
          { to: 1, at: 0.0004, curve: 'lin' },
          { to: 0, at: decay },
        ],
      },
      {
        kind: 'noise',
        gain: 0.5,
        amp: [
          { to: 1, at: 0.0004, curve: 'lin' },
          { to: 0, at: decay * 0.7 },
        ],
      },
    ],
    filter: { type: 'bandpass', frequency: range(params.tone, 1600, 3800), Q: 1.6 },
    pan: range(params.pan, -1, 1),
  }
}

export const TR909_VOICES: Voice[] = [
  { id: '909.bd', trim: 0.61, name: 'Bass Drum', machine: 'tr909', build: bassDrum },
  { id: '909.sd', trim: 0.52, name: 'Snare', machine: 'tr909', build: snare },
  { id: '909.cp', trim: 1.06, name: 'Clap', machine: 'tr909', build: clap },
  { id: '909.lt', trim: 0.81, name: 'Low Tom', machine: 'tr909', build: tom(65, 122), pitched: { low: 65, high: 122 } },
  { id: '909.mt', trim: 0.8, name: 'Mid Tom', machine: 'tr909', build: tom(100, 192), pitched: { low: 100, high: 192 } },
  { id: '909.ht', trim: 0.8, name: 'Hi Tom', machine: 'tr909', build: tom(150, 288), pitched: { low: 150, high: 288 } },
  { id: '909.rim', trim: 1.71, name: 'Rim', machine: 'tr909', build: rim },
  {
    id: '909.ch', trim: 3.23,
    name: 'Closed Hat',
    machine: 'tr909',
    choke: '909.hats',
    build: digitalMetal({
      decayRange: [0.018, 0.08],
      modes: [5100, 6230, 7410, 8740, 10480, 11800],
      bandpass: 10800,
      q: 0.75,
      highpass: 6200,
      pcmGain: 0.9,
      modeGain: 0.075,
      seed: 0x909,
    }),
  },
  {
    id: '909.oh', trim: 2.6,
    name: 'Open Hat',
    machine: 'tr909',
    choke: '909.hats',
    build: digitalMetal({
      decayRange: [0.14, 0.8],
      modes: [5100, 6230, 7410, 8740, 10480, 11800],
      bandpass: 9800,
      q: 0.65,
      highpass: 5200,
      pcmGain: 0.9,
      modeGain: 0.075,
      seed: 0x909,
    }),
  },
  {
    id: '909.rd',
    trim: 2.34,
    name: 'Ride',
    machine: 'tr909',
    build: digitalMetal({
      decayRange: [0.4, 1.6],
      modes: [1820, 2730, 3840, 5160, 6840, 8920],
      bandpass: 6200,
      q: 0.55,
      highpass: 1800,
      pcmGain: 0.62,
      modeGain: 0.15,
      seed: 0x90a,
    }),
  },
  {
    id: '909.cr',
    trim: 2.06,
    name: 'Crash',
    machine: 'tr909',
    build: digitalMetal({
      decayRange: [0.7, 2.6],
      modes: [1460, 2210, 3190, 4550, 6270, 8580],
      bandpass: 5200,
      q: 0.45,
      highpass: 1200,
      pcmGain: 0.78,
      modeGain: 0.11,
      seed: 0x90b,
    }),
  },
]
