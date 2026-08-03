// What a module is, what a patch is, and what the compiler turns one into.
//
// Read `docs/RACK.md` first — the reasoning for the shape of all of this lives there.
// This file is the shape itself.

/** An inlet or an outlet. There is only one signal type: audio and CV are the same
 *  Float32Array, and nothing anywhere enforces which is which. A patch that plays an
 *  envelope through a speaker is the user's business. */
export interface Port {
  id: string
  name: string
  /**
   * This port carries two channels rather than one, and owns two consecutive buffers.
   *
   * Absent means mono, which is what every port was before stereo existed — so a module that says nothing
   * behaves exactly as it did. See `stereo.ts` for the three connection rules and why a mono destination
   * takes the left channel rather than the sum.
   *
   * A processor sees this as slots, not as ports: a def declaring `[in(stereo), cv]` hands `process` three
   * inlet buffers — left, right, cv. Declaring it is therefore a change to the module's own indexing and
   * nothing else, and adding it to a port does NOT rename that port, so no existing cable moves.
   */
  stereo?: boolean
}

export interface ParamDef {
  id: string
  name: string
  min: number
  max: number
  default: number
  /**
   * Stepped params jump at the start of a block instead of ramping across it. A waveform
   * selector interpolated halfway between saw and pulse is not a sound anybody asked for,
   * and rounding a ramping value would make the selector flicker between the two for a
   * block every time it changed.
   */
  stepped?: boolean
  /**
   * What each position of a stepped param is called, from `min` upward.
   *
   * Nothing on the audio thread reads this. It exists because a faceplate generated from a def can
   * otherwise only offer the numbers, and a gate switch labelled "0" and "1" is worse than useless —
   * it looks like a bug. Declaring the names here rather than in the UI is what lets a module get a
   * *good* generic faceplate rather than merely a working one, which is the difference between the
   * fallback being a fallback and the fallback being enough.
   *
   * Omit it when the numbers are the meaning: a sequencer's length really is 1 to 8.
   */
  labels?: readonly string[]
  /**
   * A param the host writes rather than a control anybody turns. A faceplate leaves it out.
   *
   * The MIDI module is why: its note, gate and velocity arrive from Web MIDI, which cannot reach the audio
   * thread — a worklet scope has no `navigator` — so they come in as params instead, needing nothing new in
   * the message ABI. A *visible* knob on the same slot would fight the keyboard: it would read 0 while the
   * audio thread held 3, and nudging it would snap the note back. Hidden means exactly one writer.
   *
   * Everything else about it is a normal param: it clamps, it ramps or steps, it has a slot. What it is not
   * is part of the document — the host writes these straight to `Rack.setParam` and never through a patch,
   * so a note somebody played is never saved as one.
   */
  hidden?: boolean
}

/**
 * Where the transport is, as of the start of this block.
 *
 * Handed to `process` as a fifth argument, which exactly one module reads — see `modules/transport.ts`. Every
 * other module syncs by patching to that module's outlets, which is how a real rack does it and is why this
 * widened the contract once rather than eighteen times. Existing modules ignore it because this is JavaScript
 * and an extra argument costs nothing.
 *
 * `beat` is accumulated per block rather than derived from an absolute frame count, so that changing the tempo
 * mid-bar carries on from where the music was instead of jumping to wherever the new arithmetic lands.
 */
export interface Transport {
  /** Beats per minute. */
  tempo: number
  /** Whether it is running. A stopped transport holds its position. */
  running: boolean
  /** Position in beats since the transport started, fractional. */
  beat: number
  /** How many beats one block covers, so a module can work out where inside the block a division falls. */
  beatsPerBlock: number
}

/**
 * Bulk data for one module — a sample buffer, a pattern.
 *
 * Not params. A param is a number with a range and a knob; this is hundreds of kilobytes of audio, or a
 * 64-step 8-lane pattern that is 512 values and could never be 512 knobs. See `docs/DNB.md`.
 *
 * **Read it every block and compare by identity.** A different array means different data — that is the whole
 * change-detection protocol, and it is deliberately that crude so nothing has to subscribe to anything.
 */
export interface ModuleData {
  get(slot: string): Float32Array | undefined
}

/**
 * The audio-thread half of a module.
 *
 * `inlets`, `outlets` and `params` all arrive as `Float32Array`s of `frames` samples, in
 * the order the module's def declares them. Params are per-sample too, so a knob turn
 * ramps rather than steps — the same reasoning that makes the ladder's cutoff a-rate in
 * `@driftbox/engine`.
 *
 * Two rules, both load-bearing:
 *
 *   1. **Never write to an inlet.** Inlet buffers are shared — one outlet feeding three
 *      inlets is one buffer read three times — and an unconnected inlet is the graph's
 *      single zero buffer, so writing to one would invent a signal for every other
 *      unconnected inlet in the patch.
 *   2. **Always write every sample of every outlet.** Buffers are reused across blocks
 *      and are not cleared, so a partial write leaves the previous block's audio in the
 *      tail. Write silence if there is nothing to say.
 */
export interface Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
    transport?: Transport,
    /**
     * Audio supplied by the host to the rack node, grouped as input then channel.
     *
     * Almost every module ignores this. A first-class host source such as the Groovebox
     * device copies it into ordinary rack outlets; from there it is indistinguishable
     * from any oscillator or sampler signal and travels down normal cables.
     */
    hostInputs?: Float32Array[][],
    /**
     * Independent voices at each inlet, supplied only to a mono module that declares `voiceCollector`.
     *
     * Ordinary mono modules receive their familiar summed inlet and this is absent. A collector receives
     * both: `inlets` keeps the backwards-compatible collapse while this view preserves note identity for a
     * controller such as an arpeggiator. Input trims have already been applied to every voice.
     */
    voiceInlets?: Float32Array[][],
  ): void
  /**
   * A low-rate visual reading for a host faceplate.
   *
   * Optional because almost every module has nothing to show beyond its params. The audio thread samples
   * this only while a host has explicitly subscribed, and never uses it to make sound; `process` remains
   * the whole DSP contract. A fresh waveform is expected because the value crosses `postMessage`.
   */
  meter?(): Omit<MeterReading, 'id'>
  /**
   * Several named readings from one processor.
   *
   * A Groovebox is one retained device but has four authored-machine strips. Making those
   * four hidden Meter modules would change the patch merely to draw its front panel, so a
   * multi-bus processor can publish stable, fully-qualified reading ids directly instead.
   */
  meters?(): readonly MeterReading[]
}

/**
 * Where one processor instance sits in a variable-width polyphonic stream.
 *
 * Ordinary modules see `lane: 0` and one instance for every voice reaching them. A voice expander sees
 * several lanes for the same `sourceVoice`; that is enough for a Chord Player to turn one incoming note
 * into its tertian chord and optional octave/colour notes without teaching its processor about the graph.
 */
export interface ProcessorVoice {
  /** This instance in the module's output stream. */
  voice: number
  /** The input voice this instance descends from. */
  sourceVoice: number
  /** This child within `sourceVoice`, from zero. */
  lane: number
  /** Number of child lanes actually allocated per source voice. */
  lanes: number
  /** Total voices this module writes. */
  voices: number
  /**
   * Mutable state shared by every instance of this module node.
   *
   * Most processors ignore it. An expander can use fixed typed arrays here to coordinate its child voices —
   * for example, suppressing a duplicate chord note produced by two simultaneously played roots — without
   * putting module-specific logic in the Graph or allocating in the audio loop.
   */
  shared: Record<string, unknown>
}

/** One meter module's latest display state, sent from the audio thread at animation rate. */
export interface MeterReading {
  id: string
  /** RMS amplitude after the meter's sensitivity control. */
  level: number
  /** Highest absolute sample in the latest render block, after sensitivity. */
  peak: number
  /** The meter's ballistics, also available from its Env outlet. */
  envelope: number
  /** A small, display-only view of the latest render block. */
  waveform: Float32Array
  /** Fundamental estimate from an analyser such as the Tuner. Absent for an ordinary level meter. */
  frequency?: number
  /** Normalised confidence in `frequency`; zero means the faceplate should show no note. */
  clarity?: number
  /** A performance looper's current playhead, normalised to its captured length. */
  loopPosition?: number
  /** Captured loop duration. Absent for devices that do not hold a performance. */
  loopSeconds?: number
}

/**
 * A processor class, as the audio thread will construct it.
 *
 * `deps` carries the shared DSP classes the module asked for, keyed by the names in its
 * def. It is passed in rather than referenced by identifier on purpose — see the comment
 * in `worklet.ts` about what a minifier does to a stringified class.
 *
 * `id` is the module's id from the patch. Almost nothing needs it; what does need it is anything
 * random, because seeding from an id is what makes a patch containing noise sound the same twice
 * while still letting two Noise modules decorrelate. See `dsp/random.ts`. A class that ignores it
 * simply declares a shorter constructor.
 */
export type ProcessorClass = new (
  sampleRate: number,
  deps: Record<string, unknown>,
  id: string,
  data: ModuleData,
  voice?: ProcessorVoice,
) => Processor

/** A shared DSP class a module can ask for by name. `never[]` rather than `unknown[]` so
 *  that a constructor taking real arguments is still assignable. */
export type Dep = abstract new (...args: never[]) => unknown

/**
 * A small, host-rendered SVG mark for a module.
 *
 * Only path data crosses the package boundary. Keeping the view box fixed and leaving the `<svg>` element
 * to the host makes this safe to render without accepting arbitrary markup, while still letting a module
 * bring the visual identity that makes it recognisable in a catalogue. Paths are drawn as unfilled strokes
 * in a 64 × 40 view box, so colour and weight can follow the surface they appear on.
 */
export interface ModuleLogo {
  paths: readonly string[]
}

export interface ModuleDef {
  /** Stable forever. This is the string a saved patch stores. */
  type: string
  /** Bumped when params change in a way `migrate` has to repair. */
  version: number
  name: string
  /**
   * What this module is and why you would reach for it. One or two short sentences.
   *
   * **On the def rather than in the app**, which is the whole argument for it being here at all. The
   * registry's promise is that adding a module is a class, a def and a test — and if the copy that makes
   * it findable lived in the host, adding a module would also mean editing the host, which is exactly the
   * coupling `faceplates/index.ts` goes to some trouble to avoid. A module that arrives from somewhere
   * else brings its own description with it, the same way it brings its own name.
   *
   * Optional, so a module without one is merely undescribed rather than broken. `modules.test.ts` holds
   * the shipped ones to having it, which is where that belongs: a rule about this rack's modules, not
   * about anybody's.
   */
  blurb?: string
  /**
   * A compact vector explanation of the module, drawn in a 64 × 40 view box.
   *
   * Optional for the same reason `blurb` is optional: a module supplied by another package remains usable
   * without presentation metadata. Shipped modules have one, and hosts should simply omit the artwork when
   * it is absent.
   */
  logo?: ModuleLogo
  /**
   * Which shelf of the picker this sits on — "Sources", "Filters" and so on.
   *
   * A flat list of names is a list you read rather than a place you look. Grouping is the
   * cheapest fix and it has to be stated rather than inferred: `MODULE_LIST`'s order has always implied
   * these groups, but nothing enforced it and nothing could read it.
   */
  group?: string
  inlets: Port[]
  outlets: Port[]
  params: ParamDef[]
  processor: ProcessorClass
  /** Shared DSP classes, keyed by the name the processor will look them up under. */
  deps?: Record<string, Dep>
  /** A terminal module: its first outlet is summed into the rack's audio output. */
  terminal?: boolean
  /**
   * Param id carrying this terminal module's pan: −1 hard left, +1 hard right.
   *
   * Named here rather than found by convention in the compiler, so a module's stereo placement is a fact
   * about the module. Absent means centre, which is what every terminal module was before stereo existed —
   * and is why a patch shared before this sounds identical after it.
   */
  terminalPan?: string
  /**
   * Param ids for this terminal module's mute and solo, both treated as 0 or 1.
   *
   * Here for the same reason `terminalPan` is: these are properties of the **mix**, not of the module. Solo
   * especially — one channel soloed silences the others, which is a fact about the set of channels and
   * something no module can know about itself. The Graph is the only place that sees them all.
   */
  terminalMute?: string
  terminalSolo?: string
  /**
   * Whether this module is duplicated per voice. Default true.
   *
   * `false` means one instance however many voices the patch has, and every voice arriving at one of its
   * inlets is **summed** first. That is the collapse, and it is the whole reason the flag exists: a Delay
   * duplicated eight times is eight delays, and a shared delay is the point. So is one master Out, one
   * clock, and one sequence.
   *
   * Default true rather than false because a module inside a voice is the common case — an oscillator, a
   * filter, an envelope — and getting the default wrong the other way would silently make polyphony
   * monophonic.
   */
  poly?: boolean
  /**
   * Maximum output voices produced for every input voice.
   *
   * Absent means one, preserving the fixed-width graph every existing module was written for. The compiler
   * allocates the requested lanes when the whole stream fits the rack's bounded render capacity, records
   * that exact count on the plan, and lets ordinary downstream polyphonic modules inherit the wider stream.
   * `poly: false` modules cannot expand: their defining behaviour is to collapse to one shared instance.
   */
  voiceExpansion?: number
  /**
   * Give one shared processor a second, unsummed view of every voice reaching each inlet.
   *
   * This is deliberately narrower than `poly`: the module still runs once and writes mono outlets, but it
   * can distinguish the notes in a performed chord instead of receiving their voltages added together. The
   * ordinary collapsed `inlets` remain available for old behavior and old patches. Ignored for poly modules.
   */
  voiceCollector?: boolean
  /** Repair the params of an older saved version. Lives here rather than in a central
   *  table because at forty modules a central table is unmaintainable, and the person
   *  adding a param is the person who knows what the old value meant. */
  migrate?(params: Record<string, number>, from: number): Record<string, number>
}

export type Registry = Record<string, ModuleDef>

// ---------------------------------------------------------------------------------------
// A patch, as it is saved
// ---------------------------------------------------------------------------------------

export interface PatchModule {
  id: string
  type: string
  version?: number
  params?: Record<string, number>
  /**
   * Bulk data that belongs *in* the document — a sequencer's pattern.
   *
   * Plain number arrays, so it is JSON and travels in a file and a URL like everything else. The other kind of
   * bulk data, a sample buffer, deliberately does **not** live here: it is pushed straight at the audio thread
   * with `Rack.setData`, because a patch should store *which* break rather than several hundred kilobytes of
   * one. Same argument as the MIDI module's hidden params, and the same consequence — a patch using a loaded
   * sample cannot travel in a URL, and has to say so.
   */
  data?: Record<string, number[]>
  /**
   * Gain at a named inlet, from −1 through +1. Absent means unity.
   *
   * Held on the device rather than on its cable because the pot belongs to the jack: unplugging and
   * repatching it must not reset the setting. The negative half inverts a control signal, matching the
   * bipolar trims on hardware and making this a strict superset of a one-way level control.
   */
  inputTrims?: Record<string, number>
  /** Where it sits in the rack. The engine does not read this; the UI does. */
  pos?: [number, number]
  /**
   * Taken out of circuit: not processed at all, and its outlets carry whatever reaches its FIRST inlet.
   *
   * Absent means in circuit, so a patch written before this existed is byte-identical and sounds the same.
   *
   * **It cannot be a param**, which is the first thing anybody tries. A param is read by the module's own
   * `process`, and a bypassed module does not run — something has to answer for its outlets on its behalf,
   * and only the compiler can see both ends of the cables that would carry the answer. The same reasoning
   * put `terminalMute` and `terminalSolo` outside their processor: solo silences the OTHERS, and a module
   * has no idea the others exist.
   *
   * A module with no inlets bypasses to silence, because there is nothing for it to pass through. That is
   * what turning a source off means, and it is why one flag covers Reason's Bypass and its Off.
   */
  bypassed?: boolean
}

/** `[moduleId, portId]` at each end. Port *names*, never indices — so a module that gains
 *  an inlet does not silently rewire every patch that used it. */
export interface PatchCable {
  from: [string, string]
  to: [string, string]
}

/**
 * One Combinator control moving one parameter of one module. Reason's Modulation Routing, and the
 * whole reason the `combi` module exists — see `modulation.ts` for the rules and `modules/combi.ts`
 * for what it is routing *from*.
 *
 * A route is **not a cable**, and the difference is the point. A cable joins an outlet to an inlet and
 * carries a signal at sample rate; a route joins a knob to a *knob*, and reaches parameters no module
 * ever thought to expose as an inlet — a VCO's waveform, a Quantizer's scale, a Sampler's slice count.
 * That is exactly the gap Reason's Combinator filled, and it is why routes live in the patch rather
 * than in the graph.
 *
 * Both ends are `[moduleId, paramId]`, by name and never by index, for the same reason a cable names
 * its ports: a module that gains a parameter must not silently re-aim every route that used it.
 */
export interface ModRoute {
  /** The Combinator control driving this — a rotary or a button. */
  from: [string, string]
  /** The parameter it moves. Any parameter of any module, including another Combinator's. */
  to: [string, string]
  /**
   * Where the target sits when the source is fully down, and where when it is fully up. **In the
   * target's own units**, which is what makes a route readable: "cutoff 200 to 8000" says what it does,
   * where a normalised 0..1 pair would not.
   *
   * `min > max` is legal and inverts the route, which is how Reason's Min/Max work and is the cheapest
   * way to have one rotary open one thing while closing another.
   *
   * Either may be absent, meaning the target's own limit — so a hand-written route can sweep a parameter
   * end to end without looking its range up, and a patch does not have to hardcode a number that a later
   * version of that module might widen. Absence rather than a sentinel because a patch is JSON and JSON
   * has no NaN: `JSON.stringify(NaN)` is `null`, so a sentinel would decode back as something else.
   */
  min?: number
  max?: number
}

export interface Patch {
  modules: PatchModule[]
  cables: PatchCable[]
  /** Opaque performance scene id resolved by the host. Rack-native documents keep it
   * here; a retained Groovebox song carries its own hint inside `groovebox` instead. */
  visual?: string
  /**
   * The portable generated break this patch was written around.
   *
   * The audio itself never belongs in a patch — even one rendered bar is hundreds of kilobytes — so this is
   * a small host-resolved id. The current rack loads the same break into every Sampler, matching its break
   * picker; somebody's own sample file remains session-only because a URL cannot carry it.
   *
   * Absent means no built-in break. Optional rather than a format bump because an older reader can safely
   * ignore it and still preserve every part of the synthesis graph.
   */
  break?: string
  /**
   * An encoded `@driftbox/engine` Song, retained as an opaque envelope.
   *
   * This is a string rather than a nested `Song` on purpose. A rack build may be older
   * than the groovebox document it opens; keeping the original encoded text means it can
   * still save that future song byte-for-byte even when its installed engine correctly
   * refuses to decode it. The bridge helpers decode songs this build understands, while
   * the patch codec only promises never to damage them.
   *
   * Absent means this is a rack-native document. Present with no other rack-authored
   * state means the document remains groovebox-compatible; see `patchCompatibility`.
   */
  groovebox?: string
  /**
   * Combinator routings. Absent means none, which is what every patch written before this existed means.
   *
   * At the top level rather than on the Combinator module, deliberately, and it is the decision that kept
   * this from touching anything else. A route names both of its ends by module id — the same way a cable
   * does — so the patch format grows one optional array and nothing gains a notion of containment. Nesting
   * modules inside a module would have meant a tree in the format, a tree in the layout, a tree in the
   * compiler and a back panel that had to decide what a cable *out of* a container means. Reason's
   * Combinator is a container; what makes it a Combinator is the four rotaries, and those need no
   * containment at all.
   *
   * Ordering is load-bearing: routes are applied in list order and a later one wins a contested target.
   * See `applyModulation`.
   */
  modulation?: ModRoute[]
  /**
   * How many voices. Absent means one, which is what every patch written before this existed means.
   *
   * One count for the whole patch, deliberately. VCV Rack's model is more refined — polyphony originates at
   * a module and propagates down cables, so each cable carries its own channel count — and it is a great
   * deal more machinery: per-cable counts, a propagation pass, and a rule for what happens where two
   * different counts meet. One number is predictable, testable, and enough to play chords with.
   */
  voices?: number
  /**
   * Beats per minute. Absent means 120.
   *
   * In the patch rather than the session, because the engine's `Song` carries `bpm` for the same reason: a
   * drum-and-bass patch *is* 174, and one shared at the wrong tempo is not the patch that was shared. Whether
   * the transport is *running* is session state and deliberately not here.
   */
  tempo?: number
  /**
   * Recorded parameter moves. Absent means none, which is what every patch written before this means.
   *
   * At the top level beside `modulation`, and for the same reason: a lane names its parameter by module id
   * and param id, so the format grows one optional array and no module gains a notion of owning a timeline.
   * See `automation.ts` for why these are here rather than on the retained Song, and why a position is
   * musical rather than a frame.
   */
  automation?: AutoLane[]
}

/** One parameter, named the way a cable names an endpoint. */
export type ParamRef = [module: string, param: string]

/** One recorded value, at a position in sixteenths from the top of the arrangement. */
export interface AutoPoint {
  at: number
  value: number
}

/**
 * One parameter's recorded moves, in ascending position.
 *
 * `curve` is `linear` unless it says otherwise, because a knob somebody turned moved continuously and a
 * lane that stepped between recorded points would sound like a much coarser recording than it is. `hold`
 * is for a parameter where between two values is not a value — a waveform selector, a mute.
 */
export interface AutoLane {
  target: ParamRef
  curve?: 'hold' | 'linear'
  points: AutoPoint[]
}

// ---------------------------------------------------------------------------------------
// A compiled plan
// ---------------------------------------------------------------------------------------

/** Buffer indices, in the order the module's def declares its ports. Index 0 on an inlet
 *  means unconnected, and reads as silence. */
export interface PlanNode {
  id: string
  type: string
  inlets: number[]
  /**
   * Param slot per inlet buffer, or `undefined` where there is none. Stereo ports repeat their one trim
   * slot for both channels.
   *
   * **Sparse, and the gaps are the point.** An inlet only gets a slot when a signal actually reaches it,
   * because a slot costs the Graph a buffer of its own and a multiply per sample where an untrimmed inlet
   * just points at the source's buffer. A gap reads exactly as a plan from before trims existed did: keep
   * the direct path.
   */
  inletTrims?: (number | undefined)[]
  outlets: number[]
  /** Slot index per param, in def order. */
  params: number[]
  /** False for a module that runs once however many voices there are. */
  poly: boolean
  /**
   * Processor instances to construct. Absent on an old plan means the patch-wide voice count for a
   * polyphonic node and one for a mono node.
   */
  voices?: number
  /** Number of adjacent instances that descend from the same input voice. Absent means one. */
  voiceLanes?: number
  /** A mono processor also receives every unsummed source voice at each inlet. Absent means collapse only. */
  collectVoices?: boolean
  /** Bulk data carried in the patch, seeded into the Graph when the plan is applied. */
  data?: Record<string, number[]>
}

/**
 * One terminal module's contribution to the mix.
 *
 * `pan` is a **param slot**, not a value, because a pan knob can be turned while the patch runs and could
 * one day be modulated — the Graph already holds a per-voice buffer for every slot, so this costs it a
 * lookup it was doing anyway. Null when the terminal module has no pan param at all, which is what keeps a
 * module type this build has never seen from needing one.
 */
export interface PlanOutput {
  /** Buffer to sum into the mix. The left channel when `right` is set, and the whole signal otherwise. */
  buffer: number
  /**
   * The right channel's buffer, for a terminal module whose first outlet is stereo. Null for a mono one,
   * which is then panned into the field exactly as it was before stereo existed.
   */
  right: number | null
  /** Param slot carrying pan: −1 hard left, +1 hard right. */
  pan: number | null
  /** Param slot carrying mute, and one carrying solo. Both read as "above a half means yes". */
  mute: number | null
  solo: number | null
}

export interface PlanParam {
  value: number
  stepped: boolean
}

/**
 * Everything the compiler had to decide or discard.
 *
 * This is not a log — it is output. A cable the compiler delayed to break a cycle has to
 * be drawn differently, and a module it could not resolve has to be drawn as a blank
 * faceplate. A patch that silently behaves unlike its picture is worse than one that
 * admits it.
 */
export interface PlanNote {
  kind:
    | 'placeholder'
    | 'delayed'
    | 'dropped-cable'
    | 'replaced-cable'
    | 'duplicate-module'
    | 'migration-failed'
    /** A voice expander could not allocate another whole lane without exceeding the render bound. */
    | 'voice-cap'
    /** A stereo outlet reaching a mono inlet: the left channel is heard and the right is not. */
    | 'mono-fold'
  detail: string
  module?: string
  cable?: PatchCable
}

export interface Plan {
  /** How many buffers to allocate. Index 0 is the zero buffer and is never written. */
  buffers: number
  /** 1 to 8. Clamped from the patch, so a plan never asks for a voice count the Graph must guard against. */
  voices: number
  /**
   * Which buffers are per-voice, indexed the same way as the buffers themselves.
   *
   * A buffer is polyphonic exactly when the module writing it is, so the Graph could work this out from the
   * nodes — and it is emitted instead so that it does not have to. `process()` walking a list is the whole
   * design; every question it has to answer at run time is one it can get wrong.
   */
  poly: boolean[]
  /**
   * Exact voice width of every buffer. Absent on an old plan falls back to `poly` and `voices`.
   *
   * This is the structural difference between a chord and a summed pitch: five chord tones are five
   * buffers at one port, and downstream processors are instantiated five times to consume them.
   */
  voiceWidths?: number[]
  /** In execution order. */
  nodes: PlanNode[]
  /** What reaches the speakers, and where in the stereo field. */
  outputs: PlanOutput[]
  params: PlanParam[]
  /** `moduleId` → `paramId` → slot, so the host can address a knob by name. */
  slots: Record<string, Record<string, number>>
  /**
   * `moduleId` → `portId` → hidden param slot, kept separate from a module's authored params.
   *
   * Only inlets with something patched to them appear. A pot on an unpatched inlet is remembered in the
   * patch and costs the graph nothing until a cable arrives.
   */
  inputTrims?: Record<string, Record<string, number>>
  notes: PlanNote[]
}
