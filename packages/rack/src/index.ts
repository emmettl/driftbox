import { compile } from './compile.js'
import type { MeterReading, Patch, Plan, PlanNote, Registry } from './types.js'
import { RACK_PROCESSOR, loadRack } from './worklet.js'

// A modular synth rack: modules, cables between any of them, and one graph running at
// sample rate inside a single AudioWorklet.
//
// `docs/RACK.md` is the design and the reasoning. The short version of why this is not part
// of `@driftbox/engine`: that engine is trigger-shaped — a voice is a pure function from
// knobs to a spec, rendered into fresh Web Audio nodes per hit — and a rack is a persistent
// graph where anything modulates anything at audio rate. Two engines, one host, summing into
// the same destination.

// ---------------------------------------------------------------------------------------
// The public surface, in two tiers.
//
// **`export *` used to stand here, and that was the whole problem.** A blanket re-export
// publishes whatever `types.ts` happens to contain — which is how the compiler's `Plan`
// shapes and the worklet's `Processor` contract became part of this package's API without
// anybody deciding they should be. `docs/RACK.md` records `ModuleDef` and `Processor`
// changing four times in four PRs and concludes that opening them "turns each into a
// promise"; `export *` had already made that promise on our behalf.
//
// So every name is listed. Adding one is now a deliberate line in a diff rather than a
// side effect of adding a field, and `api.test.ts` pins the list so it shows up in review.
//
// The tiers are not enforced by the type system — TypeScript has no way to say "exported
// but not promised" — so they are enforced by being written down and tested.
// ---------------------------------------------------------------------------------------

// ---- Tier 1: the document and the host --------------------------------------------------
//
// What a consumer of `@driftbox/rack` touches. **A patch is the thing worth being stable
// about**, because patches are saved, shared as URLs and opened by builds that are not this
// one — and that stability is already designed in rather than hoped for: `PATCH_FORMAT`
// carries a version, every added field has been optional, `decodePatch` never throws and
// preserves what it does not recognise, and `patch-io.test.ts` pins that a patch written
// before a field existed still round-trips byte-identically. Adding `modulation` for the
// Combinator was that design working, not a break.
export type {
  Patch,
  PatchModule,
  PatchCable,
  ModRoute,
  AutoLane,
  AutoPoint,
  ParamRef,
  Port,
  ParamDef,
  ModuleLogo,
  ModuleGuide,
  ModuleGuideConcept,
  ModuleDef,
  MeterReading,
} from './types.js'
export type {
  AdaptiveChange,
  AdaptiveControl,
  AdaptiveHost,
  AdaptivePoint,
  AdaptiveScore,
} from './adaptive.js'
export type { RackRendererOptions, RenderedAudio } from './headless.js'
export type { LaneHost, LanePlayerOptions } from './lanes.js'

// ---- Tier 2: still moving ---------------------------------------------------------------
//
// Exported because the app in this repo needs them, **not because they are promised.** These
// are the compiler's output and the audio thread's contract, and both are expected to change:
// `Plan` is an implementation detail of `compile` that no outside consumer should be reading,
// and `Processor`/`ProcessorClass`/`Dep` are the third-party-module question `docs/RACK.md`
// explicitly defers.
//
// If this package is published, these are what a major version would be reserved for — or what
// moves behind a `@driftbox/rack/internal` entry point on the day somebody outside depends on
// one. Either way the decision is now visible instead of implied.
export type {
  Plan,
  PlanNode,
  PlanOutput,
  PlanParam,
  PlanNote,
  Processor,
  ProcessorClass,
  ProcessorVoice,
  Registry,
  Transport,
  ModuleData,
  Dep,
} from './types.js'

export { compile } from './compile.js'
export { Graph } from './graph.js'
export { applyModulation, routeValue, routedParams, sourcePosition } from './modulation.js'
export {
  automationLength,
  clearLane,
  laneFor,
  pointsIn,
  setPoint,
  STEPS_PER_BAR,
  stepOf,
  valueAt,
} from './automation.js'
export {
  embedGrooveboxSong,
  grooveboxSong,
  GROOVEBOX_SOURCE_ID,
  isGrooveboxEditable,
  patchCompatibility,
  renderRetainedSongMix,
  withGrooveboxSource,
  type PatchCompatibility,
} from './groovebox.js'
export { PATCH_FORMAT, decodePatch, encodePatch } from './patch-io.js'
export { PATCHES, patchPresetById, type PatchPreset } from './patches/index.js'
export { CHUNKS, chunkById, insertChunk, type Chunk, type Inserted } from './chunks/index.js'
export {
  DEVICE_PATCHES,
  completeParams,
  devicePatchesFor,
  initDevicePatch,
  type DevicePatch,
} from './device-patches/index.js'
export { VCV_MODELS, importVcv, importVcvPatch, type ImportNote, type Imported } from './vcv/index.js'
export { MODULES, MODULE_LIST } from './modules/index.js'
// Every module's def, one by one, so a registry can be assembled by hand.
//
// **This list is what makes trimming possible rather than theoretical.** Nineteen of these were reachable
// only through `MODULES` — which is the whole set — so a consumer wanting three modules had no way to ask
// for three. The ones that were already exported got there because something in this repo happened to need
// them; the rest are here because a supported way to control the bundle cannot be built out of imports that
// are not offered.
export { ADSR_MODULE } from './modules/adsr.js'
export { CABINET_MODULE } from './modules/cabinet.js'
export { DISTORTION_MODULE } from './modules/distortion.js'
export { IMAGER_MODULE } from './modules/imager.js'
export { PHASER_MODULE } from './modules/phaser.js'
export { PING_PONG_MODULE } from './modules/ping-pong.js'
export { CLOCK_MODULE } from './modules/clock.js'
export { CHORD_PLAYER_LANES, CHORD_PLAYER_MODULE } from './modules/chord-player.js'
export { COMPRESSOR_MODULE } from './modules/compressor.js'
export { DELAY_MODULE } from './modules/delay.js'
export { DRIVE_MODULE } from './modules/drive.js'
export { EQ_MODULE } from './modules/eq.js'
export { LFO_MODULE } from './modules/lfo.js'
export { LIMITER_MODULE } from './modules/limiter.js'
export { LOOPER_MODULE } from './modules/looper.js'
export { METER_MODULE } from './modules/meter.js'
export { MIXER_MODULE } from './modules/mixer.js'
export {
  MULTISAMPLER_MODULE,
  MULTISAMPLE_ZONE_FIELDS,
  MULTISAMPLE_ZONE_STRIDE,
  multisampleSlot,
  packMultisampleZones,
  unpackMultisampleZones,
  type MultisampleZone,
} from './modules/multisampler.js'
export { NOTE_ECHO_MODULE, NOTE_ECHO_STEPS } from './modules/note-echo.js'
export { NOISE_MODULE } from './modules/noise.js'
export { OFFSET_MODULE } from './modules/offset.js'
export { QUANTIZER_MODULE } from './modules/quantizer.js'
export { REVERB_MODULE } from './modules/reverb.js'
export { SAMPLE_HOLD_MODULE } from './modules/sample-hold.js'
export { SAMPLER_MODULE } from './modules/sampler.js'
export { SCALE_PLAYER_CUSTOM_NOTES, SCALE_PLAYER_MODULE } from './modules/scale-player.js'
export { SEQ_MODULE } from './modules/seq.js'
export { SVF_MODULE } from './modules/svf.js'
export { TRANSPORT_MODULE } from './modules/transport.js'
export { TUNER_MODULE } from './modules/tuner.js'
export { VCA_MODULE } from './modules/vca.js'

export { ALLIGATOR_BANDS, ALLIGATOR_MODULE, AlligatorProcessor } from './modules/alligator.js'
export { AUDIO_INPUT_MODULE, AudioInputProcessor } from './modules/audio-input.js'
export { ARP_MODULE, ARP_PATTERN_STEPS, ArpProcessor } from './modules/arp.js'
export { ARRANGER_MODULE, ARRANGER_SECTIONS, ArrangerProcessor } from './modules/arranger.js'
export { COMBI_CONTROLS, COMBI_MODULE, COMBI_ROTARY_MAX, CombiProcessor } from './modules/combi.js'
export { FOLLOWER_MODULE, FollowerProcessor } from './modules/follower.js'
export {
  GROOVEBOX_MODULE,
  GROOVEBOX_PORTS,
  GrooveboxProcessor,
} from './modules/groovebox.js'
export { MIDI_INPUTS, MIDI_MODULE, MidiProcessor } from './modules/midi.js'
export { LADDER_MODULE, LadderProcessor } from './modules/ladder.js'
export { OUT_MODULE, OutProcessor } from './modules/out.js'
export { TRACKER_LANES, TRACKER_MODULE, TrackerProcessor } from './modules/tracker.js'
export { VCO_MODULE, VcoProcessor } from './modules/vco.js'
export { VOICE_MODULE, VoiceProcessor } from './modules/voice.js'
export {
  VOCODER_BAND_COUNTS,
  VOCODER_MAX_BANDS,
  VOCODER_MODULE,
  VOCODER_RANGE_HZ,
  VocoderProcessor,
} from './modules/vocoder.js'
export { RACK_PROCESSOR, loadRack, rackSource, type RackMessage } from './worklet.js'
export { renderLength, renderPatch, type RenderOptions } from './render.js'
export { RackRenderer } from './headless.js'
export { Adaptive, adaptiveValue, adaptiveValues } from './adaptive.js'
export { LanePlayer } from './lanes.js'

export const EMPTY_PATCH: Patch = { modules: [], cables: [] }
/** Host input 4 is reserved for a browser MediaStream; 0..3 are the groovebox sections. */
export const RACK_LIVE_INPUT = 4
export const RACK_HOST_INPUTS = 5

/**
 * The host side of a rack.
 *
 * Owns nothing but the node and the current plan. It does not own an AudioContext — the
 * caller does, because a rack is meant to sit alongside the drum machines in the same
 * context and share their output, not to be a second application.
 *
 * **The registry is required, and that is a bundle-size decision rather than a purity one.** It used to
 * default to `MODULES`, which reads as friendlier and costs every consumer 14.5kB gzipped whether or not
 * their patch uses a Vocoder: a default parameter is a static reference, so every module in the set was
 * retained even by a caller passing its own registry. Measured, `Rack` alone came to 21.7kB gzipped and did
 * not move by a single byte when handed a four-module registry. Written by the caller, `MODULES` is imported
 * only if it is wanted, and a game that patches four modules pays for four.
 *
 * ```js
 * import { Rack, MODULES } from '@driftbox/rack'
 * const rack = new Rack(ctx, MODULES)                 // everything, ~21.7kB gzipped
 *
 * import { Rack, VCO_MODULE, LADDER_MODULE, OUT_MODULE } from '@driftbox/rack'
 * const rack = new Rack(ctx, { vco: VCO_MODULE, ladder: LADDER_MODULE, out: OUT_MODULE })
 * ```
 *
 * A patch naming a module the registry does not have becomes a placeholder rather than a deletion, exactly
 * as it does for a build that is a version behind — so a trimmed registry degrades the way an old one does,
 * visibly and in `notes`, rather than by demolishing the patch.
 */
export class Rack {
  private readonly ctx: BaseAudioContext
  private readonly registry: Registry
  private readonly hostInputs: GainNode[]
  private node: AudioWorkletNode | null = null
  private current: Patch = EMPTY_PATCH
  private compiled: Plan | null = null
  /** Module types the worklet could not construct. Empty unless the worklet was assembled
   *  from a different module set than the one that compiled the plan. */
  private absent: string[] = []
  private tempoValue = 120
  private runningValue = false
  private shuffleValue = 0
  /** Beats from every span already finished — every span before the current tempo. See `beat`. */
  private banked = 0
  /** The context time the current span began at, in seconds. */
  private spanFrom = 0
  /** Data set before there was a node to send it to. Handed over in `processorOptions` at construction. */
  private pending: { module: string; slot: string; data: Float32Array }[] = []
  /** Scheduled param changes made before there was a node to send them to. See `scheduleParam`. */
  private pendingParams: { slot: number; value: number; voice?: number; frame: number }[] = []
  /** Meter displays are opt-in so an offline render never produces UI traffic. */
  private meterListeners = new Set<(readings: readonly MeterReading[]) => void>()

  constructor(ctx: BaseAudioContext, registry: Registry) {
    this.ctx = ctx
    this.registry = registry
    this.hostInputs = Array.from({ length: RACK_HOST_INPUTS }, () => ctx.createGain())
  }

  /**
   * Load the processor and build the node.
   *
   * Resolves `false` when worklets are unavailable, which is the one failure a caller has to
   * handle: a rack without a worklet is not a degraded rack, it is no rack, and saying so is
   * better than looking broken.
   */
  async start(): Promise<boolean> {
    if (this.node) return true
    if (!(await loadRack(this.ctx, this.registry))) return false

    const node = new AudioWorkletNode(this.ctx, RACK_PROCESSOR, {
      // Four groovebox buses plus one live browser input. They make no sound by
      // themselves: source modules turn them into ordinary patchable rack outlets.
      numberOfInputs: RACK_HOST_INPUTS,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      // Handed over at construction rather than posted afterwards. A port message is delivered on the audio
      // thread, and an OfflineAudioContext does not run that thread until `startRendering` — so posting a
      // plan and rendering immediately is a race that loses silently, producing a file of the right length
      // and no sound. See the note in the processor's constructor.
      processorOptions: {
        plan: this.compiled,
        transport: { tempo: this.tempoValue, running: this.runningValue, shuffle: this.shuffleValue },
        data: this.pending,
        params: this.pendingParams,
      },
    })
    for (let input = 0; input < this.hostInputs.length; input++) {
      this.hostInputs[input].connect(node, 0, input)
    }
    this.pending = []
    this.pendingParams = []
    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        kind?: string
        types?: string[]
        readings?: MeterReading[]
      } | null
      if (message?.kind === 'missing' && Array.isArray(message.types)) this.absent = message.types
      if (message?.kind === 'meters' && Array.isArray(message.readings)) {
        for (const listener of this.meterListeners) listener(message.readings)
      }
    }
    this.node = node
    if (this.meterListeners.size > 0) node.port.postMessage({ kind: 'monitor', enabled: true })
    // A patch set before start() is already in `processorOptions` above. Do not post the same plan again:
    // an OfflineAudioContext can deliver that message after the constructor has seeded its scheduled params,
    // and rebuilding the Graph then correctly clears those events as belonging to the old plan. The result
    // is a timing-dependent export with its automation missing. Live edits still travel through `send()` in
    // the patch setter once `this.node` exists.
    return true
  }

  /** Connect this to a destination, a channel strip, or the engine's send bus. Null until
   *  `start()` has resolved true. */
  get output(): AudioNode | null {
    return this.node
  }

  /**
   * A stable destination for one host-fed source. It exists before `start()`, so another
   * engine can be wired once; the gain is connected to the worklet when it becomes ready.
   */
  input(index: number): AudioNode | null {
    return this.hostInputs[index] ?? null
  }

  get patch(): Patch {
    return this.current
  }

  /**
   * Replace the patch. Compiles immediately — so `notes` and `plan` are readable straight
   * away, whether or not audio has started — and takes effect on the audio thread at the
   * next block.
   */
  set patch(patch: Patch) {
    this.current = patch
    this.compiled = compile(patch, this.registry)
    this.absent = []
    this.send()
  }

  /** The compiled plan, for a UI that wants to draw what the compiler decided. */
  get plan(): Plan | null {
    return this.compiled
  }

  /**
   * What the compiler had to decide or discard: cables delayed to break a cycle, modules
   * this build does not have, cables it dropped. Not a log — a UI that does not draw these
   * is a UI that lies about the patch.
   */
  get notes(): PlanNote[] {
    const notes = this.compiled ? [...this.compiled.notes] : []
    for (const type of this.absent) {
      notes.push({
        kind: 'placeholder',
        detail: `the audio thread has no module of type "${type}"; it was compiled but not built`,
      })
    }
    return notes
  }

  /**
   * Move a knob. Silently does nothing for a module or param the current patch does not have, which is what
   * a UI holding a stale reference during a patch change will do.
   *
   * `voice` undefined means every voice, which is what a knob means. A specific voice is what a keyboard
   * means — one MIDI module holding eight different notes, one per voice.
   */
  setParam(moduleId: string, paramId: string, value: number, voice?: number): void {
    const slot = this.compiled?.slots[moduleId]?.[paramId]
    if (slot === undefined) return
    this.node?.port.postMessage({ kind: 'param', slot, value, voice })
  }

  /** Move the gain pot beside one rear-panel inlet. Like a knob, this ramps without rebuilding the graph. */
  setInputTrim(moduleId: string, portId: string, value: number): void {
    const slot = this.compiled?.inputTrims?.[moduleId]?.[portId]
    if (slot === undefined) return
    this.node?.port.postMessage({ kind: 'param', slot, value })
  }

  /**
   * Move a knob **at a moment**, rather than at the next block boundary.
   *
   * A separate method rather than a fifth argument to `setParam`, because scheduling without caring about
   * voices is the common case and `setParam(id, p, v, undefined, frame)` is a call site nobody should have
   * to write. It posts the same message; the frame is the only difference.
   *
   * This is what recorded automation is played back through. Without it a lane can only be delivered one
   * point per block — up to 2.9ms out at 44.1kHz, which is inaudible on a slow sweep and quite audible on
   * anything meant to land on a beat.
   *
   * `frame` is on the context's clock: use `frameFor`. A frame already past applies immediately rather than
   * being dropped, so a lane read slightly too late still plays, merely late.
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
    if (!this.node) {
      // Held until the node exists, the same way a loaded sample is. **This is what makes automation work
      // in an offline render at all**: no port message reaches an `OfflineAudioContext` before
      // `startRendering`, because that thread is not running yet — measured, and the symptom is a file of
      // the right length with the automation simply absent.
      //
      // Only scheduled changes are held. An ordinary `setParam` before `start()` is already redundant,
      // because the plan carries every param's value and the patch was compiled after it was set. A
      // scheduled change is an event rather than a value, so nothing else is carrying it.
      this.pendingParams.push({ slot, value, voice, frame })
      return
    }
    this.node.port.postMessage({ kind: 'param', slot, value, voice, frame })
  }

  /**
   * A context time, as the frame the audio thread will call it.
   *
   * Here rather than left to each caller because it is the one piece of the scheduling contract that is easy
   * to get subtly wrong — `currentFrame` on the audio thread counts samples from the start of the context,
   * which is `currentTime * sampleRate` and not, for instance, milliseconds or a count of blocks. Getting it
   * wrong gives automation that is silently in the wrong place rather than an error.
   */
  frameFor(when: number): number {
    if (!Number.isFinite(when)) return 0
    return Math.max(0, Math.round(when * this.ctx.sampleRate))
  }

  /** How many voices the open patch compiled to. */
  get voices(): number {
    return this.compiled?.voices ?? 1
  }

  /**
   * Set the tempo and whether the transport is running.
   *
   * Held here as well as sent, because a Rack built before `start()` still has to be able to be told — and
   * because a patch reload has to re-send it, since the audio thread's Graph is not rebuilt but its transport
   * state is not part of the plan either.
   */
  setTransport(tempo: number, running: boolean, shuffle = 0): void {
    // Bank what has already played, at the tempo it played at, BEFORE anything here changes. Multiplying
    // total elapsed seconds by the current tempo would move every beat already gone by the moment somebody
    // nudged the tempo — a position recorded at 174 drifting the instant you tried the patch at 172.
    // `app/src/rack/playhead.ts` learned that the hard way and this is the same arithmetic, owned here so
    // that every host does not have to repeat it.
    const now = this.ctx.currentTime
    if (this.runningValue) this.banked += ((now - this.spanFrom) * this.tempoValue) / 60
    // Starting from a stop rewinds, which is what the Graph does with its own position. The two must not
    // disagree about where bar one is.
    if (running && !this.runningValue) this.banked = 0
    this.spanFrom = now

    this.tempoValue = tempo
    this.runningValue = running
    this.shuffleValue = Number.isFinite(shuffle) ? Math.max(0, Math.min(1, shuffle)) : 0
    this.node?.port.postMessage({ kind: 'transport', tempo, running, shuffle: this.shuffleValue })
  }

  get tempo(): number {
    return this.tempoValue
  }

  get running(): boolean {
    return this.runningValue
  }

  /**
   * This host's clock, in seconds — `ctx.currentTime`, named so that anything driving both hosts does not
   * have to know which one it has. `LanePlayer` schedules against it.
   */
  get time(): number {
    return this.ctx.currentTime
  }

  /**
   * Where the transport is, in beats since it started.
   *
   * **Derived from the context clock rather than reported from the worklet**, which is the same decision
   * `live.ts` and `playhead.ts` already made twice: the audio thread does accumulate a position, but
   * reporting it would grow the message ABI `docs/RACK.md` says to keep small, and it would arrive as a
   * sample of the past at whatever rate the meter channel happens to be running. `ctx.currentTime` is
   * available always and exactly, and it is the same clock `frameFor` converts against — so a beat read
   * here and a frame scheduled there cannot disagree about when now is.
   *
   * It exists because `Adaptive` needs it. A score is written once and driven from either host, so `Rack`
   * and `RackRenderer` have to answer the same question the same way; without this, the adaptive layer
   * worked in an offline render and not in the browser, which is backwards.
   *
   * **An offline context cannot answer it.** `currentTime` on an `OfflineAudioContext` does not advance
   * while `startRendering` is running, so this reads zero throughout an export. That is why `renderPatch`
   * schedules against frames rather than positions, and why a score driven through an offline render should
   * use `RackRenderer.render`'s `onBlock`, which counts frames itself.
   */
  get beat(): number {
    if (!this.runningValue) return this.banked
    return this.banked + ((this.ctx.currentTime - this.spanFrom) * this.tempoValue) / 60
  }

  /**
   * Watch the patch's meter modules at display rate.
   *
   * The first listener enables reports on the audio thread and the last one disables them. The DSP itself
   * continues either way: monitoring is a view of the graph, never part of making sound.
   */
  onMeters(listener: (readings: readonly MeterReading[]) => void): () => void {
    this.meterListeners.add(listener)
    if (this.meterListeners.size === 1) {
      this.node?.port.postMessage({ kind: 'monitor', enabled: true })
    }
    return () => {
      this.meterListeners.delete(listener)
      if (this.meterListeners.size === 0) {
        this.node?.port.postMessage({ kind: 'monitor', enabled: false })
      }
    }
  }

  /**
   * Hand a module some bulk data — a sample buffer.
   *
   * **Transferred, not copied.** The second argument to `postMessage` moves the underlying buffer to the audio
   * thread rather than cloning it, which for a two-second stereo break is the difference between a few hundred
   * kilobytes of copying on the main thread and none. The consequence is that `data` is unusable here
   * afterwards — its byteLength becomes 0 — so a caller keeping its own copy has to make one first, and that is
   * why this takes the array rather than an AudioBuffer it could have copied out of.
   *
   * Deliberately *not* part of the patch: a patch stores which break, never several hundred kilobytes of one.
   * See `PatchModule.data` for the other kind of bulk data, which does belong in the document.
   */
  setData(moduleId: string, slot: string, data: Float32Array): void {
    if (!this.node) {
      // Held until the node exists, and then handed over at construction rather than posted. A break
      // pushed before `start()` used to be dropped on the floor without a word.
      this.pending.push({ module: moduleId, slot, data })
      return
    }
    this.node.port.postMessage({ kind: 'data', module: moduleId, slot, data }, [data.buffer])
  }

  /** Disconnect and forget the node. The processor stays registered on the context —
   *  `addModule` on an already-registered name throws, so unloading it is not possible and
   *  not worth pretending. */
  stop(): void {
    if (this.node) {
      for (const input of this.hostInputs) input.disconnect(this.node)
    }
    this.node?.disconnect()
    this.node = null
  }

  private send(): void {
    if (!this.node || !this.compiled) return
    this.node.port.postMessage({ kind: 'plan', plan: this.compiled })
  }
}
