import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BASS_VOICES, ClockFollower, voiceById } from '@driftbox/engine'
import { useBox } from '../store'
import {
  KeyboardBank,
  midiClockOrigin,
  openMidi,
  type MidiHandle,
  type MidiPort,
  type VoiceState,
} from '../midi.js'
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
import { liftNote, pressNote } from './keys-hold.js'
import { LAYOUT, noteName, outOfRange, semitoneOf, shiftOctave } from './keys-layout.js'
import { midiVoiceStep, soundingSemitones, type ChannelVoice } from './keys-midi.js'
import { claimsKey, keysKeyDown, keysKeyUp } from './keys-shortcuts.js'
import { clockLost, followClock } from '../clock-follow.js'

// A keyboard for the 303s — and for the toms, which are pitched percussion and have
// wanted playing chromatically since the day they were added.
//
// The layout is the one every tracker and DAW has used for thirty years: the home row is
// the white keys and the row above it the black ones. Monophonic, because a 303 is — that
// is not a limitation to work around, it is the feature: hold one key, press another
// without letting go, and the two glide together on one envelope. Which is the slide from
// the sequencer, arrived at from the other end.
//
// What moved out, because none of it could be reached without a controller on a desk:
//
//   keys-layout.ts     which key is which semitone, what it is called, how far it moves
//   keys-hold.ts       the monophonic stack: the glide, and the fallback that closes gaps
//   keys-midi.ts       what a note on a channel does, and what that channel is committed to
//   keys-shortcuts.ts  what a keystroke means here, and when it belongs to a field instead

export function Keys() {
  const selectedBass = useBox((s) => s.selectedBass)
  const selectBass = useBox((s) => s.selectBass)
  const selectedVoice = useBox((s) => s.selectedVoice)
  const view = useBox((s) => s.view)
  const song = useBox((s) => s.song)
  const engine = useBox((s) => s.engine)
  const running = useBox((s) => s.running)
  const editing = useBox((s) => s.editing)
  const bassEntryStep = useBox((s) => s.bassEntryStep)
  const toggleBassEntry = useBox((s) => s.toggleBassEntry)
  const setBassEntryStep = useBox((s) => s.setBassEntryStep)
  const enterBassRest = useBox((s) => s.enterBassRest)
  const enterBassTie = useBox((s) => s.enterBassTie)
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
  const [midiOutputs, setMidiOutputs] = useState<MidiPort[]>([])
  const [clockOutput, setClockOutput] = useState('')
  const clockOutputRef = useRef('')
  const [clockOut, setClockOut] = useState(false)
  const clocking = useRef(false)
  /**
   * Whether to follow an incoming MIDI clock, and off by default.
   *
   * Opt-in rather than automatic, because plenty of gear streams clock the moment it is plugged
   * in — a DAW, a groovebox, some keyboards — and a sequencer that silently handed its transport
   * and tempo to whatever was on the other end of the cable would be taking somebody's instrument
   * away from them without being asked. Following is a decision, so it gets a switch.
   */
  const [sync, setSync] = useState(false)
  const syncing = useRef(false)
  const follower = useRef(new ClockFollower())
  const [external, setExternal] = useState<number | null>(null)
  /** What each channel is committed to until its gate closes — see `keys-midi.ts`. */
  const channels = useRef(new Map<number, ChannelVoice>())

  // The grid's selected voice, if the keyboard could play it.
  const pitchedVoice = voiceById(selectedVoice)?.pitched ? voiceById(selectedVoice) : undefined
  const drum = target ? voiceById(target) : undefined

  const playMidiVoice = useCallback(
    (state: VoiceState, channel: number) => {
      init()
      const box = useBox.getState()
      const selectedTarget = targetRef.current
      const selectedDrum = selectedTarget ? voiceById(selectedTarget) : undefined
      const step = midiVoiceStep(state, channels.current.get(channel), {
        drumId: selectedDrum?.pitched ? selectedDrum.id : null,
        bassId: box.selectedBass,
      })

      if (step.capture) channels.current.set(channel, step.capture)
      else channels.current.delete(channel)

      const { action } = step
      if (action.kind === 'bass-off') {
        box.engine?.bassNoteOff(action.voiceId)
      } else if (action.kind === 'drum') {
        box.engine?.auditionPitched(action.voiceId, action.semitone, action.accent)
      } else if (action.kind === 'bass-on') {
        if (action.write) box.enterBassNote(action.semitone, action.accent)
        box.engine?.bassNoteOn(action.voiceId, action.semitone, action.accent, action.legato)
      }
      setMidiHeld(soundingSemitones(bank.current.sounding()))
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

  const stopClockOut = useCallback(() => {
    const handle = midi.current
    const output = clockOutputRef.current
    const currentEngine = useBox.getState().engine
    if (clocking.current && handle && output && currentEngine) {
      const origin = midiClockOrigin(currentEngine.ctx, performance.now())
      handle.clearOutput(output)
      handle.sendClock(
        output,
        { message: 'stop', time: currentEngine.ctx.currentTime },
        origin.audioTime,
        origin.performanceTime,
      )
    }
    clocking.current = false
    setClockOut(false)
  }, [])

  const updateMidiOutputs = useCallback(
    (outputs: MidiPort[]) => {
      const current = clockOutputRef.current
      if (clocking.current && !outputs.some((output) => output.id === current)) stopClockOut()
      const next = outputs.some((output) => output.id === current) ? current : (outputs[0]?.id ?? '')
      clockOutputRef.current = next
      setMidiOutputs(outputs)
      setClockOutput(next)
    },
    [stopClockOut],
  )

  useEffect(() => {
    if (!engine) return
    return engine.onMidiClock((event) => {
      if (!clocking.current) return
      const handle = midi.current
      const output = clockOutputRef.current
      if (!handle || !output) return
      if (event.message === 'stop') handle.clearOutput(output)
      const origin = midiClockOrigin(engine.ctx, performance.now())
      handle.sendClock(output, event, origin.audioTime, origin.performanceTime)
    })
  }, [engine])

  const toggleMidi = useCallback(async () => {
    if (midi.current) {
      stopClockOut()
      for (const { state, channel } of bank.current.allOff()) playMidiVoice(state, channel)
      midi.current.close()
      midi.current = null
      setMidiInputs([])
      updateMidiOutputs([])
      setMidiState('off')
      setLearning(null)
      return
    }

    const handle = await openMidi(
      {
        onVoice: playMidiVoice,
        onClock: (message, time) => {
          if (!syncing.current) return
          const engine = useBox.getState().engine
          if (!engine) return
          const now = performance.now()
          const command = followClock(message, time, follower.current, {
            bpm: engine.bpm,
            ticks: engine.clockTicks,
            time: now,
          })
          if (command.bpm !== undefined) {
            // `followTempo`, not `bpm`: the latter writes through to the document, and a DAW at
            // 174 would silently rewrite a 120bpm song and let the autosave keep it.
            engine.followTempo(command.bpm)
            setExternal(command.bpm)
          }
          if (command.transport === 'start') void engine.startAt(0, 0)
          else if (command.transport === 'resume') void engine.startAtStep(command.step ?? 0)
          else if (command.transport === 'stop') engine.stop()
        },
        // The mod wheel is an ordinary learnable CC in the groovebox. Rack mode adds
        // the dedicated modulation output, one of the ways it remains the superset.
        onMod: () => {},
        onControl,
        onInputs: setMidiInputs,
        onOutputs: updateMidiOutputs,
      },
      bank.current,
    )
    if (!handle) {
      setMidiState('unavailable')
      return
    }
    midi.current = handle
    setMidiInputs(handle.inputs)
    updateMidiOutputs(handle.outputs)
    setMidiState('on')
  }, [onControl, playMidiVoice, stopClockOut, updateMidiOutputs])

  // A ref beside the state because the MIDI handler is created once, inside `openMidi`, and closes
  // over whatever it can see at that moment. Reading the state directly would freeze it at
  // whatever `sync` was when the port opened.
  useEffect(() => {
    syncing.current = sync
    if (!sync) {
      useBox.getState().engine?.followTempo(null)
      setExternal(null)
    }
  }, [sync])

  // The clock going away is the one event that never arrives, so it has to be looked for. A second
  // is comfortably longer than the follower's own half-second patience and short enough that a
  // pulled cable does not leave the song at somebody else's tempo for long.
  useEffect(() => {
    if (!sync) return
    const timer = setInterval(() => {
      if (!clockLost(follower.current, performance.now()).release) return
      useBox.getState().engine?.followTempo(null)
      setExternal(null)
    }, 1000)
    return () => clearInterval(timer)
  }, [sync])

  const toggleClockOut = useCallback(() => {
    if (clockOut) {
      stopClockOut()
      return
    }
    if (!midi.current || !clockOutput || running || engine?.running) return
    syncing.current = false
    setSync(false)
    clocking.current = true
    setClockOut(true)
  }, [clockOut, clockOutput, engine, running, stopClockOut])

  useEffect(
    () => () => {
      const handle = midi.current
      const output = clockOutputRef.current
      const currentEngine = useBox.getState().engine
      if (handle && output && clocking.current && currentEngine) {
        const origin = midiClockOrigin(currentEngine.ctx, performance.now())
        handle.clearOutput(output)
        handle.sendClock(
          output,
          { message: 'stop', time: currentEngine.ctx.currentTime },
          origin.audioTime,
          origin.performanceTime,
        )
      }
      midi.current?.close()
      // Every 303 a channel had committed to, so unmounting mid-phrase cannot leave one sustaining.
      for (const voice of channels.current.values()) {
        if (voice?.kind === 'bass') useBox.getState().engine?.bassNoteOff(voice.voiceId)
      }
      channels.current.clear()
    },
    [],
  )

  const press = useCallback(
    (semitone: number) => {
      init()
      const engine = useBox.getState().engine
      const { held: next, legato } = pressNote(heldRef.current, semitone)
      heldRef.current = next
      setHeld([...next])

      if (drum) {
        // A tom is a hit, not a note — struck and gone, with nothing to sustain and
        // nothing to slide into.
        engine?.auditionPitched(drum.id, semitone, accent)
        return
      }
      useBox.getState().enterBassNote(semitone, accent)
      engine?.bassNoteOn(useBox.getState().selectedBass, semitone, accent, legato)
    },
    [accent, init, drum],
  )

  const lift = useCallback(
    (semitone: number) => {
      const { held: next, sounding } = liftNote(heldRef.current, semitone)
      heldRef.current = next
      setHeld([...next])
      if (drum) return

      const engine = useBox.getState().engine
      const voice = useBox.getState().selectedBass
      if (sounding === null) engine?.bassNoteOff(voice)
      else engine?.bassNoteOn(voice, sounding, false, true)
    },
    [drum],
  )

  // The computer keyboard.
  useEffect(() => {
    if (collapsed) return

    const entry = bassEntryStep !== null && view === 'bass' && !drum

    const down = (event: KeyboardEvent) => {
      const action = keysKeyDown(event, { octave, entry })
      if (!action) return
      if (claimsKey(action)) event.preventDefault()
      if (action.kind === 'note') press(action.semitone)
      else if (action.kind === 'rest') enterBassRest()
      else if (action.kind === 'tie') enterBassTie()
      else if (action.kind === 'octave') setOctave((o) => shiftOctave(o, action.delta))
      else if (action.kind === 'accent') setAccent(action.down)
    }

    const up = (event: KeyboardEvent) => {
      const action = keysKeyUp(event, octave)
      if (action?.kind === 'note') lift(action.semitone)
      else if (action?.kind === 'accent') setAccent(action.down)
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
  }, [
    bassEntryStep,
    collapsed,
    drum,
    enterBassRest,
    enterBassTie,
    octave,
    press,
    lift,
    view,
  ])

  const entryPattern = song.patterns.find((candidate) => candidate.id === editing)
  const entryAvailable = view === 'bass' && !drum && Boolean(entryPattern)
  const transportRunning = running || Boolean(engine?.running)

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
              {entryAvailable && (
                <div className="keys-entry" aria-label="303 step entry">
                  <button
                    className={`ghost${bassEntryStep !== null ? ' on' : ''}`}
                    aria-pressed={bassEntryStep !== null}
                    onClick={toggleBassEntry}
                    title="Write keyboard notes into the stopped pattern and advance"
                  >
                    step entry
                  </button>
                  {bassEntryStep !== null && entryPattern && (
                    <>
                      <button
                        aria-label="Previous entry step"
                        onClick={() => setBassEntryStep(bassEntryStep - 1)}
                      >
                        ←
                      </button>
                      <span>step {bassEntryStep + 1}</span>
                      <button
                        aria-label="Next entry step"
                        onClick={() => setBassEntryStep(bassEntryStep + 1)}
                      >
                        →
                      </button>
                      <button onClick={enterBassRest} title="Write a rest (Backspace)">
                        rest
                      </button>
                      <button onClick={enterBassTie} title="Tie the previous note (Enter)">
                        tie
                      </button>
                    </>
                  )}
                </div>
              )}
              <button
                className={`ghost${accent ? ' on' : ''}`}
                onClick={() => setAccent((a) => !a)}
                title="Accent — or hold shift"
              >
                accent
              </button>
              <div className="keys-octave">
                <button
                  onClick={() => setOctave((o) => shiftOctave(o, -1))}
                  aria-label="Octave down"
                >
                  −
                </button>
                <span>{octave > 0 ? `+${octave}` : octave}</span>
                <button
                  onClick={() => setOctave((o) => shiftOctave(o, 1))}
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
          <button
            className={`ghost${sync ? ' on' : ''}`}
            disabled={midiState !== 'on'}
            aria-pressed={sync}
            title={
              sync
                ? 'Following an incoming MIDI clock. The song keeps its own tempo — this one is not saved.'
                : 'Follow an incoming MIDI clock: tempo, play and stop come from the other machine'
            }
            onClick={() => {
              if (!sync) stopClockOut()
              setSync((on) => !on)
            }}
          >
            {sync ? `sync${external ? ` · ${external.toFixed(1)}` : ' · waiting'}` : 'sync'}
          </button>
          {midiState === 'on' && (
            <>
              <select
                aria-label="MIDI clock output"
                title="MIDI clock output"
                value={clockOutput}
                disabled={clockOut || transportRunning || midiOutputs.length === 0}
                onChange={(event) => {
                  clockOutputRef.current = event.target.value
                  setClockOutput(event.target.value)
                }}
              >
                {midiOutputs.length === 0 && <option value="">no MIDI outputs</option>}
                {midiOutputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {output.name}
                  </option>
                ))}
              </select>
              <button
                className={`ghost${clockOut ? ' on' : ''}`}
                disabled={!clockOutput || (transportRunning && !clockOut)}
                aria-pressed={clockOut}
                title={
                  clockOut
                    ? 'Sending MIDI clock, song position, play and stop to the selected output'
                    : transportRunning
                      ? 'Stop playback before enabling MIDI clock output'
                      : 'Send MIDI clock, song position, play and stop to the selected output'
                }
                onClick={toggleClockOut}
              >
                clock out
              </button>
            </>
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
            const semitone = semitoneOf(k, octave)
            const on = held.includes(semitone) || midiHeld.includes(semitone)
            return (
              <button
                key={k.key}
                className={`key${k.black ? ' black' : ' white'}${on ? ' on' : ''}${
                  outOfRange(drum?.pitched, semitone) ? ' unreachable' : ''
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
