import type { ModRoute, Patch, PatchCable, PatchModule } from '../types.js'

// Pre-wired groups of modules you can drop into a patch.
//
// **This is Reason's Combinator, and the reason it is a chunk rather than a second rack.** Reason never had
// more than one rack: it had one, a mixer device inside it, and the Combinator — a device holding other
// devices, saved and dropped in as a unit. Two racks would have meant two graphs, two transports, cables
// between racks becoming a second routing problem, and a patch that no longer round-trips as one document
// or one link. None of that buys anything the summing Outs do not already give.
//
// So a chunk is not a container and adds no concept to the format. It is a **recipe**: some modules, some
// cables between them, and the name of the port that leaves. Inserting one is an ordinary patch edit, and
// the result is indistinguishable from having patched it by hand — which means it can be taken apart,
// rearranged and shared like anything else.
//
// The chunk's own ids are local and are rewritten on insert, so dropping the same chunk in twice gives two
// independent copies. That rewriting is the only real machinery here and it lives in `insertChunk`.
//
// **Each chunk arrives on its own channel.** Its output is wired to a new Out rather than into an existing
// one, because that is what makes a rack of chunks a mixer: level, pan, mute and solo per chunk, which is
// exactly the multichannel arrangement Reason got from dropping a device and having it auto-connect to the
// next free mixer channel.

export interface Chunk {
  id: string
  name: string
  /** One line, for the picker. */
  blurb: string
  /** Local module ids; rewritten on insert. */
  modules: PatchModule[]
  cables: PatchCable[]
  /**
   * Combinator routings between the chunk's own modules. Local ids, rewritten on insert like the cables.
   *
   * This is what finally makes a chunk the thing the note above claims it is. A chunk was already Reason's
   * Combinator in the sense that mattered least — a group of devices dropped in as one — and had none of
   * what people actually reach a Combi patch for, which is four knobs that play it. A chunk with routings
   * in it arrives with its macros already wired.
   */
  modulation?: ModRoute[]
  /** The `[module, port]` that leaves the chunk, in local ids. Wired to a fresh Out. */
  output: [string, string]
  /** Local ids of modules wanting a sixteenth clock, wired to the patch's Transport. */
  clocked?: [string, string][]
  /** True if this chunk contains a Sampler that needs a break loading into it. */
  needsSample?: boolean
}

export const CHUNKS: readonly Chunk[] = [
  {
    id: 'break',
    name: 'Break',
    blurb: 'Sampler → compressor → reverb, chopped by a tracker',
    needsSample: true,
    modules: [
      {
        id: 'tracker',
        type: 'tracker',
        params: { length: 16, unit1: 1 },
        // Slice numbers, 1-16, because a lane value of zero is a rest and so slice 0 is written as 16 —
        // the Sampler wraps. Same wrinkle as the shipped patches, and it is why these count from one.
        data: { lane1: [1, 0, 5, 3, 9, 0, 5, 0, 1, 11, 5, 3, 9, 13, 5, 15] },
      },
      { id: 'sampler', type: 'sampler', params: { slices: 16 } },
      {
        id: 'comp',
        type: 'compressor',
        params: { threshold: -20, ratio: 4, attack: 0.003, release: 0.1, makeup: 2 },
      },
      { id: 'reverb', type: 'reverb', params: { size: 0.55, decay: 0.7, damp: 0.6, mix: 0.1 } },
    ],
    cables: [
      { from: ['tracker', 'trig1'], to: ['sampler', 'trig'] },
      { from: ['tracker', 'cv1'], to: ['sampler', 'slice'] },
      { from: ['sampler', 'out'], to: ['comp', 'in'] },
      { from: ['comp', 'out'], to: ['reverb', 'in'] },
    ],
    output: ['reverb', 'out'],
    clocked: [['tracker', 'clock']],
  },
  {
    id: 'reese',
    name: 'Reese',
    blurb: 'Two detuned saws through a ladder, driven by a tracker',
    modules: [
      {
        id: 'tracker',
        type: 'tracker',
        params: { length: 16 },
        // Semitones, where 12 is the root an octave above the VCO's own tuning. Sparse: a Reese wants room.
        data: { lane1: [12, 0, 0, 0, 12, 0, 15, 0, 0, 0, 10, 0, 12, 0, 0, 0] },
      },
      { id: 'vco-a', type: 'vco', params: { tune: -12 } },
      { id: 'vco-b', type: 'vco', params: { tune: -11.7 } },
      { id: 'mixer', type: 'mixer', params: { level1: 0.5, level2: 0.5 } },
      { id: 'ladder', type: 'ladder', params: { cutoff: 400, resonance: 0.5 } },
      { id: 'adsr', type: 'adsr', params: { attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.2 } },
      { id: 'vca', type: 'vca', params: { gain: 0 } },
    ],
    cables: [
      { from: ['tracker', 'cv1'], to: ['vco-a', 'pitch'] },
      { from: ['tracker', 'cv1'], to: ['vco-b', 'pitch'] },
      { from: ['tracker', 'gate1'], to: ['adsr', 'gate'] },
      { from: ['vco-a', 'out'], to: ['mixer', 'in1'] },
      { from: ['vco-b', 'out'], to: ['mixer', 'in2'] },
      { from: ['mixer', 'out'], to: ['ladder', 'in'] },
      { from: ['ladder', 'out'], to: ['vca', 'in'] },
      { from: ['adsr', 'out'], to: ['vca', 'cv'] },
    ],
    output: ['vca', 'out'],
    clocked: [['tracker', 'clock']],
  },
  {
    id: 'combi',
    name: 'Combi',
    blurb: 'An acid voice with four macro knobs already wired to it',
    modules: [
      {
        id: 'tracker',
        type: 'tracker',
        params: { length: 16 },
        data: { lane1: [0, 12, 0, 10, 0, 0, 15, 0, 12, 0, 3, 0, 0, 10, 0, 12] },
      },
      { id: 'vco', type: 'vco', params: { tune: -12 } },
      { id: 'ladder', type: 'ladder', params: { cutoff: 700, resonance: 0.6 } },
      { id: 'adsr', type: 'adsr', params: { attack: 0.002, decay: 0.18, sustain: 0.2, release: 0.1 } },
      { id: 'vca', type: 'vca', params: { gain: 0 } },
      // The rotaries rest where the voice above was tuned, so dropping this in and playing it sounds like
      // the patch it says it is — and the first turn of a knob moves away from that rather than jumping
      // to it. A Combi whose macros snap the sound somewhere else on load is a Combi nobody trusts.
      { id: 'combi', type: 'combi', params: { rotary1: 40, rotary2: 76, rotary3: 27, rotary4: 0 } },
    ],
    cables: [
      { from: ['tracker', 'cv1'], to: ['vco', 'pitch'] },
      { from: ['tracker', 'gate1'], to: ['adsr', 'gate'] },
      { from: ['vco', 'out'], to: ['ladder', 'in'] },
      { from: ['ladder', 'out'], to: ['vca', 'in'] },
      { from: ['adsr', 'out'], to: ['vca', 'cv'] },
      // Rotary 4 leaves as a *cable*, which is the half of this module Reason's Combinator did not have.
      // The Ladder's cutoff inlet is in octaves and a rotary sends 0..1, so this is an octave of lift over
      // whatever rotary 1 has set — and it rests at 0, where it is arithmetically nothing. One panel
      // reaching into the same filter both ways at once, which is the shortest demonstration of why the
      // controls are outlets as well as routing sources.
      { from: ['combi', 'rotary4'], to: ['ladder', 'cutoff'] },
    ],
    modulation: [
      // The four every acid line wants, in the order a hand falls on them.
      { from: ['combi', 'rotary1'], to: ['ladder', 'cutoff'], min: 120, max: 6000 },
      { from: ['combi', 'rotary2'], to: ['ladder', 'resonance'], min: 0.1, max: 0.95 },
      { from: ['combi', 'rotary3'], to: ['adsr', 'decay'], min: 0.03, max: 0.6 },
      // A button, so it is a switch rather than a sweep: saw for the classic line, pulse for the thin one.
      { from: ['combi', 'button1'], to: ['vco', 'shape'], min: 0, max: 1 },
    ],
    output: ['vca', 'out'],
    clocked: [['tracker', 'clock']],
  },
  {
    id: 'chop',
    name: 'Chop',
    blurb: 'A drone cut into a rhythm by three filtered gates',
    modules: [
      {
        id: 'tracker',
        type: 'tracker',
        params: { length: 16 },
        // Three lanes, three rhythms, deliberately not in step with each other — which is the whole
        // demonstration. Any non-zero value opens a gate; the numbers themselves go nowhere here.
        data: {
          lane1: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
          lane2: [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
          lane3: [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1],
        },
      },
      // Two saws a fraction apart: a drone with no rhythm of its own, which is the point. There is no
      // envelope anywhere in this chunk — the Alligator's own gates are the envelope, and that is the
      // shortest way to show what the device is for.
      { id: 'vco-a', type: 'vco', params: { tune: -12 } },
      { id: 'vco-b', type: 'vco', params: { tune: -11.85 } },
      { id: 'pad', type: 'mixer', params: { level1: 0.5, level2: 0.5 } },
      { id: 'gator', type: 'alligator' },
      { id: 'bands', type: 'mixer', params: { level1: 0.6, level2: 0.5, level3: 0.4 } },
    ],
    cables: [
      { from: ['vco-a', 'out'], to: ['pad', 'in1'] },
      { from: ['vco-b', 'out'], to: ['pad', 'in2'] },
      { from: ['pad', 'out'], to: ['gator', 'in'] },
      { from: ['tracker', 'gate1'], to: ['gator', 'gate1'] },
      { from: ['tracker', 'gate2'], to: ['gator', 'gate2'] },
      { from: ['tracker', 'gate3'], to: ['gator', 'gate3'] },
      // Back to one signal, because a chunk leaves on one port. Summed through a Mixer rather than
      // inside the Alligator, so the three bands can be pulled apart again — send the top to a delay
      // and leave the bottom dry, which is what people actually do with this device.
      { from: ['gator', 'out1'], to: ['bands', 'in1'] },
      { from: ['gator', 'out2'], to: ['bands', 'in2'] },
      { from: ['gator', 'out3'], to: ['bands', 'in3'] },
    ],
    output: ['bands', 'out'],
    clocked: [['tracker', 'clock']],
  },
  {
    id: 'sub',
    name: 'Sub',
    blurb: 'A triangle an octave down, gated and nothing else',
    modules: [
      {
        id: 'tracker',
        type: 'tracker',
        params: { length: 16 },
        // Long notes. A sub that moved about would be mud.
        data: { lane1: [12, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 15, 0] },
      },
      { id: 'vco', type: 'vco', params: { tune: -24, shape: 2 } },
      { id: 'adsr', type: 'adsr', params: { attack: 0.008, decay: 0.4, sustain: 0.9, release: 0.25 } },
      { id: 'vca', type: 'vca', params: { gain: 0 } },
    ],
    cables: [
      { from: ['tracker', 'cv1'], to: ['vco', 'pitch'] },
      { from: ['tracker', 'gate1'], to: ['adsr', 'gate'] },
      { from: ['vco', 'out'], to: ['vca', 'in'] },
      { from: ['adsr', 'out'], to: ['vca', 'cv'] },
    ],
    output: ['vca', 'out'],
    clocked: [['tracker', 'clock']],
  },
  {
    id: 'hats',
    name: 'Hats',
    blurb: 'Noise through a fast envelope, on the offbeats',
    modules: [
      {
        id: 'tracker',
        type: 'tracker',
        params: { length: 16 },
        data: { lane1: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1] },
      },
      { id: 'noise', type: 'noise' },
      { id: 'adsr', type: 'adsr', params: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.03 } },
      { id: 'vca', type: 'vca', params: { gain: 0 } },
    ],
    cables: [
      { from: ['tracker', 'trig1'], to: ['adsr', 'trig'] },
      { from: ['noise', 'white'], to: ['vca', 'in'] },
      { from: ['adsr', 'out'], to: ['vca', 'cv'] },
    ],
    output: ['vca', 'out'],
    clocked: [['tracker', 'clock']],
  },
]

export const chunkById = (id: string): Chunk | undefined => CHUNKS.find((chunk) => chunk.id === id)

/** A fresh id for a module of this type, avoiding everything already taken. */
function freshId(taken: Set<string>, type: string): string {
  for (let n = 1; ; n++) {
    const id = `${type}-${n}`
    if (!taken.has(id)) return id
  }
}

export interface Inserted {
  patch: Patch
  /** Local id → the id it was given, so a caller can address what it just added. */
  ids: Record<string, string>
  /** The Out that was created for this chunk, which is its channel. */
  out: string
}

/**
 * Drop a chunk into a patch.
 *
 * Every local id is rewritten to a fresh one, so inserting the same chunk twice gives two independent
 * copies rather than a name collision that would silently merge them.
 *
 * Three things are wired for you, and each is the thing that would otherwise make a freshly dropped chunk
 * do nothing at all — the failure this codebase keeps having to fix:
 *
 *   - a **Transport** if the patch has none, and its sixteenth into whatever the chunk said it clocks;
 *   - a fresh **Out**, so the chunk arrives on its own channel with its own level, pan, mute and solo;
 *   - the chunk's stated output into that Out.
 */
export function insertChunk(patch: Patch, chunk: Chunk): Inserted {
  const taken = new Set(patch.modules.map((module) => module.id))
  const ids: Record<string, string> = {}
  const modules = [...patch.modules]

  for (const module of chunk.modules) {
    const id = freshId(taken, module.type)
    taken.add(id)
    ids[module.id] = id
    // Deep-copied rather than referenced: a chunk is a recipe and must survive being inserted twice, which
    // is the same reasoning `PATCHES` uses for building rather than storing.
    modules.push({
      ...module,
      id,
      ...(module.params ? { params: { ...module.params } } : {}),
      ...(module.data
        ? { data: Object.fromEntries(Object.entries(module.data).map(([k, v]) => [k, [...v]])) }
        : {}),
    })
  }

  const cables = [...patch.cables]
  for (const cable of chunk.cables) {
    cables.push({
      from: [ids[cable.from[0]] ?? cable.from[0], cable.from[1]],
      to: [ids[cable.to[0]] ?? cable.to[0], cable.to[1]],
    })
  }

  // Reuse the Transport already there rather than adding a second one, which would only agree with it.
  let transport = modules.find((module) => module.type === 'transport')?.id
  if (chunk.clocked?.length && !transport) {
    transport = freshId(taken, 'transport')
    taken.add(transport)
    modules.push({ id: transport, type: 'transport' })
  }
  for (const [local, port] of chunk.clocked ?? []) {
    if (transport && ids[local]) cables.push({ from: [transport, 'sixteenth'], to: [ids[local], port] })
  }

  // A new Out every time, unlike the Transport. This is the decision that makes a rack of chunks a mixer:
  // sharing one Out would give every chunk the same fader.
  const out = freshId(taken, 'out')
  taken.add(out)
  modules.push({ id: out, type: 'out', params: { level: 0.7 } })
  const [fromModule, fromPort] = chunk.output
  if (ids[fromModule]) cables.push({ from: [ids[fromModule], fromPort], to: [out, 'in'] })

  // Routings, with the same id rewriting the cables get — so two copies of one chunk have two Combinators
  // each driving its own voice, rather than both reaching for the first one inserted.
  const modulation = [...(patch.modulation ?? [])]
  for (const route of chunk.modulation ?? []) {
    modulation.push({
      ...route,
      from: [ids[route.from[0]] ?? route.from[0], route.from[1]],
      to: [ids[route.to[0]] ?? route.to[0], route.to[1]],
    })
  }

  return {
    patch: {
      ...patch,
      modules,
      cables,
      // Absent stays absent: inserting a chunk with no routings into a patch with none must not start
      // writing an empty array into everybody's saved file.
      ...(modulation.length > 0 ? { modulation } : {}),
    },
    ids,
    out,
  }
}
