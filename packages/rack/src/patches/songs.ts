import { songPresetById, type Song } from '@driftbox/engine'
import { embedGrooveboxSong } from '../groovebox.js'
import { GROOVEBOX_PORTS } from '../modules/groovebox.js'
import type { ModRoute, Patch, PatchCable, PatchModule } from '../types.js'
import type { PatchPreset } from './index.js'

// The groovebox songs, rebuilt as rack documents.
//
// `PATCHES` next door is a bank of *systems*: each one proves a wiring and most of them are one bar long.
// This file is the other half of the argument. A rack-extended document can retain a complete authored
// Song and still be a patch, so these open on a finished record — the same 808, 909 and two 303s, playing
// the same arrangement — with the four machines arriving in the rack as separate stereo stems instead of
// as one finished mix. Nothing here re-sequences the song. What the rack adds is the studio around it:
//
//   - a **desk**. Six stereo channels with their own balance, two aux sends and two returns, so the
//     machines are mixed against each other rather than inside the groovebox's own master.
//   - a **room**. The Reverb's four algorithms, its wet-path low and high cut and its gate, on a real send
//     at a depth chosen per machine — which is a different device from the groovebox's one shared send.
//   - an **echo**. A Ping Pong at a musical fraction of the song's own tempo, on the second send.
//   - **more instruments**. Every one of these adds at least one voice the groovebox does not have: a
//     wavetable pad, a rack drone, hats made out of noise, a sub ducked by the 909, a re-filtered 303.
//   - **macros**. One Combinator whose four rotaries and four buttons mean the same thing in all six, so
//     somebody who learns one has learnt the set.
//
// **They share a spine, and that is the opposite of the rule next door.** `PATCHES` deliberately shares
// almost nothing, because a library of variations on one signal path would misrepresent what a modular is.
// These are records rather than demonstrations, and a record wants a console that behaves the same way
// every time you sit at it — so the desk, the two sends and the macro layout are one function, and what
// varies is the mix, the room, the tempo-locked echo, and the instrument the rack brings to each song.

/** The exact value a 0..127 Combinator rotary lands on, so a factory opens already settled. */
const routed = (min: number, max: number, rotary: number): number =>
  min + (max - min) * (rotary / 127)

/** Seconds, written as a fraction of a beat at this song's tempo. Rounded, so the source stays readable. */
const beats = (bpm: number, fraction: number): number =>
  Math.round(((60 / bpm) * fraction) * 10_000) / 10_000

/**
 * The root a 303 is standing on, in Hz.
 *
 * `bass.ts` runs its Tune knob through a ratio range from an octave below A1 to an octave above it, so
 * 0.5 is 55Hz and the ends are 27.5 and 110. Repeated here rather than imported because it is one line of
 * arithmetic and the alternative is exporting a synthesis internal for the sake of six presets.
 */
const bassRootHz = (tune = 0.5): number => 27.5 * Math.pow(4, Math.max(0, Math.min(1, tune)))

/**
 * A Tune knob, in semitones, that stands a rack oscillator on one of the song's own 303s.
 *
 * This is the whole reason a rack layer can be written into somebody else's song without guessing. A VCO
 * or a Wavetable reads 0V as C2 and one CV unit as an octave, so tuning it to `12·log2(root/C2)` makes its
 * frequency `root · 2^(cv)` — which is *exactly* the formula `bass.ts` uses for a 303 note. A Tracker lane
 * in semitone mode divides by twelve, so **a lane value is a 303 note number**: writing 12 into a lane is
 * the song's root an octave up, and 15 is the minor third above that, in every one of these songs and
 * whatever each has done to its Tune knob.
 *
 * Read from the song rather than written down, so retuning a 303 in the groovebox moves the rack layer
 * with it instead of silently detuning against it.
 */
const rootOf = (song: Song, voice: '303.a' | '303.b', octaves = 0): number => {
  const semitones = 12 * Math.log2(bassRootHz(song.kit.bass?.[voice]?.tune) / 65.406_391_325_149_66)
  const tuned = Math.round((semitones + octaves * 12) * 100) / 100
  return Math.max(-24, Math.min(24, tuned))
}

/** One channel of the desk. */
interface Strip {
  /** What arrives here. A machine stem, or the end of whatever the rack put in front of it. */
  from: [string, string]
  /** The fader. Channel 5 is the rack's own voice and takes its fader from Rotary 3 instead. */
  level?: number
  pan?: number
  /** Into the room. */
  room?: number
  /** Into the echo. */
  echo?: number
}

interface Room {
  /** 0 Room, 1 Hall, 2 Plate, 3 Spring. */
  algorithm: number
  size: number
  /** Decay at each end of Rotary 1. */
  decay: readonly [number, number]
  damp: number
  /** The wet path's own band limits — what stops a long tail from filling the bottom of the mix. */
  lowCut: number
  highCut: number
  /** What Button 2 switches on. */
  gate: { thresh: number; hold: number; release: number }
}

interface Desk {
  /** Channels 1..6 in order: 808, 909, 303 A, 303 B, then whatever the rack brought. */
  strips: readonly Strip[]
  master: number
  out: number
  room: Room
  /** Ping Pong time in seconds, and its feedback at each end of Rotary 2. */
  echo: { time: number; feedback: readonly [number, number] }
  eq: {
    low: number
    lowFreq: number
    mid: number
    midFreq: number
    q: number
    /** High shelf at each end of Rotary 4. */
    high: readonly [number, number]
    highFreq: number
  }
  width: {
    /** Below the crossover, and what Button 4 collapses to mono. */
    low: number
    /** Above it, at each end of Rotary 4. */
    high: readonly [number, number]
    crossover: number
  }
  /** Channel 5's fader at each end of Rotary 3. */
  layer: readonly [number, number]
  /** Rotary 3's second job: the one knob that is this song's own. */
  opens?: { to: [string, string]; range: readonly [number, number] }
  /** Where the four rotaries sit as the document opens, 0..127. */
  rotaries: readonly [number, number, number, number]
}

const STEMS = ['tr808', 'tr909', '303.a', '303.b'] as const

/** Where a machine leaves the retained song, for a strip that takes it straight. */
const stem = (index: 0 | 1 | 2 | 3): [string, string] => [
  'groovebox',
  GROOVEBOX_PORTS[STEMS[index]].output,
]

/**
 * The desk every one of these songs is mixed on.
 *
 * Ten modules and twelve routings identical in all six, plus the one routing each song points at a knob of
 * its own.
 *
 * The two meters are on the aux sends rather than across the master, and that is deliberate rather than
 * decorative: a Meter is mono, so one in the main path would fold the record to its left channel, while
 * both the Reverb and the Ping Pong take a mono input anyway — the fold was already happening there, and
 * putting the needle in front of it means the send level is something you can see instead of infer.
 */
function desk(spec: Desk): Required<Pick<Patch, 'modules' | 'cables' | 'modulation'>> {
  const [r1, r2, r3, r4] = spec.rotaries

  const faders: Record<string, number> = {}
  spec.strips.forEach((strip, index) => {
    const channel = index + 1
    faders[`level${channel}`] =
      channel === 5 ? routed(spec.layer[0], spec.layer[1], r3) : (strip.level ?? 0.7)
    if (strip.pan !== undefined) faders[`pan${channel}`] = strip.pan
    if (strip.room !== undefined) faders[`sendA${channel}`] = strip.room
    if (strip.echo !== undefined) faders[`sendB${channel}`] = strip.echo
  })

  const modules: PatchModule[] = [
    { id: 'groovebox', type: 'groovebox' },
    {
      id: 'desk-1',
      type: 'line-mixer',
      params: {
        ...faders,
        master: spec.master,
        returnLevelA: routed(0, 1.35, r1),
        returnLevelB: routed(0, 1.35, r2),
      },
    },
    // VU for the room, LED for the echo: one is a level you balance and the other is a level you watch for
    // the moment it starts feeding back.
    { id: 'send-room', type: 'meter', params: { mode: 0, gain: 1.8, release: 0.42 } },
    {
      id: 'room-1',
      type: 'reverb',
      params: {
        size: spec.room.size,
        decay: routed(spec.room.decay[0], spec.room.decay[1], r1),
        damp: spec.room.damp,
        // Fully wet, because this is a send and the dry signal is already on the desk. A Reverb left at
        // its 0.25 default here would put a second, quieter copy of everything through the return.
        mix: 1,
        algorithm: spec.room.algorithm,
        lowCut: spec.room.lowCut,
        highCut: spec.room.highCut,
        gate: 0,
        gateThresh: spec.room.gate.thresh,
        gateHold: spec.room.gate.hold,
        gateRelease: spec.room.gate.release,
      },
    },
    { id: 'send-echo', type: 'meter', params: { mode: 1, gain: 1.8, release: 0.24 } },
    {
      id: 'echo-1',
      type: 'ping-pong',
      params: {
        time: spec.echo.time,
        feedback: routed(spec.echo.feedback[0], spec.echo.feedback[1], r2),
      },
    },
    {
      id: 'master-eq',
      type: 'eq',
      params: {
        low: spec.eq.low,
        lowFreq: spec.eq.lowFreq,
        mid: spec.eq.mid,
        midFreq: spec.eq.midFreq,
        q: spec.eq.q,
        high: routed(spec.eq.high[0], spec.eq.high[1], r4),
        highFreq: spec.eq.highFreq,
      },
    },
    {
      id: 'master-width',
      type: 'imager',
      params: {
        lowWidth: spec.width.low,
        highWidth: routed(spec.width.high[0], spec.width.high[1], r4),
        crossover: spec.width.crossover,
      },
    },
    { id: 'out-1', type: 'out', params: { level: spec.out } },
    {
      id: 'combi-1',
      type: 'combi',
      params: { rotary1: r1, rotary2: r2, rotary3: r3, rotary4: r4 },
    },
  ]

  const cables: PatchCable[] = [
    ...spec.strips.map(
      (strip, index): PatchCable => ({ from: strip.from, to: ['desk-1', `in${index + 1}`] }),
    ),
    { from: ['desk-1', 'sendA'], to: ['send-room', 'in'] },
    { from: ['send-room', 'thru'], to: ['room-1', 'in'] },
    { from: ['room-1', 'out'], to: ['desk-1', 'returnA'] },
    { from: ['desk-1', 'sendB'], to: ['send-echo', 'in'] },
    { from: ['send-echo', 'thru'], to: ['echo-1', 'in'] },
    { from: ['echo-1', 'out'], to: ['desk-1', 'returnB'] },
    { from: ['desk-1', 'out'], to: ['master-eq', 'in'] },
    { from: ['master-eq', 'out'], to: ['master-width', 'in'] },
    { from: ['master-width', 'out'], to: ['out-1', 'in'] },
  ]

  // Rotary 1 room, Rotary 2 echo, Rotary 3 the rack's own voice, Rotary 4 air. Four buttons: drop the
  // rack's addition, gate the room, cut to the two drum machines, and collapse the bottom to mono.
  const modulation: ModRoute[] = [
    { from: ['combi-1', 'rotary1'], to: ['desk-1', 'returnLevelA'], min: 0, max: 1.35 },
    {
      from: ['combi-1', 'rotary1'],
      to: ['room-1', 'decay'],
      min: spec.room.decay[0],
      max: spec.room.decay[1],
    },
    { from: ['combi-1', 'rotary2'], to: ['desk-1', 'returnLevelB'], min: 0, max: 1.35 },
    {
      from: ['combi-1', 'rotary2'],
      to: ['echo-1', 'feedback'],
      min: spec.echo.feedback[0],
      max: spec.echo.feedback[1],
    },
    { from: ['combi-1', 'rotary3'], to: ['desk-1', 'level5'], min: spec.layer[0], max: spec.layer[1] },
    ...(spec.opens
      ? [
          {
            from: ['combi-1', 'rotary3'] as [string, string],
            to: spec.opens.to,
            min: spec.opens.range[0],
            max: spec.opens.range[1],
          },
        ]
      : []),
    { from: ['combi-1', 'rotary4'], to: ['master-eq', 'high'], min: spec.eq.high[0], max: spec.eq.high[1] },
    {
      from: ['combi-1', 'rotary4'],
      to: ['master-width', 'highWidth'],
      min: spec.width.high[0],
      max: spec.width.high[1],
    },
    { from: ['combi-1', 'button1'], to: ['desk-1', 'mute5'], min: 0, max: 1 },
    { from: ['combi-1', 'button2'], to: ['room-1', 'gate'], min: 0, max: 1 },
    { from: ['combi-1', 'button3'], to: ['desk-1', 'solo1'], min: 0, max: 1 },
    { from: ['combi-1', 'button3'], to: ['desk-1', 'solo2'], min: 0, max: 1 },
    // Inverted on purpose: the button closes the low band rather than opening it, which is what a mono
    // switch on a desk does.
    { from: ['combi-1', 'button4'], to: ['master-width', 'lowWidth'], min: spec.width.low, max: 0 },
  ]

  return { modules, cables, modulation }
}

/** The song this preset is the rack version of, built fresh and carrying its authored visual. */
const songOf = (id: string): Song => {
  const preset = songPresetById(id)
  if (!preset) throw new Error(`No groovebox song called ${id}`)
  return preset.build()
}

/** Assemble one of these: the song retained whole, the console around it, and the rack's own additions. */
const assemble = (
  song: Song,
  spine: Required<Pick<Patch, 'modules' | 'cables' | 'modulation'>>,
  extra: Partial<Pick<Patch, 'modules' | 'cables' | 'modulation'>> = {},
): Patch =>
  embedGrooveboxSong(song, {
    modules: [...spine.modules, ...(extra.modules ?? [])],
    cables: [...spine.cables, ...(extra.cables ?? [])],
    modulation: [...spine.modulation, ...(extra.modulation ?? [])],
  })

/**
 * Sundown, with a room around it and a pad underneath.
 *
 * The slowest thing here and the one with the most space in it already, so the rack's job is air rather
 * than weight: a Hall long enough to still be sounding when the next kick arrives, a dotted-eighth echo on
 * the clap and the lead 303, and a Wavetable pad holding the root for a bar and the fifth for the next
 * while an LFO walks it slowly across the table. The pad is the song's own root, read off its 303.
 */
const sundown = (): Patch => {
  const song = songOf('chillwave')
  const root = rootOf(song, '303.a')
  const rotaries = [86, 48, 74, 62] as const

  return assemble(
    song,
    desk({
      strips: [
        { from: stem(0), level: 0.74, pan: -0.05, room: 0.26, echo: 0.14 },
        { from: stem(1), level: 0.6, pan: 0.05, room: 0.2, echo: 0.1 },
        { from: stem(2), level: 0.68, pan: 0.12, room: 0.24, echo: 0.36 },
        { from: stem(3), level: 0.76, pan: 0, room: 0.04, echo: 0 },
        { from: ['vca-1', 'out'], pan: -0.18, room: 0.42, echo: 0.12 },
      ],
      master: 0.92,
      out: 0.62,
      room: {
        algorithm: 1,
        size: 0.88,
        decay: [0.62, 0.93],
        damp: 0.52,
        lowCut: 240,
        highCut: 7600,
        gate: { thresh: 0.06, hold: 0.4, release: 0.08 },
      },
      echo: { time: beats(song.bpm, 0.75), feedback: [0.24, 0.62] },
      eq: { low: 1.4, lowFreq: 88, mid: -2, midFreq: 430, q: 1.1, high: [0, 5], highFreq: 8200 },
      width: { low: 0.85, high: [1, 1.6], crossover: 190 },
      layer: [0, 0.52],
      opens: { to: ['svf-1', 'cutoff'], range: [520, 2600] },
      rotaries,
    }),
    {
      modules: [
        { id: 'transport-1', type: 'transport' },
        {
          id: 'tracker-1',
          type: 'tracker',
          // Two bars, one held note each: sixteen identical steps hold the gate rather than restriking it,
          // which is what lets an attack of nearly a second belong to a sequencer at all.
          params: { length: 32 },
          data: {
            lane1: [
              12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
              19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19,
            ],
          },
        },
        { id: 'pad-1', type: 'wavetable', params: { tune: root, position: 0.3 } },
        { id: 'lfo-1', type: 'lfo', params: { rate: 0.06, shape: 0 } },
        // The LFO runs 0..1 on its Uni jack, which would sweep the table end to end. A quarter of that is
        // a pad breathing; all of it is a sound effect.
        { id: 'sweep-1', type: 'offset', params: { gain: 0.26, offset: 0 } },
        { id: 'svf-1', type: 'svf', params: { cutoff: routed(520, 2600, 74), resonance: 0.22 } },
        { id: 'adsr-1', type: 'adsr', params: { attack: 0.9, decay: 1.4, sustain: 0.74, release: 2.6 } },
        { id: 'vca-1', type: 'vca', params: { gain: 0 } },
      ],
      cables: [
        { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
        { from: ['tracker-1', 'cv1'], to: ['pad-1', 'pitch'] },
        { from: ['tracker-1', 'gate1'], to: ['adsr-1', 'gate'] },
        { from: ['lfo-1', 'uni'], to: ['sweep-1', 'in'] },
        { from: ['sweep-1', 'out'], to: ['pad-1', 'pos'] },
        { from: ['pad-1', 'out'], to: ['svf-1', 'in'] },
        { from: ['svf-1', 'lp'], to: ['vca-1', 'in'] },
        { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
      ],
    },
  )
}

/**
 * Acieed, with the 303 sent through the rack's own filter.
 *
 * The one where the addition is not a new part. The 303 A stem leaves the groovebox already filtered and
 * goes straight into a Drive and a Ladder — the same four-pole design its own filter is modelled on — so
 * Rotary 3 opens a second resonant sweep on top of the one the song is playing. That is a thing the
 * groovebox cannot do to itself, and it is far more of this genre than another melody would be.
 *
 * The rack's own voice is deliberately small beside it: sixteenth hats made out of noise, which need no
 * tuning and no sample and fill the gap the 808's own hats leave.
 */
const acieed = (): Patch => {
  const song = songOf('acid')
  const rotaries = [58, 66, 70, 68] as const

  return assemble(
    song,
    desk({
      strips: [
        { from: stem(0), level: 0.7, pan: -0.08, room: 0.12, echo: 0.08 },
        { from: stem(1), level: 0.74, pan: 0.04, room: 0.1, echo: 0.06 },
        { from: ['ladder-1', 'out'], level: 0.6, pan: 0.1, room: 0.22, echo: 0.4 },
        { from: stem(3), level: 0.72, pan: 0, room: 0.03, echo: 0 },
        { from: ['vca-1', 'out'], pan: 0.3, room: 0.3, echo: 0.22 },
      ],
      master: 0.9,
      out: 0.6,
      room: {
        algorithm: 3,
        size: 0.34,
        decay: [0.3, 0.68],
        damp: 0.44,
        lowCut: 420,
        highCut: 9200,
        gate: { thresh: 0.08, hold: 0.12, release: 0.03 },
      },
      echo: { time: beats(song.bpm, 0.75), feedback: [0.2, 0.64] },
      eq: { low: 2, lowFreq: 72, mid: -1.5, midFreq: 380, q: 0.9, high: [0, 4.5], highFreq: 9000 },
      width: { low: 0.8, high: [1, 1.5], crossover: 220 },
      layer: [0.18, 0.46],
      opens: { to: ['ladder-1', 'cutoff'], range: [420, 3400] },
      rotaries,
    }),
    {
      modules: [
        { id: 'drive-1', type: 'drive', params: { drive: 3.4, bias: 0.03 } },
        {
          id: 'ladder-1',
          type: 'ladder',
          params: { cutoff: routed(420, 3400, 70), resonance: 0.58 },
        },
        { id: 'transport-1', type: 'transport' },
        {
          id: 'tracker-1',
          type: 'tracker',
          // Any non-zero value opens the gate; these are hats, so the numbers themselves are unused.
          params: { length: 16 },
          data: { lane1: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1] },
        },
        { id: 'noise-1', type: 'noise' },
        { id: 'svf-1', type: 'svf', params: { cutoff: 6400, resonance: 0.3 } },
        { id: 'adsr-1', type: 'adsr', params: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 } },
        { id: 'vca-1', type: 'vca', params: { gain: 0, curve: 1 } },
      ],
      cables: [
        { from: ['groovebox', GROOVEBOX_PORTS['303.a'].output], to: ['drive-1', 'in'] },
        { from: ['drive-1', 'out'], to: ['ladder-1', 'in'] },
        { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
        { from: ['tracker-1', 'trig1'], to: ['adsr-1', 'trig'] },
        { from: ['noise-1', 'white'], to: ['svf-1', 'in'] },
        { from: ['svf-1', 'hp'], to: ['vca-1', 'in'] },
        { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
      ],
    },
  )
}

/**
 * Undertow, with a gated plate and a drone under everything.
 *
 * The song with no snare and mostly room, so this is the one that takes the Reverb's new controls
 * seriously: a Plate at nearly full size, low cut well up so the tail cannot fill in the bottom the 808
 * kick is holding, and the gate wired to Button 2 — pressing it turns a bar of room into a bar of the
 * room slamming shut, which is a genre in itself.
 *
 * The rack's voice has no sequencer in it at all. Two saws a seventh of a semitone apart, an octave below
 * the song's own 303, through a state-variable filter that one very slow LFO opens and closes. Nothing
 * clocks it, and that is why it sits under an 82bpm song without arguing with it.
 */
const undertow = (): Patch => {
  const song = songOf('darkwave')
  const root = rootOf(song, '303.a', -1)
  const rotaries = [92, 40, 66, 44] as const

  return assemble(
    song,
    desk({
      strips: [
        { from: stem(0), level: 0.78, pan: -0.04, room: 0.34, echo: 0.12 },
        { from: stem(1), level: 0.62, pan: 0.06, room: 0.3, echo: 0.1 },
        { from: stem(2), level: 0.6, pan: 0.16, room: 0.48, echo: 0.34 },
        { from: stem(3), level: 0.78, pan: 0, room: 0.06, echo: 0 },
        { from: ['vca-1', 'out'], pan: 0, room: 0.18, echo: 0 },
      ],
      master: 0.88,
      out: 0.6,
      room: {
        algorithm: 2,
        size: 0.95,
        decay: [0.66, 0.96],
        damp: 0.3,
        lowCut: 320,
        highCut: 5200,
        gate: { thresh: 0.05, hold: 0.3, release: 0.05 },
      },
      echo: { time: beats(song.bpm, 1), feedback: [0.18, 0.58] },
      eq: { low: 2.4, lowFreq: 64, mid: -3, midFreq: 520, q: 1.3, high: [-1, 4], highFreq: 7400 },
      width: { low: 0.7, high: [1.05, 1.75], crossover: 170 },
      layer: [0, 0.44],
      opens: { to: ['svf-1', 'cutoff'], range: [120, 640] },
      rotaries,
    }),
    {
      modules: [
        { id: 'vco-1', type: 'vco', params: { tune: root } },
        // A seventh of a semitone. Far enough to beat once every few seconds, close enough to still be
        // one note — the same trick the D&B Reese uses, at a fraction of the detune because this one is
        // meant to be felt rather than heard.
        { id: 'vco-2', type: 'vco', params: { tune: Math.round((root + 0.14) * 100) / 100 } },
        { id: 'mixer-1', type: 'mixer', params: { level1: 0.5, level2: 0.5, level3: 0, level4: 0 } },
        { id: 'lfo-1', type: 'lfo', params: { rate: 0.05, shape: 0 } },
        {
          id: 'svf-1',
          type: 'svf',
          params: { cutoff: routed(120, 640, 66), resonance: 0.46 },
        },
        { id: 'vca-1', type: 'vca', params: { gain: 0.62 } },
      ],
      cables: [
        { from: ['vco-1', 'out'], to: ['mixer-1', 'in1'] },
        { from: ['vco-2', 'out'], to: ['mixer-1', 'in2'] },
        { from: ['mixer-1', 'out'], to: ['svf-1', 'in'] },
        // Octaves on a cutoff inlet, so one bipolar LFO is a two-octave sweep centred wherever Rotary 3
        // has left the knob.
        { from: ['lfo-1', 'bi'], to: ['svf-1', 'cutoff'] },
        { from: ['svf-1', 'lp'], to: ['vca-1', 'in'] },
      ],
    },
  )
}

/**
 * Last Bus, with a sub the 909 pushes out of the way.
 *
 * Two-step garage leaves a hole under the second beat, and this fills it with a triangle an octave above
 * the song's low 303 — then keys a Compressor from the 909 stem so every kick shoves it down and it climbs
 * back in the gap. That sidechain is one cable, it is the pump the genre is built on, and it is only
 * possible because the machines arrive here as separate stems.
 *
 * The 808 goes through a slow Phaser on its way to the desk. It stays stereo the whole way — the Phaser is
 * one of the devices that takes a pair in and hands a pair back — so the hats keep the field they were
 * panned into.
 */
const lastBus = (): Patch => {
  const song = songOf('garage')
  const root = rootOf(song, '303.b')
  const rotaries = [54, 72, 76, 70] as const

  return assemble(
    song,
    desk({
      strips: [
        { from: ['phaser-1', 'out'], level: 0.72, pan: -0.06, room: 0.2, echo: 0.16 },
        { from: stem(1), level: 0.7, pan: 0.04, room: 0.14, echo: 0.08 },
        { from: stem(2), level: 0.62, pan: 0.14, room: 0.26, echo: 0.44 },
        { from: stem(3), level: 0.72, pan: 0, room: 0.05, echo: 0 },
        { from: ['compressor-1', 'out'], pan: 0, room: 0, echo: 0 },
      ],
      master: 0.9,
      out: 0.6,
      room: {
        algorithm: 0,
        size: 0.5,
        decay: [0.34, 0.72],
        damp: 0.66,
        lowCut: 400,
        highCut: 9000,
        gate: { thresh: 0.07, hold: 0.16, release: 0.04 },
      },
      echo: { time: beats(song.bpm, 0.75), feedback: [0.22, 0.6] },
      eq: { low: 1.8, lowFreq: 76, mid: -1.2, midFreq: 340, q: 0.8, high: [0.5, 5.5], highFreq: 9600 },
      width: { low: 0.75, high: [1.05, 1.6], crossover: 210 },
      layer: [0, 0.6],
      // Up brings the sub in and pushes it further under the kick at the same time.
      opens: { to: ['compressor-1', 'threshold'], range: [-8, -30] },
      rotaries,
    }),
    {
      modules: [
        { id: 'phaser-1', type: 'phaser', params: { rate: 0.18, center: 900, depth: 0.55, feedback: 0.2, mix: 0.26 } },
        { id: 'transport-1', type: 'transport' },
        {
          id: 'tracker-1',
          type: 'tracker',
          // The song's own bass notes an octave up, written into the two-step's gaps: root, the fifth,
          // then the minor third on the way back round.
          params: { length: 16 },
          data: { lane1: [12, 12, 0, 0, 0, 0, 0, 0, 19, 19, 0, 0, 0, 0, 15, 15] },
        },
        { id: 'vco-1', type: 'vco', params: { tune: root, shape: 2 } },
        { id: 'adsr-1', type: 'adsr', params: { attack: 0.006, decay: 0.26, sustain: 0.9, release: 0.16 } },
        { id: 'vca-1', type: 'vca', params: { gain: 0 } },
        {
          id: 'compressor-1',
          type: 'compressor',
          params: {
            threshold: routed(-8, -30, 76),
            ratio: 7,
            attack: 0.002,
            release: 0.12,
            makeup: 4,
            knee: 3,
          },
        },
      ],
      cables: [
        { from: ['groovebox', GROOVEBOX_PORTS.tr808.output], to: ['phaser-1', 'in'] },
        { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
        { from: ['tracker-1', 'cv1'], to: ['vco-1', 'pitch'] },
        { from: ['tracker-1', 'gate1'], to: ['adsr-1', 'gate'] },
        { from: ['vco-1', 'out'], to: ['vca-1', 'in'] },
        { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
        { from: ['vca-1', 'out'], to: ['compressor-1', 'in'] },
        // The whole point of the patch.
        { from: ['groovebox', GROOVEBOX_PORTS.tr909.output], to: ['compressor-1', 'key'] },
      ],
    },
  )
}

/**
 * Rings of Saturn, with the 909 through a tape stage and stabs over the top.
 *
 * 170bpm breakbeat, so the room is short and the echo is a fast dotted eighth that lands inside the bar
 * rather than across it. The 909 stem goes through a Distortion in Tape mode before it reaches the desk —
 * gentle, and it is doing what tape did to a break, which is to round the transients and make the whole
 * kit sound like one recording rather than six voices.
 *
 * Over it, a Wavetable playing four stabs a bar out of the song's own five-note set.
 */
const rings = (): Patch => {
  const song = songOf('saturn')
  const root = rootOf(song, '303.a')
  const rotaries = [62, 74, 72, 78] as const

  return assemble(
    song,
    desk({
      strips: [
        { from: stem(0), level: 0.68, pan: -0.1, room: 0.2, echo: 0.18 },
        { from: ['distortion-1', 'out'], level: 0.72, pan: 0.04, room: 0.24, echo: 0.12 },
        { from: stem(2), level: 0.6, pan: 0.16, room: 0.38, echo: 0.42 },
        { from: stem(3), level: 0.74, pan: 0, room: 0.04, echo: 0 },
        { from: ['vca-1', 'out'], pan: -0.24, room: 0.44, echo: 0.3 },
      ],
      master: 0.9,
      out: 0.58,
      room: {
        algorithm: 2,
        size: 0.62,
        decay: [0.4, 0.78],
        damp: 0.55,
        lowCut: 500,
        highCut: 8800,
        gate: { thresh: 0.09, hold: 0.14, release: 0.03 },
      },
      echo: { time: beats(song.bpm, 0.75), feedback: [0.26, 0.68] },
      eq: { low: 2.2, lowFreq: 68, mid: -2.4, midFreq: 460, q: 1.2, high: [0, 5], highFreq: 10_000 },
      width: { low: 0.8, high: [1.1, 1.8], crossover: 200 },
      layer: [0, 0.46],
      opens: { to: ['svf-1', 'cutoff'], range: [900, 5200] },
      rotaries,
    }),
    {
      modules: [
        {
          id: 'distortion-1',
          type: 'distortion',
          params: { mode: 1, amount: 0.22, tone: 7200, bias: 0, level: 0.85 },
        },
        { id: 'transport-1', type: 'transport' },
        {
          id: 'tracker-1',
          type: 'tracker',
          // Two octaves above the song's root, which sits at the bottom of the 303's range in this one, so
          // the stabs land above the bassline instead of inside it.
          params: { length: 16 },
          data: { lane1: [24, 0, 0, 0, 0, 0, 31, 0, 0, 0, 27, 0, 0, 34, 0, 0] },
        },
        { id: 'stab-1', type: 'wavetable', params: { tune: root, position: 0.68 } },
        { id: 'svf-1', type: 'svf', params: { cutoff: routed(900, 5200, 72), resonance: 0.35 } },
        { id: 'adsr-1', type: 'adsr', params: { attack: 0.004, decay: 0.18, sustain: 0.12, release: 0.24 } },
        { id: 'vca-1', type: 'vca', params: { gain: 0, curve: 1 } },
      ],
      cables: [
        { from: ['groovebox', GROOVEBOX_PORTS.tr909.output], to: ['distortion-1', 'in'] },
        { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
        { from: ['tracker-1', 'cv1'], to: ['stab-1', 'pitch'] },
        { from: ['tracker-1', 'gate1'], to: ['adsr-1', 'gate'] },
        { from: ['stab-1', 'out'], to: ['svf-1', 'in'] },
        { from: ['svf-1', 'lp'], to: ['vca-1', 'in'] },
        { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
      ],
    },
  )
}

/**
 * Time Vortex, with a spring, a tape echo and a drone that draws its own timbre.
 *
 * The one that uses the Tracker's Curve lane. Lane 2 is drawn rather than played — zero is a value there
 * rather than a rest — and its CV goes to the Wavetable's Position inlet, so the drone walks across the
 * table in step with the bar instead of drifting under an LFO. That is a modulation shape written into the
 * sequencer, which is the thing a Matrix could do and nothing here could until the lane mode landed.
 *
 * Spring rather than Hall, because this song is a radiophonic workshop and a spring tank is what was in
 * the room. The echo is a dotted quarter with enough feedback to be an instrument.
 */
const vortex = (): Patch => {
  const song = songOf('timevortex')
  const root = rootOf(song, '303.a')
  const rotaries = [70, 88, 68, 60] as const

  return assemble(
    song,
    desk({
      strips: [
        { from: stem(0), level: 0.72, pan: -0.08, room: 0.24, echo: 0.2 },
        { from: stem(1), level: 0.62, pan: 0.06, room: 0.2, echo: 0.14 },
        { from: ['phaser-1', 'out'], level: 0.6, pan: 0.18, room: 0.36, echo: 0.5 },
        { from: stem(3), level: 0.74, pan: 0, room: 0.05, echo: 0.04 },
        { from: ['vca-1', 'out'], pan: -0.2, room: 0.4, echo: 0.26 },
      ],
      master: 0.88,
      out: 0.58,
      room: {
        algorithm: 3,
        size: 0.4,
        decay: [0.42, 0.84],
        damp: 0.42,
        lowCut: 300,
        highCut: 6000,
        gate: { thresh: 0.07, hold: 0.2, release: 0.04 },
      },
      echo: { time: beats(song.bpm, 1.5), feedback: [0.34, 0.86] },
      eq: { low: 1.6, lowFreq: 80, mid: -2.8, midFreq: 620, q: 1.4, high: [-1, 4.5], highFreq: 8600 },
      width: { low: 0.78, high: [1.1, 1.85], crossover: 180 },
      layer: [0, 0.5],
      opens: { to: ['svf-1', 'cutoff'], range: [700, 4800] },
      rotaries,
    }),
    {
      modules: [
        { id: 'phaser-1', type: 'phaser', params: { rate: 0.09, center: 1400, depth: 0.72, feedback: 0.42, mix: 0.42 } },
        { id: 'transport-1', type: 'transport' },
        {
          id: 'tracker-1',
          // Lane 2 in Curve mode: its numbers are a shape rather than notes, divided by sixteen, so a lane
          // drawn 0 to 12 arrives at the Position inlet as 0 to 0.75.
          type: 'tracker',
          params: { length: 16, unit2: 2 },
          data: {
            lane1: [12, 12, 12, 12, 12, 12, 12, 12, 15, 15, 15, 15, 19, 19, 19, 19],
            lane2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 9, 6, 3],
          },
        },
        { id: 'drone-1', type: 'wavetable', params: { tune: root, position: 0.06 } },
        { id: 'svf-1', type: 'svf', params: { cutoff: routed(700, 4800, 68), resonance: 0.3 } },
        { id: 'adsr-1', type: 'adsr', params: { attack: 0.45, decay: 0.9, sustain: 0.72, release: 1.8 } },
        { id: 'vca-1', type: 'vca', params: { gain: 0 } },
      ],
      cables: [
        { from: ['groovebox', GROOVEBOX_PORTS['303.a'].output], to: ['phaser-1', 'in'] },
        { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
        { from: ['tracker-1', 'cv1'], to: ['drone-1', 'pitch'] },
        { from: ['tracker-1', 'gate1'], to: ['adsr-1', 'gate'] },
        { from: ['tracker-1', 'cv2'], to: ['drone-1', 'pos'] },
        { from: ['drone-1', 'out'], to: ['svf-1', 'in'] },
        { from: ['svf-1', 'lp'], to: ['vca-1', 'in'] },
        { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
      ],
    },
  )
}

/**
 * A rack version of a shipped groovebox song.
 *
 * Everything a `PatchPreset` is, plus the id of the song it is built from — so a host can say what it is a
 * version *of*, and a test can prove that song still exists rather than discovering it at load time.
 */
export interface SongPatchPreset extends PatchPreset {
  song: string
}

export const SONG_PATCHES: readonly SongPatchPreset[] = [
  {
    id: 'sundown-plus',
    song: 'chillwave',
    name: 'Sundown ++',
    blurb: 'The opener, with a hall and a wavetable pad under it',
    kicker: 'Rack++ song',
    features: ['hall send', 'wavetable pad', '4 stems on a desk'],
    accent: 'violet',
    featured: true,
    build: sundown,
  },
  {
    id: 'acieed-plus',
    song: 'acid',
    name: 'Acieed ++',
    blurb: 'The 303 sent back out through the rack’s own ladder',
    kicker: 'Rack++ song',
    features: ['ladder on a stem', 'noise hats', 'spring send'],
    accent: 'pink',
    featured: true,
    build: acieed,
  },
  {
    id: 'undertow-plus',
    song: 'darkwave',
    name: 'Undertow ++',
    blurb: 'A gated plate and a drone with no sequencer in it',
    kicker: 'Rack++ song',
    features: ['gated plate', 'analogue drone', 'LFO filter'],
    accent: 'violet',
    build: undertow,
  },
  {
    id: 'last-bus-plus',
    song: 'garage',
    name: 'Last Bus ++',
    blurb: 'A sub in the two-step gaps, ducked by the 909',
    kicker: 'Rack++ song',
    features: ['sidechain key', 'phased 808', 'triangle sub'],
    accent: 'mint',
    build: lastBus,
  },
  {
    id: 'rings-plus',
    song: 'saturn',
    name: 'Rings of Saturn ++',
    blurb: 'Tape on the 909 and wavetable stabs over the top',
    kicker: 'Rack++ song',
    features: ['tape stage', 'wavetable stabs', 'plate send'],
    accent: 'amber',
    build: rings,
  },
  {
    id: 'vortex-plus',
    song: 'timevortex',
    name: 'Time Vortex ++',
    blurb: 'A spring tank, a tape echo and a drawn drone',
    kicker: 'Rack++ song',
    features: ['curve lane', 'spring send', 'phased 303'],
    accent: 'amber',
    build: vortex,
  },
]

export const songPatchPresetById = (id: string): SongPatchPreset | undefined =>
  SONG_PATCHES.find((preset) => preset.id === id)
