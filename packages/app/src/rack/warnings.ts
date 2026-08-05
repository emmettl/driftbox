import type { AudioInputState } from './audio-input.js'

// Everything the rack says when something is not quite right, as data.
//
// Split out of `RackApp` because the wording *is* the behaviour. Each of these sentences exists because
// somebody was confused by silence: a suspended context that looks like a dead patch, four voices that are
// four times louder rather than a chord, a link that quietly does not carry the sample somebody loaded. A
// component cannot make the claim "that link warns about the file it cannot carry" — a function returning
// a list can, and does, in `warnings.test.ts`.
//
// Order is part of it. These render as one stack under the header, and the stack is read from the top: the
// thing that just happened (a refused microphone, a suspended context) has to come before the standing
// facts about the patch.

/** One line in the warning stack. `id` is the React key and the name the tests use. */
export interface RackWarning {
  id:
    | 'unshareable-samples'
    | 'audio-suspended'
    | 'audio-input-error'
    | 'audio-input-monitoring'
    | 'voices-without-midi'
    | 'placeholder-modules'
  text: string
}

/** Everything a warning can be a function of. Deliberately plain: no store, no refs, no DOM. */
export interface RackWarningState {
  /** Whether audio has ever been started. Nothing about a context is worth saying before that. */
  started: boolean
  playing: boolean
  audioState: AudioContextState | 'none'
  /** Whether the patch asks for a live input at all; without one, an input error is stale. */
  hasAudioInput: boolean
  audioInputState: AudioInputState
  audioInputError: string | null
  voices: number
  hasMidi: boolean
  /** Modules this build does not have, kept in the patch and silent. */
  placeholders: number
  /** Whether a share link has been made this session. The sample warning is about that link. */
  shared: boolean
  /** Samples that came from somebody's own file rather than a shipped break. */
  loadedFiles: readonly string[]
}

export function rackWarnings(state: RackWarningState): RackWarning[] {
  const warnings: RackWarning[] = []

  // `docs/DNB.md` asked for this in as many words: a patch using a loaded sample cannot travel in a URL
  // and should say so plainly rather than silently sharing a broken link. The shipped breaks are fine —
  // they are named, not carried, and the other end renders its own.
  if (state.shared && state.loadedFiles.length > 0) {
    warnings.push({
      id: 'unshareable-samples',
      text:
        state.loadedFiles.length === 1
          ? `That link does not carry “${state.loadedFiles[0]}” — whoever opens it gets the patch with an empty sampler.`
          : `That link does not carry ${state.loadedFiles.length} loaded samples — whoever opens it gets the patch with empty samplers.`,
    })
  }

  // A browser suspends a context on its own — a background tab, an interruption on iOS — and then the
  // transport is running as far as this app is concerned while nothing is coming out.
  if (state.started && state.playing && state.audioState === 'suspended') {
    warnings.push({
      id: 'audio-suspended',
      text: 'The browser has suspended audio — press Play again, or click anywhere on the page.',
    })
  }

  // In the warning stack rather than the header. An error is a sentence of arbitrary length, and a
  // sentence in a toolbar pushes every control after it onto another line — which is how somebody finds
  // out their microphone was refused: the buttons move.
  if (state.hasAudioInput && state.audioInputError) {
    warnings.push({ id: 'audio-input-error', text: state.audioInputError })
  }

  if (state.audioInputState === 'on') {
    warnings.push({
      id: 'audio-input-monitoring',
      text: 'Live input is monitoring through the rack. Use headphones or an audio interface to avoid speaker feedback.',
    })
  }

  if (state.voices > 1 && !state.hasMidi) {
    warnings.push({
      id: 'voices-without-midi',
      text: `${state.voices} voices, and no MIDI module to play different notes on them — so every voice plays the same note and the output is ${state.voices}× louder. That is the summing being correct rather than a bug; add a MIDI module to hear it as a chord.`,
    })
  }

  if (state.placeholders > 0) {
    warnings.push({
      id: 'placeholder-modules',
      text:
        state.placeholders === 1
          ? '1 module in this patch is not in this build. It is kept and will be saved, but it makes no sound.'
          : `${state.placeholders} modules in this patch are not in this build. They are kept and will be saved, but they make no sound.`,
    })
  }

  return warnings
}
