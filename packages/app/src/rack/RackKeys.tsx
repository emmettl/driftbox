import { useCallback, useEffect, useRef, useState } from 'react'
import { BLACK_HEIGHT, WHITE_HEIGHT, keyMap, keyboardWidth, noteName, pianoKeys } from './keys.js'
import { useRack } from './store.js'

// The keyboard you play the rack with when there is no keyboard to plug in.
//
// Which is most of the time: Web MIDI is Chromium-only and a phone has none at all, so a rack that can
// only be played by its own sequencer or by hardware is one that most people can never play. `docs/DNB.md`
// calls this cheap and high value, and the cheap part is real — it needed no new message and no new
// module, because the MIDI module's params are already the note, the gate and the velocity, and the host
// already writes them per voice.
//
// **It reuses `Keyboard` from `midi.ts` rather than having its own note logic.** That class is where
// last-note priority, legato and voice allocation live, and they are the difference between a keyboard and
// a row of buttons — hold a note, press another, it glides; let the second go and it falls back to the
// first. Reimplementing that here would have meant two subtly different keyboards in one app.
//
// Notes never travel through the store. They are performance, not document — see the note in `store.ts`
// about why routing them through `setParam` would autosave the last key anybody pressed into the file.

interface Props {
  /** Whether the on-screen panel is taking up space. Computer and MIDI keyboards remain available. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Make the rack able to sound before playing into it. Resolves true if it had to be started from cold. */
  wake: () => Promise<boolean>
  /** Notes go through the `KeyboardBank` owned above, so hardware and these keys share one allocator. */
  down: (note: number, velocity: number) => void
  up: (note: number) => void
  allOff: () => void
  /** Which notes are currently sounding, for lighting the keys. */
  sounding: readonly number[]
}

/** Two octaves on a desktop: enough for a bassline and its answer without moving the hands. */
const OCTAVES = 2
/**
 * One octave on a phone, and the reason is thumb size.
 *
 * Two octaves is fifteen white keys, which on a 430px screen is 28px each — measured, and well under the
 * ~44px a fingertip needs. One octave gives 53px, which is playable. The octave buttons are what make the
 * narrower range workable, and they are why they exist at all rather than being a nicety.
 */
const NARROW_OCTAVES = 1
const NARROW = '(max-width: 560px)'

/** How many octaves fit, kept live so rotating a phone changes it. */
function useOctaves(): number {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === 'function' && matchMedia(NARROW).matches,
  )
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia(NARROW)
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow ? NARROW_OCTAVES : OCTAVES
}
/** Where the keyboard starts, in MIDI notes. 36 is C2, which is 0 V on every pitch inlet in this rack. */
const ROOT = 36

export function RackKeys({ open, onOpenChange, wake, down, up, allOff, sounding }: Props) {
  const ensureMidi = useRack((s) => s.ensureMidi)
  const hasMidi = useRack((s) => s.patch.modules.some((m) => m.type === 'midi'))
  const hasVco = useRack((s) => s.patch.modules.some((m) => m.type === 'vco'))

  const [octave, setOctave] = useState(0)
  const [velocity, setVelocity] = useState(0.8)
  const octaves = useOctaves()
  const keys = pianoKeys(octaves)
  const width = keyboardWidth(octaves)

  /** Notes held by the pointer, so dragging off a key releases it and dragging on presses the next. */
  const dragging = useRef<number | null>(null)
  const held = useRef(new Set<number>())

  const press = useCallback(
    (note: number) => {
      if (held.current.has(note)) return
      // Wire one up on the first note rather than doing nothing, the same way loading a break does. A
      // keyboard that is silent because of missing plumbing is indistinguishable from a broken one.
      ensureMidi()
      held.current.add(note)
      down(note, velocity)
      void wake().then((wasCold) => {
        // Played into an audio thread that did not exist yet, so play it again now that it does — but only
        // in that case, or every note in the ordinary path would be struck twice.
        if (wasCold && held.current.has(note)) down(note, velocity)
      })
    },
    [down, ensureMidi, velocity, wake],
  )

  const release = useCallback(
    (note: number) => {
      if (!held.current.delete(note)) return
      up(note)
    },
    [up],
  )

  // The computer keyboard. Two octaves under the hands, shifted by the octave control.
  useEffect(() => {
    const map = keyMap()
    const onDown = (event: KeyboardEvent) => {
      // Auto-repeat would retrigger the note thirty times a second while a key is simply held, which is
      // the opposite of holding a note.
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      const semitone = map.get(event.key.toLowerCase())
      if (semitone !== undefined) {
        event.preventDefault()
        press(ROOT + semitone + octave * 12)
        return
      }
      if (event.key === ',') setOctave((o) => Math.max(-2, o - 1))
      if (event.key === '.') setOctave((o) => Math.min(3, o + 1))
    }
    const onUp = (event: KeyboardEvent) => {
      const semitone = map.get(event.key.toLowerCase())
      if (semitone !== undefined) release(ROOT + semitone + octave * 12)
    }
    // A key held while the window loses focus never sends its key-up, so the note would sustain until
    // something else happened to stop it.
    const onBlur = () => {
      held.current.clear()
      allOff()
    }

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      onBlur()
    }
  }, [octave, press, release, allOff])

  /**
   * Slide from one key to the next without letting go.
   *
   * A glissando, and it is the reason this resolves the note from the event target on every move rather
   * than capturing the pointer to the key that was first pressed. Implicit pointer capture on touch would
   * otherwise pin every move to the first key — the same trap the back panel's patching hit, noted in
   * `BackPanel.tsx`.
   */
  const slideTo = useCallback(
    (note: number | null) => {
      if (dragging.current === note) return
      if (dragging.current !== null) release(dragging.current)
      dragging.current = note
      if (note !== null) press(note)
    },
    [press, release],
  )

  const stop = useCallback(() => {
    if (dragging.current !== null) release(dragging.current)
    dragging.current = null
  }, [release])

  const toggle = useCallback(() => {
    if (open) {
      // A pointer or computer key can still be held when the panel starts moving. Release the shared
      // allocator before hiding its feedback, otherwise a note could remain sounding with no lit key to
      // explain it.
      dragging.current = null
      held.current.clear()
      allOff()
    }
    onOpenChange(!open)
  }, [allOff, onOpenChange, open])

  const noteFor = (semitone: number) => ROOT + semitone + octave * 12

  return (
    <div className="rk-keys-dock" data-open={open ? 'yes' : 'no'}>
      <button
        type="button"
        className="rk-keys-toggle"
        aria-expanded={open}
        aria-controls="rack-keyboard"
        onClick={toggle}
      >
        <span aria-hidden="true">{open ? '↓' : '↑'}</span>
        {open ? 'Hide keyboard' : 'Show keyboard'}
      </button>

      <div className="rk-keys-reveal">
        <div
          id="rack-keyboard"
          className="rk-keys"
          data-armed={hasMidi ? 'yes' : 'no'}
          aria-hidden={!open}
          inert={!open}
        >
          <div className="rk-keys-controls">
            <button
              type="button"
              onClick={() => setOctave((o) => Math.max(-2, o - 1))}
              aria-label="Octave down"
            >
              &minus;
            </button>
            <span className="rk-keys-octave">{noteName(noteFor(0))}</span>
            <button
              type="button"
              onClick={() => setOctave((o) => Math.min(3, o + 1))}
              aria-label="Octave up"
            >
              +
            </button>
            <label className="rk-keys-vel">
              VEL
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.01"
                value={velocity}
                onChange={(event) => setVelocity(Number(event.target.value))}
                aria-label="Velocity"
              />
            </label>
          </div>

          {/* No `preserveAspectRatio: none` here, unlike the back panel. The rack's cables can stretch with the
              window because their shape is arbitrary; a piano's is not, and stretching it made near-square keys
              with oval corners. Letting it letterbox instead keeps a key the shape of a key at any width. */}
          <svg
            className="rk-keys-board"
            viewBox={`0 0 ${width} ${WHITE_HEIGHT}`}
            role="group"
            // The computer-key mapping is the accessible path rather than 25 tab stops, so it has to be
            // discoverable by somebody who cannot see the hint next to it.
            aria-label={`Keyboard, ${octaves === 1 ? 'one octave' : `${octaves} octaves`} from ${noteName(noteFor(0))}. Play with the Z and Q rows; comma and full stop change octave.`}
            onPointerLeave={stop}
            onPointerUp={stop}
            onPointerCancel={stop}
          >
            {keys.map((key) => {
              const note = noteFor(key.semitone)
              const lit = sounding.includes(note)
              return (
                <rect
                  key={key.semitone}
                  className={[
                    'rk-key',
                    key.black ? 'rk-key-black' : 'rk-key-white',
                    lit ? 'rk-key-lit' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  x={key.x}
                  y={0}
                  width={key.width}
                  height={key.black ? BLACK_HEIGHT : WHITE_HEIGHT}
                  rx={0.08}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    slideTo(note)
                  }}
                  // Resolved per element rather than from coordinates: the keys are rectangles that already
                  // know which note they are, and `pointerenter` while a button is down is exactly a slide.
                  onPointerEnter={(event) => {
                    if (event.buttons !== 0 && dragging.current !== null) slideTo(note)
                  }}
                >
                  <title>{noteName(note)}</title>
                </rect>
              )
            })}
          </svg>

          <p className="rk-keys-hint">
            {!hasMidi && !hasVco
              ? 'Add a VCO and these keys will have something to play.'
              : !hasMidi
                ? 'Playing a key patches a Keys module in, taking over the pitch and gate it lands on.'
                : null}
            {/* Real characters rather than `&hairsp;`: the build does not decode that entity and it came out
                on screen as the literal text "z&hairsp;–&hairsp;m". */}
            <span className="rk-keys-tip">
              <kbd>z</kbd>–<kbd>m</kbd> and <kbd>q</kbd>–<kbd>u</kbd> · <kbd>,</kbd> <kbd>.</kbd> octave
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
