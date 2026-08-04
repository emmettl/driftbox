import { applyModulation } from './modulation.js'
import { channelCount, wire } from './stereo.js'
import type {
  PlanOutput,
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
 * Eight played notes through an eight-lane chord expander. Bounded here, where graph shape is decided, so a
 * chain of expanders cannot accidentally turn one key into hundreds of audio-thread processors.
 */
const MAX_RENDER_VOICES = 64

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
export function compile(rawPatch: Patch, registry: Registry): Plan {
  const notes: PlanNote[] = []
  // Combinator routings, applied before anything else looks at a param.
  //
  // Here rather than only in the host, because a patch does not have to come from a host: a shipped preset,
  // a link opened by a headless consumer and an offline render all reach this function without a knob ever
  // having been turned. Applying it here is what makes "what a patch sounds like" a property of the patch
  // rather than of the page that happened to open it. The app applies it too, so the target knob is seen to
  // move — same function, so the two cannot disagree. See `modulation.ts`.
  const patch = applyModulation(rawPatch, registry)
  const modules = Array.isArray(patch?.modules) ? patch.modules : []
  const cables = Array.isArray(patch?.cables) ? patch.cables : []
  // The performed voice count. Expanded streams can be wider, but a keyboard still addresses these base
  // voices and an old patch still means exactly one.
  const voices = Math.max(1, Math.min(8, Math.round(clamp(patch?.voices, 1, 8, 1))))

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

  /** Per outlet, the buffers it owns: one, or two for a stereo port. See `stereo.ts`. */
  const outletBuffer = new Map<string, number[]>()
  /** Per buffer: is it written per voice? Index 0 is the zero buffer, which belongs to nobody and is read by
   *  every unconnected inlet of every voice — mono is the only answer that makes sense for it. */
  const bufferPoly: boolean[] = [false]
  const bufferOwner: number[] = [-1]
  let buffers = 1
  for (let moduleIndex = 0; moduleIndex < live.length; moduleIndex++) {
    const module = live[moduleIndex]
    const def = registry[module.type]
    // A buffer is polyphonic exactly when the module writing it is. Recorded here rather than worked out on
    // the audio thread, because a question `process()` has to answer at run time is one it can get wrong.
    const poly = def.poly !== false
    for (const port of def.outlets) {
      // Consecutive, so that a stereo port's two buffers are as cheap to talk about as one — and so that
      // widening a port later moves only the numbers after it rather than reshaping the plan.
      const channels: number[] = []
      for (let channel = 0; channel < channelCount(port); channel++) {
        bufferPoly[buffers] = poly
        bufferOwner[buffers] = moduleIndex
        channels.push(buffers)
        buffers++
      }
      outletBuffer.set(key(module.id, port.id), channels)
    }
  }

  // ---- Cables --------------------------------------------------------------------------
  //
  // One cable per inlet, and the last one wins — which is what happens when you drag a
  // cable onto an occupied input in Reason. Summing instead would make every inlet a
  // hidden mixer; the Mixer module is the visible one.

  interface Source {
    /** The buffers the source port writes: one, or two when it is stereo. */
    channels: number[]
    /** null when the cable comes from a placeholder. */
    from: number | null
    /** The cable's own endpoints, kept so bypass can be walked back through them. */
    fromId: string
    fromPort: string
    /** The destination, carried rather than parsed back out of the map key. Deriving it from
     *  the key means the key format is load-bearing in two places, and it is exactly the kind
     *  of coupling that made a NUL separator look load-bearing when it was an accident. */
    to: number
    toId: string
    toPort: string
  }
  const inletSource = new Map<string, Source>()
  const replaced = new Map<string, PatchCable>()
  /** Valid cables into placeholders have no inlet source entry but remain physically present in the patch. */
  const placeholderOutletConnections = new Set<string>()

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
    if (dest.index === null) {
      placeholderOutletConnections.add(key(fromId, fromPort))
      continue
    }

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
      channels: source.index === null ? [ZERO] : (outletBuffer.get(key(fromId, fromPort)) ?? [ZERO]),
      from: source.index,
      fromId,
      fromPort,
      to: dest.index,
      toId,
      toPort,
    })
  }

  // Only the winning cable into a live inlet counts. A cable to a placeholder also counts because the cable
  // is deliberately preserved, even though this build cannot construct its destination.
  const connectedOutlets = new Set(placeholderOutletConnections)
  for (const source of inletSource.values()) connectedOutlets.add(key(source.fromId, source.fromPort))

  // ---- Bypass --------------------------------------------------------------------------
  //
  // A bypassed module is not processed at all — it gets no node, so its CPU is genuinely freed, which is
  // most of what makes bypassing something like the Vocoder worth doing. What answers for its outlets is
  // this pass: anything reading one of them is redirected to whatever reaches that module's FIRST inlet.
  //
  // **All of its outlets carry the same signal**, and the tidier-looking alternative is nonsense on a real
  // module. Pairing outlet *n* with inlet *n* would put a cutoff CV on the SVF's highpass jack, because
  // that module's second inlet is a control voltage. The first inlet is the signal path on every module
  // here, by convention, and bypass is a statement about the signal path.
  //
  // Resolution happens here, before the ordering, so everything downstream — the topological sort, the
  // delayed-cable notes, the mono-fold notes — sees the real source rather than the one the cable names.
  // Otherwise a bypassed module in the middle of a chain would still constrain the order, and could report
  // a feedback delay that no longer exists.

  const bypassed = (index: number | null): boolean => index !== null && live[index].bypassed === true

  /** What a port really carries, having walked back through any bypassed modules in front of it. */
  const resolve = (
    fromId: string,
    fromPort: string,
    seen: Set<string>,
  ): { channels: number[]; from: number | null } => {
    const entry = entries.get(fromId)
    if (!entry || entry.index === null) return { channels: [ZERO], from: null }
    if (!bypassed(entry.index)) {
      return { channels: outletBuffer.get(key(fromId, fromPort)) ?? [ZERO], from: entry.index }
    }
    // A ring of bypassed modules has nothing at the end of it to read. Silence rather than a throw or a
    // stack overflow: this is a patch from outside the program, and the placeholder rule's standard —
    // neutralise, never crash — applies to every other malformed thing in this file too.
    if (seen.has(fromId)) return { channels: [ZERO], from: null }
    seen.add(fromId)

    const first = registry[entry.module.type].inlets[0]
    if (!first) return { channels: [ZERO], from: null }
    const feeding = inletSource.get(key(fromId, first.id))
    if (!feeding) return { channels: [ZERO], from: null }
    return resolve(feeding.fromId, feeding.fromPort, seen)
  }

  for (const source of inletSource.values()) {
    const resolved = resolve(source.fromId, source.fromPort, new Set())
    source.channels = resolved.channels
    source.from = resolved.from
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

  // ---- Voice widths --------------------------------------------------------------------
  //
  // The old graph had one bit per buffer: mono, or exactly `patch.voices`. Keep that bit for old readers and
  // add the actual width beside it. Ordinary polyphonic modules inherit the widest stream reaching them;
  // an expander multiplies that stream by a whole number of child lanes. This is the honest representation
  // of a chord — several pitch buffers — and it lets every downstream VCO/filter/envelope stay unchanged.
  //
  // Repeated to a fixed point because a delayed feedback cable can point backwards in execution order. Widths
  // only grow from the performed count and are bounded at forty, so this always settles quickly.
  const moduleVoices = live.map((module) => registry[module.type].poly === false ? 1 : voices)
  const moduleLanes = live.map(() => 1)
  const sourceWidth = (index: number): number => {
    const owner = bufferOwner[index]
    return owner === undefined || owner < 0 ? 1 : moduleVoices[owner]
  }

  for (let pass = 0; pass < MAX_RENDER_VOICES; pass++) {
    let changed = false
    for (const index of order) {
      const module = live[index]
      const def = registry[module.type]
      if (def.poly === false) continue
      let incoming = voices
      for (const inlet of def.inlets) {
        const source = inletSource.get(key(module.id, inlet.id))
        for (const channel of source?.channels ?? [ZERO]) incoming = Math.max(incoming, sourceWidth(channel))
      }
      const asked = Math.max(1, Math.min(8, Math.round(def.voiceExpansion ?? 1)))
      // Never allocate a partial lane set: every source voice either gets the same chord or the expander is
      // held at its input width. That makes the bound musically predictable and prevents later source voices
      // from disappearing merely because earlier ones consumed the remaining slots.
      const lanes = incoming * asked <= MAX_RENDER_VOICES ? asked : 1
      const width = incoming * lanes
      moduleLanes[index] = lanes
      if (width > moduleVoices[index]) {
        moduleVoices[index] = width
        changed = true
      }
    }
    if (!changed) break
  }

  const voiceWidths = Array.from({ length: buffers }, (_, buffer) => sourceWidth(buffer))
  for (let index = 0; index < live.length; index++) {
    const def = registry[live[index].type]
    const asked = Math.max(1, Math.min(8, Math.round(def.voiceExpansion ?? 1)))
    if (asked <= 1 || moduleLanes[index] === asked) continue
    notes.push({
      kind: 'voice-cap',
      module: live[index].id,
      detail: `${live[index].id} kept ${moduleVoices[index]} voices: another ${asked}-lane expansion would exceed ${MAX_RENDER_VOICES}`,
    })
  }

  // ---- Params --------------------------------------------------------------------------
  //
  // Slots are allocated in patch order rather than execution order, so that adding a cable
  // — which can reorder execution — does not renumber every knob the host is holding.

  const params: PlanParam[] = []
  const slots: Record<string, Record<string, number>> = {}
  const inputTrims: Record<string, Record<string, number>> = {}
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

  // ---- Input trims ---------------------------------------------------------------------
  //
  // **A slot only where the pot is doing something**, and the reason is that a slot is far from free. The
  // Graph gives a trimmed inlet a buffer of its own and multiplies it sample by sample, where an untrimmed
  // one simply points at the source's buffer — no copy, which is the property the whole graph is built
  // around. Allocating one for every inlet of every module meant every patch paid that on every inlet,
  // whether or not it was patched and whether or not anybody had ever turned the pot. Measured against
  // `graph.bench.ts`: 3–4% of render time on the small patches and about 5% on `pressure-system`, spent
  // almost entirely on multiplying by one.
  //
  // Two conditions, and both have to hold:
  //
  //   - **Something is patched to it.** Silence times any gain is silence, so an unpatched inlet, a cable
  //     from a module this build could not construct, and a cable that walked back through a ring of
  //     bypassed modules all need nothing. A trim set on an unpatched inlet is still kept in the patch and
  //     starts working the moment a cable arrives, which is what makes the pot belong to the jack rather
  //     than to the cable.
  //   - **The pot is off unity.** Unity is what the direct path already does, exactly, so paying a buffer
  //     and a multiply to reproduce it is the whole of the waste above.
  //
  // The cost of the second condition is honest and worth stating: **engaging a trim rebuilds the graph
  // once**, because a slot has to appear, and so does returning one to exactly unity. That is one click at
  // each end of a pot's travel, against 3–5% of every block for every patch that never touches one. Every
  // turn in between is a message to a slot that already exists, which is the property that mattered.
  //
  // Allocated in a **pass of its own, after every authored knob**. The loop above hands slots out in patch
  // order so that adding a cable — which reorders execution — renumbers nothing the host is holding, and
  // deciding a trim slot by what is patched puts cabling back into the numbering. Keeping them in their own
  // pass means a cable can only ever move other trims.
  for (const module of live) {
    const def = registry[module.type]
    const trims: Record<string, number> = {}
    for (const inlet of def.inlets) {
      const source = inletSource.get(key(module.id, inlet.id))
      if (!source || source.channels.every((channel) => channel === ZERO)) continue
      const wanted = clamp(module.inputTrims?.[inlet.id], -1, 1, 1)
      if (wanted === 1) continue
      trims[inlet.id] = params.length
      params.push({ value: wanted, stepped: false })
    }
    inputTrims[module.id] = trims
  }

  // ---- Nodes and output ----------------------------------------------------------------

  // A bypassed module gets no node: nothing runs it, and everything that read its outlets was pointed at
  // its input by the pass above.
  const nodes: PlanNode[] = order.filter((index) => !bypassed(index)).map((index) => {
    const module = live[index]
    const def = registry[module.type]
    return {
      id: module.id,
      type: module.type,
      // Slots, not ports: a stereo port occupies two consecutive entries, so a def declaring
      // `[in(stereo), cv]` produces three inlet buffers. `wire` is the whole of the mono/stereo mapping and
      // is total — an unconnected inlet arrives as the zero buffer and comes back as one or two of it.
      inlets: def.inlets.flatMap((port) =>
        wire(inletSource.get(key(module.id, port.id))?.channels ?? [ZERO], channelCount(port)),
      ),
      // Presence follows the cable, not its samples. A valid cable from a placeholder or a bypassed source
      // can resolve to the zero buffer and is still physically plugged in — the distinction devices with
      // normalled or arming jacks need. Stereo ports repeat the one jack fact for both processor slots.
      inletConnected: def.inlets.flatMap((port) =>
        Array.from({ length: channelCount(port) }, () => inletSource.has(key(module.id, port.id))),
      ),
      // One pot per physical inlet. A stereo inlet occupies two processor slots but has one pot, so both
      // channels read the same hidden param slot.
      // Sparse: an inlet with nothing patched to it, or a pot sitting at unity, has no slot — and
      // `undefined` is what tells the Graph to keep the direct buffer path, the same road a plan from
      // before trims existed takes.
      inletTrims: def.inlets.flatMap((port) =>
        Array.from({ length: channelCount(port) }, () => inputTrims[module.id][port.id]),
      ),
      outlets: def.outlets.flatMap((port) => outletBuffer.get(key(module.id, port.id)) ?? [ZERO]),
      outletConnected: def.outlets.flatMap((port) =>
        Array.from({ length: channelCount(port) }, () => connectedOutlets.has(key(module.id, port.id))),
      ),
      params: def.params.map((param) => slots[module.id][param.id]),
      poly: def.poly !== false,
      voices: moduleVoices[index],
      voiceLanes: moduleLanes[index],
      ...(def.poly === false && def.voiceCollector === true ? { collectVoices: true } : {}),
      // Carried through untouched. `compile` has no opinion about what a module's data means — it is the module
      // that knows whether a run of numbers is a pattern or a wavetable — and validating it here would need a
      // schema per module type, which is the sort of thing the placeholder rule exists to avoid.
      ...(module.data ? { data: module.data } : {}),
    }
  })

  const outputs: PlanOutput[] = []
  for (const module of live) {
    const def = registry[module.type]
    if (!def.terminal) continue
    // A bypassed terminal contributes nothing. Its outlet buffer is written by nobody — there is no node —
    // so summing it would put whatever was in that buffer last into the mix for ever.
    if (module.bypassed === true) continue
    const port = def.outlets[0]
    if (!port) continue
    const channels = outletBuffer.get(key(module.id, port.id))
    if (channels === undefined || channels[0] === undefined) continue
    // A slot, not a value: the Graph reads the pan buffer every sample, so turning the knob while the patch
    // runs works without recompiling — the same reason `setParam` does not bump the revision.
    const slot = (id: string | undefined) => (id ? (slots[module.id]?.[id] ?? null) : null)
    outputs.push({
      buffer: channels[0],
      // A stereo terminal reaches the mix as a pair, and its pan param then means balance rather than
      // placement — which is what a pan control on a stereo channel means on every mixer ever built.
      right: channels[1] ?? null,
      pan: slot(def.terminalPan),
      mute: slot(def.terminalMute),
      solo: slot(def.terminalSolo),
    })
  }

  // Cables that lost a channel. A stereo outlet reaching a mono inlet is heard as its left channel — see
  // `stereo.ts` for why that is the rule rather than a sum — and reporting it is the same obligation that
  // makes a delayed cable draw differently: a patch that behaves unlike its picture is worse than one that
  // admits it. Not a warning. Patching one side of a stereo pair into a filter is an ordinary thing to do.
  for (const [k, source] of inletSource) {
    if (source.channels.length < 2) continue
    const dest = live[source.to]
    const port = registry[dest.type].inlets.find((p) => p.id === source.toPort)
    if (!port || channelCount(port) > 1) continue
    notes.push({
      kind: 'mono-fold',
      cable: replaced.get(k),
      module: source.toId,
      detail: `${source.toId}.${source.toPort} is mono: the left channel is heard and the right is not`,
    })
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

  return { buffers, voices, poly: bufferPoly, voiceWidths, nodes, outputs, params, slots, inputTrims, notes }
}
