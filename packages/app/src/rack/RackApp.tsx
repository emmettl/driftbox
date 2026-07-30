import { MIDI_INPUTS, MODULE_LIST, MODULES, Rack, compile } from '@driftbox/rack'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackPanel } from './BackPanel.js'
import { Chassis } from './Chassis.js'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { Oscilloscope } from '../visual/Oscilloscope.js'
import { BREAKS, renderBreak } from './breaks.js'
import { midiTargets, openMidi, type MidiHandle } from './midi.js'
import { PatchBrowser } from './PatchBrowser.js'
import { patchShareLink } from './persistence.js'
import { openingPatch, useRack } from './store.js'

// The rack, as a page.
//
// Its own entry point rather than a tab on the sequencer: `rack.html`, its own root, no shared store and
// no router. See the entry-point section of `docs/RACK.md` for why — the short version is that the rack
// turns around, and there is nothing in a step sequencer to hang that off.
//
// The flip is a CSS 3D rotation rather than three.js. The app already has `@react-three/fiber` for the
// visualiser, so WebGL was available and is the wrong tool here: rotating real DOM keeps every knob a
// real element with its own events, its focus ring and its ARIA role, which a canvas would have to
// reimplement badly. `preserve-3d` and `backface-visibility` are the whole mechanism.

export default function RackApp() {
  const patch = useRack((s) => s.patch)
  const revision = useRack((s) => s.revision)
  const flipped = useRack((s) => s.flipped)
  const flip = useRack((s) => s.flip)
  const load = useRack((s) => s.load)
  const addModule = useRack((s) => s.addModule)
  const setNotes = useRack((s) => s.setNotes)
  const name = useRack((s) => s.name)
  const setMidi = useRack((s) => s.setMidi)
  const midiInputs = useRack((s) => s.midiInputs)
  const setVoices = useRack((s) => s.setVoices)
  const voices = useRack((s) => s.patch.voices ?? 1)
  const hasMidi = useRack((s) => s.patch.modules.some((m) => m.type === 'midi'))
  const tempo = useRack((s) => s.patch.tempo ?? 120)
  const setTempo = useRack((s) => s.setTempo)
  const playing = useRack((s) => s.running)
  const setRunning = useRack((s) => s.setRunning)
  const ensureSampler = useRack((s) => s.ensureSampler)

  const rack = useRef<Rack | null>(null)
  /**
   * The rack's own analyser.
   *
   * State rather than a ref, because the scope has to re-render once it exists. It is the sequencer's
   * `Oscilloscope` component reading it — the same trace, the same phosphor persistence — which took
   * removing that component's dependency on the sequencer's store. It is genuinely diagnostic here rather
   * than decorative: a VCA left shut reads as a flat line, and a patch clipping into the Out reads as a
   * flattened top, and both are otherwise invisible.
   */
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [shared, setShared] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [loadedBreak, setLoadedBreak] = useState<string | null>(null)
  /**
   * What the AudioContext says about itself.
   *
   * Worth knowing rather than assuming, because a browser suspends a context on its own — a background tab, an
   * interruption on iOS — and then the transport is running as far as this app is concerned while nothing is
   * coming out. Event-driven off `statechange` rather than polled.
   */
  const [audioState, setAudioState] = useState<AudioContextState | 'none'>('none')
  const midi = useRef<MidiHandle | null>(null)
  const [midiState, setMidiState] = useState<'off' | 'on' | 'unavailable'>('off')

  const geometry = useMemo(() => layout(patch.modules, sizeFor(MODULES)), [patch.modules])

  /**
   * Send an incoming note to every MIDI module listening on that channel.
   *
   * Straight to `rack.setParam` and **never through the store's patch**. A note somebody played is
   * performance, not document — routing it through the patch would autosave the last key anybody pressed
   * into the file, and every note would also bump the revision and recompile the graph. The store gets a
   * copy of the note only so the faceplate can say whether a keyboard is connected.
   */
  const sendMidi = useCallback(
    (
      channel: number,
      values: Partial<Record<(typeof MIDI_INPUTS)[number], number>>,
      voice?: number,
    ) => {
      const live = rack.current
      if (!live) return
      // The decision about *which* modules hear this is `midiTargets`, which is pure and tested — Chrome
      // refuses Web MIDI under automation, so a rule left in here could not be verified at all.
      for (const id of midiTargets(useRack.getState().patch.modules, channel)) {
        // `voice` undefined means every voice, which is right for the mod wheel — one wheel, all the notes.
        // A note names its voice, which is how one MIDI module holds a chord.
        for (const [param, value] of Object.entries(values)) live.setParam(id, param, value, voice)
      }
    },
    [],
  )

  /**
   * Render a break and hand it to every sampler in the patch.
   *
   * A copy per sampler, because `setData` **transfers** the buffer — after the first send the array is empty on
   * this side, so loading one break into two samplers would give the second one nothing. That is the cost of not
   * copying on the audio thread's doorstep, and it is worth it; it just has to be known about.
   */
  const loadBreak = useCallback(
    async (id: string) => {
      const live = rack.current
      const entry = BREAKS.find((candidate) => candidate.id === id)
      if (!live || !entry) return

      // **If there is nowhere to put it, make somewhere.** Clicking a break used to do nothing at all when the
      // patch had no Sampler — there was a hint saying to add one, and the button stayed enabled and silently
      // no-opped. For an instrument whose whole aim is being fun in four seconds, clicking a break has to produce
      // a break; being told to go and assemble three modules first is the opposite of that.
      ensureSampler()
      // The patch it may just have changed has to reach the audio thread before the data does, or the data is for
      // a module the Graph has not built yet.
      live.patch = useRack.getState().patch

      const rendered = await renderBreak(entry, { sampleRate: live.output?.context.sampleRate })
      const samplers = useRack.getState().patch.modules.filter((m) => m.type === 'sampler')
      // A copy per sampler, because `setData` transfers: after the first send the array is empty on this side.
      for (const module of samplers) live.setData(module.id, 'sample', rendered.slice())
      setLoadedBreak(entry.name)

      // A break is rendered at its own tempo and only slices cleanly at that tempo, so adopting it means adopting
      // the tempo too. Letting the chop drift silently would be the worse outcome.
      if ((useRack.getState().patch.tempo ?? 120) !== entry.tempo) setTempo(entry.tempo)
      // And it should be playing. Loading a break and hearing nothing is the same failure as the stop button.
      setRunning(true)
    },
    [ensureSampler, setTempo, setRunning],
  )

  async function toggleMidi() {
    if (midi.current) {
      midi.current.close()
      midi.current = null
      setMidiState('off')
      setMidi(null, [])
      return
    }
    const handle = await openMidi({
      onVoice: (state, channel) => {
        sendMidi(
          channel,
          { note: state.note, gate: state.gate, velocity: state.velocity },
          state.voice,
        )
        // Only the note that just sounded reaches the faceplate. A gate-off does not clear it, because on a
        // chord the last thing to be released is not interesting and blanking on it would flicker.
        if (state.gate === 1) setMidi(state.note)
      },
      onMod: (value, channel) => sendMidi(channel, { mod: value }),
    })
    if (!handle) {
      // Web MIDI is Chromium-only, so this is the common case rather than the exceptional one. Absence has
      // to read as absence — the same standard `loadRack` holds itself to when there is no AudioWorklet.
      setMidiState('unavailable')
      return
    }
    // After the null check, and before anything is played: the keyboards have to agree with the graph about
    // how many voices exist, or the first note lands on a voice the audio thread does not have.
    handle.setVoices(useRack.getState().patch.voices ?? 1)
    midi.current = handle
    setMidiState('on')
    setMidi(null, handle.inputs)
  }

  // Whatever we were opened with: a shared link, the last session, or the starter patch.
  useEffect(() => {
    void openingPatch().then(load)
  }, [load])

  // Tab flips the rack, the way it does in Reason. Kept off inputs so a rename field is still usable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      event.preventDefault()
      flip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip])

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
    const live = rack.current
    if (live) live.patch = useRack.getState().patch
    // Compiled for diagnostics whether or not audio is running. The Rack would produce the same notes,
    // but only once it exists — and a feedback cable has to be drawn as feedback from the moment it is
    // patched, not from the moment somebody presses Start. Compiling is pure and cheap; it is the same
    // function the audio thread's plan comes from, so the two cannot disagree.
    setNotes(compile(useRack.getState().patch, MODULES).notes)
  }, [revision, setNotes])

  async function start() {
    if (rack.current) return
    const ctx = new AudioContext()
    const live = new Rack(ctx)
    if (!(await live.start())) {
      // No worklet, no rack — unlike the engine's ladder there is nothing to fall back to, and saying
      // so is better than looking broken.
      setFailed(true)
      return
    }
    ctx.onstatechange = () => setAudioState(ctx.state)
    setAudioState(ctx.state)

    const scope = ctx.createAnalyser()
    scope.fftSize = 2048
    scope.smoothingTimeConstant = 0.75
    live.output?.connect(scope)
    live.output?.connect(ctx.destination)
    setAnalyser(scope)

    live.patch = useRack.getState().patch
    rack.current = live
    // The gesture that starts audio is also the gesture that starts the music. Anything else means arriving,
    // pressing a button, and getting silence — which is the "instant DJ" problem in `docs/DNB.md`.
    live.setTransport(useRack.getState().patch.tempo ?? 120, true)
    setRunning(true)
    setStarted(true)
  }

  // Knob moves go straight to the audio thread. Subscribing rather than doing it in the handler keeps
  // the faceplates from needing the Rack at all — they only ever touch the store.
  // Let go of the devices on the way out, so a reload does not leave handlers on a closed page.
  useEffect(() => () => midi.current?.close(), [])

  // The keyboards have to agree with the graph about how many voices there are, or a note lands on a voice
  // the audio thread does not have. `setVoices` silences everything, which is what recompiling does anyway.
  useEffect(() => {
    midi.current?.setVoices(voices)
  }, [voices])

  /**
   * Push the transport, and suspend the audio context when stopped.
   *
   * Both, and the second one is the fix for a real bug. Stop used to only set `running: false`, which the
   * Transport module honours and **nothing else does** — the Clock is free-running by design, so on the shipped
   * patches, which drive themselves from a Clock, Stop changed the button's label and nothing else. A stop button
   * that does not stop is worse than no stop button.
   *
   * Suspending is the honest answer: it stops everything regardless of what is driving the patch, it is instant,
   * and it is what a transport control on a player does. The transport message still goes out, because a
   * Transport-driven patch should also come back in the right place.
   */
  useEffect(() => {
    const live = rack.current
    if (!live) return
    live.setTransport(tempo, playing)

    // An AudioWorkletNode's context is typed as BaseAudioContext, which has neither suspend nor resume — the rack
    // is always given a real AudioContext, so this is a narrowing rather than an assumption.
    const ctx = live.output?.context as AudioContext | undefined
    if (!ctx) return
    if (playing) {
      if (ctx.state === 'suspended') void ctx.resume()
    } else if (ctx.state === 'running') {
      void ctx.suspend()
    }
  }, [tempo, playing])

  useEffect(() => {
    return useRack.subscribe((state, previous) => {
      const live = rack.current
      if (!live || state.patch === previous.patch || state.revision !== previous.revision) return
      for (const module of state.patch.modules) {
        const before = previous.patch.modules.find((m) => m.id === module.id)
        if (!before || before.params === module.params) continue
        for (const [id, value] of Object.entries(module.params ?? {})) {
          if (before.params?.[id] !== value) live.setParam(module.id, id, value)
        }
      }
    })
  }, [])

  // `s.notes` and not `s.notes.filter(...)`. A selector that builds a new array every call hands
  // zustand a different snapshot on every render, and `useSyncExternalStore` responds by rendering
  // again — an infinite loop, which React reports as "Maximum update depth exceeded" and a blank page.
  // Derive outside the selector, always.
  const notes = useRack((s) => s.notes)
  const placeholders = useMemo(
    () => notes.filter((note) => note.kind === 'placeholder'),
    [notes],
  )

  return (
    <div className="rk" data-playing={playing ? 'yes' : 'no'} data-audio={audioState}>
      <header className="rk-header">
        <h1>
          Driftbox <span>Rack</span>
        </h1>
        {name && <span className="rk-open">{name}</span>}
        {loadedBreak && <span className="rk-open">{loadedBreak}</span>}

        {!started && !failed && (
          <button type="button" className="rk-primary" onClick={start}>
            Start audio
          </button>
        )}
        {failed && <span className="rk-warn">No AudioWorklet — this browser cannot run a rack.</span>}

        <button type="button" onClick={() => flip()} aria-pressed={flipped}>
          {flipped ? 'Front' : 'Back'} <kbd>Tab</kbd>
        </button>

        <button
          type="button"
          onClick={() => {
            setAdding((open) => !open)
            setBrowsing(false)
          }}
          aria-expanded={adding}
        >
          Add module
        </button>

        <button
          type="button"
          onClick={() => {
            setBrowsing((open) => !open)
            setAdding(false)
          }}
          aria-expanded={browsing}
        >
          Patches
        </button>

        {started && (
          <>
            <button type="button" onClick={() => setRunning(!playing)} aria-pressed={playing}>
              {playing ? '■ Stop' : '▶ Play'}
            </button>
            <label className="rk-voices">
              BPM
              <input
                type="number"
                min={20}
                max={400}
                value={Math.round(tempo)}
                aria-label="Tempo"
                onChange={(event) => setTempo(Number(event.target.value))}
              />
            </label>
          </>
        )}

        <label
          className="rk-voices"
          title={
            voices > 1 && !hasMidi
              ? 'Nothing here plays different notes on different voices, so every voice plays the same one — and the output is that many times louder. Add a MIDI module.'
              : undefined
          }
        >
          Voices
          <select
            value={voices}
            onChange={(event) => setVoices(Number(event.target.value))}
            aria-label="Voices"
          >
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {midiState !== 'unavailable' ? (
          <button
            type="button"
            onClick={toggleMidi}
            aria-pressed={midiState === 'on'}
            disabled={!started}
            title={started ? undefined : 'Start audio first'}
          >
            {/* "MIDI in" rather than "MIDI": the palette has a button for the module itself, and two
                controls sharing an accessible name is ambiguous to a screen reader and to a test. */}
            MIDI in{midiState === 'on' && midiInputs.length > 0 ? ` · ${midiInputs.length}` : ''}
          </button>
        ) : (
          <span className="rk-warn">No Web MIDI in this browser.</span>
        )}

        <button
          type="button"
          onClick={async () => {
            setShared(await patchShareLink(useRack.getState().patch))
            await navigator.clipboard?.writeText(shared ?? '').catch(() => {})
          }}
        >
          Copy link
        </button>

        <a className="rk-away" href="./index.html">
          Sequencer →
        </a>
      </header>

      {adding && (
        <div className="rk-palette">
          {MODULE_LIST.map((def) => (
            <button
              key={def.type}
              type="button"
              onClick={() => {
                addModule(def.type)
                setAdding(false)
              }}
            >
              {def.name}
            </button>
          ))}
        </div>
      )}

      {browsing && (
        <PatchBrowser onClose={() => setBrowsing(false)} onLoadBreak={started ? loadBreak : undefined} />
      )}

      {shared && <p className="rk-shared">{shared}</p>}

      {started && playing && audioState === 'suspended' && (
        <p className="rk-warn">
          The browser has suspended audio — press Play again, or click anywhere on the page.
        </p>
      )}

      {voices > 1 && !hasMidi && (
        <p className="rk-warn">
          {voices} voices, and no MIDI module to play different notes on them — so every voice plays the same
          note and the output is {voices}× louder. That is the summing being correct rather than a bug; add a
          MIDI module to hear it as a chord.
        </p>
      )}

      {placeholders.length > 0 && (
        <p className="rk-warn">
          {placeholders.length === 1
            ? '1 module in this patch is not in this build. It is kept and will be saved, but it makes no sound.'
            : `${placeholders.length} modules in this patch are not in this build. They are kept and will be saved, but they make no sound.`}
        </p>
      )}

      <div className="rk-stage">
        <div
          className={flipped ? 'rk-rack rk-rack-flipped' : 'rk-rack'}
          style={{
            width: geometry.width,
            height: geometry.height,
          }}
        >
          <div className="rk-side rk-side-front">
            <Chassis layout={geometry} />
          </div>
          <div className="rk-side rk-side-back">
            <BackPanel layout={geometry} />
          </div>
        </div>
      </div>

      {started && (
        <div className="rk-scope">
          {/* No `colour`: it becomes a canvas strokeStyle, which cannot read a CSS custom property — it
              would silently keep whatever was set last. The default is already --nine's value. */}
          <Oscilloscope analyser={analyser} mode="wave" height={70} />
        </div>
      )}

      <footer className="rk-footer">
        <span>
          {patch.modules.length} modules · {patch.cables.length} cables
        </span>
        <span className="rk-hint">
          {flipped ? 'Drag between jacks to patch · click a cable to unpatch' : 'Drag a knob · Tab for the back'}
        </span>
      </footer>
    </div>
  )
}
