import { DriftboxEngine, Kaoss, songBars, type Song } from '@driftbox/engine'
import {
  compile,
  grooveboxSong,
  LanePlayer,
  MODULES,
  Rack,
  valueAt,
} from '@driftbox/rack'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { AudioInputState } from './audio-input.js'
import { grooveboxTransport, routeGrooveboxSources } from './groovebox-host.js'
import { clearLive, publishLive } from './live.js'
import { publishMeters } from './meter.js'
import type { RackNodes } from './nodes.js'
import { moveTo, stepAt, STOPPED, type Playhead } from './playhead.js'
import { useRack, type Opening } from './store.js'

// The live audio session: starting it, keeping it in step with the document, and taking it down again.
//
// This is the half of the rack page that has a clock. Everything here is either an effect that pushes a
// change at the audio thread, or the one gesture that builds the thread in the first place. It is a hook
// rather than a component because none of it draws anything — the four pieces of state it does return are
// the least a screen needs to know that any of it happened.

export interface RackEngineOptions {
  /** The retained song beside the rack graph, or null for a rack-native patch. */
  song: Song | null
  /** The exact retained envelope, so rack-only edits do not rebuild the song engine. */
  encodedSong: string | undefined
  /** An explicit rack tempo. Undefined leaves the hosted song owning its own tempo automation. */
  tempoOverride: number | undefined
  /** What the transport actually runs at: the override, else the song's tempo, else 120. */
  tempo: number
  shuffle: number
  playing: boolean
  /** An open live input keeps the context awake while the transport is stopped. */
  audioInputState: AudioInputState
  connectAudioInput: () => Promise<void>
  /** Push retained sample PCM into a rack that has only just been built. */
  hydrate: (live: Rack) => void
  loadBreak: (id: string) => Promise<void>
  opening: RefObject<Opening | null>
}

export interface RackEngine {
  /** Whether audio has ever been started. */
  started: boolean
  /** No AudioWorklet, no rack. Saying so is better than looking broken. */
  failed: boolean
  analyser: AnalyserNode | null
  kaoss: RefObject<Kaoss | null>
  /** Only so the pad re-renders once there is a filter for it to move. */
  hasKaoss: boolean
  audioState: AudioContextState | 'none'
  start: () => Promise<void>
  /** Make the rack able to make a sound, because somebody is about to play one. */
  wake: () => Promise<boolean>
}

export function useRackEngine(nodes: RackNodes, options: RackEngineOptions): RackEngine {
  const {
    song,
    encodedSong,
    tempoOverride,
    tempo,
    shuffle,
    playing,
    audioInputState,
    connectAudioInput,
    hydrate,
    loadBreak,
    opening,
  } = options
  const setNotes = useRack((s) => s.setNotes)
  const setRunning = useRack((s) => s.setRunning)
  const revision = useRack((s) => s.revision)

  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  /**
   * The rack's own analyser.
   *
   * State rather than a ref, because the scope has to re-render once it exists. It is the sequencer's
   * `Oscilloscope` component reading it — the same trace, the same phosphor persistence. It is genuinely
   * diagnostic here rather than decorative: a VCA left shut reads as a flat line, and a patch clipping
   * into the Out reads as a flattened top, and both are otherwise invisible.
   */
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  /**
   * What the AudioContext says about itself.
   *
   * Worth knowing rather than assuming, because a browser suspends a context on its own — a background
   * tab, an interruption on iOS — and then the transport is running as far as this app is concerned while
   * nothing is coming out. Event-driven off `statechange` rather than polled.
   */
  const [audioState, setAudioState] = useState<AudioContextState | 'none'>('none')
  /** The performance filter. A ref because the audio graph owns it; the boolean is only so React
   *  re-renders the pad once there is something for it to move. */
  const kaoss = useRef<Kaoss | null>(null)
  const [hasKaoss, setHasKaoss] = useState(false)
  /** Where the rack's transport is, in musical time. See `playhead.ts`. */
  const playhead = useRef<Playhead>(STOPPED)
  /** Exact envelope currently hosted, so rack-only edits do not rebuild the song engine. */
  const hostedGroovebox = useRef<string | undefined>(undefined)
  /** Detach launch observations before replacing the hosted engine. */
  const grooveboxLaunchObserver = useRef<(() => void) | null>(null)
  /** Read at the moment Start finishes rather than captured when it was defined, so a break chosen while
   *  the context was being built is still the one that gets rendered. */
  const loadBreakRef = useRef(loadBreak)
  loadBreakRef.current = loadBreak

  const bindGrooveboxPerformance = useCallback(
    (hosted: DriftboxEngine | null) => {
      grooveboxLaunchObserver.current?.()
      grooveboxLaunchObserver.current = null

      const state = useRack.getState()
      state.clearGrooveboxLaunches()
      state.setGrooveboxLoop(null)
      state.setGrooveboxAutomationPosition(
        hosted ? () => (hosted.running ? hosted.position : null) : null,
      )
      state.setGrooveboxLauncher(
        hosted
          ? (section, patternId, quantization) => hosted.queueClip(section, patternId, quantization)
          : null,
      )
      state.setGrooveboxTransport(
        hosted
          ? grooveboxTransport({
              bars: () => songBars(hosted.song),
              // A jump is a rack transport move as much as a song one: the rack has to be told the tempo
              // and set running, or the hosted song plays alone against a clock nothing else follows.
              armRack: () => {
                const live = nodes.rack.current
                if (!live) return false
                const currentPatch = useRack.getState().patch
                const current = grooveboxSong(currentPatch)
                live.setTransport(
                  currentPatch.tempo ?? current?.bpm ?? 120,
                  true,
                  current?.swing ?? 0,
                )
                useRack.getState().setRunning(true)
                return true
              },
              startAt: (bar) => void hosted.startAt(bar),
              setLoop: (start, bars) => hosted.setLoop(start, bars),
              clearLoop: () => hosted.clearLoop(),
              onLoop: (loop) => useRack.getState().setGrooveboxLoop(loop),
            })
          : null,
      )
      if (hosted) {
        grooveboxLaunchObserver.current = hosted.onClipLaunch((event) =>
          useRack.getState().setGrooveboxLaunch(event),
        )
      }
    },
    [nodes],
  )

  /**
   * A library load can replace a hosted song with another song or a native patch after
   * audio has started. Rebuild only when the retained envelope changes; adding a cable
   * to the surrounding rack must not restart the groovebox transport.
   */
  useEffect(() => {
    const live = nodes.rack.current
    const pad = kaoss.current
    if (!live || !pad || hostedGroovebox.current === encodedSong) return

    const current = nodes.groovebox.current
    hostedGroovebox.current = encodedSong

    // Pattern edits replace the immutable retained envelope, but they do not replace
    // the instrument. The sequencer uses this same live-song handoff: the scheduler
    // reads the new pattern on the next step, preserving the playhead, ringing voices,
    // source routes and meter taps.
    if (current && song) {
      current.song = song
      current.bpm = tempoOverride ?? song.bpm
      current.syncFx()
      return
    }

    bindGrooveboxPerformance(null)
    current?.dispose()
    nodes.groovebox.current = null
    if (!song) return

    const hosted = new DriftboxEngine(song, {
      context: live.output?.context as AudioContext,
      destination: pad.input,
    })
    nodes.groovebox.current = hosted
    bindGrooveboxPerformance(hosted)
    routeGrooveboxSources(hosted, live, useRack.getState().patch)
    if (playing) void hosted.start()
  }, [bindGrooveboxPerformance, encodedSong, nodes, playing, song, tempoOverride])

  const start = useCallback(async () => {
    if (nodes.rack.current) return
    // A pedal chain is played through, so ask the browser to favour response time over
    // a deeper power-saving buffer. It is a hint, not a latency guarantee.
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    // Every module, because this is the editor: a rack you can patch anything into cannot ship a registry
    // chosen ahead of time. An embedding host with a fixed patch is the case that passes fewer — see `Rack`.
    const live = new Rack(ctx, MODULES)
    if (!(await live.start())) {
      // No worklet, no rack — unlike the engine's ladder there is nothing to fall back to, and saying
      // so is better than looking broken.
      setFailed(true)
      return
    }
    live.onMeters(publishMeters)
    ctx.onstatechange = () => setAudioState(ctx.state)
    setAudioState(ctx.state)

    // The performance filter, as an insert across everything the rack makes. After the rack's output means
    // after its master limiter, which is the same order the engine uses and for the same reason: the
    // limiter should not be reacting to a signal the filter is about to throw away.
    const pad = new Kaoss(ctx)
    live.output?.connect(pad.input)
    kaoss.current = pad
    setHasKaoss(true)

    // Host the intact authored song with its own engine rather than exploding it into
    // anonymous rack primitives. Both engines enter the same pad, analyser and destination,
    // so performance controls and visuals see one combined output.
    const currentPatch = useRack.getState().patch
    const currentSong = grooveboxSong(currentPatch)
    const hosted = currentSong
      ? new DriftboxEngine(currentSong, { context: ctx, destination: pad.input })
      : null
    nodes.groovebox.current = hosted
    hostedGroovebox.current = currentPatch.groovebox
    bindGrooveboxPerformance(hosted)

    const scope = ctx.createAnalyser()
    scope.fftSize = 2048
    scope.smoothingTimeConstant = 0.75
    // The scope watches the filtered signal, so sweeping the pad shows on it. Watching the pre-filter
    // output would have drawn a waveform nobody could hear.
    pad.output.connect(scope)
    pad.output.connect(ctx.destination)
    setAnalyser(scope)

    live.patch = useRack.getState().patch
    nodes.rack.current = live
    hydrate(live)
    if (hosted) routeGrooveboxSources(hosted, live, currentPatch)
    // A guitar preset should become an instrument from the same gesture that starts
    // audio. The permission prompt is still the browser's, and a refusal leaves the rack
    // running with a visible Enable input control.
    if (currentPatch.modules.some((module) => module.type === 'audio-input')) {
      void connectAudioInput()
    }
    // The gesture that starts audio is also the gesture that starts the music. Anything else means
    // arriving, pressing a button, and getting silence — which is the "instant DJ" problem in `docs/DNB.md`.
    live.setTransport(currentPatch.tempo ?? currentSong?.bpm ?? 120, true, currentSong?.swing ?? 0)
    setRunning(true)
    setStarted(true)
    if (hosted) await hosted.start()

    // The reward for the gesture, and `docs/DNB.md` calls this the most important thing in it: a beat, not
    // a bleep. The opening patch is a chopped break for a first-time visitor, and a break is silent until
    // one has been rendered into it — so the gesture that starts audio is also the one that fills the
    // Sampler.
    const wanted = useRack.getState().patch.break ?? opening.current?.preset?.needsBreak
    if (wanted) void loadBreakRef.current(wanted)
  }, [bindGrooveboxPerformance, connectAudioInput, hydrate, nodes, opening, setRunning])

  /**
   * Make the rack able to make a sound, because somebody is about to play one.
   *
   * Two ways it can be unable to. It may never have been started, in which case this is the starting
   * gesture like any other. Or it may be **suspended because the transport is stopped** — Stop suspends
   * the whole context, which is the honest fix for a Clock that ignores `running`, and it had the side
   * effect that a keyboard went completely dead the moment somebody pressed Stop. Measured: holding a key
   * with the transport stopped drew a flat line on the scope.
   *
   * That is the wrong trade for an instrument. A sequencer being stopped is exactly when you want to play
   * something by hand, so a note resumes the context and **leaves the transport stopped** — `running`
   * stays false, so anything transport-locked stays where it is and only the sound comes back.
   *
   * Returns whether the rack had to be started from cold, because a note played into an audio thread that
   * did not exist yet needs playing again once it does.
   */
  const wake = useCallback(async (): Promise<boolean> => {
    if (!nodes.rack.current) {
      await start()
      return true
    }
    const ctx = nodes.rack.current.output?.context as AudioContext | undefined
    if (ctx?.state === 'suspended') void ctx.resume()
    return false
  }, [nodes, start])

  /**
   * Push the patch at the audio thread when the GRAPH changes, and never when a knob moves.
   *
   * `revision` and not `patch`. A knob turn produces a new patch object — it has to, so React re-renders
   * — but recompiling on it would rebuild every processor sixty times a second while somebody drags,
   * which resets each oscillator's phase and each filter's history. That is a continuous crackle. The
   * knob's own value reaches the audio thread through `rack.setParam`, which is a message and a one-block
   * ramp. See the note at the top of `store.ts`.
   */
  useEffect(() => {
    const live = nodes.rack.current
    const current = useRack.getState().patch
    if (live) {
      live.patch = current
      const hosted = nodes.groovebox.current
      if (hosted) routeGrooveboxSources(hosted, live, current)
    }
    // Compiled for diagnostics whether or not audio is running. The Rack would produce the same notes,
    // but only once it exists — and a feedback cable has to be drawn as feedback from the moment it is
    // patched, not from the moment somebody presses Start. Compiling is pure and cheap; it is the same
    // function the audio thread's plan comes from, so the two cannot disagree.
    setNotes(compile(current, MODULES).notes)
  }, [nodes, revision, setNotes])

  /**
   * Push the transport, and suspend the audio context when stopped.
   *
   * Both, and the second one is the fix for a real bug. Stop used to only set `running: false`, which the
   * Transport module honours and **nothing else does** — the Clock is free-running by design, so on the
   * shipped patches, which drive themselves from a Clock, Stop changed the button's label and nothing
   * else. A stop button that does not stop is worse than no stop button.
   *
   * Suspending is the honest answer unless a live input is being monitored. A pedal chain has to keep
   * passing audio while its sequencer transport is stopped, so an open Audio Input keeps the context awake
   * and only the transport message stops. The transport-driven patch still comes back in the right place.
   */
  useEffect(() => {
    const live = nodes.rack.current
    if (!live) return
    live.setTransport(tempo, playing, shuffle)
    // The rack's own playhead, kept beside the graph's. Starting rewinds and a tempo change banks what has
    // already elapsed, exactly as `Graph.setTransport` does — see `playhead.ts` for why recomputing from
    // total elapsed seconds would move every position already recorded.
    playhead.current = moveTo(playhead.current, live.output?.context.currentTime ?? 0, playing, tempo)
    // An AudioWorkletNode's context is typed as BaseAudioContext, which has neither suspend nor resume —
    // the rack is always given a real AudioContext, so this is a narrowing rather than an assumption.
    const ctx = live.output?.context as AudioContext | undefined
    if (!ctx) return
    // A rack tempo is an explicit override. With no override, the hosted engine keeps
    // ownership of its song tempo and any recorded tempo automation.
    const hosted = nodes.groovebox.current
    if (tempoOverride !== undefined && hosted && hosted.bpm !== tempo) {
      hosted.bpm = tempo
    }
    if (playing) {
      void nodes.groovebox.current?.start()
      if (ctx.state === 'suspended') void ctx.resume()
    } else {
      nodes.groovebox.current?.stop()
      if (ctx.state === 'running' && audioInputState !== 'on') void ctx.suspend()
    }
  }, [audioInputState, nodes, playing, shuffle, tempo, tempoOverride])

  /**
   * Tell the store where the transport is, so an armed knob turn records somewhere real.
   *
   * A callback rather than a pushed number, so the position is read at the instant the knob moves. Null
   * while there is no rack at all, which is what makes recording before `Start audio` a no-op rather than
   * a pile of points at step zero.
   */
  useEffect(() => {
    const read = () => {
      const ctx = nodes.rack.current?.output?.context
      if (!ctx) return null
      return stepAt(playhead.current, ctx.currentTime)
    }
    useRack.getState().setAutomationPosition(read)
    return () => useRack.getState().setAutomationPosition(null)
  }, [nodes])

  /**
   * Play the lanes back.
   *
   * `LanePlayer` is this, moved into `@driftbox/rack` — it was forty lines here, which meant a patch
   * opened by anything that is not this app played the patch and not the performance. The scheduler is
   * unchanged in design: a lookahead window, each point handed over with `scheduleParam` and the frame it
   * belongs at, so the 100ms tick decides only how far ahead work is done and never where a value lands.
   *
   * It reads its position from `Rack.beat`, which is the same banked arithmetic `playhead.ts` does for the
   * screen — one clock, two readers, so the knob and the sound cannot disagree.
   *
   * Playback goes straight to the audio thread rather than through the store, and that is load-bearing:
   * recording writes through `setParam`, which is also what a knob does, so a lane played back into the
   * store would record itself, one point per tick, for ever.
   */
  useEffect(() => {
    if (!playing) return
    // Built on the first tick that finds a rack rather than when the effect runs, because `playing` can
    // turn true before the node exists and an effect that gave up then would leave the lanes silent until
    // somebody pressed stop and play again. A fresh player also replays from the top: it seeds its window
    // just before the current position, so a point at step zero is due rather than skipped.
    let lanes: LanePlayer | null = null
    const tick = () => {
      const live = nodes.rack.current
      if (!live) return
      lanes ??= new LanePlayer(live)
      lanes.advance(useRack.getState().patch.automation)
    }
    tick()
    const timer = window.setInterval(tick, 100)
    return () => window.clearInterval(timer)
  }, [nodes, playing])

  /**
   * Move the knobs the lanes are driving.
   *
   * The same lane and the same playhead that decided what the audio thread was told, read again for the
   * screen — so the panel and the sound are the same number computed twice rather than two channels that
   * can disagree. See `live.ts` for why this is derived here instead of reported from the worklet.
   *
   * An animation frame rather than the scheduler's 100ms tick: this is only ever a picture, and a knob
   * that stepped ten times a second would read as a broken knob rather than a moving one.
   */
  useEffect(() => {
    if (!playing) {
      clearLive()
      return
    }
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const ctx = nodes.rack.current?.output?.context
      const lanes = useRack.getState().patch.automation
      if (!ctx || !lanes || lanes.length === 0) return clearLive()
      const at = stepAt(playhead.current, ctx.currentTime)
      const next = new Map<string, Record<string, number>>()
      for (const lane of lanes) {
        const value = valueAt(lane, at)
        // Undefined before a lane's first point, which is what leaves the knob its own value until the
        // recording actually starts. Publishing a number there would take the knob over at the top of the
        // arrangement, which is precisely what `valueAt` refuses to do.
        if (value === undefined) continue
        const forModule = next.get(lane.target[0]) ?? {}
        forModule[lane.target[1]] = value
        next.set(lane.target[0], forModule)
      }
      publishLive(next)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      clearLive()
    }
  }, [nodes, playing])

  // Knob moves go straight to the audio thread. Subscribing rather than doing it in the handler keeps
  // the faceplates from needing the Rack at all — they only ever touch the store.
  useEffect(() => {
    return useRack.subscribe((state, previous) => {
      const live = nodes.rack.current
      // **Deliberately not `state.revision === previous.revision`.** That guard was here because a
      // structural edit rebuilds the graph anyway, and a rebuild seeds params and data from the plan —
      // so pushing them too was redundant. Undo made it wrong: a restore can change the structure *and*
      // a module's data in one step, and data is the one thing a rebuild does not re-seed, because the
      // Graph keeps pushed data in `pushed` and `pushed` beats `seeded` — the rule that stops a
      // recompile throwing away a loaded break. Without this push, undoing a removed Tracker brings the
      // module back playing the pattern it had *before* the undo. Pushing on every patch change costs a
      // walk of the module list against references that are usually identical.
      if (!live || state.patch === previous.patch) return
      for (const module of state.patch.modules) {
        const before = previous.patch.modules.find((m) => m.id === module.id)
        if (!before) continue
        if (before.params !== module.params) {
          for (const [id, value] of Object.entries(module.params ?? {})) {
            if (before.params?.[id] !== value) live.setParam(module.id, id, value)
          }
        }
        if (before.inputTrims !== module.inputTrims) {
          const ports = new Set([
            ...Object.keys(before.inputTrims ?? {}),
            ...Object.keys(module.inputTrims ?? {}),
          ])
          for (const port of ports) {
            const value = module.inputTrims?.[port] ?? 1
            if ((before.inputTrims?.[port] ?? 1) !== value) {
              live.setInputTrim(module.id, port, value)
            }
          }
        }
        // Pattern data takes the same road as a knob, and for the same reason: `data` is compiled into the
        // plan, so treating an edit as structural would rebuild every processor on every cell you touched.
        // Sent as a `data` message instead, which the Graph keeps in `pushed` — and `pushed` beats
        // `seeded`, which is precisely why recompiling never throws away a loaded break. A pattern is the
        // same shape.
        if (before.data !== module.data) {
          for (const [slot, values] of Object.entries(module.data ?? {})) {
            if (before.data?.[slot] === values) continue
            // A fresh array every time, because `setData` **transfers** it — the buffer is gone on this
            // side the moment it is sent, and the patch's own copy must not be the one that leaves.
            live.setData(module.id, slot, Float32Array.from(values))
          }
        }
      }
    })
  }, [nodes])

  // Let go of the hosted engine on the way out, so a reload does not leave a scheduler running against a
  // context nobody can hear.
  useEffect(
    () => () => {
      bindGrooveboxPerformance(null)
      nodes.groovebox.current?.dispose()
    },
    [bindGrooveboxPerformance, nodes],
  )

  return { started, failed, analyser, kaoss, hasKaoss, audioState, start, wake }
}
