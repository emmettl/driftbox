import type { ModuleData, Plan, Processor, ProcessorClass, Transport } from './types.js'

// The audio thread. Walks a compiled plan, once per render quantum.
//
// This class is SELF-CONTAINED — no imports that survive compilation, no references to
// anything at module scope — because `worklet.ts` serialises it with toString() and
// evaluates it inside an AudioWorkletGlobalScope, which shares no scope with this module.
// Type-only imports are fine: they are erased. A value would be a ReferenceError at the
// moment the first patch loaded. `graph.test.ts` reproduces that scope exactly.
//
// It is also why this is testable. A Graph is arithmetic over Float32Arrays, so the tests
// run it in Node and measure what came out, the same trick `ladder.test.ts` uses one level
// further down.

/**
 * One module, once per voice — or once in total when the module is `poly: false`.
 *
 * `voices` is a list of what to hand each instance, rather than one set of buffers with an index into it,
 * because the four cases a polyphonic graph has to get right are all decided at *build* time:
 *
 *   consumer  source   the inlet gets
 *   --------  ------   ---------------------------------------------
 *   poly      poly     that voice's buffer
 *   poly      mono     the one buffer, the same for every voice
 *   mono      poly     a scratch holding every voice summed
 *   mono      mono     the one buffer
 *
 * Deciding them once and storing the answer keeps `process()` a list-walker. Deciding them per sample would
 * be four branches in the innermost loop in the program.
 */
interface Node {
  processor: Processor
  inlets: Float32Array[]
  outlets: Float32Array[]
  params: Float32Array[]
  /** Inlets that need summing before this instance runs, with the voice buffers to sum. Empty for a
   *  polyphonic module, which never collapses anything. */
  collapse: { into: Float32Array; from: Float32Array[] }[]
}

export class Graph {
  /** Module types the plan named that this build could not construct. Should always be
   *  empty — the compiler checked the host's registry — and will not be if the worklet was
   *  assembled from a different module set than the one that compiled the plan. */
  readonly missing: string[] = []

  private readonly sampleRate: number
  private readonly modules: Record<string, ProcessorClass>
  private readonly deps: Record<string, unknown>

  private frames: number
  private plan: Plan | null = null
  private voices = 1
  /** `[bufferIndex][voice]`. A mono buffer has one entry; a polyphonic one has `voices`. */
  private buffers: Float32Array[][] = []
  /** Where an outlet with no allocated buffer writes. Insurance: it means no module can
   *  write into buffer 0 and invent a signal for every unconnected inlet at once. */
  private scratch: Float32Array
  private nodes: Node[] = []
  private outputs: Float32Array[] = []

  /** `[slot][voice]`. A knob writes every voice; MIDI writes one — which is the whole reason a param is
   *  per-voice rather than shared, and the one addition polyphony needed to the message ABI. */
  /**
   * Where the transport is. Accumulated per block rather than derived from an absolute frame count, so changing
   * the tempo mid-bar carries on from where the music was rather than jumping to wherever the new arithmetic
   * lands.
   */
  private tempo = 120
  private running = false
  private beat = 0

  /**
   * Bulk data, in two layers on purpose.
   *
   * `pushed` came from `setData` — a sample buffer — and **survives a rebuild**, because it is not part of the
   * patch and recompiling must not throw away a break somebody loaded. `seeded` came from the plan — a
   * pattern — and is replaced every build, because there it *is* the document. `pushed` wins where both have a
   * slot, which is only reachable if a module accepts the same data from either source.
   */
  private pushed = new Map<string, Map<string, Float32Array>>()
  private seeded = new Map<string, Map<string, Float32Array>>()

  private paramBuffers: Float32Array[][] = []
  private values: Float32Array[] = []
  private targets: Float32Array[] = []
  private stepped = new Uint8Array(0)
  /** Set for one block after a param ramped, so the buffer is flattened back to a constant
   *  next block. Without it the ramp would be replayed for as long as the knob sat still. */
  private ramped: Uint8Array[] = []

  constructor(
    sampleRate: number,
    frames: number,
    modules: Record<string, ProcessorClass>,
    deps: Record<string, unknown>,
  ) {
    this.sampleRate = sampleRate
    this.frames = frames > 0 ? frames : 128
    this.modules = modules
    this.deps = deps
    this.scratch = new Float32Array(this.frames)
  }

  /** Apply a plan. Module state does not survive this: a patch edit rebuilds every
   *  processor, so a filter's history and an oscillator's phase both restart. Preserving
   *  them across an edit is a real feature and a later one — it needs identity for a
   *  module across two plans, which the compiler does not currently carry. */
  setPlan(plan: Plan): void {
    this.plan = plan
    this.build(false)
  }

  /**
   * Aim a param at a new value. It arrives over the block that follows, ramped, so a knob turn does not
   * click. Nothing here is scheduled against a frame yet — that is what sample-accurate automation will
   * need, and it is not needed to make a sound.
   *
   * `voice` undefined means every voice, which is what a knob means: one knob, one value, all eight notes.
   * A specific voice is what a keyboard means — that is how eight MIDI modules hold eight different notes,
   * and it is the only thing polyphony added to the message ABI.
   */
  setParam(slot: number, value: number, voice?: number): void {
    const perVoice = this.targets[slot]
    if (!perVoice) return
    if (!Number.isFinite(value)) return
    if (voice === undefined) {
      perVoice.fill(value)
      return
    }
    if (voice < 0 || voice >= perVoice.length) return
    perVoice[voice] = value
  }

  /** Where the transport is now. Tempo may change while running; position does not jump when it does. */
  setTransport(tempo: number, running: boolean): void {
    if (Number.isFinite(tempo) && tempo > 0) this.tempo = Math.max(20, Math.min(400, tempo))
    // Restarting from a stop rewinds; changing tempo while running does not.
    if (running && !this.running) this.beat = 0
    this.running = running
  }

  /**
   * Hand a module some bulk data. Survives a patch edit, because it is not part of the patch.
   *
   * The array is kept by reference and never copied — the host transferred it across `postMessage`, so this
   * side owns it and a copy here would undo the point of transferring it.
   */
  setData(module: string, slot: string, data: Float32Array): void {
    const forModule = this.pushed.get(module) ?? new Map<string, Float32Array>()
    forModule.set(slot, data)
    this.pushed.set(module, forModule)
  }

  /** Sum the rack into every channel it was handed. Mono for now: a stereo signal path is
   *  a decision about what a cable is, and this is not the place to take it quietly. */
  process(channels: Float32Array[]): void {
    const mix = channels[0]
    if (!mix) return
    if (mix.length !== this.frames) {
      this.frames = mix.length > 0 ? mix.length : this.frames
      if (this.plan) this.build(true)
    }
    const frames = this.frames

    for (let slot = 0; slot < this.paramBuffers.length; slot++) {
      const perVoice = this.paramBuffers[slot]
      const stepped = this.stepped[slot]
      for (let voice = 0; voice < perVoice.length; voice++) {
        const buffer = perVoice[voice]
        const target = this.targets[slot][voice]
        const value = this.values[slot][voice]
        if (value === target) {
          if (this.ramped[slot][voice]) {
            buffer.fill(target)
            this.ramped[slot][voice] = 0
          }
          continue
        }
        if (stepped) {
          buffer.fill(target)
        } else {
          const step = (target - value) / frames
          for (let i = 0; i < frames; i++) buffer[i] = value + step * (i + 1)
          this.ramped[slot][voice] = 1
        }
        this.values[slot][voice] = target
      }
    }

    // One transport view per block, shared by every module that reads it — which is one of them.
    const transport: Transport = {
      tempo: this.tempo,
      running: this.running,
      beat: this.beat,
      // Zero while stopped, because no beats pass in a block during which nothing is playing. Reporting the
      // running figure regardless was a real bug: a module interpolating position across the block then crept
      // forward and snapped back every block, so a stopped bar ramp wobbled instead of holding still. `tempo` is
      // still here for anything that wants a synced time while stopped.
      beatsPerBlock: this.running ? (frames * this.tempo) / (60 * this.sampleRate) : 0,
    }
    this.beat += transport.beatsPerBlock

    for (const node of this.nodes) {
      // The collapse: every voice of a polyphonic outlet summed into one buffer before a module that runs
      // once reads it. Done here rather than in the module, because a module has no idea how many voices
      // exist and should not have to.
      for (const { into, from } of node.collapse) {
        into.set(from[0])
        for (let source = 1; source < from.length; source++) {
          const other = from[source]
          for (let i = 0; i < frames; i++) into[i] += other[i]
        }
      }
      node.processor.process(node.inlets, node.outlets, node.params, frames, transport)
    }

    if (this.outputs.length === 0) {
      for (let c = 0; c < channels.length; c++) channels[c].fill(0)
      return
    }
    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (let o = 0; o < this.outputs.length; o++) sum += this.outputs[o][i]
      // A modular can produce an infinity — patching an output back into its own input is
      // what that is for. A NaN reaching an AudioNode silences that node for the lifetime
      // of the context, so the tab would go quiet for good and a reload would be the only
      // way back. This keeps the rack alive. It does NOT rescue a module that has gone
      // unstable: that patch will sound wrong until it is unpatched, which is the correct
      // outcome and the audible sign that something is.
      mix[i] = Number.isFinite(sum) ? (sum > 4 ? 4 : sum < -4 ? -4 : sum) : 0
    }
    for (let c = 1; c < channels.length; c++) channels[c].set(mix)
  }

  /** A live view of one module's bulk data. Pushed wins over seeded; see the note on those fields. */
  private dataFor(module: string): ModuleData {
    return {
      get: (slot) => this.pushed.get(module)?.get(slot) ?? this.seeded.get(module)?.get(slot),
    }
  }

  /** Allocate everything the plan describes. `keepParams` carries the live knob positions
   *  across a re-allocation, which is what a change of render quantum needs — the plan's
   *  own values are where the patch was saved, not where the user has moved it since. */
  private build(keepParams: boolean): void {
    const plan = this.plan
    if (!plan) return
    this.missing.length = 0
    this.scratch = new Float32Array(this.frames)
    this.voices = Math.max(1, Math.min(8, Math.round(plan.voices || 1)))

    // Patch data is the document, so it is replaced wholesale each build. Pushed data is not, so it is left
    // alone — recompiling a patch must not throw away a sample somebody loaded into it.
    this.seeded = new Map()
    for (const node of plan.nodes) {
      if (!node.data) continue
      const forModule = new Map<string, Float32Array>()
      for (const [slot, values] of Object.entries(node.data)) {
        if (Array.isArray(values)) forModule.set(slot, Float32Array.from(values))
      }
      if (forModule.size > 0) this.seeded.set(node.id, forModule)
    }

    // A polyphonic buffer gets one array per voice; a mono one gets a single array that every voice reads.
    // `plan.poly` says which is which, worked out by the compiler from who writes each buffer.
    this.buffers = []
    for (let i = 0; i < plan.buffers; i++) {
      const wide = plan.poly?.[i] ? this.voices : 1
      this.buffers.push(Array.from({ length: wide }, () => new Float32Array(this.frames)))
    }

    const count = plan.params.length
    const previous = keepParams && this.targets.length === count ? this.targets : null
    this.paramBuffers = []
    this.values = []
    this.targets = []
    this.stepped = new Uint8Array(count)
    this.ramped = []
    for (let i = 0; i < count; i++) {
      const saved = plan.params[i].value
      const values = new Float32Array(this.voices)
      const targets = new Float32Array(this.voices)
      for (let voice = 0; voice < this.voices; voice++) {
        // A knob position survives a re-allocation; a voice added by a change of count starts where the
        // patch says. `previous[i]` may be narrower than the new voice count, hence the fallback.
        const value = previous?.[i]?.[voice] ?? saved
        values[voice] = value
        targets[voice] = value
      }
      this.values.push(values)
      this.targets.push(targets)
      this.stepped[i] = plan.params[i].stepped ? 1 : 0
      this.ramped.push(new Uint8Array(this.voices))
      this.paramBuffers.push(
        Array.from({ length: this.voices }, () => new Float32Array(this.frames).fill(values[0])),
      )
    }

    // A buffer index the plan does not have reads as silence rather than crashing. The plan crossed
    // postMessage and may have been written by a build that is not this one.
    const at = (index: number, voice: number): Float32Array => {
      const perVoice = this.buffers[index]
      if (!perVoice) return this.scratch
      return perVoice[perVoice.length === 1 ? 0 : voice] ?? perVoice[0]
    }

    this.nodes = []
    for (const node of plan.nodes) {
      const Constructor = this.modules[node.type]
      if (!Constructor) {
        this.missing.push(node.type)
        continue
      }
      const poly = node.poly !== false
      const instances = poly ? this.voices : 1

      for (let voice = 0; voice < instances; voice++) {
        const collapse: Node['collapse'] = []
        const inlets = node.inlets.map((index) => {
          if (poly) return at(index, voice)
          const perVoice = this.buffers[index]
          // Mono module, polyphonic source: this is the collapse. A scratch buffer per inlet, summed before
          // the module runs — a module has no idea how many voices exist and should not have to.
          if (perVoice && perVoice.length > 1) {
            const into = new Float32Array(this.frames)
            collapse.push({ into, from: perVoice })
            return into
          }
          return at(index, 0)
        })

        this.nodes.push({
          // Voice 0 keeps the plain module id, so a one-voice patch sounds exactly as it did before
          // polyphony existed — which matters because anything random in the rack seeds from this. Later
          // voices get a suffix, so eight Noise modules are eight different noises rather than one 18dB
          // louder.
          processor: new Constructor(
            this.sampleRate,
            this.deps,
            voice === 0 ? node.id : `${node.id}#${voice}`,
            // A live view rather than a snapshot, because data can arrive long after the graph was built —
            // somebody loads a break into a patch that is already playing. Every voice of a module shares it.
            this.dataFor(node.id),
          ),
          inlets,
          outlets: node.outlets.map((index) =>
            index > 0 ? at(index, voice) : this.scratch,
          ),
          params: node.params.map(
            (slot) => this.paramBuffers[slot]?.[poly ? voice : 0] ?? this.scratch,
          ),
          collapse,
        })
      }
    }

    // Every voice of every terminal outlet. An Out is `poly: false`, so in practice this is one buffer per
    // Out — but a polyphonic terminal module would still work, and summing all its voices is right.
    this.outputs = plan.outputs
      .filter((index) => index > 0)
      .flatMap((index) => this.buffers[index] ?? [])
  }
}
