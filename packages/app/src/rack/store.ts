import {
  AUTOMATION_TARGET,
  DEFAULT_BASS_PARAMS,
  DEFAULT_FX,
  DEFAULT_PARAMS,
  DEFAULT_SENDS,
  ALL_VOICES,
  chainSetClip,
  type BassParams,
  type ClipLaunchEvent,
  type ClipLaunchPhase,
  type ClipLaunchQuantization,
  type Pattern,
  type FxParams,
  type SendLevels,
  type Song,
  type GrooveboxSection,
  type VoiceParams,
  encodeSong,
  enterBassNote,
  setAutomationPoint,
  setStep,
} from '@driftbox/engine'
import {
  applyModulation,
  clearLane,
  completeParams,
  setPoint,
  type DevicePatch,
  EMPTY_PATCH,
  grooveboxSong,
  insertChunk,
  type Chunk,
  type Inserted,
  type ModRoute,
  MODULES,
  PATCHES,
  decodePatch,
  encodePatch,
  patchPresetById,
  withGrooveboxSource,
  type Patch,
  type PatchCable,
  type PatchPreset,
  type PlanNote,
} from '@driftbox/rack'
import { create } from 'zustand'
import { autosavePatch, loadStoredPatch, takeRackDocumentFromUrl } from './persistence.js'
import { forget, learn, loadBindings, saveBindings, type CcBinding } from '../midi-cc.js'
import {
  dataKey,
  needsRebuild,
  NO_HISTORY,
  paramKey,
  remember,
  stepBack,
  stepForward,
  type History,
} from './history.js'
import { reordered } from './layout.js'
import { tempoForBars } from './sample.js'

// What is on screen. `@driftbox/rack` owns the sound; this owns the patch as immutable data so React
// can diff it, and pushes it at the audio thread when it changes.
//
// **The important thing here is that a knob turn is not a patch change.**
//
// Handing the Rack a new patch recompiles it and rebuilds every processor, which resets an
// oscillator's phase and a filter's history — inaudible once, and a continuous crackle if it happens
// sixty times a second while somebody drags a knob. So there are two paths, and they are not
// interchangeable:
//
//   `setParam`  updates the value in the patch AND calls `rack.setParam`, which reaches the audio
//               thread as a message and ramps across one block. Nothing is recompiled.
//   `structural` anything that changes what modules or cables exist. Bumps `revision`, which is what
//               the effect in `RackApp` watches, and only then is the patch recompiled.
//
// The counter rather than a deep comparison of the patch, because the comparison would have to
// deliberately ignore params to be correct, and a comparison with an exception in it is a thing
// somebody will later "simplify".
//
// **Every edit is settled through `applyModulation` before it is stored.** A Combinator routing is
// arithmetic from one param to another, so turning a rotary has to move the targets *in the patch* — that
// is what makes the driven knob visibly move, what makes the routed value autosave and travel in a link,
// and what lets the existing param-push subscription in `RackApp` deliver it to the audio thread with no
// new machinery at all. Settling in one helper rather than at each call site is deliberate: a route that
// applied on a rotary turn but not after loading a patch would be a rack that sounded different depending
// on how you got to it.
//
// A routing edit is deliberately **not** structural. It changes no module and no cable, so nothing needs
// recompiling; it only moves knobs, which is exactly the path `setParam` already owns.

export interface GrooveboxTapTarget {
  patternId: string
  section: GrooveboxSection
  voiceId: string
}

export interface GrooveboxTapHit {
  section: GrooveboxSection
  voiceId: string
  semitone: number
  accent: boolean
}

interface RackState {
  patch: Patch
  /** Bumped only when the graph needs rebuilding. Never by a knob. */
  revision: number
  /**
   * Where you have been, and where you have stepped back from. See `history.ts`.
   *
   * Held as data rather than as `canUndo`/`canRedo` flags so a component can subscribe to the depth it
   * cares about and nothing has to keep two representations agreeing.
   */
  history: History
  /**
   * Step back, or forward again. Both decline silently when there is nowhere to go, which is what lets
   * a keyboard shortcut call them without first asking.
   *
   * A restore is an ordinary document change: it settles, it autosaves, and it rebuilds the graph only
   * if the structure actually differs — see `needsRebuild`. Undoing a knob must not click.
   */
  undo: () => void
  redo: () => void
  /**
   * What is selected, in the order it was picked, for editing and for dimming the rest.
   *
   * **A list rather than an id plus a set.** Reordering and removal used to be one module at a time, which
   * `docs/REASON-GAP.md` lists as the multi-select gap. Holding a primary id *and* a group would be two
   * representations that must agree, and this store's own rule is that nothing should have to keep two of
   * those in step — so the list is the only truth and `primary` reads off the end of it.
   */
  selection: readonly string[]
  flipped: boolean
  /**
   * What the compiler had to decide or discard, straight from the Rack.
   *
   * Held here so the back panel can draw a delayed cable differently and the header can say when a
   * module is a placeholder. It is not a log — a UI that does not show these is a UI that lies about
   * the patch, which is the argument `compile.ts` makes for producing them at all.
   */
  notes: PlanNote[]
  /** What the open patch is called in the library, or null for one that has never been saved — imported
   *  from a file, opened from a link, or the shipped patch it started on. */
  name: string | null
  /**
   * The last note MIDI sent, and the inputs it came from. **Performance, not document.**
   *
   * Deliberately here and not in the patch. A note somebody played is not part of what they built, and
   * routing it through `setParam` would autosave the last key anybody pressed into the file. The audio
   * thread gets these straight from `Rack.setParam`; this copy exists only so a faceplate can answer "is my
   * keyboard connected", which is the first question anybody has.
   */
  midiNote: number | null
  midiInputs: string[]

  setParam: (moduleId: string, paramId: string, value: number) => void
  paramValue: (moduleId: string, paramId: string) => number

  /**
   * Whether a knob turn is also recorded onto a lane.
   *
   * Session state, not document state — deliberately, and for the same reason `running` is. Arming is
   * something you are doing right now; saving a patch that reopened already recording would overwrite the
   * automation somebody had just loaded, with the first knob they touched.
   */
  automating: boolean
  setAutomating: (automating: boolean) => void
  /**
   * Where the transport is, in sixteenths, or null when there is nowhere to record.
   *
   * A callback rather than a number, so the position is read at the instant the knob moves rather than
   * being pushed into the store sixty times a second — which is the same shape `grooveboxAutomationPosition`
   * uses, and for the same reason: a stored playhead is a render per frame to deliver a number nobody was
   * looking at.
   */
  automationPosition: (() => number | null) | null
  setAutomationPosition: (position: (() => number | null) | null) => void
  /** Forget one parameter's recording. */
  clearAutomation: (moduleId: string, paramId: string) => void

  /**
   * Write one lane of a pattern. **Not structural**, for the same reason a knob is not.
   *
   * Pattern data lives in `PatchModule.data`, which `compile` copies into the plan — so treating an edit as
   * structural would recompile and rebuild every processor on every cell you touched, which is a click per
   * edit and a continuous crackle while dragging a value. Instead this takes the same two paths `setParam`
   * takes: the patch is updated so the edit saves and travels in a link, and `RackApp` pushes the array at
   * the audio thread as a `data` message, which the Graph keeps in `pushed` and which survives a rebuild.
   *
   * That `pushed` beats `seeded` is what makes it work at all, and it was already true — it exists so that
   * recompiling a patch does not throw away a break somebody loaded. A pattern is the same shape of problem.
   */
  setLane: (moduleId: string, lane: number, values: readonly number[]) => void
  /** One lane's steps, or an empty array. The patch is the source of truth; the audio thread has a copy. */
  lane: (moduleId: string, lane: number) => number[]

  /**
   * Write one data slot by name — what `setLane` is the Tracker-shaped case of.
   *
   * The Arranger's sections are not lanes, but they are the same kind of thing: an array a module reads at
   * audio rate, edited while it plays, which must not rebuild the graph. Rather than give each module its
   * own store action, the general one is the primitive and `setLane` keeps its name because `lane3` reads
   * better at the call site than the string does.
   */
  setData: (moduleId: string, slot: string, values: readonly number[]) => void
  /** One data slot, or an empty array. */
  data: (moduleId: string, slot: string) => number[]

  /**
   * Set one device's knobs from a saved patch, in one edit.
   *
   * **Not structural**, which is the whole reason it is worth having as an action rather than as a loop
   * of `setParam` at the call site. Nothing about the graph changes — no module appears, no cable moves —
   * so recompiling would rebuild every processor in the rack and click, for a change that is sixteen
   * numbers. It takes the road a knob takes, and the host's patch diff carries every one of them to the
   * audio thread.
   *
   * One edit, so it is **one undo**. Sixteen `setParam` calls would be sixteen steps, and stepping back
   * out of a preset you did not like would mean pressing undo until the sound stopped changing.
   *
   * The params are completed against the def first — see `completeParams`. A device patch that mentioned
   * only what it cared about would leave everything else exactly as the last preset left it, which makes
   * the browser's second click sound different from its first.
   */
  loadDevicePatch: (moduleId: string, patch: DevicePatch) => void
  /** What a device is set to now, as a patch ready to be named and saved. */
  devicePatchOf: (moduleId: string) => Record<string, number> | null

  addModule: (type: string) => void
  /**
   * Drop a pre-wired group of modules in, on its own channel.
   *
   * Reason's Combinator, and the reason there is one rack rather than several — see the note at the top of
   * `chunks/index.ts`. Returns the ids it handed out so the host can address what it just added, which is
   * how a chunk containing a Sampler gets a break loaded into the right one.
   */
  addChunk: (chunk: Chunk) => Inserted
  /**
   * Copy one module, with everything you have turned on it, and drop it in beside the original.
   *
   * The thing `addChunk` is not. A chunk is a *recipe* — a group of modules wired the way somebody wrote
   * them down — and there was no way at all to take a module you had spent five minutes dialling in and
   * have a second one like it. The commonest thing anybody wants two of is the one they just tuned.
   *
   * **The copy arrives unpatched, and that is not laziness.** Copying the outgoing cables would aim them
   * at the same inlets, and one cable per inlet means the later one wins — so duplicating a module would
   * silently *unpatch* the original, which is the opposite of what the word means. Copying the incoming
   * ones is safe but half an answer, and an edit that does half of a thing is worse than one that does
   * none of it and says so. Combinator routings are left alone for the same reason: a routing names its
   * target by module id, so copied ones would aim at the targets the original already drives and the two
   * panels would fight over every knob.
   */
  duplicateModule: (moduleId: string) => void
  /**
   * Take a module out of circuit, or put it back.
   *
   * Structural, because the compiler resolves it: a bypassed module gets no node at all and everything
   * reading its outlets is redirected to whatever reaches its first inlet. So this rebuilds the graph,
   * which also means a bypassed module's filter history and oscillator phase are gone when it comes back —
   * the honest consequence of not running it, and the reason bypassing a Vocoder actually buys something.
   */
  setBypassed: (moduleId: string, bypassed: boolean) => void
  removeModule: (moduleId: string) => void
  moveModule: (moduleId: string, by: number) => void
  /**
   * Move a module to an insertion index, which is what a drag reports.
   *
   * Separate from `moveModule` rather than replacing it. The buttons step by one and are the only way in
   * for anybody who cannot drag — the same standard the back panel holds itself to, where Enter arms a
   * jack because "a modular whose whole point is the cables is a poor thing to make mouse-only".
   */
  dropModule: (moduleId: string, index: number) => void

  connect: (from: [string, string], to: [string, string]) => void
  disconnect: (cable: PatchCable) => void

  /**
   * Point one Combinator control at one parameter. Reason's Modulation Routing.
   *
   * Indexed operations rather than keyed ones, because the routing list's **order is part of the
   * document**: two routes onto one target resolve last-wins, the same rule two cables into one inlet
   * follow. A keyed collection would have thrown that away.
   */
  addRoute: (from: [string, string], to: [string, string]) => void
  /** Change one end, or one limit, of an existing routing. */
  setRoute: (index: number, change: Partial<ModRoute>) => void
  removeRoute: (index: number) => void
  /**
   * Which Combinator's routing panel is open, or null. **Session state, never part of the patch.**
   *
   * Here rather than in `RackApp`'s own state because the control that opens it is on the faceplate, and a
   * faceplate is handed nothing but its def and its params — the same reason the Sampler reaches in here
   * for what file it is holding.
   */
  editingRoutes: string | null
  editRoutes: (moduleId: string | null) => void

  /**
   * Learned MIDI controller mappings. **Session state kept beside the patch, never in it.**
   *
   * A patch travels in a URL; a binding describes the box on somebody's desk. Sharing a patch that
   * silently re-aimed another person's controller would be wrong, and carrying a mapping for hardware
   * nobody else owns would be carrying noise. See the note at the top of `cc.ts`.
   */
  ccBindings: CcBinding[]
  /** Which parameter is waiting to be taught a controller, or null. */
  ccLearning: { module: string; param: string } | null
  /** Arm a parameter: the next controller message that arrives becomes its binding. */
  startCcLearn: (moduleId: string, paramId: string) => void
  cancelCcLearn: () => void
  /**
   * Finish a learn. Does nothing if nothing was armed, which is what a stray controller message is.
   *
   * Takes no channel on purpose. A binding listens on every channel, because a controller's knobs and its
   * keys often sit on different ones and somebody who has just turned a knob to teach it should not have
   * to know which was listening. Per-channel binding is a small change to `CcBinding`, which already
   * carries the field, on the day two controllers make it worth having.
   */
  finishCcLearn: (cc: number) => void
  clearCcBinding: (moduleId: string, paramId: string) => void

  setNotes: (notes: PlanNote[]) => void
  setName: (name: string | null) => void
  setMidi: (note: number | null, inputs?: string[]) => void
  /** Structural: the graph is rebuilt with a different number of processors per module. */
  setVoices: (voices: number) => void
  /** Not structural. Tempo is a value in the patch — it saves and it travels in a link, but changing it does not
   *  rebuild the graph, so it goes down the same path a knob does. */
  setTempo: (tempo: number) => void
  /** Change the generated break the patch asks its host to load. The id travels; the rendered audio does not. */
  setBreak: (id: string | null) => void
  /** Save a host-resolved performance scene. Compatible Groovebox documents keep the
   * hint inside their retained song; rack-native documents keep it on the patch. */
  setVisual: (scene: string) => void
  /**
   * Replace one pattern inside the retained Groovebox song.
   *
   * This is document data, but not rack graph data: the hosted engine reads the next
   * immutable song at the following scheduled step, so a step edit must not rebuild the
   * worklet graph or restart the arrangement.
   */
  /** Pass discrete for one-shot transforms; direct painting coalesces by pattern. */
  setGrooveboxPattern: (pattern: Pattern, discrete?: boolean) => void
  /** Edit one authored drum voice without rebuilding the hosted engine. */
  setGrooveboxVoiceParam: (
    voiceId: string,
    key: keyof VoiceParams,
    value: number,
  ) => void
  /** Edit one authored 303 without rebuilding the hosted engine. */
  setGrooveboxBassParam: (
    voiceId: '303.a' | '303.b',
    key: keyof BassParams,
    value: number,
  ) => void
  /** Edit the shared 909 flam spacing without rebuilding the hosted engine. */
  setGrooveboxFlamWidth: (value: number) => void
  /** Edit the retained song's global swing and record it when automation is active. */
  setGrooveboxSwing: (value: number) => void
  /** Edit and optionally record one voice's offset from global song swing. */
  setGrooveboxVoiceSwing: (voiceId: string, value: number) => void
  /** Edit and optionally record one voice's delay or reverb send. */
  setGrooveboxSend: (
    voiceId: string,
    key: keyof SendLevels,
    value: number,
  ) => void
  /** Edit and optionally record one shared Groovebox effect control. */
  setGrooveboxFx: (key: keyof FxParams, value: number) => void
  /** Remove every retained automation lane as one undoable document edit. */
  clearGrooveboxAutomation: () => void
  /** Assign one retained machine clip to one arrangement section. */
  setGrooveboxClip: (
    section: number,
    machine: GrooveboxSection,
    patternId: string,
  ) => void
  /**
   * Live clip launch is session performance state, never part of the patch or undo history.
   *
   * RackApp installs the engine callback after audio starts. The event map lets the
   * faceplate distinguish a queued launch from the one active after its requested boundary.
   */
  grooveboxLauncher: ((
    machine: GrooveboxSection,
    patternId: string | null,
    quantization?: ClipLaunchQuantization,
  ) => boolean) | null
  setGrooveboxLauncher: (launcher: RackState['grooveboxLauncher']) => void
  grooveboxLaunches: Partial<
    Record<
      GrooveboxSection,
      {
        patternId: string | null
        phase: ClipLaunchPhase
        quantization: ClipLaunchQuantization
      }
    >
  >
  setGrooveboxLaunch: (event: ClipLaunchEvent) => void
  clearGrooveboxLaunches: () => void
  grooveboxLaunchQuantization: ClipLaunchQuantization
  setGrooveboxLaunchQuantization: (quantization: ClipLaunchQuantization) => void
  /**
   * Hosted song navigation is session state. The engine owns the clock; the store only
   * gives the faceplate a host callback and the loop range it needs to draw.
   */
  grooveboxTransport: {
    startAt: (bar: number) => boolean
    setLoop: (start: number, bars: number) => boolean
    clearLoop: () => void
  } | null
  setGrooveboxTransport: (transport: RackState['grooveboxTransport']) => void
  grooveboxLoop: { start: number; bars: number } | null
  setGrooveboxLoop: (loop: RackState['grooveboxLoop']) => void
  /** Armed state and the engine-owned playhead are session facts, not rack document data. */
  grooveboxAutomationRecording: boolean
  toggleGrooveboxAutomationRecording: () => void
  grooveboxAutomationPosition: (() => { bar: number; index: number } | null) | null
  setGrooveboxAutomationPosition: (
    position: RackState['grooveboxAutomationPosition'],
  ) => void
  /** Keyboard tap recording is armed and focused in the editor, but never saved in the patch. */
  grooveboxTapRecording: boolean
  grooveboxTapTarget: GrooveboxTapTarget | null
  /** Stopped-transport 303 entry cursor. Session state, shared with the faceplate. */
  grooveboxTapStep: number
  toggleGrooveboxTapRecording: () => void
  setGrooveboxTapTarget: (target: GrooveboxTapTarget) => void
  setGrooveboxTapStep: (step: number) => void
  /** Quantise at the playhead, or advance the focused 303 cursor while stopped. */
  recordGrooveboxTap: (note: number, velocity: number) => GrooveboxTapHit | null
  /**
   * What is loaded into each Sampler, by module id. **Session state, never part of the patch.**
   *
   * The audio itself is not here — only what a faceplate needs to say what it is holding. A break is
   * megabytes and the store is diffed on every render; keeping it here would also put it one careless
   * `encodePatch` away from being written into a shared link.
   *
   * It is keyed by module id rather than being one global sample because a patch can have two Samplers, and
   * before this there was no way to say which one a file was meant for — loading pushed to all of them.
   */
  samples: Record<string, SampleInfo>
  setSample: (moduleId: string, sample: SampleInfo | null) => void
  /**
   * Re-read a loaded file as a different number of bars, and adopt the tempo that implies.
   *
   * The correction for the one mistake `guessBars` can make. It is always out by a factor of two, so the
   * fix is one press — and the tempo has to move with it or the slices stop landing on the beat, which is
   * the whole reason the bar count matters.
   */
  setSampleBars: (moduleId: string, bars: number) => void
  /**
   * Load a file into one Sampler.
   *
   * Installed by `RackApp`, because decoding is cheap but *pushing* needs the live Rack and the store has
   * no business knowing about it. Null until the page has mounted, which is also the honest answer for a
   * faceplate rendered in a test.
   */
  loadSampleInto: ((moduleId: string, file: File) => Promise<void>) | null
  setSampleLoader: (load: RackState['loadSampleInto']) => void
  /**
   * Audition the decoded sample without requiring a trigger cable or a running transport.
   *
   * Installed by `RackApp` beside the loader because it owns the retained PCM and the AudioContext. Calling
   * it again for the playing sampler stops the preview, so every faceplate shares one honest transport.
   */
  previewSample: ((moduleId: string) => Promise<void>) | null
  setSamplePreviewer: (preview: RackState['previewSample']) => void
  previewingSample: string | null
  setPreviewingSample: (moduleId: string | null) => void
  /** Session state, not part of the patch. */
  running: boolean
  setRunning: (running: boolean) => void
  /**
   * Make sure there is a Sampler with somewhere to send its output, and return its id.
   *
   * Exists because clicking a break with no Sampler in the patch used to do nothing at all. Being told to go and
   * assemble three modules before a break will play is the opposite of what this instrument is for — so it wires
   * the smallest thing that works: a Transport if there is not one, a Sampler, a sixteenth into its trigger, and
   * its output to the existing Out or a new one.
   *
   * A no-op when a Sampler already exists, so it never rearranges a patch somebody built.
   */
  ensureSampler: () => string
  /**
   * Make sure there is a MIDI module with somewhere to send its notes, and return its id.
   *
   * The same reasoning as `ensureSampler`, and the same bug avoided: pressing a key on a rack with no MIDI
   * module used to be indistinguishable from a broken keyboard. Being told to go and patch two cables
   * before a note will sound is the opposite of what this instrument is for.
   *
   * **It takes over the pitch and gate inlets it lands on**, because one cable per inlet is the rule
   * everywhere — the compiler enforces it and `connect` mirrors it, which is what dragging a cable onto an
   * occupied input does in Reason. On the starter patch that means the keyboard replaces the sequencer as
   * what plays the voice, which is exactly what somebody pressing a key is asking for. It is visible on the
   * back panel and undone by patching the sequencer back.
   *
   * A no-op when a MIDI module already exists, so it never rearranges a patch somebody built.
   */
  ensureMidi: () => string | null
  load: (patch: Patch) => void
  /** Pick one, or with `extend` add it to the group — or take it back out, which is the half people reach
   *  for immediately after picking one thing too many. `null` clears. */
  select: (moduleId: string | null, extend?: boolean) => void
  /** Everything between the last thing picked and this one, in rack order. Shift-click. */
  selectRange: (moduleId: string) => void
  /** Remove everything selected, in one structural edit and therefore one undo step. */
  removeSelected: () => void
  flip: (flipped?: boolean) => void
}

/** A fresh id for a module of this type: `vco-1`, `vco-2`. Stable, readable, and — because anything
 *  random in the rack seeds from the module id — it is also what decides what a Noise module sounds
 *  like, so it must not be a timestamp or a counter that resets. */
/**
 * The outlet a newly added module should be heard through, or null for one that should arrive unpatched.
 *
 * Reason connects a new device to the next free mixer channel. Doing the same here is what turns a click
 * in the picker into a sound rather than a silent rectangle you then have to wire up — which matters most
 * for exactly the modules the picker gallery was built to show off.
 *
 * **Two conditions, and neither is a special case.** A module in the `Sources` group, so that adding an EQ
 * or a Delay does not create a channel with nothing feeding it. And an outlet literally named `out`, which
 * is how a def *declares* which of its outlets is the main one.
 *
 * The second is what keeps this honest rather than a guess. Two shipped sources deliberately do not
 * qualify: the Noise has `white` and `pink`, which are equally its output, and the Groovebox has eight —
 * four machines in stereo pairs — so wiring "the first one" would give you the 808's left channel and the
 * strong impression that the other three machines were broken. A module that has not said which outlet is
 * primary is one the rack should not answer for, so those two arrive unpatched as everything did before.
 */
function autoOutlet(type: string): string | null {
  const def = MODULES[type]
  if (!def || def.group !== 'Sources') return null
  return def.outlets.some((outlet) => outlet.id === 'out') ? 'out' : null
}

function freshId(patch: Patch, type: string): string {
  const taken = new Set(patch.modules.map((m) => m.id))
  for (let n = 1; ; n++) {
    const id = `${type}-${n}`
    if (!taken.has(id)) return id
  }
}

/**
 * What a first-time visitor arrives on.
 *
 * A beat, not a bleep. `docs/DNB.md` is explicit that the reward for the gesture that starts audio has to be
 * immediate and has to be the thing this rack is for — and a sequenced acid line, which is what this used to
 * be, is a demonstration rather than a record.
 *
 * The shipped factory rather than a second copy of it: `@driftbox/rack` owns presets for the same reason the
 * engine owns songs. They are data about the instrument, not about the page showing it.
 */
const FIRST_PRESET = patchPresetById('pressure-system') ?? PATCHES[0]

const STARTER = (): Patch => FIRST_PRESET.build()

/** What a faceplate needs to say what a Sampler is holding. Deliberately not the audio. */
export interface SampleInfo {
  name: string
  /** How many bars the file was taken to be — the number the derived tempo rests on. */
  bars: number
  seconds: number
  /** Display-only peak envelope. Small enough for state; the audio buffer itself deliberately stays out. */
  peaks: readonly number[]
  /** A shipped break can be re-rendered from its id; somebody's own file cannot travel in a link. */
  source: 'break' | 'file'
}

export const useRack = create<RackState>((set, get) => {
  /**
   * Run every Combinator routing over a patch before it is stored.
   *
   * One place, so no edit can forget. `applyModulation` returns the very same object when nothing moved,
   * so this is free on the overwhelming majority of edits — the store diffs by reference and a settled
   * patch stays reference-equal.
   */
  const settle = (patch: Patch): Patch => applyModulation(patch, MODULES)

  /**
   * **Every write to the document goes through here.** Settling, autosave, undo and the revision are all
   * decided in one place, so no edit can forget one of them.
   *
   * That was already the argument for `structural`, and undo is what made it worth extending to the
   * edits that are *not* structural. A knob, a pattern cell, the tempo and a retained groovebox pattern
   * each used to call `set` themselves; each would have had to remember to record history, and the one
   * that forgot would not fail loudly — it would silently make undo skip a step.
   *
   * **An edit that changed nothing changes nothing.** The revision is what makes `RackApp` recompile,
   * and recompiling rebuilds every processor, resetting each oscillator's phase and each filter's
   * history — an audible click. Several edits here can legitimately be no-ops: moving the first module
   * up, dropping a dragged module back where it started, removing an id that is not there. Reference
   * identity is the test, which is why the operations below are careful to hand back the very same patch
   * when they decline — the convention `applyModulation` and `reordered` already follow. A declined edit
   * must not land in the history either, or undo would appear to do nothing.
   *
   * `key` is the coalescing key from `history.ts`: null for an edit that stands alone, a string for one
   * that continues a gesture. `rebuild` is whether the graph has to be rebuilt.
   */
  const write = (key: string | null, rebuild: boolean, change: (patch: Patch) => Patch) => {
    set((state) => {
      const patch = settle(change(state.patch))
      if (patch === state.patch) return {}
      autosavePatch(patch)
      const history = remember(state.history, state.patch, key)
      return rebuild ? { patch, history, revision: state.revision + 1 } : { patch, history }
    })
  }

  /** A structural edit: what modules or cables exist. Never coalesces — each one is its own step. */
  const structural = (change: (patch: Patch) => Patch) => write(null, true, change)

  /** A routing edit: the document changes, the graph does not. Same path a knob takes. */
  const routing = (key: string | null, change: (routes: ModRoute[]) => ModRoute[]) => {
    write(key, false, (current) => {
      const routes = change([...(current.modulation ?? [])])
      // Absent rather than an empty array, so removing the last routing leaves a patch byte-identical to
      // one that never had any — the same standard `voices` and `tempo` hold themselves to.
      const { modulation: _drop, ...rest } = current
      return routes.length > 0 ? { ...rest, modulation: routes } : rest
    })
  }

  /** Add one point at the hosted audio clock when armed. No timer and no guessed UI playhead. */
  const recordGrooveboxPoint = (
    song: Song,
    target: string,
    value: number,
    interpolation: 'hold' | 'linear' = 'linear',
  ): Song => {
    const state = get()
    if (!state.grooveboxAutomationRecording) return song
    const position = state.grooveboxAutomationPosition?.()
    return position
      ? setAutomationPoint(song, target, position.bar, position.index, value, interpolation)
      : song
  }

  return {
    patch: EMPTY_PATCH,
    revision: 0,
    history: NO_HISTORY,
    selection: [],
    flipped: false,
    notes: [],
    name: null,
    midiNote: null,
    midiInputs: [],
    running: false,
    grooveboxLauncher: null,
    grooveboxLaunches: {},
    grooveboxLaunchQuantization: 'bar',
    grooveboxTransport: null,
    grooveboxLoop: null,
    grooveboxAutomationRecording: false,
    grooveboxAutomationPosition: null,
    grooveboxTapRecording: false,
    grooveboxTapTarget: null,
    grooveboxTapStep: 0,

    paramValue: (moduleId, paramId) => {
      const module = get().patch.modules.find((m) => m.id === moduleId)
      const saved = module?.params?.[paramId]
      if (saved !== undefined) return saved
      const def = module ? MODULES[module.type] : undefined
      return def?.params.find((p) => p.id === paramId)?.default ?? 0
    },

    setParam: (moduleId, paramId, value) => {
      // No revision bump. See the note at the top of this file — this is the whole reason it exists.
      // Coalesced by module and param, so one drag of one knob is one undo rather than four hundred.
      //
      // Settled by `write`, so turning a Combinator rotary moves everything it drives in the same edit.
      // That also means grabbing a *routed* knob directly is undone the moment its rotary next moves,
      // which is what Reason does and is the honest behaviour: the routing owns the knob, and the
      // faceplate marks it so rather than disabling it.
      //
      // When armed, the move is also written to a lane at wherever the transport is. Recorded in the same
      // edit rather than in a second one: two writes would be two undo steps for one gesture, and a patch
      // could be saved between them with the knob moved and the recording missing.
      const at = get().automating ? get().automationPosition?.() : null
      write(paramKey(moduleId, paramId), false, (patch) => {
        const moved = {
          ...patch,
          modules: patch.modules.map((module) =>
            module.id === moduleId
              ? { ...module, params: { ...module.params, [paramId]: value } }
              : module,
          ),
        }
        if (at === null || at === undefined) return moved
        return { ...moved, automation: setPoint(moved.automation, [moduleId, paramId], at, value) }
      })
    },

    automating: false,
    automationPosition: null,
    setAutomating: (automating) => set({ automating }),
    setAutomationPosition: (automationPosition) => set({ automationPosition }),

    clearAutomation: (moduleId, paramId) =>
      // Structural is wrong — a lane changes no module and no cable, so nothing needs recompiling and
      // clearing one must not click. The same path a knob takes.
      write(`automation:clear:${moduleId}:${paramId}`, false, (patch) => {
        const automation = clearLane(patch.automation, [moduleId, paramId])
        // `?? 0` matters: with no automation at all, `patch.automation?.length` is undefined and
        // `0 === undefined` is false — so clearing a lane that was never recorded wrote a new patch,
        // autosaved it and cost an undo step for nothing. Identity is the signal everywhere in this app.
        if (automation.length === (patch.automation?.length ?? 0)) return patch
        const next = { ...patch }
        // Dropped rather than left empty, so clearing the last lane leaves the patch exactly as it was
        // before anything was recorded — and round-tripping it stays byte-identical.
        if (automation.length > 0) next.automation = automation
        else delete next.automation
        return next
      }),

    setLane: (moduleId, lane, values) => get().setData(moduleId, `lane${lane + 1}`, values),

    lane: (moduleId, lane) => get().data(moduleId, `lane${lane + 1}`),

    setData: (moduleId, slot, values) => {
      // Coalesced by module and slot, for the same reason a knob is: painting a Tracker lane writes the
      // whole lane on every pointer move, so one drag across eight cells is one undo.
      write(dataKey(moduleId, slot), false, (patch) => ({
        ...patch,
        modules: patch.modules.map((module) =>
          module.id === moduleId
            ? { ...module, data: { ...module.data, [slot]: [...values] } }
            : module,
        ),
      }))
    },

    data: (moduleId, slot) =>
      get().patch.modules.find((m) => m.id === moduleId)?.data?.[slot] ?? [],

    loadDevicePatch: (moduleId, device) => {
      // Keyed to the module so that clicking through a bank coalesces into one undo step per device. The
      // gesture is "audition presets until one is right", and undo should step out of the audition rather
      // than back through every patch you rejected on the way.
      write(`device:${moduleId}`, false, (patch) => {
        const module = patch.modules.find((m) => m.id === moduleId)
        const def = module ? MODULES[module.type] : undefined
        // A module type this build does not have has no def to complete against, and guessing would write
        // knobs nothing reads into somebody's patch. Declines by identity, so it costs no undo step.
        if (!module || !def || def.type !== device.type) return patch
        const params = completeParams(def, device.params)
        return {
          ...patch,
          modules: patch.modules.map((candidate) =>
            candidate.id === moduleId ? { ...candidate, params } : candidate,
          ),
        }
      })
    },

    devicePatchOf: (moduleId) => {
      const module = get().patch.modules.find((m) => m.id === moduleId)
      const def = module ? MODULES[module.type] : undefined
      if (!module || !def) return null
      // Completed rather than handed back raw, so a device saved before it was ever touched still stores
      // every knob rather than an empty object that would load as a no-op.
      return completeParams(def, module.params)
    },

    addRoute: (from, to) =>
      // A fresh route sweeps the target end to end, which it says by leaving both limits absent rather
      // than by writing the numbers down. That way the patch does not hardcode a range a later version of
      // that module might widen, and the panel can show the real limits by looking them up.
      routing(null, (routes) => [...routes, { from, to }]),

    setRoute: (index, change) =>
      // Coalesced per routing rather than globally: the limits are number fields, and typing `1200` in
      // one fires four edits. Undo should step over the number, not over each digit of it.
      routing(`route:${index}`, (routes) => {
        if (index < 0 || index >= routes.length) return routes
        const next = { ...routes[index], ...change }
        // An erased number field means "the target's own limit", and is stored as absence. `in` rather
        // than a comparison to undefined, because clearing the field is done by passing undefined and the
        // spread above would otherwise leave the key present holding it — which JSON drops anyway, but
        // only after `applyModulation` has seen it. Zero would be the wrong repair either way: it aims
        // the route at the bottom of the range rather than at the end of it.
        if ('min' in change && !Number.isFinite(next.min)) delete next.min
        if ('max' in change && !Number.isFinite(next.max)) delete next.max
        routes[index] = next
        return routes
      }),

    removeRoute: (index) =>
      routing(null, (routes) => {
        if (index < 0 || index >= routes.length) return routes
        routes.splice(index, 1)
        return routes
      }),

    editingRoutes: null,
    editRoutes: (editingRoutes) => set({ editingRoutes }),

    // Read once, at construction. Bindings change when somebody learns one, which is rare, so there is
    // nothing to gain from re-reading storage and a stale read would be a mapping that stopped working.
    ccBindings: loadBindings(),
    ccLearning: null,
    startCcLearn: (module, param) => set({ ccLearning: { module, param } }),
    cancelCcLearn: () => set({ ccLearning: null }),
    finishCcLearn: (cc) => {
      const armed = get().ccLearning
      if (!armed) return
      const bindings = learn(get().ccBindings, { cc, channel: 0, ...armed })
      saveBindings(bindings)
      set({ ccBindings: bindings, ccLearning: null })
    },
    clearCcBinding: (module, param) => {
      const bindings = forget(get().ccBindings, module, param)
      saveBindings(bindings)
      set({ ccBindings: bindings })
    },

    addChunk: (chunk) => {
      let result: Inserted | null = null
      structural((patch) => {
        result = insertChunk(patch, chunk)
        return result.patch
      })
      return result!
    },

    addModule: (type) =>
      structural((patch) => {
        const id = freshId(patch, type)
        const modules = [...patch.modules, { id, type }]
        const port = autoOutlet(type)
        if (!port) return { ...patch, modules }

        // Its own Out, exactly the way `insertChunk` gives a chunk one — which is the same idea and the
        // reason `docs/REASON-GAP.md` listed this as "chunks only". Sharing an existing Out would put the
        // new thing on somebody else's fader; a fresh one is what makes a rack of sources a mixer.
        const out = freshId({ ...patch, modules }, 'out')
        return {
          ...patch,
          modules: [...modules, { id: out, type: 'out', params: { level: 0.7 } }],
          cables: [...patch.cables, { from: [id, port], to: [out, 'in'] }],
        }
      }),

    duplicateModule: (moduleId) =>
      structural((patch) => {
        const at = patch.modules.findIndex((m) => m.id === moduleId)
        // The same decline-by-identity convention every other structural edit follows, so a duplicate of
        // something that is not there is not an undo step that appears to do nothing.
        if (at < 0) return patch
        const source = patch.modules[at]

        const modules = [...patch.modules]
        // **Beside the original, not at the end of the rack.** The module list is the layout, so a copy
        // appended to the bottom is a copy you have to go and find — and then move back up past everything
        // else. This is also why it is `splice` rather than `push`: order is the document here.
        modules.splice(at + 1, 0, {
          ...source,
          // Anything random in the rack seeds from the module id, so the copy of a Noise is a *different*
          // noise rather than the same one twice as loud. That is the right answer and it comes for free
          // from numbering the way `addModule` does.
          id: freshId(patch, source.type),
          // Copied a level deeper than the spread reaches. Nothing mutates a patch in place today, so a
          // shared `params` object would not corrupt anything yet — and "yet" is the whole problem: two
          // modules whose data array is the same reference is a trap laid for whoever writes the first
          // in-place edit.
          ...(source.params ? { params: { ...source.params } } : {}),
          ...(source.data
            ? { data: Object.fromEntries(Object.entries(source.data).map(([k, v]) => [k, [...v]])) }
            : {}),
        })
        return { ...patch, modules }
      }),

    setBypassed: (moduleId, bypassed) =>
      structural((patch) => {
        const at = patch.modules.findIndex((m) => m.id === moduleId)
        if (at < 0 || (patch.modules[at].bypassed === true) === bypassed) return patch
        const modules = [...patch.modules]
        // Absent rather than `false`, so a patch that has never had anything bypassed stays byte-identical
        // to one written before bypass existed — the same standard `voices`, `tempo` and `modulation` hold.
        const { bypassed: _drop, ...rest } = modules[at]
        modules[at] = bypassed ? { ...rest, bypassed: true } : rest
        return { ...patch, modules }
      }),

    removeModule: (moduleId) =>
      structural((patch) => {
        // Every cable touching it goes too. The compiler would drop them anyway, but leaving them in
        // the patch means they come back if the module is re-added under the same id, which looks
        // like a haunting.
        const routes = (patch.modulation ?? []).filter(
          // And every routing touching it, at either end, for exactly the same reason. `applyModulation`
          // would skip them silently, so a stale route is quieter than a stale cable and therefore worse:
          // re-adding a Combinator under the same id would resurrect routings nobody could see.
          (route) => route.from[0] !== moduleId && route.to[0] !== moduleId,
        )
        const { modulation: _drop, ...rest } = patch
        return {
          ...rest,
          modules: patch.modules.filter((m) => m.id !== moduleId),
          cables: patch.cables.filter((c) => c.from[0] !== moduleId && c.to[0] !== moduleId),
          ...(routes.length > 0 ? { modulation: routes } : {}),
        }
      }),

    dropModule: (moduleId, index) =>
      structural((patch) => {
        const from = patch.modules.findIndex((m) => m.id === moduleId)
        const modules = reordered(patch.modules, from, index)
        // The same array back means the drop changed nothing. Returning the same *patch* is what tells
        // `structural` not to bump the revision, which is what stops a drag that ends where it started
        // from rebuilding every processor in the rack.
        return modules === patch.modules ? patch : { ...patch, modules: [...modules] }
      }),

    moveModule: (moduleId, by) =>
      structural((patch) => {
        const at = patch.modules.findIndex((m) => m.id === moduleId)
        const to = at + by
        if (at < 0 || to < 0 || to >= patch.modules.length) return patch
        const modules = [...patch.modules]
        const [module] = modules.splice(at, 1)
        modules.splice(to, 0, module)
        return { ...patch, modules }
      }),

    connect: (from, to) =>
      structural((patch) => ({
        ...patch,
        // One cable per inlet, matching the compiler — which takes the last and reports the earlier as
        // replaced. Doing it here as well means the patch says what it does rather than carrying a
        // cable that exists only to be discarded.
        cables: [
          ...patch.cables.filter((c) => !(c.to[0] === to[0] && c.to[1] === to[1])),
          { from, to },
        ],
      })),

    disconnect: (cable) =>
      structural((patch) => ({
        ...patch,
        cables: patch.cables.filter(
          (c) =>
            !(
              c.from[0] === cable.from[0] &&
              c.from[1] === cable.from[1] &&
              c.to[0] === cable.to[0] &&
              c.to[1] === cable.to[1]
            ),
        ),
      })),

    setNotes: (notes) => set({ notes }),
    setName: (name) => set({ name }),
    samples: {},
    setSample: (moduleId, sample) =>
      set((state) => {
        const samples = { ...state.samples }
        if (sample) samples[moduleId] = sample
        else delete samples[moduleId]
        return { samples }
      }),
    setSampleBars: (moduleId, bars) => {
      const info = get().samples[moduleId]
      if (!info) return
      const tempo = tempoForBars(info.seconds, bars)
      if (!(tempo > 0)) return
      set((state) => ({ samples: { ...state.samples, [moduleId]: { ...info, bars } } }))
      get().setTempo(Math.round(tempo * 100) / 100)
    },
    loadSampleInto: null,
    setSampleLoader: (loadSampleInto) => set({ loadSampleInto }),
    previewSample: null,
    setSamplePreviewer: (previewSample) => set({ previewSample }),
    previewingSample: null,
    setPreviewingSample: (previewingSample) => set({ previewingSample }),

    setMidi: (midiNote, inputs) =>
      set((state) => ({ midiNote, midiInputs: inputs ?? state.midiInputs })),

    setTempo: (tempo) => {
      const state = get()
      const retained = grooveboxSong(state.patch)
      if (retained && state.grooveboxAutomationRecording) {
        write(`groovebox:automation:${AUTOMATION_TARGET.bpm}`, false, (patch) => {
          const song = grooveboxSong(patch)
          if (!song) return patch
          const bpm = Math.max(20, Math.min(300, tempo))
          const edited = song.bpm === bpm ? song : { ...song, bpm }
          const next = recordGrooveboxPoint(
            edited,
            AUTOMATION_TARGET.bpm,
            bpm,
            'hold',
          )
          const { tempo: _drop, ...rest } = patch
          return { ...rest, groovebox: encodeSong(next) }
        })
        return
      }
      // One key for the whole control: a tempo field is dragged or typed into, and either way the
      // gesture is "set the tempo" rather than one edit per intermediate number.
      write('tempo', false, (patch) => {
        const wanted = Math.max(20, Math.min(400, tempo))
        return wanted === 120
          ? (({ tempo: _drop, ...rest }) => rest)(patch)
          : { ...patch, tempo: wanted }
      })
    },
    setBreak: (id) =>
      write('break', false, (patch) => {
        if ((id ?? undefined) === patch.break) return patch
        const { break: _drop, ...rest } = patch
        return id ? { ...rest, break: id } : rest
      }),
    setVisual: (scene) =>
      write('visual', false, (patch) => {
        const wanted = scene.trim().slice(0, 120)
        if (wanted === '') return patch
        const song = grooveboxSong(patch)
        if (song) {
          if (song.visual === wanted && patch.visual === undefined) return patch
          const { visual: _drop, ...rest } = patch
          return { ...rest, groovebox: encodeSong({ ...song, visual: wanted }) }
        }
        return patch.visual === wanted ? patch : { ...patch, visual: wanted }
      }),

    setGrooveboxPattern: (pattern, discrete = false) =>
      // Keyed by the pattern, so painting a drum lane in the retained song coalesces the way painting a
      // Tracker lane does. Undoing it re-encodes the previous song, which the hosted engine picks up on
      // its next step — the same live handoff a forward edit uses, and no graph rebuild either way.
      write(discrete ? null : `groovebox:${pattern.id}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song || !song.patterns.some((candidate) => candidate.id === pattern.id)) return patch
        const next: Song = {
          ...song,
          patterns: song.patterns.map((candidate) =>
            candidate.id === pattern.id ? pattern : candidate,
          ),
        }
        return { ...patch, groovebox: encodeSong(next) }
      }),

    setGrooveboxFlamWidth: (value) =>
      write('groovebox:flam-width', false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song) return patch
        const flam = Math.max(0, Math.min(1, value))
        if ((song.kit.flam ?? 0.4) === flam) return patch
        return {
          ...patch,
          groovebox: encodeSong({
            ...song,
            kit: { ...song.kit, flam },
          }),
        }
      }),

    setGrooveboxSwing: (value) =>
      write(`groovebox:automation:${AUTOMATION_TARGET.swing}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song) return patch
        const swing = Math.max(0, Math.min(1, value))
        const edited = song.swing === swing ? song : { ...song, swing }
        const next = recordGrooveboxPoint(
          edited,
          AUTOMATION_TARGET.swing,
          swing,
        )
        if (next === song) return patch
        return { ...patch, groovebox: encodeSong(next) }
      }),

    setGrooveboxVoiceSwing: (voiceId, value) =>
      write(`groovebox:voice-swing:${voiceId}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song) return patch
        const swing = Math.max(0, Math.min(1, value))
        const current = song.kit.swing?.[voiceId] ?? 0.5
        const edited: Song =
          current === swing
            ? song
            : {
                ...song,
                kit: {
                  ...song.kit,
                  swing: { ...song.kit.swing, [voiceId]: swing },
                },
              }
        const next = recordGrooveboxPoint(
          edited,
          AUTOMATION_TARGET.voiceSwing(voiceId),
          swing,
        )
        if (next === song) return patch
        return { ...patch, groovebox: encodeSong(next) }
      }),

    setGrooveboxSend: (voiceId, key, value) =>
      write(`groovebox:send:${voiceId}:${key}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song) return patch
        const nextValue = Math.max(0, Math.min(1, value))
        const current = song.kit.sends?.[voiceId] ?? DEFAULT_SENDS
        const edited: Song =
          current[key] === nextValue
            ? song
            : {
                ...song,
                kit: {
                  ...song.kit,
                  sends: {
                    ...song.kit.sends,
                    [voiceId]: { ...current, [key]: nextValue },
                  },
                },
              }
        const next = recordGrooveboxPoint(
          edited,
          AUTOMATION_TARGET.send(voiceId, key),
          nextValue,
        )
        if (next === song) return patch
        return { ...patch, groovebox: encodeSong(next) }
      }),

    setGrooveboxFx: (key, value) =>
      write(`groovebox:fx:${key}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song) return patch
        const nextValue = Math.max(0, Math.min(1, value))
        const current = song.fx ?? DEFAULT_FX
        const edited: Song =
          current[key] === nextValue
            ? song
            : { ...song, fx: { ...current, [key]: nextValue } }
        const next = recordGrooveboxPoint(
          edited,
          AUTOMATION_TARGET.fx(key),
          nextValue,
        )
        if (next === song) return patch
        return { ...patch, groovebox: encodeSong(next) }
      }),

    clearGrooveboxAutomation: () =>
      write(null, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song?.automation?.length) return patch
        return {
          ...patch,
          groovebox: encodeSong({ ...song, automation: undefined }),
        }
      }),

    setGrooveboxVoiceParam: (voiceId, key, value) =>
      write(`groovebox:voice:${voiceId}:${key}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song) return patch
        const current = song.kit.params[voiceId] ?? DEFAULT_PARAMS
        const nextValue = Math.max(0, Math.min(1, value))
        const edited: Song =
          current[key] === nextValue
            ? song
            : {
                ...song,
                kit: {
                  ...song.kit,
                  params: {
                    ...song.kit.params,
                    [voiceId]: { ...current, [key]: nextValue },
                  },
                },
              }
        const next = recordGrooveboxPoint(
          edited,
          AUTOMATION_TARGET.voice(voiceId, key),
          nextValue,
        )
        if (next === song) return patch
        return { ...patch, groovebox: encodeSong(next) }
      }),

    setGrooveboxBassParam: (voiceId, key, value) =>
      write(`groovebox:bass:${voiceId}:${key}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song) return patch
        const current = song.kit.bass?.[voiceId] ?? DEFAULT_BASS_PARAMS
        const nextValue = Math.max(0, Math.min(1, value))
        const edited: Song =
          current[key] === nextValue
            ? song
            : {
                ...song,
                kit: {
                  ...song.kit,
                  bass: {
                    ...song.kit.bass,
                    [voiceId]: { ...current, [key]: nextValue },
                  },
                },
              }
        const next = recordGrooveboxPoint(
          edited,
          AUTOMATION_TARGET.bass(voiceId, key),
          nextValue,
        )
        if (next === song) return patch
        return { ...patch, groovebox: encodeSong(next) }
      }),

    setGrooveboxClip: (section, machine, patternId) =>
      write(`groovebox:clip:${section}:${machine}`, false, (patch) => {
        const song = grooveboxSong(patch)
        if (!song || !song.patterns.some((pattern) => pattern.id === patternId)) return patch
        const chain =
          song.chain.length > 0
            ? song.chain
            : [{ pattern: song.patterns[0]?.id ?? patternId, repeat: 1 }]
        if (section < 0 || section >= chain.length) return patch
        const withChain = { ...song, chain }
        const next: Song = {
          ...withChain,
          chain: chainSetClip(withChain, section, machine, patternId),
        }
        return { ...patch, groovebox: encodeSong(next) }
      }),

    setGrooveboxLauncher: (grooveboxLauncher) => set({ grooveboxLauncher }),
    setGrooveboxLaunch: (event) =>
      set((state) => {
        const grooveboxLaunches = { ...state.grooveboxLaunches }
        if (event.phase === 'active' && event.patternId === null) {
          delete grooveboxLaunches[event.section]
        } else {
          grooveboxLaunches[event.section] = {
            patternId: event.patternId,
            phase: event.phase,
            quantization: event.quantization,
          }
        }
        return { grooveboxLaunches }
      }),
    clearGrooveboxLaunches: () => set({ grooveboxLaunches: {} }),
    setGrooveboxLaunchQuantization: (grooveboxLaunchQuantization) =>
      set({ grooveboxLaunchQuantization }),
    setGrooveboxTransport: (grooveboxTransport) => set({ grooveboxTransport }),
    setGrooveboxLoop: (grooveboxLoop) => set({ grooveboxLoop }),
    toggleGrooveboxAutomationRecording: () =>
      set((state) => ({
        grooveboxAutomationRecording: !state.grooveboxAutomationRecording,
      })),
    setGrooveboxAutomationPosition: (grooveboxAutomationPosition) =>
      set({ grooveboxAutomationPosition }),
    toggleGrooveboxTapRecording: () =>
      set((state) => ({ grooveboxTapRecording: !state.grooveboxTapRecording })),
    setGrooveboxTapTarget: (grooveboxTapTarget) => set({ grooveboxTapTarget }),
    setGrooveboxTapStep: (grooveboxTapStep) => set({ grooveboxTapStep }),
    recordGrooveboxTap: (note, velocity) => {
      const state = get()
      const song = grooveboxSong(state.patch)
      const position = state.grooveboxAutomationPosition?.()
      if (!state.grooveboxTapRecording || !song) return null

      const target = state.grooveboxTapTarget
      const pattern =
        song.patterns.find((candidate) => candidate.id === target?.patternId) ??
        song.patterns[0]
      if (!pattern || pattern.length <= 0) return null

      const section = target?.section ?? 'tr808'
      const bass = section === '303.a' || section === '303.b'
      if (!position && !bass) return null
      const voiceId = bass
        ? section
        : ALL_VOICES.some(
              (voice) => voice.id === target?.voiceId && voice.machine === section,
            )
          ? target!.voiceId
          : ALL_VOICES.find((voice) => voice.machine === section)?.id
      if (!voiceId) return null

      const rawStep = position?.index ?? state.grooveboxTapStep
      const step = ((Math.floor(rawStep) % pattern.length) + pattern.length) % pattern.length
      const accent = velocity >= 0.75
      const semitone = Math.max(0, Math.min(24, Math.round(note) - 36))
      const entered = bass
        ? enterBassNote(pattern, voiceId, step, semitone, accent)
        : null
      const nextPattern = entered
        ? entered.pattern
        : setStep(pattern, voiceId, step, accent ? 2 : 1)

      write(`groovebox:tap:${pattern.id}`, false, (patch) => {
        const current = grooveboxSong(patch)
        if (!current?.patterns.some((candidate) => candidate.id === pattern.id)) return patch
        return {
          ...patch,
          groovebox: encodeSong({
            ...current,
            patterns: current.patterns.map((candidate) =>
              candidate.id === pattern.id ? nextPattern : candidate,
            ),
          }),
        }
      })
      if (!position && entered) set({ grooveboxTapStep: entered.nextStep })
      return { section, voiceId, semitone, accent }
    },

    setRunning: (running) => set({ running }),

    ensureSampler: () => {
      const existing = get().patch.modules.find((m) => m.type === 'sampler')
      if (existing) return existing.id

      const id = freshId(get().patch, 'sampler')
      structural((patch) => {
        const modules = [...patch.modules]
        const cables = [...patch.cables]

        // Reuse whatever is already there rather than duplicating it — a second Out would sum alongside the first
        // and a second Transport would just agree with it.
        let transport = modules.find((m) => m.type === 'transport')?.id
        if (!transport) {
          transport = freshId({ ...patch, modules }, 'transport')
          modules.push({ id: transport, type: 'transport' })
        }
        let out = modules.find((m) => m.type === 'out')?.id
        if (!out) {
          out = freshId({ ...patch, modules }, 'out')
          modules.push({ id: out, type: 'out' })
        }
        modules.push({ id, type: 'sampler' })

        // One slice per sixteenth, which is the chop a one-bar break at sixteen slices is built for.
        cables.push({ from: [transport, 'sixteenth'], to: [id, 'trig'] })
        cables.push({ from: [transport, 'bar'], to: [id, 'slice'] })
        cables.push({ from: [id, 'out'], to: [out, 'in'] })
        return { ...patch, modules, cables }
      })
      return id
    },

    ensureMidi: () => {
      const existing = get().patch.modules.find((m) => m.type === 'midi')
      if (existing) return existing.id

      // Somewhere for the notes to go. Without a pitch inlet to drive there is nothing useful to build —
      // a MIDI module wired to nothing is the silent no-op this exists to prevent, so say so instead.
      const patch = get().patch
      const vco = patch.modules.find((m) => m.type === 'vco')
      if (!vco) return null

      const id = freshId(patch, 'midi')
      structural((current) => {
        const modules = [...current.modules, { id, type: 'midi' }]
        const cables = [...current.cables]

        // One cable per inlet, so anything already driving these is replaced rather than summed — a summed
        // pitch would be a wrong note rather than an obvious break, which is the worse failure.
        // Named explicitly rather than inferred from the destination: the gate goes to a VCA's `cv` inlet
        // when there is no envelope, and guessing the source from the target's port id would have sent it
        // pitch instead — a drone at the wrong note rather than a note.
        const takeOver = (from: string, to: [string, string]) => {
          const at = cables.findIndex((c) => c.to[0] === to[0] && c.to[1] === to[1])
          if (at >= 0) cables.splice(at, 1)
          cables.push({ from: [id, from], to })
        }
        takeOver('pitch', [vco.id, 'pitch'])
        // The gate goes to an envelope if there is one; a VCA's own CV inlet otherwise, so a patch with no
        // ADSR still articulates rather than droning.
        const adsr = current.modules.find((m) => m.type === 'adsr')
        const vca = current.modules.find((m) => m.type === 'vca')
        if (adsr) takeOver('gate', [adsr.id, 'gate'])
        else if (vca) takeOver('gate', [vca.id, 'cv'])
        return { ...current, modules, cables }
      })
      return id
    },

    setVoices: (voices) =>
      structural((patch) => {
        const wanted = Math.max(1, Math.min(8, Math.round(voices)))
        // One stays absent rather than being written, so a monophonic patch round-trips exactly as it did
        // before polyphony existed — and a shared link from before this is byte-identical to one made now.
        if (wanted === 1) {
          const { voices: _drop, ...rest } = patch
          return rest
        }
        return { ...patch, voices: wanted }
      }),
    load: (patch) => {
      structural(() => withGrooveboxSource(patch))
      // **Opening a document is where undo stops.** A history that spanned a load would let one press
      // resurrect the patch somebody had deliberately left — and the thing they left is not gone: it is
      // in the library, in storage, or in the link they arrived by. Reason draws the line in the same
      // place, and so does every editor with a File menu.
      set({
        history: NO_HISTORY,
        grooveboxTapRecording: false,
        grooveboxTapTarget: null,
        grooveboxTapStep: 0,
      })
    },

    undo: () =>
      set((state) => {
        const step = stepBack(state.history, state.patch)
        if (!step) return {}
        autosavePatch(step.patch)
        // Settling is not needed and would be wrong: the stored patch was settled when it was current,
        // and running the routings again against a *restored* Combinator would re-derive the targets
        // from the rotary we are in the middle of putting back.
        return needsRebuild(state.patch, step.patch)
          ? { ...step, revision: state.revision + 1 }
          : step
      }),

    redo: () =>
      set((state) => {
        const step = stepForward(state.history, state.patch)
        if (!step) return {}
        autosavePatch(step.patch)
        return needsRebuild(state.patch, step.patch)
          ? { ...step, revision: state.revision + 1 }
          : step
      }),

    select: (moduleId, extend) =>
      set((state) => {
        if (moduleId === null) return { selection: [] }
        if (!extend) return { selection: [moduleId] }
        // Toggling, so a modifier-click can take something back out of the group — which is the half of
        // additive selection people reach for immediately after picking one thing too many.
        return state.selection.includes(moduleId)
          ? { selection: state.selection.filter((id) => id !== moduleId) }
          : { selection: [...state.selection, moduleId] }
      }),

    selectRange: (moduleId) =>
      set((state) => {
        const order = state.patch.modules.map((m) => m.id)
        const anchor = state.selection[state.selection.length - 1]
        const from = order.indexOf(anchor)
        const to = order.indexOf(moduleId)
        // With nothing selected yet, or an anchor that has since been removed, a range has no meaning and
        // this is an ordinary click. Silently, because a shortcut that reported an error would be worse.
        if (from < 0 || to < 0) return { selection: [moduleId] }
        const [start, end] = from <= to ? [from, to] : [to, from]
        // Anchor last, so shift-clicking again extends from where you started rather than from the far end
        // of what you just selected — which is what every list in every application does.
        const span = order.slice(start, end + 1).filter((id) => id !== anchor)
        return { selection: [...span, anchor] }
      }),

    removeSelected: () =>
      structural((patch) => {
        const going = new Set(get().selection)
        if (going.size === 0) return patch
        // One structural edit for the whole group, so removing four modules is one undo rather than four.
        // Cables and routings at either end go with them, for the reason `removeModule` gives: leaving
        // them means they come back if a module is re-added under the same id, which looks like a haunting.
        const routes = (patch.modulation ?? []).filter(
          (route) => !going.has(route.from[0]) && !going.has(route.to[0]),
        )
        const { modulation: _drop, ...rest } = patch
        return {
          ...rest,
          modules: patch.modules.filter((m) => !going.has(m.id)),
          cables: patch.cables.filter((c) => !going.has(c.from[0]) && !going.has(c.to[0])),
          ...(routes.length > 0 ? { modulation: routes } : {}),
        }
      }),

    flip: (flipped) => set((state) => ({ flipped: flipped ?? !state.flipped })),
  }
})

/**
 * What to open with: a shared rack document, then the last session, then something that makes a noise.
 *
 * The starter patch matters more than it looks. An empty rack is a correct empty state and a terrible
 * first impression — a modular with nothing in it does not hint at what it is for, and the first thing
 * anybody needs is to hear that it works and see a cable. So it opens on a small sequenced line, which
 * is also the shortest description of what this rack can do.
 */
export async function openingPatch(): Promise<Opening> {
  const shared = await takeRackDocumentFromUrl()
  if (shared) return { patch: shared, fresh: false, preset: matchingPreset(shared) }
  const stored = loadStoredPatch()
  if (stored) return { patch: stored, fresh: false, preset: matchingPreset(stored) }
  return { patch: STARTER(), fresh: true, preset: FIRST_PRESET }
}

/**
 * Recover the identity of an untouched shipped patch after it has travelled through storage or a link.
 *
 * Names stay outside the patch document so somebody's graph is not forced to have one. Exact encoded equality
 * is deliberately strict: the instant a person changes a knob it is their patch, not something the catalogue
 * should silently relabel as ours.
 */
export function matchingPreset(patch: Patch): PatchPreset | undefined {
  // Decoding once gives every optional top-level field and every module field a canonical insertion order.
  // Comparing the raw encodings did not: a factory writes `{ tempo, break, modules, ... }`, while a saved
  // patch decodes as `{ modules, cables, break, ... }`, and JSON object order made identical patches differ.
  const canonical = (candidate: Patch) => encodePatch(decodePatch(encodePatch(candidate))!)
  const encoded = canonical(patch)
  return PATCHES.find((preset) => canonical(preset.build()) === encoded)
}

/**
 * What the rack opened with, and whether this is somebody's first time.
 *
 * `fresh` is the whole distinction `docs/DNB.md`'s D2 turns on. Arriving already playing is the most
 * important thing in that document — but only for a visitor with nothing of their own. A shared link or a
 * saved session is somebody's work, and replacing it with a demo because it makes a better first impression
 * would be the worst thing this app could do.
 */
export interface Opening {
  patch: Patch
  fresh: boolean
  /** The preset `patch` came from, when it came from one — so the host can render the break it asks for. */
  preset?: PatchPreset
}

export { STARTER }
