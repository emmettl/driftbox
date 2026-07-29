import { TR808_VOICES } from './voices/tr808.js'
import { TR909_VOICES } from './voices/tr909.js'
import type { Voice, VoiceParams, VoiceSpec } from './types.js'

// The voice registry, and the one function that turns a voice into a spec.
//
// Its own module rather than part of `index.ts` because the stem renderer needs both, and
// `index.ts` imports the stem renderer. A cycle between them works in this build and is
// exactly the kind of thing that stops working inside somebody else's bundler — which for
// a published package is a bug report rather than a build error.

export const ALL_VOICES: Voice[] = [...TR909_VOICES, ...TR808_VOICES]

const VOICE_BY_ID = new Map(ALL_VOICES.map((v) => [v.id, v]))

export function voiceById(id: string): Voice | undefined {
  return VOICE_BY_ID.get(id)
}

/**
 * Build a voice's spec with its output normalisation applied.
 *
 * Everything that turns a voice into sound goes through here — the sequencer, the
 * audition button, the offline renderer behind the waveform display, the stem export. If
 * the trim were applied at any one of those instead, the drawn waveform and the audible
 * hit would be different sizes, and the panel would quietly stop telling the truth.
 */
export function buildVoice(voice: Voice, params: VoiceParams, accent: number): VoiceSpec {
  const spec = voice.build(params, accent)
  if (voice.trim === undefined) return spec
  return { ...spec, trim: voice.trim }
}
