import type { Patch, PatchCable, PatchModule } from '../types.js'
import { listZip, readZipText } from './zip.js'

// Reading a VCV Rack patch.
//
// **Topology only.** Modules and cables come across; knob positions do not. That is a scoping decision and not
// laziness: VCV stores a param as a number whose meaning depends on a range declared in that module's C++, so
// carrying a value over means encoding a guess about somebody else's internals for every param of every model.
// A patch that arrives correctly wired with knobs at our defaults is honest and useful. One that arrives with
// a filter cutoff silently a factor of ten out is worse than nothing.
//
// **One VCV module becomes one of ours.** That rule decides several things that would otherwise each need
// their own argument: an eight-channel attenuverter does not become eight Offsets, an Audio-8 does not become
// four stereo Outs, and a stereo pair of jacks does not become two panned terminals with knobs we wrote
// ourselves. Where a model has more of something than our nearest module does, the extra ports are dropped
// **visibly**, which is the same trade the port table below already makes.
//
// **The port indices below are the weak point and are worth reading before trusting.** `patch.json` identifies
// a port by *number*, not by name — `{"outputModuleId": 1, "outputId": 0}` — so mapping requires knowing the
// order Fundamental declares its ports in. That order is not in the file, is not part of any published format,
// and has changed between VCV versions. The table is best effort and has not been checked against a real
// `.vcv` produced by Rack.
//
// So the importer **reports every mapping it made**, both endpoints named, and the UI shows it. A wrong index
// then reads as one obviously wrong line — "VCO Saw → Ladder Cutoff" — rather than as a patch that sounds
// subtly wrong for reasons nobody can find. Correcting the table is a one-line change once somebody has a file
// to check it against.
//
// **A mapping that lands on a real port can still change what you hear, and those say so now.** Four of VCV's
// VCO outputs are four waveforms and ours is one jack behind a Shape knob; VCV's audio interface has two mono
// inputs where our Out has one stereo inlet that takes both. Before this, all of that was reported as `mapped`
// alongside the exact ones, which made the report say a patch had arrived intact when half of it had been
// folded. `approximate` is the same idea as the compiler's stereo fold note: the cable is real, it is drawn,
// and the one thing the reader needs to know is that it is not what was there before.
//
// Running VCV's own modules is out of scope and stays out: that is a C++/Wasm port with GPLv3 attached, and the
// Wasm section of `docs/RACK.md` covers why such a bridge has to cross the boundary once per block rather than
// once per sample.

/** How one VCV model maps onto one of ours. */
interface Mapping {
  /** Our module type. */
  type: string
  /** Our inlet id for each VCV input index, in order. `null` for one we have no equivalent for. */
  inputs: (string | null)[]
  /** Our outlet id for each VCV output index, in order. */
  outputs: (string | null)[]
  /**
   * Our port id → why a cable landing on it is lossy, reported once per module and port.
   *
   * Keyed by *our* port rather than by VCV's index, because that is the shape of every one of these: several
   * of theirs arrive at one of ours, and the reader wants one line about the jack they can see rather than
   * four about jacks that no longer exist.
   */
  approximate?: Record<string, string>
  /** A caveat about the module as a whole, reported when it arrives rather than when a cable lands. */
  note?: string
}

/** Said by every model whose several waveform jacks arrive at one outlet with a Shape knob in front of it. */
const ONE_SHAPE_JACK =
  'VCV gives each waveform its own jack and this has one, chosen by a Shape knob — and knobs do not come across'

/**
 * Fundamental and Core, as far as we can serve them.
 *
 * Keyed `plugin/model`, which are the stable slugs — those *are* in the file and they do not move. Only the
 * index ordering inside each entry is uncertain; see the note at the top.
 *
 * What is deliberately **not** here is as much a decision as what is. `8vert` is eight attenuverters and
 * `Merge`/`Split` are polyphony plumbing with no module of ours behind them; one-to-one says they stay
 * placeholders, which keeps their cables and says plainly that we could not play them. `Random` needs a
 * clocked generator we do not have — our Sample & Hold samples something you patch into it, which is a
 * different module wearing a similar name, and mapping one onto the other would produce silence with a
 * confident report attached.
 */
const FUNDAMENTAL: Record<string, Mapping> = {
  'Fundamental/VCO': {
    type: 'vco',
    inputs: ['fm', null, null, 'pitch'],
    outputs: ['out', 'out', 'out', 'out'],
    approximate: { out: ONE_SHAPE_JACK },
  },
  'Fundamental/WTVCO': {
    type: 'wavetable',
    inputs: ['fm', 'pos', null, 'pitch'],
    outputs: ['out'],
  },
  'Fundamental/VCF': {
    // The SVF rather than the Ladder, and the reason is the highpass. VCV's VCF has an LPF jack and an HPF
    // jack; the Ladder has one lowpass outlet, so the old table sent both of them there and a highpass
    // silently became a lowpass — the exact failure the top of this file exists to prevent. The SVF has
    // both, so the wiring survives intact.
    //
    // The cost is character, and it is real: Fundamental's VCF is ladder-derived and the SVF is the clean
    // one. That is a trade between a patch that is wired right and one that is voiced right, and topology is
    // what this importer promises — so it takes the wiring and says so, and swapping in a Ladder afterwards
    // is one module and two cables for anybody who wants the other half.
    type: 'svf',
    inputs: [null, 'cutoff', 'res', null, 'in'],
    outputs: ['lp', 'hp'],
    note: "VCV's VCF is ladder-derived; this is the clean state-variable filter, so the routing is right and the character is not — swap in a Ladder for that",
  },
  'Fundamental/VCA': { type: 'vca', inputs: ['cv', 'in'], outputs: ['out'] },
  'Fundamental/VCA-1': { type: 'vca', inputs: ['cv', 'in'], outputs: ['out'] },
  'Fundamental/ADSR': {
    type: 'adsr',
    inputs: [null, null, null, null, 'gate', 'trig'],
    outputs: ['out'],
  },
  'Fundamental/LFO': {
    type: 'lfo',
    inputs: [null, null, 'reset', 'rate', null],
    outputs: ['bi', 'bi', 'bi', 'bi'],
    approximate: { bi: ONE_SHAPE_JACK },
  },
  'Fundamental/WTLFO': {
    type: 'lfo',
    inputs: [null, null, 'reset', 'rate', null],
    outputs: ['bi', 'bi', 'bi', 'bi'],
    approximate: {
      bi: 'a wavetable LFO arriving at an ordinary one — the rate and the reset carry over, the table does not',
    },
  },
  'Fundamental/Noise': {
    type: 'noise',
    inputs: [],
    outputs: ['white', 'pink', 'white', 'white', 'white'],
    approximate: { white: 'VCV offers several noise colours here and this build has white and pink' },
  },
  'Fundamental/Delay': { type: 'delay', inputs: ['time', 'fb', null, null, 'in'], outputs: ['out'] },
  'Fundamental/Mixer': {
    type: 'mixer',
    inputs: [null, 'in1', 'in2', 'in3', 'in4'],
    outputs: ['out'],
  },
  'Fundamental/VCMixer': {
    // Our Mixer rather than the Line Mixer, because the channel count is what matters: four channels each
    // with a level CV is exactly what `mixer.ts` is, where the Line Mixer is a six-channel stereo desk with
    // sends and no level CV at all. The nearer-looking name is the worse match.
    type: 'mixer',
    inputs: [null, 'cv1', 'cv2', 'cv3', 'cv4', 'in1', 'in2', 'in3', 'in4'],
    outputs: ['out'],
  },
  'Fundamental/Scope': {
    type: 'meter',
    inputs: ['in', null],
    outputs: [],
    approximate: {
      in: 'a level meter rather than a scope — it shows how loud that signal is, not what shape it has',
    },
  },
  'Fundamental/Quantizer': { type: 'quantizer', inputs: ['in'], outputs: ['out'] },
  'Fundamental/SEQ3': {
    type: 'seq',
    inputs: ['clock', 'reset'],
    outputs: ['gate', 'pitch'],
    // The one mapped model whose *content* is entirely knobs. It arrives clocked and wired and plays
    // nothing, which without this line reads as the importer having broken it.
    note: 'its steps are knobs, so it arrives clocked, wired and empty — the notes have to be entered again',
  },
  'Core/AudioInterface': audioOut(),
  'Core/AudioInterface2': audioOut(),
  'Core/AudioInterface16': audioOut(14),
  'Core/Audio2': audioOut(),
  'Core/Audio8': audioOut(6),
  'Core/Audio16': audioOut(14),
  'Core/MIDIToCVInterface': {
    type: 'midi',
    inputs: [],
    outputs: ['pitch', 'gate', 'vel', 'mod'],
  },
}

/**
 * An audio interface, with `extra` inputs past the first pair.
 *
 * Both of VCV's first two inputs land on one stereo inlet, because that is what our Out has and one-to-one
 * says the module does not become two. A mono cable into a stereo inlet feeds both channels — `stereo.ts`
 * has the rules — so the pair arrives summed and centred rather than as a stereo image, which is the whole
 * content of the note. Everything past the pair is dropped, visibly.
 */
function audioOut(extra = 0): Mapping {
  return {
    type: 'out',
    inputs: ['in', 'in', ...Array.from({ length: extra }, () => null)],
    outputs: [],
    approximate: {
      in: "the Out's In is one stereo inlet, so VCV's left and right both feed both channels — the pair arrives summed and centred",
    },
  }
}

/** One thing the importer did or could not do, for showing to whoever opened the file. */
export interface ImportNote {
  kind: 'mapped' | 'approximate' | 'placeholder' | 'dropped-cable' | 'refused'
  detail: string
}

export interface Imported {
  patch: Patch
  notes: ImportNote[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** VCV's `[x, row]`, where x is horizontal pitch units and row is the rack row. Null when it is not there. */
function placement(raw: Record<string, unknown>): [number, number] | null {
  const pos = raw.pos
  if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') return null
  return [pos[0], pos[1]]
}

/**
 * How many voices a MIDI module was set to play.
 *
 * The one number VCV records that ours means the same thing by. `Patch.voices` is one count for the whole
 * patch — `types.ts` argues why — and a MIDI-CV's channel count is a count rather than a value in somebody
 * else's units, which is why reading it is not the knob decision in disguise. The key is not part of any
 * published format, so this is guarded at every step: anything unexpected leaves the patch monophonic, which
 * is what every import did before.
 */
function polyphonyOf(data: unknown): number {
  if (!isRecord(data)) return 0
  for (const key of ['channels', 'polyphony']) {
    const value = data[key]
    if (typeof value === 'number' && Number.isInteger(value) && value > 1 && value <= 16) return value
  }
  return 0
}

/** The most voices this rack will build. `compile` clamps to the same number. */
const MAX_VOICES = 8

/**
 * Turn a VCV `patch.json` into one of ours.
 *
 * Never throws. A module we have no mapping for becomes a **placeholder** — kept, with its cables, drawn as a
 * blank faceplate, and saved again untouched. That rule was built in `compile.ts` for version skew between two
 * builds of this rack, and it turns out to be exactly what importing somebody else's rack needs: the parts we
 * understand play, the parts we do not are visibly and honestly absent, and nothing is quietly deleted.
 */
export function importVcvPatch(text: string): Imported | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.modules)) return null

  const notes: ImportNote[] = []
  const modules: PatchModule[] = []
  /** VCV's numeric module id → ours, plus how to read its ports. */
  const known = new Map<number, { id: string; mapping: Mapping | null; model: string }>()
  const used = new Set<string>()
  let voices = 0

  const fresh = (base: string) => {
    for (let n = 1; ; n++) {
      const id = `${base}-${n}`
      if (!used.has(id)) {
        used.add(id)
        return id
      }
    }
  }

  // **In the order they were on screen, not the order they were saved in.** Our layout *is* the module list —
  // there are no coordinates in a Driftbox patch, which is `layout.ts`'s decision and a good one — so the
  // order this loop runs in is the arrangement somebody sees when the import lands. VCV's array is creation
  // order, so without this a rack built left to right over an evening arrives shuffled. Reading `pos` for it
  // is also the only use `pos` has ever had here: it round-trips through `patch-io` and nothing else looks at
  // it. Row first, then x, then the file's own order for anything that has no position at all.
  const placed = parsed.modules
    .map((raw, index) => ({ raw, index, at: isRecord(raw) ? placement(raw) : null }))
    .sort((a, b) => {
      if (a.at && b.at) return a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.index - b.index
      if (a.at) return -1
      if (b.at) return 1
      return a.index - b.index
    })

  for (const { raw, at } of placed) {
    if (!isRecord(raw) || typeof raw.id !== 'number') continue
    const plugin = typeof raw.plugin === 'string' ? raw.plugin : '?'
    const model = typeof raw.model === 'string' ? raw.model : '?'
    const slug = `${plugin}/${model}`
    const mapping = FUNDAMENTAL[slug] ?? null

    // A placeholder's type carries where it came from, so the faceplate can say "this was a Rack module" rather
    // than only "unknown". Nothing will ever claim this type, which is the point.
    const type = mapping ? mapping.type : `vcv:${slug}`
    const id = fresh(mapping ? mapping.type : 'vcv')

    const module: PatchModule = { id, type }
    if (at) module.pos = at
    // v2 writes `bypassed`, v1 wrote `disabled`, and neither is a published format — so take either, and take
    // it for a placeholder too. A module somebody had switched out of the chain should not come back in.
    if (raw.bypassed === true || raw.disabled === true) module.bypassed = true
    modules.push(module)
    known.set(raw.id, { id, mapping, model: slug })

    if (mapping) {
      notes.push({
        kind: 'mapped',
        detail: `${slug} → ${mapping.type} (${id})${module.bypassed ? ', bypassed' : ''}`,
      })
      if (mapping.note) notes.push({ kind: 'approximate', detail: `${id}: ${mapping.note}` })
      if (mapping.type === 'midi') voices = Math.max(voices, polyphonyOf(raw.data))
    } else {
      notes.push({ kind: 'placeholder', detail: `${slug} has no equivalent here; kept as a placeholder` })
    }
  }

  const cables: PatchCable[] = []
  /** `${module}.${port}` whose approximation has been reported. Fanning one outlet out four ways is one fact. */
  const said = new Set<string>()
  const caveat = (end: { id: string; mapping: Mapping | null }, port: string) => {
    const detail = end.mapping?.approximate?.[port]
    if (!detail) return
    const key = `${end.id}.${port}`
    if (said.has(key)) return
    said.add(key)
    notes.push({ kind: 'approximate', detail: `${end.id}.${port}: ${detail}` })
  }

  for (const raw of Array.isArray(parsed.cables) ? parsed.cables : []) {
    if (!isRecord(raw)) continue
    const fromId = raw.outputModuleId
    const toId = raw.inputModuleId
    if (typeof fromId !== 'number' || typeof toId !== 'number') continue
    const from = known.get(fromId)
    const to = known.get(toId)
    if (!from || !to) continue

    const outIndex = typeof raw.outputId === 'number' ? raw.outputId : -1
    const inIndex = typeof raw.inputId === 'number' ? raw.inputId : -1

    // A placeholder has no known ports, so its end of the cable keeps VCV's index as a port name. `compile`
    // takes that on trust — which is what a placeholder is for — and the cable survives a save.
    const outPort = from.mapping ? from.mapping.outputs[outIndex] : `out${outIndex}`
    const inPort = to.mapping ? to.mapping.inputs[inIndex] : `in${inIndex}`

    if (!outPort || !inPort) {
      notes.push({
        kind: 'dropped-cable',
        detail: `${from.model}[${outIndex}] → ${to.model}[${inIndex}] has no equivalent here`,
      })
      continue
    }
    cables.push({ from: [from.id, outPort], to: [to.id, inPort] })
    notes.push({
      kind: 'mapped',
      detail: `${from.id}.${outPort} → ${to.id}.${inPort}`,
    })
    caveat(from, outPort)
    caveat(to, inPort)
  }

  const patch: Patch = { modules, cables }
  if (voices > 1) {
    patch.voices = Math.min(MAX_VOICES, voices)
    notes.push(
      voices > MAX_VOICES
        ? {
            kind: 'approximate',
            detail: `${voices} MIDI channels → ${MAX_VOICES} voices, which is this rack's maximum`,
          }
        : { kind: 'mapped', detail: `${voices} MIDI channels → ${voices} voices` },
    )
  }
  return { patch, notes }
}

/** Read a `.vcv` file. Null when it is not one, with the reason in `notes` where there is one to give. */
export async function importVcv(buffer: ArrayBuffer): Promise<Imported | null> {
  const text = await readZipText(buffer, 'patch.json')
  if (text === null) {
    const inside = listZip(buffer)
    if (inside.length === 0) return null
    return {
      patch: { modules: [], cables: [] },
      notes: [
        {
          kind: 'refused',
          detail: `no patch.json in this archive — it holds ${inside.slice(0, 6).join(', ')}`,
        },
      ],
    }
  }
  return importVcvPatch(text)
}

/** The models this build knows how to map, for saying so before somebody imports. */
export const VCV_MODELS: readonly string[] = Object.keys(FUNDAMENTAL)
