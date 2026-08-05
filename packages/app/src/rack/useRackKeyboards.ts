import { MIDI_INPUTS, MODULES } from '@driftbox/rack'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardBank, midiTargets, openMidi, type MidiHandle } from '../midi.js'
import { ccValue, targets as ccTargets } from '../midi-cc.js'
import type { RackNodes } from './nodes.js'
import { useRack, type GrooveboxTapHit } from './store.js'

// Everything that plays a note, whichever keyboard played it: the on-screen keys, a plugged-in
// controller, and the tap recorder that turns a played note into a step in the retained song.
//
// The rule this file exists to keep straight is the one between **performance and document**. A note
// somebody played goes to the audio thread and never into the patch — routing it through the store would
// autosave the last key anybody pressed into the file and recompile the graph per note. A *controller*
// moving a knob is the opposite: that is the same act as turning the knob with a mouse, and it has to
// travel through the store so the knob moves, the Combinator routing runs, and it saves. The two paths
// are a few lines apart below, and confusing them has produced a bug in each direction.

export interface RackKeyboards {
  /** Which notes are sounding, for lighting the keys. Session state; it never goes near the patch. */
  sounding: number[]
  midiState: 'off' | 'on' | 'unavailable'
  toggleMidi: () => Promise<void>
  down: (note: number, velocity: number) => void
  up: (note: number) => void
  allOff: () => void
}

export function useRackKeyboards(nodes: RackNodes): RackKeyboards {
  const setMidi = useRack((s) => s.setMidi)
  const voices = useRack((s) => s.patch.voices ?? 1)
  const [sounding, setSounding] = useState<number[]>([])
  const [midiState, setMidiState] = useState<'off' | 'on' | 'unavailable'>('off')
  const midi = useRef<MidiHandle | null>(null)

  /**
   * One allocator for every keyboard, on screen or plugged in.
   *
   * Two banks would fight over the voices: each would believe it owned all of them, so an on-screen note
   * could be silently stolen by one from hardware and a release would hand back a voice the other still
   * thought it held. Sharing also means the on-screen keys light up for notes arriving from a controller,
   * which is the cheapest possible way to see that a controller is working.
   */
  const bank = useRef(new KeyboardBank())
  /** Notes claimed by the Groovebox tap recorder instead of the generic rack MIDI path. */
  const grooveboxTaps = useRef(new Map<number, GrooveboxTapHit>())

  /**
   * Send an incoming note to every MIDI module listening on that channel.
   *
   * Straight to `rack.setParam` and **never through the store's patch**. The store gets a copy of the note
   * only so the faceplate can say whether a keyboard is connected.
   */
  const sendMidi = useCallback(
    (
      channel: number,
      values: Partial<Record<(typeof MIDI_INPUTS)[number], number>>,
      voice?: number,
    ) => {
      const live = nodes.rack.current
      if (!live) return
      // The decision about *which* modules hear this is `midiTargets`, which is pure and tested — Chrome
      // refuses Web MIDI under automation, so a rule left in here could not be verified at all.
      for (const id of midiTargets(useRack.getState().patch.modules, channel)) {
        // `voice` undefined means every voice, which is right for the mod wheel — one wheel, all the
        // notes. A note names its voice, which is how one MIDI module holds a chord.
        for (const [param, value] of Object.entries(values)) live.setParam(id, param, value, voice)
      }
    },
    [nodes],
  )

  /** The one path a note takes to the audio thread, whichever keyboard played it. */
  const playVoice = useCallback(
    (state: { voice: number; note: number; gate: 0 | 1; velocity: number }, channel = 1) => {
      const heldTap = grooveboxTaps.current.get(state.note)
      if (state.gate === 0 && heldTap) {
        grooveboxTaps.current.delete(state.note)
        if (heldTap.section === '303.a' || heldTap.section === '303.b') {
          nodes.groovebox.current?.bassNoteOff(heldTap.section)
        }
        setSounding(bank.current.sounding())
        return
      }

      if (state.gate === 1) {
        // A monophonic allocator can emit a second gate-on when it falls back to a key that is still
        // held. It should sound again, but it is not another tap and must not overwrite another step.
        const tap = heldTap ?? useRack.getState().recordGrooveboxTap(state.note, state.velocity)
        if (tap) {
          const legato = [...grooveboxTaps.current.values()].some(
            (held) => held.section === tap.section,
          )
          grooveboxTaps.current.set(state.note, tap)
          if (tap.section === '303.a' || tap.section === '303.b') {
            nodes.groovebox.current?.bassNoteOn(tap.section, tap.semitone, tap.accent, legato)
          } else {
            nodes.groovebox.current?.audition(tap.voiceId, tap.accent ? 1 : 0.55)
          }
          setMidi(state.note)
          setSounding(bank.current.sounding())
          return
        }
      }

      sendMidi(
        channel,
        { note: state.note, gate: state.gate, velocity: state.velocity },
        state.voice,
      )
      // Only the note that just sounded reaches the faceplate. A gate-off does not clear it, because on a
      // chord the last thing released is not interesting and blanking on it would flicker.
      if (state.gate === 1) setMidi(state.note)
      setSounding(bank.current.sounding())
    },
    [nodes, sendMidi, setMidi],
  )

  const down = useCallback(
    (note: number, velocity: number) => {
      for (const state of bank.current.for(1).down(note, velocity)) playVoice(state)
    },
    [playVoice],
  )
  const up = useCallback(
    (note: number) => {
      for (const state of bank.current.for(1).up(note)) playVoice(state)
    },
    [playVoice],
  )
  const allOff = useCallback(() => {
    for (const { state, channel } of bank.current.allOff()) playVoice(state, channel)
  }, [playVoice])

  /**
   * A controller moved. Either teach it a parameter, or move the ones it already drives.
   *
   * **Through the store, not straight to the audio thread** — and that is the opposite of what a *note*
   * does above. It has to move the knob on screen, run the Combinator's routing so everything it drives
   * moves with it, save, and travel in a link. `setParam` already does all of that; going direct would
   * give a rotary that silently did nothing but change the sound.
   */
  const onControl = useCallback((cc: number, raw: number, channel: number) => {
    const state = useRack.getState()
    // Learning wins. While a parameter is armed, the next controller message teaches it rather than moving
    // whatever else that controller happens to be bound to — otherwise arming a knob you had already
    // mapped would fight itself.
    if (state.ccLearning) {
      state.finishCcLearn(cc)
      return
    }
    for (const binding of ccTargets(state.ccBindings, cc, channel)) {
      const module = state.patch.modules.find((m) => m.id === binding.module)
      if (!module) continue
      const param = MODULES[module.type]?.params.find((p) => p.id === binding.param)
      // A binding whose module has been deleted, or whose param this build does not have. Left in storage
      // rather than pruned: the patch it was taught against may well be opened again.
      if (!param || param.hidden) continue
      state.setParam(binding.module, binding.param, ccValue(raw, param))
    }
  }, [])

  const toggleMidi = useCallback(async () => {
    if (midi.current) {
      midi.current.close()
      midi.current = null
      setMidiState('off')
      setMidi(null, [])
      return
    }
    const handle = await openMidi(
      {
        onVoice: (state, channel) => playVoice(state, channel),
        onMod: (value, channel) => sendMidi(channel, { mod: value }),
        onPerformance: (control, value, channel) => sendMidi(channel, { [control]: value }),
        onControl,
        onInputs: (inputs) => setMidi(null, inputs),
      },
      bank.current,
    )
    if (!handle) {
      // Web MIDI is Chromium-only, so this is the common case rather than the exceptional one. Absence has
      // to read as absence — the same standard `start` holds itself to when there is no AudioWorklet.
      setMidiState('unavailable')
      return
    }
    midi.current = handle
    setMidiState('on')
    setMidi(null, handle.inputs)
  }, [onControl, playVoice, sendMidi, setMidi])

  /**
   * Keep the allocator agreeing with the graph about how many voices exist.
   *
   * Was done once, when Web MIDI was opened. That was already the wrong place — changing the voice count
   * afterwards left the keyboards allocating across a number the audio thread no longer had, so a note
   * could land on a voice that did not exist — and it is doubly wrong now the on-screen keys can play
   * without Web MIDI ever being opened at all.
   */
  useEffect(() => {
    for (const { state, channel } of bank.current.setVoices(voices)) playVoice(state, channel)
  }, [playVoice, voices])

  // The keyboards have to agree with the graph about how many voices there are, or a note lands on a voice
  // the audio thread does not have. `setVoices` silences everything, which is what recompiling does anyway.
  useEffect(() => {
    midi.current?.setVoices(voices)
  }, [voices])

  // Let go of the devices on the way out, so a reload does not leave handlers on a closed page.
  useEffect(() => () => midi.current?.close(), [])

  return { sounding, midiState, toggleMidi, down, up, allOff }
}
