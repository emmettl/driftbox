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
}

/**
 * Fundamental, as far as we can serve it.
 *
 * Keyed `plugin/model`, which are the stable slugs — those *are* in the file and they do not move. Only the
 * index ordering inside each entry is uncertain; see the note at the top.
 */
const FUNDAMENTAL: Record<string, Mapping> = {
  'Fundamental/VCO': {
    type: 'vco',
    inputs: ['fm', null, null, 'pitch'],
    outputs: ['out', 'out', 'out', 'out'],
  },
  'Fundamental/VCF': {
    type: 'ladder',
    inputs: [null, 'cutoff', 'res', null, 'in'],
    outputs: ['out', 'out'],
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
  },
  'Fundamental/Noise': {
    type: 'noise',
    inputs: [],
    outputs: ['white', 'pink', 'white', 'white', 'white'],
  },
  'Fundamental/Delay': { type: 'delay', inputs: ['time', 'fb', null, null, 'in'], outputs: ['out'] },
  'Fundamental/Mixer': {
    type: 'mixer',
    inputs: [null, 'in1', 'in2', 'in3', 'in4'],
    outputs: ['out'],
  },
  'Fundamental/Quantizer': { type: 'quantizer', inputs: ['in'], outputs: ['out'] },
  'Fundamental/SEQ3': { type: 'seq', inputs: ['clock', 'reset'], outputs: ['gate', 'pitch'] },
  'Core/AudioInterface': { type: 'out', inputs: ['in', 'in'], outputs: [] },
  'Core/Audio2': { type: 'out', inputs: ['in', 'in'], outputs: [] },
  'Core/AudioInterface2': { type: 'out', inputs: ['in', 'in'], outputs: [] },
  'Core/MIDIToCVInterface': {
    type: 'midi',
    inputs: [],
    outputs: ['pitch', 'gate', 'vel', 'mod'],
  },
}

/** One thing the importer did or could not do, for showing to whoever opened the file. */
export interface ImportNote {
  kind: 'mapped' | 'placeholder' | 'dropped-cable' | 'refused'
  detail: string
}

export interface Imported {
  patch: Patch
  notes: ImportNote[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

  const fresh = (base: string) => {
    for (let n = 1; ; n++) {
      const id = `${base}-${n}`
      if (!used.has(id)) {
        used.add(id)
        return id
      }
    }
  }

  for (const raw of parsed.modules) {
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
    const pos = raw.pos
    if (Array.isArray(pos) && typeof pos[0] === 'number' && typeof pos[1] === 'number') {
      module.pos = [pos[0], pos[1]]
    }
    modules.push(module)
    known.set(raw.id, { id, mapping, model: slug })

    notes.push(
      mapping
        ? { kind: 'mapped', detail: `${slug} → ${mapping.type} (${id})` }
        : { kind: 'placeholder', detail: `${slug} has no equivalent here; kept as a placeholder` },
    )
  }

  const cables: PatchCable[] = []
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
  }

  return { patch: { modules, cables }, notes }
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
