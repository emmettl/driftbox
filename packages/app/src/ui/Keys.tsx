import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BASS_VOICES, voiceById } from '@driftbox/engine'
import { useBox } from '../store'
import { KeyboardBank, openMidi, type MidiHandle, type VoiceState } from '../midi.js'
import {
  bindingsFor,
  ccValue,
  describeBinding,
  forget,
  learn,
  loadBindings,
  saveBindings,
  targets as ccTargets,
  type CcBinding,
} from '../midi-cc.js'
import {
  applyGrooveboxMidiTarget,
  GROOVEBOX_MIDI_MODULE,
  grooveboxMidiTargetRange,
  grooveboxMidiTargets,
} from '../groovebox-midi.js'

// A keyboard for the 303s — and for the toms, which are pitched percussion and have
// wanted playing chromatically since the day they were added.
//
// The layout is the one every tracker and DAW has used for thirty years: the home row is
// the white keys and the row above it the black ones. What matters is that the colours
// follow the PITCH — the 303's note 0 is an A, so the white keys from the root spell A
// natural minor, and the two gaps in the black row fall where B meets C and E meets F,
// exactly as they do on a piano. For a major scale under the fingers, start on `d`, which
// is a C.
//
// Monophonic, because a 303 is. That is not a limitation to work around, it is the
// feature: hold one key, press another without letting go, and the two glide together on
// one envelope. Which is the slide from the sequencer, arrived at from the other end.

/**
 * One octave of a real piano, from the 303's root.
 *
 * The colours follow the PITCH, not the scale. That sounds obvious and the first version
 * got it wrong: it put white keys at 0,2,4,5,7,9,11 — the shape of a piano starting at C —
 * while the 303's note 0 is an A. So C, F and G came out on black keys and C#, F# and G#
 * on white ones, which is precisely backwards from every keyboard ever built, and no
 * amount of helpful degree labelling makes that read as anything but wrong.
 *
 * From A the pattern is: one black, a gap where B meets C, two blacks, a gap where E meets
 * F, then two more. Those two gaps are the thing that makes a keyboard legible at a glance
 * — they are how you find middle C without counting — and they only appear if the black
 * keys are placed by pitch.
 *
 * The consequence, worth saying out loud: the home row now spells A natural MINOR rather
 * than A major, because that is what the white keys from an A are. The major third, sixth
 * and seventh moved up to the black row where they belong. For a major scale under the
 * fingers, start on `d` — which is a C, and C major is all white keys.
 *
 * The letters keep the shape of the computer keyboard: black keys sit on the number row's
 * neighbours, above the gap between the two white keys they fall between.
 */
const LAYOUT: { key: string; semitone: number; black: boolean; degree: string }[] = [
  { key: 'a', semitone: 0, black: false, degree: '1' },
  { key: 'w', semitone: 1, black: true, degree: '\u266d2' },
  { key: 's', semitone: 2, black: false, degree: '2' },
  // No black key between B and C. This gap is not a mistake.
  { key: 'd', semitone: 3, black: false, degree: '\u266d3' },
  { key: 'r', semitone: 4, black: true, degree: '3' },
  { key: 'f', semitone: 5, black: false, degree: '4' },
  { key: 't', semitone: 6, black: true, degree: '\u266d5' },
  { key: 'g', semitone: 7, black: false, degree: '5' },
  // Nor between E and F.
  { key: 'h', semitone: 8, black: false, degree: '\u266d6' },
  { key: 'u', semitone: 9, black: true, degree: '6' },
  { key: 'j', semitone: 10, black: false, degree: '\u266d7' },
  { key: 'i', semitone: 11, black: true, degree: '7' },
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
  const view = useBox((s) => s.view)
  // Which instrument the keys drive. The 303s, or whichever pitched drum voice is
  // selected in the grid — you pick Low Tom over there and it becomes playable here.
  const [target, setTarget] = useState<string | null>(null)
  const targetRef = useRef<string | null>(null)
  targetRef.current = target
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
  const [midiHeld, setMidiHeld] = useState<number[]>([])

  // Hardware bindings describe the controller on this desk, not the song. Rack and
  // groovebox share the file, with a namespace keeping their stable targets separate.
  const [bindings, setBindings] = useState<CcBinding[]>(() => loadBindings())
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings
  const [learning, setLearning] = useState<string | null>(null)
  const learningRef = useRef<string | null>(null)
  learningRef.current = learning
  const learnTargets = useMemo(
    () => grooveboxMidiTargets(view === 'bass', selectedVoice, selectedBass),
    [view, selectedVoice, selectedBass],
  )
  const [mapping, setMapping] = useState(learnTargets[0].param)
  const activeMapping = learnTargets.some((candidate) => candidate.param === mapping)
    ? mapping
    : learnTargets[0].param
  const learned = bindingsFor(bindings, GROOVEBOX_MIDI_MODULE).get(activeMapping)

  const bank = useRef(new KeyboardBank())
  const midi = useRef<MidiHandle | null>(null)
  const [midiState, setMidiState] = useState<'off' | 'on' | 'unavailable'>('off')
  const [midiInputs, setMidiInputs] = useState<string[]>([])
  /** Bass voice a channel started on. A selection change while a key is held must not
   * send the eventual note-off to a different 303. */
  const midiBass = useRef(new Map<number, string>())
  /** Pitched drums are hits, not sustained voices. Remember a channel's passage so the
   * mono allocator returning to an older held key does not strike that tom twice. */
  const midiDrums = useRef(
    new Map<number, { id: string; played: Set<number>; current: number }>(),
  )

  // The grid's selected voice, if the keyboard could play it.
  const pitchedVoice = voiceById(selectedVoice)?.pitched ? voiceById(selectedVoice) : undefined
  const drum = target ? voiceById(target) : undefined

  const playMidiVoice = useCallback(
    (state: VoiceState, channel: number) => {
      init()
      const box = useBox.getState()
      const capturedBass = midiBass.current.get(channel)
      const capturedDrum = midiDrums.current.get(channel)

      if (state.gate === 0) {
        if (capturedBass) {
          box.engine?.bassNoteOff(capturedBass)
          midiBass.current.delete(channel)
        }
        midiDrums.current.delete(channel)
        setMidiHeld(bank.current.sounding().map((note) => note - 33))
        return
      }

      // Once a legato passage starts on a 303 it stays there until its gate closes,
      // even if the editor selection changes while the player's fingers are down.
      if (capturedBass) {
        box.engine?.bassNoteOn(capturedBass, state.note - 33, state.velocity >= 0.8, true)
      } else if (capturedDrum) {
        // A repeated note-on should retrigger; a fallback to an older held note should
        // not. The allocator reports both as gate-on, so the held passage disambiguates.
        if (!capturedDrum.played.has(state.note) || capturedDrum.current === state.note) {
          box.engine?.auditionPitched(capturedDrum.id, state.note - 33, state.velocity >= 0.8)
        }
        capturedDrum.played.add(state.note)
        capturedDrum.current = state.note
      } else {
        const selectedTarget = targetRef.current
        const selectedDrum = selectedTarget ? voiceById(selectedTarget) : undefined
        if (selectedDrum?.pitched) {
          box.engine?.auditionPitched(selectedDrum.id, state.note - 33, state.velocity >= 0.8)
          midiDrums.current.set(channel, {
            id: selectedDrum.id,
            played: new Set([state.note]),
            current: state.note,
          })
        } else {
          midiBass.current.set(channel, box.selectedBass)
          box.engine?.bassNoteOn(box.selectedBass, state.note - 33, state.velocity >= 0.8, false)
        }
      }
      setMidiHeld(bank.current.sounding().map((note) => note - 33))
    },
    [init],
  )

  const onControl = useCallback((cc: number, raw: number, _channel: number) => {
    const armed = learningRef.current
    if (armed) {
      const next = learn(bindingsRef.current, {
        cc,
        channel: 0,
        module: GROOVEBOX_MIDI_MODULE,
        param: armed,
      })
      bindingsRef.current = next
      saveBindings(next)
      setBindings(next)
      setLearning(null)
      return
    }

    for (const binding of ccTargets(bindingsRef.current, cc, _channel)) {
      if (binding.module !== GROOVEBOX_MIDI_MODULE) continue
      const range = grooveboxMidiTargetRange(binding.param)
      if (!range) continue
      applyGrooveboxMidiTarget(binding.param, ccValue(raw, range), useBox.getState())
    }
  }, [])

  const toggleMidi = useCallback(async () => {
    if (midi.current) {
      for (const { state, channel } of bank.current.allOff()) playMidiVoice(state, channel)
      midi.current.close()
      midi.current = null
      setMidiInputs([])
      setMidiState('off')
      setLearning(null)
      return
    }

    const handle = await openMidi(
      {
        onVoice: playMidiVoice,
        // The mod wheel is an ordinary learnable CC in the groovebox. Rack mode adds
        // the dedicated modulation output, one of the ways it remains the superset.
        onMod: () => {},
        onControl,
        onInputs: setMidiInputs,
      },
      bank.current,
    )
    if (!handle) {
      setMidiState('unavailable')
      return
    }
    midi.current = handle
    setMidiInputs(handle.inputs)
    setMidiState('on')
  }, [onControl, playMidiVoice])

  useEffect(
    () => () => {
      midi.current?.close()
      for (const voice of midiBass.current.values()) useBox.getState().engine?.bassNoteOff(voice)
      midiBass.current.clear()
      midiDrums.current.clear()
    },
    [],
  )

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
    <section
      className={`keys${collapsed ? ' collapsed' : ''}${
        held.length || midiHeld.length ? ' sounding' : ''
      }`}
    >
      <div className="keys-head">
        <button
          className="fold-toggle"
          onClick={() => toggleCollapsed('keys')}
          aria-expanded={!collapsed}
        >
          <span className="fold-chevron">▾</span>
          <h3>Keys</h3>
        </button>

        <div className="keys-head-tools">
          <button
            className={`ghost keys-midi${midiState === 'on' ? ' on' : ''}`}
            onClick={() => void toggleMidi()}
            aria-pressed={midiState === 'on'}
            title={
              midiState === 'unavailable'
                ? 'Web MIDI is unavailable or permission was refused'
                : midiState === 'on'
                  ? `${midiInputs.length} MIDI input${midiInputs.length === 1 ? '' : 's'} connected`
                  : 'Enable hardware MIDI input'
            }
          >
            {midiState === 'unavailable'
              ? 'MIDI unavailable'
              : `MIDI${midiState === 'on' && midiInputs.length ? ` · ${midiInputs.length}` : ''}`}
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
                <button
                  onClick={() => setOctave((o) => Math.max(-1, o - 1))}
                  aria-label="Octave down"
                >
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
      </div>

      {!collapsed && (
        <div className="keys-midi-learn">
          <label>
            <span>MIDI map</span>
            <select
              value={activeMapping}
              onChange={(event) => {
                setMapping(event.target.value)
                setLearning(null)
              }}
            >
              {learnTargets.map((candidate) => (
                <option key={candidate.param} value={candidate.param}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`ghost${learning === activeMapping ? ' on' : ''}`}
            disabled={midiState !== 'on'}
            onClick={() => setLearning((armed) => (armed === activeMapping ? null : activeMapping))}
          >
            {learning === activeMapping
              ? 'turn a control…'
              : learned
                ? describeBinding(learned)
                : 'learn'}
          </button>
          {learned && (
            <button
              className="ghost"
              onClick={() => {
                const next = forget(bindingsRef.current, GROOVEBOX_MIDI_MODULE, activeMapping)
                bindingsRef.current = next
                saveBindings(next)
                setBindings(next)
                setLearning(null)
              }}
            >
              forget
            </button>
          )}
          <span className="keys-midi-hint">
            {midiState === 'on'
              ? learning
                ? 'Move the hardware knob to bind it'
                : midiInputs.length
                  ? midiInputs.join(', ')
                  : 'Ready — connect a controller'
              : 'Enable MIDI to play the selected Keys instrument and learn controls'}
          </span>
        </div>
      )}

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
            const on = held.includes(semitone) || midiHeld.includes(semitone)
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
