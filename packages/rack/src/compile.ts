import type {
  ModuleDef,
  Patch,
  PatchCable,
  PatchModule,
  Plan,
  PlanNode,
  PlanNote,
  PlanParam,
  Registry,
} from './types.js'

// Turning a patch into something the audio thread can run without thinking.
//
// This is the part of the rack that is worth being careful about, and it is deliberately
// pure arithmetic on plain objects: no AudioContext, no worklet, no DOM. Everything that
// makes a graph a graph — the ordering, the cycle breaking, which buffer each cable is —
// is decided here and tested here. `process()` on the audio thread then does nothing but
// walk a list.
//
// The alternative was compiling on the audio thread. Don't: a topological sort inside
// `process()` is a glitch waiting for the first patch edit, and none of it would be
// testable without an audio device.
//
// The plan is plain objects and arrays because it crosses `postMessage`.

/** Buffer 0 is the zero buffer. Nothing ever writes to it, so an unconnected inlet reads
 *  silence and no module has to branch on whether it is patched. */
const ZERO = 0

/**
 * A composite key for one port of one module.
 *
 * `JSON.stringify` rather than joining with a separator, because both halves come out of a
 * patch file and may contain anything at all. Joining `["a b", "c"]` and `["a", "b c"]` with a
 * space gives the same string for both, which would silently wire one module's inlet to
 * another's outlet — and the first version of this used a raw NUL to dodge that, which worked,
 * said nothing about why, and made this file binary as far as git was concerned. This is
 * unambiguous for every input and costs nothing: it runs when a patch changes, never per block.
 */
const key = (moduleId: string, portId: string) => JSON.stringify([moduleId, portId])

interface Entry {
  module: PatchModule
  /** null for a module whose type this build does not know. */
  index: number | null
}

const isCable = (value: unknown): value is PatchCable => {
  const c = value as PatchCable | null
  return (
    !!c &&
    Array.isArray(c.from) &&
    Array.isArray(c.to) &&
    typeof c.from[0] === 'string' &&
    typeof c.from[1] === 'string' &&
    typeof c.to[0] === 'string' &&
    typeof c.to[1] === 'string'
  )
}

const clamp = (value: unknown, low: number, high: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(low, Math.min(high, value))
}

/**
 * Run a module's own `migrate` if the patch was saved by an older version of it.
 *
 * This is where per-module versioning actually happens. `patch-io.ts` preserves the version
 * and does nothing with it, because migrating needs the def and it has no registry — so the
 * repair lands here, at the one point that has both the saved params and the module that owns
 * them.
 *
 * A missing version means "current": a patch written by hand should not have to declare one.
 * A version NEWER than this build's is left alone rather than migrated backwards — the params
 * are then clamped against this build's defs like any others, and anything it does not
 * recognise is carried through untouched by `encodePatch` on the way back out.
 *
 * A `migrate` that throws costs its module's knob positions and nothing else. It is somebody's
 * hand-written repair function running against data from an unknown build, which is the one
 * place in this file where the input is not the only thing that might be wrong.
 */
function migrated(
  module: PatchModule,
  def: ModuleDef,
  notes: PlanNote[],
): Record<string, number> {
  const saved = module.params ?? {}
  const from = module.version
  if (from === undefined || from >= def.version || !def.migrate) return saved

  try {
    return def.migrate({ ...saved }, from)
  } catch {
    notes.push({
      kind: 'migration-failed',
      module: module.id,
      detail: `${module.type} could not migrate its params from version ${from} to ${def.version}; they fall back to defaults`,
    })
    return {}
  }
}

/**
 * Compile a patch against the modules this build has.
 *
 * Never throws. A patch arrives from outside the program — from a URL somebody else sent,
 * or from a build that is not this one — and the failure mode for trusting it is the rack
 * going silent with no way back. Anything unusable is dropped or neutralised and recorded
 * in `plan.notes`; the caller always gets a plan it can run.
 */
export function compile(patch: Patch, registry: Registry): Plan {
  const notes: PlanNote[] = []
  const modules = Array.isArray(patch?.modules) ? patch.modules : []
  const cables = Array.isArray(patch?.cables) ? patch.cables : []

  // ---- Modules -------------------------------------------------------------------------
  //
  // A module whose type is not in the registry becomes a PLACEHOLDER: it is kept in the
  // entry table so cables touching it still resolve, but it gets no node and its outlets
  // read as silence. It is emphatically not deleted. `song-io.ts` in the engine already
  // declines to check voice ids against the kit registry, on the grounds that silently
  // dropping somebody's settings because they opened an older build is not a repair — and
  // the argument is stronger here, because deleting a module would take every cable
  // touching it with it. Open a newer patch in an older build, re-save, and the patch
  // would be quietly demolished.

  const entries = new Map<string, Entry>()
  /** Only the modules that will actually run, in patch order. */
  const live: PatchModule[] = []

  for (const module of modules) {
    if (!module || typeof module.id !== 'string' || module.id === '') continue
    if (entries.has(module.id)) {
      notes.push({
        kind: 'duplicate-module',
        module: module.id,
        detail: `two modules share the id "${module.id}"; the later one was dropped`,
      })
      continue
    }
    const def = registry[module.type]
    if (!def) {
      notes.push({
        kind: 'placeholder',
        module: module.id,
        detail: `no module of type "${module.type}" in this build; kept as a placeholder`,
      })
      entries.set(module.id, { module, index: null })
      continue
    }
    entries.set(module.id, { module, index: live.length })
    live.push(module)
  }

  // ---- Buffers -------------------------------------------------------------------------
  //
  // One buffer per outlet of every live module, whether or not anything is patched to it.
  // Allocating only for connected outlets would save a few kilobytes and introduce a
  // footgun: an unconnected outlet would have to point somewhere, and the only somewhere
  // is the zero buffer, which a module is then writing to. Reusing buffers between
  // modules whose lifetimes do not overlap is a real optimisation and belongs later.

  const outletBuffer = new Map<string, number>()
  /** Per buffer: is it written per voice? Index 0 is the zero buffer, which belongs to nobody and is read by
   *  every unconnected inlet of every voice — mono is the only answer that makes sense for it. */
  const bufferPoly: boolean[] = [false]
  let buffers = 1
  for (const module of live) {
    const def = registry[module.type]
    // A buffer is polyphonic exactly when the module writing it is. Recorded here rather than worked out on
    // the audio thread, because a question `process()` has to answer at run time is one it can get wrong.
    const poly = def.poly !== false
    for (const port of def.outlets) {
      outletBuffer.set(key(module.id, port.id), buffers)
      bufferPoly[buffers] = poly
      buffers++
    }
  }

  // ---- Cables --------------------------------------------------------------------------
  //
  // One cable per inlet, and the last one wins — which is what happens when you drag a
  // cable onto an occupied input in Reason. Summing instead would make every inlet a
  // hidden mixer; the Mixer module is the visible one.

  interface Source {
    buffer: number
    /** null when the cable comes from a placeholder. */
    from: number | null
    /** The destination, carried rather than parsed back out of the map key. Deriving it from
     *  the key means the key format is load-bearing in two places, and it is exactly the kind
     *  of coupling that made a NUL separator look load-bearing when it was an accident. */
    to: number
    toId: string
    toPort: string
  }
  const inletSource = new Map<string, Source>()
  const replaced = new Map<string, PatchCable>()

  for (const cable of cables) {
    if (!isCable(cable)) continue
    const [fromId, fromPort] = cable.from
    const [toId, toPort] = cable.to

    const source = entries.get(fromId)
    const dest = entries.get(toId)
    const drop = (detail: string) => notes.push({ kind: 'dropped-cable', cable, detail })

    if (!source) {
      drop(`no module "${fromId}" to take a cable from`)
      continue
    }
    if (!dest) {
      drop(`no module "${toId}" to take a cable to`)
      continue
    }
    // A port name is only checkable on a module whose def we have. On a placeholder it is
    // taken on trust, which is the whole point of a placeholder.
    if (source.index !== null && !registry[source.module.type].outlets.some((p) => p.id === fromPort)) {
      drop(`${source.module.type} has no outlet "${fromPort}"`)
      continue
    }
    if (dest.index !== null && !registry[dest.module.type].inlets.some((p) => p.id === toPort)) {
      drop(`${dest.module.type} has no inlet "${toPort}"`)
      continue
    }
    // Into a placeholder. Kept in the patch, no effect on the plan; the placeholder note
    // already says why.
    if (dest.index === null) continue

    const k = key(toId, toPort)
    const previous = inletSource.get(k)
    if (previous) {
      const old = replaced.get(k)
      if (old) {
        notes.push({
          kind: 'replaced-cable',
          cable: old,
          detail: `one cable per inlet: superseded by a later cable into ${toId}.${toPort}`,
        })
      }
      replaced.set(k, cable)
    } else {
      replaced.set(k, cable)
    }
    inletSource.set(k, {
      // From a placeholder is silence rather than a dropped cable, so the patch keeps its
      // shape and only loses its sound.
      buffer: source.index === null ? ZERO : outletBuffer.get(key(fromId, fromPort)) ?? ZERO,
      from: source.index,
      to: dest.index,
      toId,
      toPort,
    })
  }

  // ---- Order ---------------------------------------------------------------------------
  //
  // Kahn's algorithm, taking the lowest-numbered ready module each time so the order is a
  // function of the patch alone — two hosts compiling the same patch must agree, or a
  // shared URL is not a shared sound.
  //
  // When nothing is ready and modules remain, there is a cycle. Force the lowest-numbered
  // one out and carry on. That is all cycle breaking is here: the cables it could not
  // satisfy end up pointing backwards in the order, and a module that runs before its
  // source reads the buffer the source wrote LAST block. No special buffer, no copy — the
  // buffers simply are not cleared between blocks, so the delay falls out of the ordering
  // for free. It is one render quantum, 2.9ms at 44.1kHz, and it is what Reason did.

  const successors: number[][] = live.map(() => [])
  const indegree = live.map(() => 0)
  const edges = new Set<string>()

  for (const source of inletSource.values()) {
    const to = source.to
    if (source.from === null || source.from === to) continue
    const edge = `${source.from}>${to}`
    if (edges.has(edge)) continue
    edges.add(edge)
    successors[source.from].push(to)
    indegree[to]++
  }

  const order: number[] = []
  const done = live.map(() => false)
  while (order.length < live.length) {
    let pick = -1
    for (let i = 0; i < live.length; i++) {
      if (!done[i] && indegree[i] === 0) {
        pick = i
        break
      }
    }
    if (pick === -1) {
      for (let i = 0; i < live.length; i++) {
        if (!done[i]) {
          pick = i
          break
        }
      }
    }
    done[pick] = true
    order.push(pick)
    for (const next of successors[pick]) if (!done[next]) indegree[next]--
  }

  const position = live.map(() => 0)
  order.forEach((module, at) => {
    position[module] = at
  })

  // ---- Params --------------------------------------------------------------------------
  //
  // Slots are allocated in patch order rather than execution order, so that adding a cable
  // — which can reorder execution — does not renumber every knob the host is holding.

  const params: PlanParam[] = []
  const slots: Record<string, Record<string, number>> = {}
  for (const module of live) {
    const def = registry[module.type]
    const saved = migrated(module, def, notes)
    const mine: Record<string, number> = {}
    for (const param of def.params) {
      mine[param.id] = params.length
      params.push({
        value: clamp(saved[param.id], param.min, param.max, param.default),
        stepped: param.stepped === true,
      })
    }
    slots[module.id] = mine
  }

  // ---- Nodes and output ----------------------------------------------------------------

  const nodes: PlanNode[] = order.map((index) => {
    const module = live[index]
    const def = registry[module.type]
    return {
      id: module.id,
      type: module.type,
      inlets: def.inlets.map((port) => inletSource.get(key(module.id, port.id))?.buffer ?? ZERO),
      outlets: def.outlets.map((port) => outletBuffer.get(key(module.id, port.id)) ?? ZERO),
      params: def.params.map((param) => slots[module.id][param.id]),
      poly: def.poly !== false,
    }
  })

  const outputs: number[] = []
  for (const module of live) {
    const def = registry[module.type]
    if (!def.terminal) continue
    const port = def.outlets[0]
    if (!port) continue
    const buffer = outletBuffer.get(key(module.id, port.id))
    if (buffer !== undefined) outputs.push(buffer)
  }

  // Delayed cables, worked out from the finished order. A cable is delayed when its source
  // runs after its destination, or when it feeds the module it came from.
  for (const [k, source] of inletSource) {
    if (source.from === null) continue
    if (source.from !== source.to && position[source.from] < position[source.to]) continue
    notes.push({
      kind: 'delayed',
      cable: replaced.get(k),
      module: source.toId,
      detail: `feedback into ${source.toId}.${source.toPort}: delayed by one block to break the cycle`,
    })
  }

  // 1 to 8. Clamped here so that no later stage has to guard against a patch asking for nine hundred, and
  // rounded because a plan with 2.5 voices is not a thing the Graph should have to have an opinion about.
  const voices = Math.max(1, Math.min(8, Math.round(clamp(patch?.voices, 1, 8, 1))))

  return { buffers, voices, poly: bufferPoly, nodes, outputs, params, slots, notes }
}
