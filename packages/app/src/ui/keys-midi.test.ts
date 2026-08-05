import { describe, expect, it } from 'vitest'
import {
  ACCENT_VELOCITY,
  MIDI_ROOT,
  midiVoiceStep,
  soundingSemitones,
  type ChannelVoice,
} from './keys-midi.js'

// None of this could be run before: it read two mutable ref maps, the live store and a third ref, and
// the only way to reach it was a real controller on a real desk played by hand.
//
// The rule the branches exist for is capture. A channel stays committed to what it started playing until
// its gate closes, so a selection change made mid-phrase cannot move the passage under somebody's
// fingers. Getting it wrong leaves a stuck note on one voice and a spurious note-off on another, and it
// only happens when somebody changes the selection while playing.

const on = (note: number, velocity = 0.5) => ({ note, velocity, gate: 1 })
const off = (note: number) => ({ note, velocity: 0, gate: 0 })

const bass = (voiceId: string): ChannelVoice => ({ kind: 'bass', voiceId })
const drum = (id: string, played: number[], current: number): ChannelVoice => ({
  kind: 'drum',
  passage: { id, played, current },
})

const on303 = { drumId: null, bassId: '303.a' }
const onTom = { drumId: '909.lt', bassId: '303.a' }

describe('a free channel', () => {
  it('plays the selected 303, writes the note down, and captures the voice', () => {
    const step = midiVoiceStep(on(MIDI_ROOT + 7), undefined, on303)
    expect(step.action).toEqual({
      kind: 'bass-on',
      voiceId: '303.a',
      semitone: 7,
      accent: false,
      legato: false,
      write: true,
    })
    expect(step.capture).toEqual({ kind: 'bass', voiceId: '303.a' })
  })

  it('plays the selected drum instead when the panel is pointed at one', () => {
    const step = midiVoiceStep(on(MIDI_ROOT + 3), undefined, onTom)
    expect(step.action).toEqual({ kind: 'drum', voiceId: '909.lt', semitone: 3, accent: false })
    expect(step.capture).toEqual({
      kind: 'drum',
      passage: { id: '909.lt', played: [MIDI_ROOT + 3], current: MIDI_ROOT + 3 },
    })
  })

  it('reads the root as note zero, and below it as negative', () => {
    const at = (note: number) => midiVoiceStep(on(note), undefined, on303).action
    expect(at(MIDI_ROOT)).toMatchObject({ semitone: 0 })
    expect(at(MIDI_ROOT + 24)).toMatchObject({ semitone: 24 })
    expect(at(MIDI_ROOT - 12)).toMatchObject({ semitone: -12 })
  })

  it('accents from the top of the velocity range, which is all a 303 has', () => {
    const at = (velocity: number) => midiVoiceStep(on(MIDI_ROOT, velocity), undefined, on303).action
    expect(at(ACCENT_VELOCITY)).toMatchObject({ accent: true })
    expect(at(ACCENT_VELOCITY - 0.01)).toMatchObject({ accent: false })
    expect(at(1)).toMatchObject({ accent: true })
  })
})

describe('a channel already playing a 303', () => {
  it('glides, and does not write the glided note down', () => {
    const step = midiVoiceStep(on(MIDI_ROOT + 5), bass('303.a'), on303)
    expect(step.action).toEqual({
      kind: 'bass-on',
      voiceId: '303.a',
      semitone: 5,
      accent: false,
      legato: true,
      write: false,
    })
  })

  it('stays on the voice it started on when the editor selection moves', () => {
    // The whole point of capture: fingers down, selection changed, the passage does not jump.
    const step = midiVoiceStep(on(MIDI_ROOT + 5), bass('303.a'), { drumId: null, bassId: '303.b' })
    expect(step.action).toMatchObject({ voiceId: '303.a' })
    expect(step.capture).toEqual({ kind: 'bass', voiceId: '303.a' })
  })

  it('stays on it even when a drum is selected mid-phrase', () => {
    const step = midiVoiceStep(on(MIDI_ROOT + 5), bass('303.b'), onTom)
    expect(step.action).toMatchObject({ kind: 'bass-on', voiceId: '303.b' })
  })
})

describe('a channel already playing a pitched drum', () => {
  it('strikes a note the passage has not played yet', () => {
    const step = midiVoiceStep(on(MIDI_ROOT + 5), drum('909.lt', [MIDI_ROOT], MIDI_ROOT), onTom)
    expect(step.action).toEqual({ kind: 'drum', voiceId: '909.lt', semitone: 5, accent: false })
    expect(step.capture).toMatchObject({
      passage: { played: [MIDI_ROOT, MIDI_ROOT + 5], current: MIDI_ROOT + 5 },
    })
  })

  it('does not strike again when the allocator falls back to an older held note', () => {
    // A tom is a hit. Re-striking one the finger never re-pressed is an audible extra hit, and the
    // allocator reports a fallback and a fresh press identically.
    const passage = drum('909.lt', [MIDI_ROOT, MIDI_ROOT + 5], MIDI_ROOT + 5)
    const step = midiVoiceStep(on(MIDI_ROOT), passage, onTom)
    expect(step.action).toEqual({ kind: 'none' })
    expect(step.capture).toMatchObject({ passage: { current: MIDI_ROOT } })
  })

  it('does strike again when the same note is genuinely re-pressed', () => {
    const passage = drum('909.lt', [MIDI_ROOT, MIDI_ROOT + 5], MIDI_ROOT + 5)
    const step = midiVoiceStep(on(MIDI_ROOT + 5), passage, onTom)
    expect(step.action).toMatchObject({ kind: 'drum', semitone: 5 })
  })

  it('records a note in the passage exactly once', () => {
    const passage = drum('909.lt', [MIDI_ROOT], MIDI_ROOT)
    const step = midiVoiceStep(on(MIDI_ROOT), passage, onTom)
    expect(step.capture).toMatchObject({ passage: { played: [MIDI_ROOT] } })
  })

  it('stays on the drum it started on when the panel selection moves', () => {
    const step = midiVoiceStep(on(MIDI_ROOT + 2), drum('909.lt', [MIDI_ROOT], MIDI_ROOT), on303)
    expect(step.action).toMatchObject({ kind: 'drum', voiceId: '909.lt' })
  })
})

describe('a gate closing', () => {
  it('silences the 303 the channel started on, not the one selected now', () => {
    const step = midiVoiceStep(off(MIDI_ROOT), bass('303.a'), { drumId: null, bassId: '303.b' })
    expect(step.action).toEqual({ kind: 'bass-off', voiceId: '303.a' })
    expect(step.capture).toBeNull()
  })

  it('releases a drum channel without silencing anything, a hit having no gate to close', () => {
    const step = midiVoiceStep(off(MIDI_ROOT), drum('909.lt', [MIDI_ROOT], MIDI_ROOT), onTom)
    expect(step.action).toEqual({ kind: 'none' })
    expect(step.capture).toBeNull()
  })

  it('does nothing for a channel that was never captured', () => {
    const step = midiVoiceStep(off(MIDI_ROOT), undefined, on303)
    expect(step.action).toEqual({ kind: 'none' })
    expect(step.capture).toBeNull()
  })
})

describe('a phrase played across a selection change', () => {
  it('reaches the same voice it left, on both the note-on and the note-off', () => {
    let capture: ChannelVoice
    const actions = []

    const first = midiVoiceStep(on(MIDI_ROOT), capture, { drumId: null, bassId: '303.a' })
    capture = first.capture ?? undefined
    actions.push(first.action)

    // Somebody clicks the other 303 while still holding the key.
    const glide = midiVoiceStep(on(MIDI_ROOT + 7), capture, { drumId: null, bassId: '303.b' })
    capture = glide.capture ?? undefined
    actions.push(glide.action)

    const release = midiVoiceStep(off(MIDI_ROOT + 7), capture, { drumId: null, bassId: '303.b' })
    actions.push(release.action)

    expect(actions.map((action) => 'voiceId' in action && action.voiceId)).toEqual([
      '303.a',
      '303.a',
      '303.a',
    ])
    expect(release.capture).toBeNull()
  })
})

describe('what the grid lights up', () => {
  it('reports sounding notes as semitones above the root', () => {
    expect(soundingSemitones([MIDI_ROOT, MIDI_ROOT + 7])).toEqual([0, 7])
    expect(soundingSemitones([])).toEqual([])
  })
})
