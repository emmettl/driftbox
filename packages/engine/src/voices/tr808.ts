import type { Voice, VoiceParams, VoiceSpec } from '../types.js'
import { accentGain, metallicSources, range, ratioRange } from './common.js'

// The 808 kit, synthesised from the circuit topologies rather than sampled.
//
// The 808 is an analogue machine and every voice on it is a small circuit doing one
// trick. The bass drum is a bridged-T oscillator ringing at around 50Hz. The snare is
// two tuned oscillators plus a noise generator, mixed by the "snappy" control. The
// hats and cymbals are all six square oscillators at inharmonic ratios, differing only
// in how they are filtered and how long they are allowed to ring. Reproducing the
// topology gets you far closer than trying to EQ a noise burst into submission, and
// every knob then does something real.

function bassDrum(params: VoiceParams, accent: number): VoiceSpec {
  const base = range(params.tune, 42, 72)
  const decay = ratioRange(params.decay, 0.12, 1.6)
  // The 808 kick's pitch drop is fast and fairly subtle — it is a ringing circuit
  // settling, not the long swoop people often reach for.
  const attack = base * range(params.tone, 2.2, 4.4)

  return {
    duration: decay + 0.1,
    gain: accentGain(params, accent),
    sources: [
      {
        kind: 'osc',
        type: 'sine',
        frequency: attack,
        pitch: [{ to: base, at: 0.042 }],
        gain: 1,
        amp: [
          { to: 1, at: 0.002, curve: 'lin' },
          { to: 0, at: decay },
        ],
      },
      // The click. On the real machine this is the trigger pulse bleeding through, and
      // it is most of what lets a kick cut through a mix on small speakers.
      {
        kind: 'noise',
        gain: range(params.colour, 0, 0.5),
        amp: [
          { to: 1, at: 0.0004, curve: 'lin' },
          { to: 0, at: 0.014 },
        ],
        filter: { type: 'highpass', frequency: 1200 },
      },
    ],
    pan: range(params.pan, -1, 1),
  }
}

function snare(params: VoiceParams, accent: number): VoiceSpec {
  const tune = ratioRange(params.tune, 0.75, 1.35)
  const snappy = range(params.colour, 0.05, 1)
  const noiseDecay = ratioRange(params.decay, 0.05, 0.4)
  const toneDecay = Math.min(noiseDecay, 0.12)

  const body = (frequency: number, gain: number) =>
    ({
      kind: 'osc' as const,
      type: 'triangle' as const,
      frequency: frequency * tune,
      gain,
      amp: [
        { to: 1, at: 0.001, curve: 'lin' as const },
        { to: 0, at: toneDecay },
      ],
    })

  return {
    duration: Math.max(noiseDecay, toneDecay) + 0.05,
    gain: accentGain(params, accent),
    sources: [
      // Two tuned shells, a fifth-ish apart. This pair is the whole "body" of an 808
      // snare; the noise on top is the wires.
      body(185, (1 - snappy * 0.5) * 0.9),
      body(330, (1 - snappy * 0.5) * 0.5),
      {
        kind: 'noise',
        gain: snappy,
        amp: [
          { to: 1, at: 0.001, curve: 'lin' },
          { to: 0, at: noiseDecay },
        ],
        filter: { type: 'highpass', frequency: range(params.tone, 700, 2600) },
      },
    ],
    pan: range(params.pan, -1, 1),
  }
}

function clap(params: VoiceParams, accent: number): VoiceSpec {
  const decay = ratioRange(params.decay, 0.12, 0.6)
  const centre = range(params.tone, 700, 1800)
  // Three fast retriggers and then a longer tail. That stutter is the entire reason a
  // clap sounds like several hands and not one burst of noise.
  const spacing = range(params.colour, 0.006, 0.016)

  const burst = (delay: number, gain: number) =>
    ({
      kind: 'noise' as const,
      gain,
      delay,
      amp: [
        { to: 1, at: 0.0006, curve: 'lin' as const },
        { to: 0, at: 0.012 },
      ],
    })

  return {
    duration: decay + spacing * 3 + 0.05,
    gain: accentGain(params, accent) * 0.9,
    filter: { type: 'bandpass', frequency: centre, Q: 1.6 },
    sources: [
      burst(0, 0.8),
      burst(spacing, 0.9),
      burst(spacing * 2, 1),
      {
        kind: 'noise',
        gain: 0.7,
        delay: spacing * 3,
        amp: [
          { to: 1, at: 0.001, curve: 'lin' },
          { to: 0, at: decay },
        ],
      },
    ],
    pan: range(params.pan, -1, 1),
  }
}

/** Hats and cymbals differ only in filtering and ring time, so they share a builder. */
function metallic(decayRange: [number, number], bandpass: number, q: number) {
  return (params: VoiceParams, accent: number): VoiceSpec => {
    const base = 40 * ratioRange(params.tune, 0.7, 1.5)
    const decay = ratioRange(params.decay, decayRange[0], decayRange[1])
    const bright = ratioRange(params.tone, 0.6, 1.7)

    return {
      duration: decay + 0.05,
      gain: accentGain(params, accent) * 0.5,
      sources: metallicSources(base, 0.35, [
        { to: 1, at: 0.0008, curve: 'lin' },
        { to: 0, at: decay },
      ]),
      filter: { type: 'bandpass', frequency: bandpass * bright, Q: q },
      pan: range(params.pan, -1, 1),
    }
  }
}

function tom(baseLow: number, baseHigh: number) {
  return (params: VoiceParams, accent: number): VoiceSpec => {
    const base = range(params.tune, baseLow, baseHigh)
    const decay = ratioRange(params.decay, 0.1, 0.7)

    return {
      duration: decay + 0.05,
      gain: accentGain(params, accent),
      sources: [
        {
          kind: 'osc',
          type: 'sine',
          frequency: base * 1.9,
          pitch: [{ to: base, at: 0.06 }],
          gain: 1,
          amp: [
            { to: 1, at: 0.002, curve: 'lin' },
            { to: 0, at: decay },
          ],
        },
        {
          kind: 'noise',
          gain: range(params.colour, 0, 0.22),
          amp: [
            { to: 1, at: 0.001, curve: 'lin' },
            { to: 0, at: 0.03 },
          ],
          filter: { type: 'highpass', frequency: 600 },
        },
      ],
      pan: range(params.pan, -1, 1),
    }
  }
}

function cowbell(params: VoiceParams, accent: number): VoiceSpec {
  const tune = ratioRange(params.tune, 0.8, 1.25)
  const decay = ratioRange(params.decay, 0.1, 0.6)
  const amp = [
    { to: 1, at: 0.001, curve: 'lin' as const },
    { to: 0, at: decay },
  ]

  // Two squares a slightly-off interval apart, band-limited hard. Famous for it.
  return {
    duration: decay + 0.05,
    gain: accentGain(params, accent) * 0.7,
    sources: [
      { kind: 'osc', type: 'square', frequency: 540 * tune, gain: 0.6, amp },
      { kind: 'osc', type: 'square', frequency: 800 * tune, gain: 0.6, amp },
    ],
    filter: { type: 'bandpass', frequency: range(params.tone, 1800, 3600), Q: 2.4 },
    pan: range(params.pan, -1, 1),
  }
}

function rimshot(params: VoiceParams, accent: number): VoiceSpec {
  const decay = ratioRange(params.decay, 0.02, 0.09)
  return {
    duration: decay + 0.03,
    gain: accentGain(params, accent) * 0.8,
    sources: [
      {
        kind: 'osc',
        type: 'triangle',
        frequency: range(params.tune, 1400, 2200),
        pitch: [{ to: range(params.tune, 320, 520), at: 0.012 }],
        gain: 1,
        amp: [
          { to: 1, at: 0.0005, curve: 'lin' },
          { to: 0, at: decay },
        ],
      },
    ],
    filter: { type: 'bandpass', frequency: range(params.tone, 1200, 2800), Q: 1.4 },
    pan: range(params.pan, -1, 1),
  }
}

function maracas(params: VoiceParams, accent: number): VoiceSpec {
  const decay = ratioRange(params.decay, 0.015, 0.14)
  return {
    duration: decay + 0.03,
    gain: accentGain(params, accent) * 0.6,
    sources: [
      {
        kind: 'noise',
        gain: 1,
        amp: [
          { to: 1, at: 0.0008, curve: 'lin' },
          { to: 0, at: decay },
        ],
      },
    ],
    filter: { type: 'highpass', frequency: range(params.tone, 4000, 9000) },
    pan: range(params.pan, -1, 1),
  }
}

export const TR808_VOICES: Voice[] = [
  { id: '808.bd', trim: 0.8, name: 'Bass Drum', machine: 'tr808', build: bassDrum },
  { id: '808.sd', trim: 0.66, name: 'Snare', machine: 'tr808', build: snare },
  { id: '808.cp', trim: 3.35, name: 'Clap', machine: 'tr808', build: clap },
  { id: '808.lt', trim: 0.87, name: 'Low Tom', machine: 'tr808', build: tom(55, 105), pitched: { low: 55, high: 105 } },
  { id: '808.mt', trim: 0.86, name: 'Mid Tom', machine: 'tr808', build: tom(90, 170), pitched: { low: 90, high: 170 } },
  { id: '808.ht', trim: 0.86, name: 'Hi Tom', machine: 'tr808', build: tom(140, 265), pitched: { low: 140, high: 265 } },
  { id: '808.rs', trim: 1.79, name: 'Rimshot', machine: 'tr808', build: rimshot },
  { id: '808.cb', trim: 2.16, name: 'Cowbell', machine: 'tr808', build: cowbell },
  {
    id: '808.ch', trim: 8.59,
    name: 'Closed Hat',
    machine: 'tr808',
    // Closed and open hats share one circuit on the real machine, so a closed hat
    // silences a ringing open one. Without this a 16th-note hat pattern turns into a
    // wash of overlapping open hats.
    choke: '808.hats',
    build: metallic([0.02, 0.09], 9400, 1.4),
  },
  {
    id: '808.oh', trim: 4.28,
    name: 'Open Hat',
    machine: 'tr808',
    choke: '808.hats',
    build: metallic([0.15, 0.9], 8600, 1.2),
  },
  { id: '808.ma', trim: 1.14, name: 'Maracas', machine: 'tr808', build: maracas },
]
