import { MODULE_LIST, MODULES, Rack, compile } from '@driftbox/rack'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BackPanel } from './BackPanel.js'
import { Chassis } from './Chassis.js'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { Oscilloscope } from '../visual/Oscilloscope.js'
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
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [shared, setShared] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const geometry = useMemo(() => layout(patch.modules, sizeFor(MODULES)), [patch.modules])

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
    const scope = ctx.createAnalyser()
    scope.fftSize = 2048
    scope.smoothingTimeConstant = 0.75
    live.output?.connect(scope)
    live.output?.connect(ctx.destination)
    setAnalyser(scope)

    live.patch = useRack.getState().patch
    rack.current = live
    setRunning(true)
  }

  // Knob moves go straight to the audio thread. Subscribing rather than doing it in the handler keeps
  // the faceplates from needing the Rack at all — they only ever touch the store.
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
    <div className="rk">
      <header className="rk-header">
        <h1>
          Driftbox <span>Rack</span>
        </h1>

        {!running && !failed && (
          <button type="button" className="rk-primary" onClick={start}>
            Start audio
          </button>
        )}
        {failed && <span className="rk-warn">No AudioWorklet — this browser cannot run a rack.</span>}

        <button type="button" onClick={() => flip()} aria-pressed={flipped}>
          {flipped ? 'Front' : 'Back'} <kbd>Tab</kbd>
        </button>

        <button type="button" onClick={() => setAdding((open) => !open)} aria-expanded={adding}>
          Add module
        </button>

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

      {shared && <p className="rk-shared">{shared}</p>}

      {placeholders.length > 0 && (
        <p className="rk-warn">
          {placeholders.length} module{placeholders.length > 1 ? 's' : ''} in this patch are not in this
          build. They are kept and will be saved, but they make no sound.
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

      {running && (
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
