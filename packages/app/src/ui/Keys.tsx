import { useCallback, useEffect, useRef, useState } from 'react'
import { BASS_VOICES, voiceById } from '@driftbox/engine'
import { useBox } from '../store'

// A keyboard for the 303s — and for the toms, which are pitched percussion and have
// wanted playing chromatically since the day they were added.
//
// The layout is the one every tracker and DAW has used for thirty years: the home row is
// the white keys and the row above it the black ones, laid out like a piano. It is worth
// noticing what that gives you here for nothing. The 303's note 0 is an A, so the white
// keys from the root spell **A major** — and the black row above them is where the minor
// third, sixth and seventh live. Press `d` for a bright third, `e` for a dark one.
//
// Monophonic, because a 303 is. That is not a limitation to work around, it is the
// feature: hold one key, press another without letting go, and the two glide together on
// one envelope. Which is the slide from the sequencer, arrived at from the other end.

/**
 * Semitones above the root, laid out as a piano. `a` is the root.
 *
 * Each key also carries its scale degree, and that label is doing real work. The 303's
 * root is an A, so the raised keys come out named C, F and G — which on an actual piano
 * are *white*, and reading them on black keys is baffling. The degree says what is
 * actually going on: the home row is the major scale and the row above it is where the
 * flattened third, sixth and seventh live. `d` is a bright third, `e` a dark one.
 */
const LAYOUT: { key: string; semitone: number; black: boolean; degree: string }[] = [
  { key: 'a', semitone: 0, black: false, degree: '1' },
  { key: 'w', semitone: 1, black: true, degree: '♭2' },
  { key: 's', semitone: 2, black: false, degree: '2' },
  { key: 'e', semitone: 3, black: true, degree: '♭3' },
  { key: 'd', semitone: 4, black: false, degree: '3' },
  { key: 'f', semitone: 5, black: false, degree: '4' },
  { key: 't', semitone: 6, black: true, degree: '♭5' },
  { key: 'g', semitone: 7, black: false, degree: '5' },
  { key: 'y', semitone: 8, black: true, degree: '♭6' },
  { key: 'h', semitone: 9, black: false, degree: '6' },
  { key: 'u', semitone: 10, black: true, degree: '♭7' },
  { key: 'j', semitone: 11, black: false, degree: '7' },
  { key: 'k', semitone: 12, black: false, degree: '8' },
]

const NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']
const noteName = (semitones: number) => NAMES[((semitones % 12) + 12) % 12]

/** Highest octave offset the grid can still show — notes run 0..24. */
const MAX_OCTAVE = 1

export function Keys() {
  const selectedBass = useBox((s) => s.selectedBass)
  const selectBass = useBox((s) => s.selectBass)
  const selectedVoice = useBox((s) => s.selectedVoice)
  // Which instrument the keys drive. The 303s, or whichever pitched drum voice is
  // selected in the grid — you pick Low Tom over there and it becomes playable here.
  const [target, setTarget] = useState<string | null>(null)
  const collapsed = useBox((s) => s.collapsed.keys ?? false)
  const toggleCollapsed = useBox((s) => s.toggleCollapsed)
  const init = useBox((s) => s.init)

  useEffect(() => {
    // Selecting a different voice in the grid drops a stale drum target, so the keys
    // never quietly go on playing something that is no longer on screen.
    setTarget((t) => (t && t !== selectedVoice ? null : t))
  }, [selectedVoice])

  const [octave, setOctave] = useState(0)
  const [accent, setAccent] = useState(false)
  // Which semitones are sounding. A set rather than a single value because the UI wants
  // to light every held key, even though only the last one is audible.
  const [held, setHeld] = useState<number[]>([])
  const heldRef = useRef<number[]>([])

  // The grid's selected voice, if the keyboard could play it.
  const pitchedVoice = voiceById(selectedVoice)?.pitched ? voiceById(selectedVoice) : undefined
  const drum = target ? voiceById(target) : undefined

  const press = useCallback(
    (semitone: number) => {
      init()
      const engine = useBox.getState().engine
      heldRef.current = [...heldRef.current.filter((n) => n !== semitone), semitone]
      setHeld([...heldRef.current])

      if (drum) {
        // A tom is a hit, not a note — struck and gone, with nothing to sustain and
        // nothing to slide into.
        engine?.auditionPitched(drum.id, semitone, accent)
        return
      }
      // Legato when something is already down: the second note glides into the first
      // rather than restarting it, which is the 303's slide.
      const legato = heldRef.current.length > 1
      engine?.bassNoteOn(useBox.getState().selectedBass, semitone, accent, legato)
    },
    [accent, init, drum],
  )

  const lift = useCallback(
    (semitone: number) => {
      heldRef.current = heldRef.current.filter((n) => n !== semitone)
      setHeld([...heldRef.current])
      if (drum) return

      const engine = useBox.getState().engine
      const voice = useBox.getState().selectedBass
      const remaining = heldRef.current[heldRef.current.length - 1]
      if (remaining === undefined) {
        engine?.bassNoteOff(voice)
      } else {
        // Something is still down — fall back to it rather than going silent, so rolling
        // between two keys never leaves a gap.
        engine?.bassNoteOn(voice, remaining, false, true)
      }
    },
    [drum],
  )

  // The computer keyboard.
  useEffect(() => {
    if (collapsed) return

    const down = (event: KeyboardEvent) => {
      // Auto-repeat would retrigger the note thirty times a second while a key is simply
      // held down, which is the opposite of holding a note.
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      const mapped = LAYOUT.find((k) => k.key === event.key.toLowerCase())
      if (mapped) {
        event.preventDefault()
        press(mapped.semitone + octave * 12)
        return
      }
      if (event.key === 'z') setOctave((o) => Math.max(-1, o - 1))
      if (event.key === 'x') setOctave((o) => Math.min(MAX_OCTAVE, o + 1))
      if (event.key === 'Shift') setAccent(true)
    }

    const up = (event: KeyboardEvent) => {
      const mapped = LAYOUT.find((k) => k.key === event.key.toLowerCase())
      if (mapped) lift(mapped.semitone + octave * 12)
      if (event.key === 'Shift') setAccent(false)
    }

    // A key held while the window loses focus never sends its key-up, so the note would
    // sustain until something else happened to stop it.
    const blur = () => {
      heldRef.current = []
      setHeld([])
      useBox.getState().engine?.bassNoteOff(useBox.getState().selectedBass)
      setAccent(false)
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      blur()
    }
  }, [collapsed, octave, press, lift])

  const semitoneOf = (k: (typeof LAYOUT)[number]) => k.semitone + octave * 12

  // A tom tunes across a little under an octave, so the top of the keyboard is out of
  // its reach. Those keys are dimmed rather than removed — the shape stays a keyboard,
  // and it is obvious why the end of it has gone quiet. The way further up is the next
  // tom, which is what the machine's three of them are for.
  const outOfRange = (semitone: number) =>
    drum?.pitched ? drum.pitched.low * Math.pow(2, semitone / 12) > drum.pitched.high : false

  return (
    <section className={`keys${collapsed ? ' collapsed' : ''}${held.length ? ' sounding' : ''}`}>
      <div className="keys-head">
        <button
          className="fold-toggle"
          onClick={() => toggleCollapsed('keys')}
          aria-expanded={!collapsed}
        >
          <span className="fold-chevron">▾</span>
          <h3>Keys</h3>
        </button>

        {!collapsed && (
          <div className="keys-tools">
            <div className="bass-pick">
              {BASS_VOICES.map((v) => (
                <button
                  key={v.id}
                  className={!target && v.id === selectedBass ? 'on' : ''}
                  onClick={() => {
                    setTarget(null)
                    selectBass(v.id)
                  }}
                  title={`Play ${v.name}`}
                >
                  {v.id.slice(-1).toUpperCase()}
                </button>
              ))}
              {/* Only offered when the voice selected in the grid is one the tune knob
                  actually moves the pitch of. A snare has a tune knob too, and playing
                  tunes on it is not a thing anybody wants. */}
              {pitchedVoice && (
                <button
                  className={`keys-drum${target === pitchedVoice.id ? ' on' : ''}`}
                  onClick={() => setTarget(target === pitchedVoice.id ? null : pitchedVoice.id)}
                  title={`Play ${pitchedVoice.name}`}
                >
                  {pitchedVoice.name}
                </button>
              )}
            </div>
            <button
              className={`ghost${accent ? ' on' : ''}`}
              onClick={() => setAccent((a) => !a)}
              title="Accent — or hold shift"
            >
              accent
            </button>
            <div className="keys-octave">
              <button onClick={() => setOctave((o) => Math.max(-1, o - 1))} aria-label="Octave down">
                −
              </button>
              <span>{octave > 0 ? `+${octave}` : octave}</span>
              <button
                onClick={() => setOctave((o) => Math.min(MAX_OCTAVE, o + 1))}
                aria-label="Octave up"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {!collapsed && (
        <div
          className="keys-board"
          // Pointer capture is not used: a finger sliding across the keys should play
          // them, which is how a real keyboard behaves and how anybody expects a glissando
          // to work. That means every key handles its own enter and leave.
          onPointerLeave={() => {
            for (const n of heldRef.current) lift(n)
          }}
        >
          {LAYOUT.map((k) => {
            const semitone = semitoneOf(k)
            const on = held.includes(semitone)
            return (
              <button
                key={k.key}
                className={`key${k.black ? ' black' : ' white'}${on ? ' on' : ''}${
                  outOfRange(semitone) ? ' unreachable' : ''
                }`}
                onPointerDown={(e) => {
                  e.currentTarget.releasePointerCapture?.(e.pointerId)
                  press(semitone)
                }}
                onPointerEnter={(e) => {
                  if (e.buttons > 0) press(semitone)
                }}
                onPointerUp={() => lift(semitone)}
                onPointerLeave={() => lift(semitone)}
                onPointerCancel={() => lift(semitone)}
                aria-label={`${noteName(semitone)}, key ${k.key}`}
              >
                <span className="key-note">{noteName(semitone)}</span>
                <span className="key-cap">
                  {k.degree}
                  <i className="key-letter"> · {k.key}</i>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
