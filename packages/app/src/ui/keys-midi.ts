// What a note arriving on a MIDI channel actually does.
//
// Out of `Keys.tsx` because it is the densest decision in the panel and it was completely unreachable:
// the only way to run it was a real controller, on a real desk, played by hand. It reads two mutable
// `useRef` maps, the live store and a third ref holding the selected drum, and branches four ways.
//
// The rule the branches exist for is CAPTURE. A channel remembers what it started playing until its gate
// closes, so a selection change made while somebody's fingers are down cannot move the passage under
// them — the eventual note-off reaches the 303 the note-on went to, not whichever one the editor has
// selected by then. Getting that wrong leaves a stuck note on one voice and a spurious note-off on
// another, and it only happens when somebody changes the selection mid-phrase.

/** MIDI note 33 is the 303's note 0. Everything here works in semitones above that. */
export const MIDI_ROOT = 33

/** Above this, a note is an accent. The 303 has one accent level, not a velocity curve. */
export const ACCENT_VELOCITY = 0.8

/** A pitched drum passage in progress on one channel. */
export interface DrumPassage {
  id: string
  /** Notes this passage has already struck, so a fallback does not strike them again. */
  played: readonly number[]
  /** The note the passage is on now. */
  current: number
}

/** What a channel is committed to until its gate closes. */
export type ChannelVoice =
  | { kind: 'bass'; voiceId: string }
  | { kind: 'drum'; passage: DrumPassage }
  | undefined

/** What the panel is pointed at when a channel is free to be captured. */
export interface KeysSelection {
  /** The pitched drum voice the Keys panel is playing, if it is playing one. */
  drumId: string | null
  /** The 303 the editor has selected. */
  bassId: string
}

export type MidiVoiceAction =
  | { kind: 'none' }
  | { kind: 'bass-off'; voiceId: string }
  | {
      kind: 'bass-on'
      voiceId: string
      semitone: number
      accent: boolean
      legato: boolean
      /** Whether this note is also written into the pattern. A glide within a passage is not. */
      write: boolean
    }
  | { kind: 'drum'; voiceId: string; semitone: number; accent: boolean }

export interface MidiVoiceStep {
  action: MidiVoiceAction
  /** What the channel is committed to after this event. Null releases it. */
  capture: ChannelVoice | null
}

/** One event from the allocator, in the shape the MIDI handle reports it. */
export interface MidiVoiceEvent {
  note: number
  velocity: number
  gate: number
}

/**
 * Resolve one allocator event against what its channel is already playing.
 *
 * The four branches, in the order they have to be asked:
 *
 *  1. gate closed — release the channel, and silence a 303 only if this channel is what started it.
 *  2. captured 303 — glide, always. Once a legato passage starts it stays on that voice.
 *  3. captured drum — strike, unless this is the allocator falling back to an older held note. A tom is
 *     a hit; re-striking one the finger never re-pressed is an audible extra hit, not a sustain.
 *  4. free — capture whatever the panel is pointed at now, and only here is a note written down.
 */
export function midiVoiceStep(
  event: MidiVoiceEvent,
  captured: ChannelVoice,
  selection: KeysSelection,
): MidiVoiceStep {
  const semitone = event.note - MIDI_ROOT
  const accent = event.velocity >= ACCENT_VELOCITY

  if (event.gate === 0) {
    return {
      action:
        captured?.kind === 'bass'
          ? { kind: 'bass-off', voiceId: captured.voiceId }
          : { kind: 'none' },
      capture: null,
    }
  }

  if (captured?.kind === 'bass') {
    return {
      action: {
        kind: 'bass-on',
        voiceId: captured.voiceId,
        semitone,
        accent,
        legato: true,
        write: false,
      },
      capture: captured,
    }
  }

  if (captured?.kind === 'drum') {
    const { passage } = captured
    // A repeated note-on retriggers; a fallback to an older held note does not. The allocator reports
    // both as gate-on, so the passage's own history is the only thing that can tell them apart.
    const strike = !passage.played.includes(event.note) || passage.current === event.note
    return {
      action: strike
        ? { kind: 'drum', voiceId: passage.id, semitone, accent }
        : { kind: 'none' },
      capture: {
        kind: 'drum',
        passage: {
          id: passage.id,
          played: passage.played.includes(event.note)
            ? passage.played
            : [...passage.played, event.note],
          current: event.note,
        },
      },
    }
  }

  if (selection.drumId) {
    return {
      action: { kind: 'drum', voiceId: selection.drumId, semitone, accent },
      capture: {
        kind: 'drum',
        passage: { id: selection.drumId, played: [event.note], current: event.note },
      },
    }
  }

  return {
    action: {
      kind: 'bass-on',
      voiceId: selection.bassId,
      semitone,
      accent,
      legato: false,
      write: true,
    },
    capture: { kind: 'bass', voiceId: selection.bassId },
  }
}

/** The sounding notes, as the key grid wants them: semitones above the root rather than MIDI notes. */
export const soundingSemitones = (notes: readonly number[]): number[] =>
  notes.map((note) => note - MIDI_ROOT)
