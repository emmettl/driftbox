import { compile } from './compile.js'
import { Graph } from './graph.js'
import type { MeterReading, Patch, Plan, PlanNote, Registry } from './types.js'

// The rack with no browser under it at all.
//
// There were two hosts before this one and both of them are Web Audio: `Rack` wraps an
// `AudioWorkletNode` on a live context, and `renderPatch` does the same on an `OfflineAudioContext`. Neither
// is reachable from a game server, a Node process, a worker in a runtime with no audio, or anything
// embedding a JS engine to make sound with — and the awkward part was that the rack could already do it.
// `Graph` is arithmetic over `Float32Array`s: `graph.test.ts` has run the whole thing in Node since the
// first week, measuring the samples that came out.
//
// So the capability existed and only the *API* did not. An embedder following the tests had to reach for
// `Graph` and `compile`, which `index.ts` lists in the tier it explicitly does not promise, and to
// reassemble the registry into the `{modules, deps}` shape the Graph wants — a detail of how the worklet is
// built that nobody outside should have to know. This file is that path, made supported.
//
// **It is not a second engine, and that is the property worth defending.** The same `compile` produces the
// plan, the same module processors run it, and the same `Graph` walks it. `worklet.test.ts` already pins
// that the assembled worklet source produces the same samples as the graph running in-process, so all three
// hosts are the same arithmetic reached three ways. A fourth implementation of the DSP for headless use
// would have been the obvious build and would have started drifting immediately.
//
// **What it does not carry is the groovebox.** A patch's 808, 909 and 303s arrive on the host inputs from
// `@driftbox/engine`, whose renderer is Web Audio from end to end — so headless you get the rack's own
// modules and not the drum machines, and a Sampler patch gets whatever break the host feeds it rather than
// the ones `app/src/rack/breaks.ts` synthesises through the engine. `hostInputs` on `process` is the seam:
// anything that can produce blocks of samples can fill them.

/** Where a renderer's clock starts and how big a block it works in. */
export interface RackRendererOptions {
  sampleRate?: number
  /**
   * Samples per block. 128 is the render quantum a browser would use and the size every module was written
   * and measured against; a host with its own buffer size can say so instead, and the Graph reallocates.
   *
   * Larger blocks are cheaper per sample and coarser in one specific way worth knowing: an unscheduled
   * `setParam` ramps across exactly one block, so at 1024 a knob move takes 21ms to arrive rather than 2.7.
   * `scheduleParam` is unaffected — it lands on the sample asked for either way.
   */
  frames?: number
}

/** Blocks of audio, as a host that has to write a file or fill a ring buffer wants them. */
export interface RenderedAudio {
  sampleRate: number
  /** Frames per channel. */
  length: number
  /** Left and right. Stereo because the rack's output is — see the pan law in `graph.ts`. */
  channels: Float32Array[]
}

/**
 * A rack that renders into buffers you own.
 *
 * The method names are `Rack`'s deliberately, so moving a piece of host code between the two is a change of
 * constructor and nothing else. What it adds is `process`, and what it drops is everything that only means
 * something on a Web Audio graph: there is no node to connect, no worklet to load and therefore no `start()`
 * that can fail.
 *
 * The registry is the first argument and is required, for the bundle-size reason written out at `Rack` — a
 * default would be a static reference to the whole module set, and every consumer would carry all of it.
 *
 * ```js
 * const renderer = new RackRenderer(MODULES, { sampleRate: 48000 })
 * ```
 */
export class RackRenderer {
  readonly sampleRate: number
  private readonly registry: Registry
  private readonly graph: Graph
  private current: Patch = { modules: [], cables: [] }
  private compiled: Plan | null = null
  private tempoValue = 120
  private runningValue = false
  private frames: number
  /**
   * Musical position, in beats, tracked on this side.
   *
   * The Graph accumulates its own and hands it to the modules, but does not expose it — and an adaptive
   * score needs to know where the bar line is, which is the whole reason `Adaptive.update` takes a beat.
   * Accumulated per block from the tempo in force during that block, exactly as the Graph does it, rather
   * than derived from total elapsed samples: multiplying total seconds by the current tempo would move
   * every position already passed the moment somebody changed tempo. `app/src/rack/playhead.ts` learned
   * that the same way.
   */
  private beats = 0
  /** Frames handed out so far, which is this host's clock. See `time`. */
  private rendered = 0

  constructor(registry: Registry, options: RackRendererOptions = {}) {
    this.sampleRate = options.sampleRate ?? 48000
    this.frames = Math.max(1, Math.round(options.frames ?? 128))
    this.registry = registry

    // The shape the Graph wants: processors by type, and every dependency any module declared, merged and
    // keyed by string. In the worklet this is what `rackSource` writes into the assembled source; here it
    // is built directly, and it is the piece of plumbing this class exists to stop leaking.
    const modules: Record<string, Registry[string]['processor']> = {}
    const deps: Record<string, unknown> = {}
    for (const def of Object.values(this.registry)) {
      modules[def.type] = def.processor
      for (const [name, dep] of Object.entries(def.deps ?? {})) deps[name] = dep
    }
    this.graph = new Graph(this.sampleRate, this.frames, modules, deps)
  }

  get patch(): Patch {
    return this.current
  }

  /** Replace the patch. Compiles immediately and takes effect on the next `process`. */
  set patch(patch: Patch) {
    this.current = patch
    this.compiled = compile(patch, this.registry)
    this.graph.setPlan(this.compiled)
  }

  /** The compiled plan, for a host that wants to see what the compiler decided. */
  get plan(): Plan | null {
    return this.compiled
  }

  /** Cables delayed to break a cycle, modules this build does not have, cables dropped. Same contract as
   *  `Rack.notes`, minus the worklet's report — nothing here can be assembled from a different module set
   *  than the one that compiled the plan, because it is the same object. */
  get notes(): PlanNote[] {
    return this.compiled ? [...this.compiled.notes] : []
  }

  /** How many voices the open patch compiled to. */
  get voices(): number {
    return this.compiled?.voices ?? 1
  }

  /**
   * Move a knob. Silently does nothing for a param the current patch does not have, which is what a host
   * holding a stale reference across a patch change will do.
   *
   * The value ramps across the block that follows, so this does not click — and so a caller updating faster
   * than block rate is only overwriting a target nothing has read yet. `Adaptive` throttles for that reason.
   */
  setParam(moduleId: string, paramId: string, value: number, voice?: number): void {
    const slot = this.compiled?.slots[moduleId]?.[paramId]
    if (slot === undefined) return
    this.graph.setParam(slot, value, voice)
  }

  /**
   * Move a knob at a moment. `frame` counts samples from the start of this renderer's clock — use
   * `frameFor` — and a frame already gone by applies at once rather than being dropped.
   *
   * Unlike `Rack`, nothing needs holding until a node exists: there is no thread to race, so a change
   * scheduled before the first `process` is simply a change scheduled in the future.
   */
  scheduleParam(
    moduleId: string,
    paramId: string,
    value: number,
    frame: number,
    voice?: number,
  ): void {
    const slot = this.compiled?.slots[moduleId]?.[paramId]
    if (slot === undefined) return
    this.graph.setParam(slot, value, voice, frame)
  }

  /** A time in seconds, as the frame this renderer will call it. The same contract as `Rack.frameFor`. */
  frameFor(when: number): number {
    if (!Number.isFinite(when)) return 0
    return Math.max(0, Math.round(when * this.sampleRate))
  }

  /**
   * Hand a module some bulk data — a sample buffer.
   *
   * **Not transferred, unlike `Rack.setData`**, because there is no thread to transfer it to. The array is
   * kept by reference and stays usable here, which means a caller that goes on to mutate it is editing what
   * the Sampler is playing mid-note. Copy first if that is not what you meant.
   */
  setData(moduleId: string, slot: string, data: Float32Array): void {
    this.graph.setData(moduleId, slot, data)
  }

  /** Set the tempo and whether the transport is running. Starting from a stop rewinds the position, which
   *  is what the Graph does with its own — the two must not disagree about where bar one is. */
  setTransport(tempo: number, running: boolean, shuffle = 0): void {
    if (Number.isFinite(tempo) && tempo > 0) this.tempoValue = Math.max(20, Math.min(400, tempo))
    if (running && !this.runningValue) this.beats = 0
    this.runningValue = running
    this.graph.setTransport(tempo, running, shuffle)
  }

  get tempo(): number {
    return this.tempoValue
  }

  get running(): boolean {
    return this.runningValue
  }

  /** Where the transport is, in beats since it started. Zero while stopped, and it does not jump when the
   *  tempo changes. This is what an adaptive score quantises its bar lines against. */
  get beat(): number {
    return this.beats
  }

  /**
   * This host's clock, in seconds — how much audio has been rendered.
   *
   * Unlike `beat` it advances whether or not the transport is running, because it is a clock rather than a
   * position in the music. `frameFor` converts against it, and `LanePlayer` schedules against both.
   */
  get time(): number {
    return this.rendered / this.sampleRate
  }

  /** Read the patch's meter modules. Free of the worklet's opt-in message, because there is no channel to
   *  keep quiet: reading them costs a walk of the nodes and nothing else. */
  meters(): MeterReading[] {
    return this.graph.meters()
  }

  /**
   * Render one block into the channels handed in.
   *
   * The block size follows the arrays: hand it 256-frame channels and the graph reallocates to match, the
   * same way the worklet's would if a browser ever changed its render quantum. `hostInputs` is
   * `[input][channel]` and is how anything outside — an engine, a game's own synth, a decoded stream —
   * reaches a patch's source modules.
   */
  process(channels: Float32Array[], hostInputs: Float32Array[][] = []): void {
    const frames = channels[0]?.length ?? this.frames
    this.frames = frames
    this.graph.process(channels, hostInputs)
    this.rendered += frames
    if (this.runningValue) this.beats += (frames * this.tempoValue) / (60 * this.sampleRate)
  }

  /**
   * Render a stretch of audio in one call, for a host that wants a file rather than a stream.
   *
   * `onBlock` runs before each block with the position that block starts at, which is where a caller drives
   * an adaptive score, moves a knob or advances its own clock. Without it an offline render could only be
   * the patch playing itself, which is what `renderPatch` already does in a browser.
   */
  render(seconds: number, onBlock?: (at: { frame: number; beat: number }) => void): RenderedAudio {
    const length = Math.max(0, Math.round(seconds * this.sampleRate))
    const left = new Float32Array(length)
    const right = new Float32Array(length)
    const block = [new Float32Array(this.frames), new Float32Array(this.frames)]

    for (let frame = 0; frame < length; frame += this.frames) {
      onBlock?.({ frame, beat: this.beats })
      this.process(block)
      // The last block runs whole and is clipped on the way out, rather than being rendered short: a
      // shorter block would make the Graph reallocate every buffer in the patch for one block of audio.
      const take = Math.min(this.frames, length - frame)
      left.set(take === this.frames ? block[0] : block[0].subarray(0, take), frame)
      right.set(take === this.frames ? block[1] : block[1].subarray(0, take), frame)
    }

    return { sampleRate: this.sampleRate, length, channels: [left, right] }
  }
}
