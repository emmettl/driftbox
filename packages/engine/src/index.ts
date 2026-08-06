import { BASS_VOICES, DEFAULT_BASS_PARAMS, bassNote, type BassStep } from './bass.js'
import { Bassline } from './bassline.js'
import { DEFAULT_FX, DEFAULT_SENDS, Sends, type SendLevels } from './effects.js'
import { Kaoss } from './kaoss.js'
import {
  ClipLauncher,
  type ClipLaunchEvent,
  type ClipLaunchQuantization,
} from './clip-launch.js'
import { metronomeClick } from './metronome.js'
import { MONITOR_MAX_DELAY, outputLatencyOf } from './monitor.js'
import { renderVoice, type VoiceHandle } from './render.js'
import { STEPS_PER_BEAT } from './timing.js'
import { Transport, type StepEvent } from './transport.js'
import {
  CLIP_SLOTS,
  clipSlotForVoice,
  patternForBar,
  type ClipSlot,
  type Song,
} from './pattern.js'
import { buildVoice, voiceById } from './kit.js'
import { barLengthForSelection, planStep } from './schedule.js'
import { DEFAULT_PARAMS, tuneForPitch, type Voice, type VoiceParams } from './types.js'
import { MIX_BUS_GAIN, MIX_MASTER_GAIN } from './master.js'
import { MasterEffects } from './master-effects.js'

export * from './types.js'
export * from './pattern.js'
export * from './timing.js'
export * from './bass.js'
export * from './effects.js'
export * from './master-effects.js'
export * from './song-io.js'
export * from './automation.js'
export * from './kaoss.js'
export * from './clip-launch.js'
// The shipped patterns ship WITH the engine, not with the app. Driftlings wants the
// patterns as much as the machines — an adaptive soundtrack that has to author its own
// haze/drift/neon before it can play anything is not much of a soundtrack — and the
// argument against copying a synthesis engine applies just as well to copying its songs.
export * from './songs/index.js'
export * from './schedule.js'
export * from './stems.js'
export * from './kit.js'
export { metronomeClick } from './metronome.js'
// The clock follower is engine-side rather than app-side because it is arithmetic on timestamps
// and belongs next to `timing.ts` — and because an embedding host that wants to be slaved to a DAW
// should get that from the engine rather than reimplementing the estimator.
export {
  ClockFollower,
  parseClock,
  TICKS_PER_QUARTER,
  TICKS_PER_STEP,
  type ClockMessage,
  type ClockState,
  type ParsedClock,
} from './midi-clock.js'
// Exported because the rack builds its own analysis tap around its own graph and must arrive at
// the same number. Two implementations of "how far behind is the speaker" would be two chances to
// compensate the two pages by different amounts.
export { MONITOR_MAX_DELAY, outputLatencyOf, type LatencyReporting } from './monitor.js'
export { Transport, type StepEvent } from './transport.js'
export { renderVoice } from './render.js'
export { Bassline } from './bassline.js'
export { Ladder } from './dsp/ladder.js'
export { TR808_VOICES } from './voices/tr808.js'
export { TR909_VOICES } from './voices/tr909.js'

// The public face of the engine. Nothing in here — or anywhere below it — imports
// React, touches the DOM, or knows a sequencer UI exists. That is the whole point: the
// game embeds this and gets a soundtrack, the sequencer app embeds the same thing and
// puts knobs on it, and neither can drift from the other because there is one engine.

/** How long a held note lasts if nothing ever releases it. Long enough to be "held" and
 *  short enough that a lost key-up cannot leave a 303 droning for the rest of the day. */
const HELD_SECONDS = 30

/**
 * The four authored machines that make one groovebox song.
 *
 * This deliberately aliases the arrangement's clip slots. A section output and the clip
 * selected for it must never acquire competing identities: `tr808` means the same machine
 * in a scene, an automation target and a host's audio routing.
 */
export type GrooveboxSection = ClipSlot
export const GROOVEBOX_SECTIONS: readonly GrooveboxSection[] = CLIP_SLOTS

export interface EngineOptions {
  /** Supply your own context to share one with other audio in the host app. */
  context?: AudioContext
  /**
   * Where the complete groovebox mix goes. Defaults to the context destination.
   *
   * A host such as rack mode can provide its own shared performance/filter bus so the
   * groovebox and another engine are one audible instrument rather than two unrelated
   * outputs. The node must belong to `context`.
   */
  destination?: AudioNode
  /**
   * Replace the dry destination of any authored machine.
   *
   * Unspecified sections continue through the engine's complete mastered mix. A supplied
   * destination receives that section pre-master and pre-send-return, while the section's
   * delay and reverb sends still return through the engine destination. This is the live
   * equivalent of a drum machine's individual outputs: a host can put the 909 through its
   * own rack chain without reimplementing a single voice or flattening the song.
   *
   * Every node must belong to `context`.
   */
  sectionDestinations?: Partial<Record<GrooveboxSection, AudioNode>>
  /** Master level, 0..1. */
  gain?: number
}

export class DriftboxEngine {
  readonly ctx: AudioContext
  /**
   * Tap for visualisers. Everything left on the engine's mastered route passes through it.
   *
   * It reads the mix **delayed by the output latency**, so what it reports is what is being heard
   * at that instant rather than what is about to be heard. That is a side branch: the analyser is
   * no longer between the master and the output, and nothing a visualiser does can affect the
   * sound. See `monitor.ts`, and `syncOutputLatency` for when the amount is re-read.
   */
  readonly analyser: AnalyserNode
  /**
   * One unity output per authored machine, before the shared bus and effect returns.
   *
   * Public as a read-only routing surface rather than as four more engines. The engine
   * still owns their lifetime and the song still owns everything they play.
   */
  readonly sectionOutputs: Readonly<Record<GrooveboxSection, GainNode>>

  private readonly bus: GainNode
  /** The one destination currently fed by each section output. */
  private readonly sectionDestinations: Partial<Record<GrooveboxSection, AudioNode>> = {}
  /** Optional non-destructive observation route per section. */
  private readonly sectionTaps: Partial<Record<GrooveboxSection, AudioNode>> = {}
  private readonly master: GainNode
  /** The analysis tap's delay line, holding the output latency. */
  private readonly monitor: DelayNode
  /** Keeps the tap on a path to the output so it is guaranteed to be processed. Gain is zero. */
  private readonly monitorSink: GainNode
  private readonly inserts: MasterEffects
  private readonly transport: Transport
  /** Session performance state: never written into `song`. */
  private readonly clipLauncher = new ClipLauncher()
  /** One ringing voice per choke group, so a closed hat can cut off an open one. */
  private readonly choking = new Map<string, VoiceHandle>()
  /** One persistent monosynth per 303, built once the ladder worklet has loaded. */
  private readonly basslines = new Map<string, Bassline>()
  private bassReady: Promise<void> | undefined
  private readonly sends: Sends
  /**
   * One send gain per voice per effect, created once and kept.
   *
   * Not per hit. A drum hit's graph disconnects itself when its tail runs out, and
   * `disconnect()` drops every outgoing connection — so a send gain created alongside
   * the hit would be orphaned still attached to the send bus, and at 140bpm that is
   * thousands of dead nodes an hour. Persistent gains invert it: the hit connects INTO
   * something that outlives it, and cleans up after itself on the way out.
   */
  private readonly sendGains = new Map<string, GainNode>()

  /**
   * Whether the 303s got a real ladder filter or fell back to a biquad. Undefined until
   * the worklet has finished loading. Worth surfacing: the fallback is a filter sweep
   * rather than a squelch, and "the basslines sound tame" has exactly one likely cause.
   */
  usingLadder: boolean | undefined

  /** Click on every beat. Off by default — it is a practice tool, not part of the song,
   *  which is also why it lives on the engine rather than in the Song. */
  metronome = false
  /** Bars of clicks before the pattern starts. 0 plays immediately. */
  countInBars = 0

  /** Bar the count-in runs until. Set on start; the pattern is silent before it. */
  private countInUntil = 0
  private readonly clickOut: GainNode

  /**
   * The performance filter, across the whole mix.
   *
   * Public because it is played rather than configured — the UI drives it from a pointer
   * at frame rate, and routing that through the song and a store update per move would
   * put a React render between a finger and a filter.
   */
  readonly kaoss: Kaoss

  song: Song

  constructor(song: Song, options: EngineOptions = {}) {
    this.song = song
    this.ctx = options.context ?? new AudioContext()

    this.bus = this.ctx.createGain()
    this.bus.gain.value = MIX_BUS_GAIN
    this.sectionOutputs = Object.fromEntries(
      GROOVEBOX_SECTIONS.map((section) => {
        const output = this.ctx.createGain()
        output.gain.value = 1
        return [section, output]
      }),
    ) as Record<GrooveboxSection, GainNode>
    for (const section of GROOVEBOX_SECTIONS) {
      this.routeSection(section, options.sectionDestinations?.[section] ?? null)
    }

    this.inserts = new MasterEffects(this.ctx)

    this.master = this.ctx.createGain()
    // 0.7, not 0.8. Measured by rendering the busiest shipped pattern through this
    // exact chain offline: the raw sum peaks at 2.14 and the compressor brings that to
    // 1.08 — still over full scale, so the loudest bars were hard-clipping on output.
    this.master.gain.value = options.gain ?? MIX_MASTER_GAIN

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.75

    // The sends return to the bus, so the wet signal goes through the same compressor
    // and master as everything else. Returning them after the compressor would let a
    // long reverb tail push the output over full scale with nothing holding it.
    this.sends = new Sends(this.ctx, this.bus)

    // The click goes straight to the destination, past everything.
    //
    // Not through the bus: it would duck the whole mix through the compressor on every
    // beat, arrive in the reverb, and draw itself on the oscilloscope. It also lands
    // downstream of the performance filter, which is the behaviour you want for free —
    // sweeping the pad shut must not take the click with it, or a count-in disappears
    // exactly when somebody is leaning on the filter.
    this.clickOut = this.ctx.createGain()
    this.clickOut.gain.value = 1
    const destination = options.destination ?? this.ctx.destination
    this.clickOut.connect(destination)

    // After the compressor, so the compressor is not reacting to signal the filter is
    // about to throw away, and a resonant peak cannot be pumped by it.
    this.kaoss = new Kaoss(this.ctx)

    this.bus.connect(this.inserts.input)
    this.inserts.output.connect(this.kaoss.input)
    this.kaoss.output.connect(this.master)

    // The mix goes straight out. The analyser used to sit in this line, and moving it off is what
    // lets the picture be compensated without the sound being delayed with it.
    this.master.connect(destination)

    // The monitor tap: the same mix, delayed by however far behind the speaker is, read by the
    // analyser every scene and the oscilloscope draw from. See `monitor.ts` for why.
    this.monitor = this.ctx.createDelay(MONITOR_MAX_DELAY)
    this.master.connect(this.monitor)
    this.monitor.connect(this.analyser)

    // A silent path from the analyser to the output, and it is not superstition.
    //
    // Web Audio only guarantees that nodes on a path to the destination are processed. An analyser
    // hanging off the end of a branch is pulled anyway in every implementation anybody has
    // measured — checked here in Chromium, where a leaf analyser reads a full-scale 255 on a tone,
    // identical to one in the signal path. But the failure mode if some browser disagrees is not a
    // slightly wrong picture, it is an analyser that reads silence for ever and a visualiser that
    // is simply dead, on a page whose whole argument is that a phone should open into the visuals.
    // That is not a bet worth taking against one gain node, and the gain is exactly zero, so what
    // it contributes to the mix is exactly nothing — which the offline level measurements in
    // `render.browser.test.ts` would catch immediately if it were ever not true.
    this.monitorSink = this.ctx.createGain()
    this.monitorSink.gain.value = 0
    this.analyser.connect(this.monitorSink)
    this.monitorSink.connect(destination)

    // Set outright rather than ramped: there is nothing to glide from, and a context built
    // suspended almost always answers 0 here anyway. `resume()` is where the real number arrives.
    this.monitor.delayTime.value = outputLatencyOf(this.ctx)

    this.transport = new Transport(this.ctx, {
      onBar: (bar) => this.clipLauncher.activate('bar', bar),
      barLength: (bar) =>
        barLengthForSelection(this.song, bar, this.clipLauncher.selection),
      onStep: (event) => this.playStep(event),
    })
    this.transport.bpm = song.bpm

    this.syncFx()

    // Kicked off now rather than on the first note. Registering an AudioWorklet module
    // is a real async round trip, and a 303 that arrives two bars into the song is
    // worse than one that costs a moment of startup nobody is listening through.
    void this.ensureBass()
  }

  /** Push the song's effect settings into the master inserts and send buses. Call after
   *  changing `song.fx` or the tempo — the delay is tempo-synced, so it has to be told. */
  syncFx(): void {
    const fx = this.song.fx ?? DEFAULT_FX
    this.sends.update(fx, this.transport.bpm)
    this.inserts.update(fx)
  }

  /**
   * The send gain for one voice, created on first use and kept for the session.
   *
   * Levels are read from the song here rather than pushed in when a knob moves, so a
   * send that has never been touched costs nothing at all: no node is built until the
   * voice is actually sent somewhere.
   */
  private routeSends(
    voiceId: string,
    output: AudioNode,
    levels?: SendLevels,
    time = this.ctx.currentTime,
  ): void {
    const resolved = levels ?? this.song.kit.sends?.[voiceId] ?? DEFAULT_SENDS

    for (const [kind, amount] of [
      ['delay', resolved.delay],
      ['reverb', resolved.reverb],
    ] as const) {
      const key = `${voiceId}:${kind}`
      let gain = this.sendGains.get(key)
      if (!gain) {
        if (amount <= 0) continue
        gain = this.ctx.createGain()
        gain.connect(kind === 'delay' ? this.sends.delayInput : this.sends.reverbInput)
        this.sendGains.set(key, gain)
      }
      gain.gain.setValueAtTime(amount, time)
      output.connect(gain)
    }
  }

  /** Unknown future voices keep reaching the complete mix rather than disappearing. */
  private outputFor(voiceId: string): AudioNode {
    const section = clipSlotForVoice(voiceId)
    return section ? this.sectionOutputs[section] : this.bus
  }

  /**
   * Move one dry authored machine between the engine master and a host-owned route.
   *
   * This changes one Web Audio connection and nothing about the song or transport, so
   * patching a hosted 909 through a rack effect does not restart the bar it is playing.
   * Passing null restores the original mastered route.
   */
  routeSection(section: GrooveboxSection, destination: AudioNode | null): void {
    const output = this.sectionOutputs[section]
    const previous = this.sectionDestinations[section]
    const next = destination ?? this.bus
    if (previous === next) return
    if (previous) output.disconnect(previous)
    output.connect(next)
    this.sectionDestinations[section] = next
  }

  /**
   * Observe one dry authored machine without moving it off the mastered route.
   *
   * A rack uses this to keep its source meter alive before anybody patches the section.
   * It is deliberately separate from `routeSection`: a tap cannot accidentally make an
   * imported song disappear from its original mix. Passing null removes the observation.
   */
  tapSection(section: GrooveboxSection, destination: AudioNode | null): void {
    const output = this.sectionOutputs[section]
    const previous = this.sectionTaps[section]
    if (previous === destination) return
    if (previous) output.disconnect(previous)
    if (destination) {
      output.connect(destination)
      this.sectionTaps[section] = destination
    } else {
      delete this.sectionTaps[section]
    }
  }

  /** Build the 303s once their filter is available. Idempotent; the promise is the
   *  latch, so concurrent callers all wait on the same load. */
  private ensureBass(): Promise<void> {
    this.bassReady ??= (async () => {
      for (const voice of BASS_VOICES) {
        const { bassline, usingLadder } = await Bassline.create(this.ctx)
        bassline.output.connect(this.outputFor(voice.id))
        this.basslines.set(voice.id, bassline)
        this.usingLadder = usingLadder
      }
      // A 303's output node is permanent, unlike a drum hit's, so its sends only need
      // connecting once. `routeSends` is idempotent — connecting the same pair of nodes
      // twice is a no-op in Web Audio — so the per-step call below costs nothing but
      // keeps the level current as the knob moves.
      for (const [voiceId, bassline] of this.basslines) this.routeSends(voiceId, bassline.output)
    })()
    return this.bassReady
  }

  get running(): boolean {
    return this.transport.running
  }

  get position(): { bar: number; index: number } {
    return this.transport.position
  }

  set bpm(value: number) {
    this.song.bpm = value
    this.transport.bpm = value
    // The delay is measured in steps, not seconds, so it has to follow the tempo or the
    // repeats stop landing where the pattern does.
    this.syncFx()
  }

  get bpm(): number {
    return this.transport.bpm
  }

  /**
   * Play at a tempo that is not the song's, without the song finding out.
   *
   * **Setting `bpm` would be wrong here, and quietly.** It writes through to `song.bpm`, which is
   * correct for a knob — the document should remember where you left it — and destructive for an
   * external clock: a DAW at 174 would silently rewrite a 120bpm song to 174 and the autosave
   * would keep it. Somebody would open their song the next day at somebody else's tempo, with
   * nothing to point at.
   *
   * So this moves the transport and re-syncs the tempo-locked delay, and leaves the document
   * alone. Pass null to hand control back to the song, which is what happens when the clock stops
   * or the cable comes out.
   */
  followTempo(bpm: number | null): void {
    this.transport.bpm = bpm ?? this.song.bpm
    this.syncFx()
  }

  set swing(value: number) {
    // Nothing to tell the transport: it emits straight times and swing is applied per
    // voice as each step is scheduled, so a change here lands on the very next step.
    this.song.swing = value
  }

  get swing(): number {
    return this.song.swing
  }

  set gain(value: number) {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02)
  }

  /** Browsers start an AudioContext suspended until the user has interacted with the
   *  page. Call this from a click; starting the transport without it is silent. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
    // Here rather than only in the constructor, because a context that has not run yet does not
    // know: it is created suspended, and `outputLatency` is 0 or undefined until there is a device
    // attached to be late. This is the one line every path to making a sound goes through.
    this.syncOutputLatency()
  }

  /**
   * Re-read how far behind the output device is, and retune the analysis tap to match.
   *
   * Called on every resume, which covers starting and returning from a suspended tab. It is public
   * for the case that is not covered: the latency changes when the *device* changes — plugging in
   * an interface, or a Bluetooth pair completing — and there is no event for that worth relying
   * on. A host that knows its output moved can say so.
   *
   * Ramped rather than assigned. `delayTime` is an `AudioParam` and stepping it re-reads the delay
   * line at a new offset, which is an audible click on anything passing through — inaudible here,
   * where the branch ends in a silent gain, but the analyser would see the discontinuity and every
   * scene reading it would flinch. 50ms is under a frame's worth of visual change and far shorter
   * than any latency being corrected.
   */
  syncOutputLatency(): void {
    const target = outputLatencyOf(this.ctx)
    this.monitor.delayTime.setTargetAtTime(target, this.ctx.currentTime, 0.05)
  }

  /** How far the analysis tap is currently behind the graph, in seconds. Zero where the platform
   *  reports no latency, and for an offline render. A host can show it; a test can measure it. */
  get monitorDelay(): number {
    return this.monitor.delayTime.value
  }

  async start(): Promise<void> {
    await this.resume()
    await this.ensureBass()
    this.countInUntil = Math.max(0, Math.floor(this.countInBars))
    this.transport.start()
  }

  /** Start immediately from a bar/step without applying the count-in at song position 0. */
  async startAt(bar: number, index = 0): Promise<void> {
    if (this.transport.running) this.transport.stop()
    await this.resume()
    await this.ensureBass()
    this.countInUntil = 0
    this.transport.startAt(bar, index)
  }

  setLoop(start: number, bars: number): void {
    this.transport.setLoop(start, bars)
  }

  clearLoop(): void {
    this.transport.clearLoop()
  }

  get loop(): { start: number; bars: number } | null {
    return this.transport.loop
  }

  /**
   * Launch one machine's pattern at the next requested boundary, or pass null to follow
   * the song again. Bar remains the default for callers written before finer launch
   * quantization existed.
   *
   * Returns false for an unknown pattern without disturbing an already queued launch.
   */
  queueClip(
    section: GrooveboxSection,
    patternId: string | null,
    quantization: ClipLaunchQuantization = 'bar',
  ): boolean {
    if (patternId !== null && !this.song.patterns.some((pattern) => pattern.id === patternId)) {
      return false
    }
    this.clipLauncher.queue(section, patternId, quantization)
    return true
  }

  /** Observe queued and active launch state without coupling the engine to a UI store. */
  onClipLaunch(listener: (event: ClipLaunchEvent) => void): () => void {
    return this.clipLauncher.onChange(listener)
  }

  /** Whether the transport is currently counting in rather than playing the song. */
  get countingIn(): boolean {
    return this.transport.running && this.transport.position.bar < this.countInUntil
  }

  /**
   * Drop everything still ringing — reverb tails, delay repeats, held 303 notes.
   *
   * For changing song. Deliberately not part of `stop`, because a record that is stopped
   * should be allowed to ring out; a record that has been *replaced* should not still be
   * audible over the one that replaced it.
   */
  silenceTails(): void {
    this.sends.silence()
    for (const bassline of this.basslines.values()) bassline.silence()
  }

  stop(): void {
    this.transport.stop()
    // A 303 note is held by a VCA envelope that runs until its gate ends, so unlike a
    // drum hit it will still be sounding when the transport stops. Left alone it hangs
    // there until the bar it was never going to finish.
    for (const bassline of this.basslines.values()) bassline.silence()
  }

  /** Fire one voice immediately — auditioning from the UI, or a one-shot from a game
   *  event that has nothing to do with the running pattern. */
  audition(voiceId: string, accent = 1): void {
    void this.resume()
    this.trigger(voiceId, this.ctx.currentTime + 0.01, accent)
  }

  trigger(
    voiceId: string,
    time: number,
    accent: number,
    params?: VoiceParams,
    sends?: SendLevels,
  ): void {
    const voice = voiceById(voiceId)
    if (!voice) return

    const spec = buildVoice(voice, params ?? this.song.kit.params[voiceId] ?? DEFAULT_PARAMS, accent)

    if (voice.choke) {
      const previous = this.choking.get(voice.choke)
      if (previous && previous.endsAt > time) {
        // Not an instant cut: a few milliseconds of fade, or the choke itself clicks.
        previous.output.gain.cancelScheduledValues(time)
        previous.output.gain.setValueAtTime(previous.output.gain.value, time)
        previous.output.gain.linearRampToValueAtTime(0, time + 0.004)
      }
    }

    const handle = renderVoice(this.ctx, spec, this.outputFor(voiceId), time, voiceId)
    this.routeSends(voiceId, handle.output, sends, time)
    if (voice.choke) this.choking.set(voice.choke, handle)
  }

  /** Play one 303 note now — previewing a note while writing a line. */
  auditionBass(voiceId: string, step: BassStep): void {
    void this.resume()
    const bassline = this.basslines.get(voiceId)
    if (!bassline) return
    const params = this.song.kit.bass?.[voiceId] ?? DEFAULT_BASS_PARAMS
    // No previous step, so it always strikes rather than sliding — you are auditioning
    // this note, not the pair it happens to sit between.
    const note = bassNote(params, step, { note: null, accent: false, slide: false }, 0.3)
    if (note) bassline.play(note, this.ctx.currentTime + 0.01)
  }

  /**
   * Start a 303 note and hold it until `bassNoteOff`.
   *
   * For playing one from a keyboard rather than auditioning a step. `legato` is what
   * makes this worth having: pressing a second key without releasing the first glides
   * between them on the same envelope, which is exactly the sequencer's slide and
   * therefore comes free — a 303 is monophonic, so there was never another option.
   */
  bassNoteOn(voiceId: string, semitones: number, accent = false, legato = false): void {
    void this.resume()
    const bassline = this.basslines.get(voiceId)
    if (!bassline) return

    const params = this.song.kit.bass?.[voiceId] ?? DEFAULT_BASS_PARAMS
    const note = bassNote(
      params,
      { note: semitones, accent, slide: false },
      // A held previous note is a sliding one as far as `bassNote` is concerned.
      legato ? { note: semitones, accent: false, slide: true } : { note: null, accent: false, slide: false },
      0.3,
    )
    if (!note) return

    // Held rather than gated: a long gate the release cancels, so the note sustains for
    // as long as a finger is down instead of for whatever the pattern's step length is.
    bassline.play({ ...note, gate: HELD_SECONDS }, this.ctx.currentTime + 0.01)
  }

  /**
   * Play a pitched drum voice at a note — a tom, from the keyboard.
   *
   * `semitones` counts up from the bottom of that voice's own range, so key one is the
   * tom at its lowest tuning. Notes past the top clamp there rather than failing: an 808
   * tom covers about a fifth and the way to the notes above it is to play the next tom
   * up, which is why the machine has three.
   *
   * Not held, unlike a 303 note — a tom is a hit. There is nothing to sustain.
   */
  auditionPitched(voiceId: string, semitones: number, accent = false): boolean {
    const voice = voiceById(voiceId)
    if (!voice?.pitched) return false
    void this.resume()

    const hz = voice.pitched.low * Math.pow(2, semitones / 12)
    const tune = tuneForPitch(voice, hz)
    if (tune === null) return false

    const params = { ...(this.song.kit.params[voiceId] ?? DEFAULT_PARAMS), tune }
    const spec = buildVoice(voice, params, accent ? 1 : 0.6)
    const handle = renderVoice(
      this.ctx,
      spec,
      this.outputFor(voiceId),
      this.ctx.currentTime + 0.01,
      voiceId,
    )
    this.routeSends(voiceId, handle.output)
    // Whether the note actually landed where it was asked, so the UI can grey out the
    // keys this voice cannot reach rather than lighting them and lying.
    return hz <= voice.pitched.high + 0.001
  }

  /** Let a held 303 note go. */
  bassNoteOff(voiceId: string): void {
    this.basslines.get(voiceId)?.silence(this.ctx.currentTime + 0.005)
  }

  private playStep(event: StepEvent): void {
    this.clipLauncher.activate(event.index % STEPS_PER_BEAT === 0 ? 'beat' : 'step', event.bar)
    // The click lands on the beat, straight, whatever the song is swinging. Swing is a
    // property of the music; a metronome that shuffled with it would be measuring
    // against itself and useless for playing along to.
    if (event.index % STEPS_PER_BEAT === 0 && (this.metronome || event.bar < this.countInUntil)) {
      renderVoice(this.ctx, metronomeClick(event.index === 0), this.clickOut, event.time)
    }

    // Counting in: click only. The pattern starts when the count-in is over.
    if (event.bar < this.countInUntil) return

    if (!patternForBar(this.song, event.bar)) return

    // What this step plays is worked out by `planStep`, which the stem renderer uses
    // too — the two must never disagree about which voice sounds when.
    const plan = planStep(this.song, event, this.clipLauncher.selection)
    if (this.transport.bpm !== plan.bpm) {
      this.transport.bpm = plan.bpm
    }
    this.sends.update(plan.fx, plan.bpm, event.time)
    this.inserts.update(plan.fx, event.time, plan.pcf)
    for (const hit of plan.drums) {
      this.trigger(hit.voiceId, hit.time, hit.accent, hit.params, hit.sends)
    }
    for (const hit of plan.bass) {
      const bassline = this.basslines.get(hit.voiceId)
      if (!bassline) continue
      bassline.play(hit.note, hit.time)
      this.routeSends(hit.voiceId, bassline.output, hit.sends, hit.time)
    }
  }

  dispose(): void {
    this.stop()
    this.clickOut.disconnect()
    this.kaoss.dispose()
    for (const bassline of this.basslines.values()) bassline.dispose()
    this.basslines.clear()
    for (const gain of this.sendGains.values()) gain.disconnect()
    this.sendGains.clear()
    this.sends.dispose()
    this.inserts.dispose()
    this.clipLauncher.clear()
    for (const output of Object.values(this.sectionOutputs)) output.disconnect()
    this.bus.disconnect()
    this.master.disconnect()
    this.analyser.disconnect()
    this.monitor.disconnect()
    this.monitorSink.disconnect()
  }
}

/**
 * Render a single voice on its own, offline, and hand back the samples.
 *
 * This is how the voices are actually verified — a kick either has energy below 100Hz
 * that decays over the time its knob says, or it does not, and that is a measurement
 * rather than an opinion. The sequencer also uses it to draw each voice's waveform in
 * its channel strip, so you can see the shape of the sound you are dialling in.
 */
export async function renderVoiceOffline(
  voice: Voice,
  params: VoiceParams = DEFAULT_PARAMS,
  accent = 1,
  sampleRate = 44100,
  /**
   * Which of this voice's possible renders to produce. Zero is the voice as a song would play it.
   *
   * A noise voice does not have *a* peak, it has a distribution of them: the hit starts at an
   * offset into the shared noise buffer, and that offset is a function of which hit it is — see
   * `noiseOffsetSeed`. Measuring the distribution therefore needs more than one render, and this
   * is what varies between them.
   *
   * **It perturbs the identity of the hit, not its position in time.** Rendering at a series of
   * later start times was the obvious way to do this and is wrong: a start time that is not on a
   * render-quantum boundary changes far more than the noise offset. Measured on the 808 closed
   * hat, which contains no noise at all, the bare peak moves between 0.67 and 3.97 purely with
   * where the hit falls inside a quantum. That is a real effect worth knowing about — it survives
   * into the engine as a 0.28-to-0.78 spread, well under full scale because of the bus and master
   * gains — but it is a different question from this one, and a sweep that moved both would be
   * measuring neither.
   */
  variant = 0,
): Promise<Float32Array> {
  const spec = buildVoice(voice, params, accent)
  const length = Math.max(1, Math.ceil((spec.duration + 0.05) * sampleRate))
  const ctx = new OfflineAudioContext(1, length, sampleRate)
  renderVoice(ctx, spec, ctx.destination, 0, variant ? `${voice.id}#${variant}` : voice.id)
  const buffer = await ctx.startRendering()
  return buffer.getChannelData(0)
}
