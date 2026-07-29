import { BASS_VOICES, DEFAULT_BASS_PARAMS, REST, type BassParams, type BassStep } from './bass'
import { DEFAULT_FX, type FxParams, type SendLevels } from './effects'
import { DEFAULT_PARAMS, type VoiceParams } from './types'

// Patterns as plain data — no classes, no methods, nothing that cannot survive
// JSON.stringify. The game needs to ship a soundtrack as an asset, the sequencer needs
// undo and pattern copy, and both of those are free if a pattern is just a value.

/** Off, on, or accented. The machines only ever had these three, and resisting the
 *  urge to add continuous velocity is most of why patterns programmed on them swing
 *  the way they do — you commit to an accent or you do not. */
export type StepValue = 0 | 1 | 2

export interface Pattern {
  id: string
  name: string
  /** Steps per bar. 16 is the machine default; other lengths give polymetric loops,
   *  which is a cheap source of patterns that never quite repeat. */
  length: number
  /** Voice id to its steps. A voice with no entry simply never fires. */
  tracks: Record<string, StepValue[]>
  /**
   * Bass voice id to its line. Optional, so a pattern written before the 303s existed
   * still loads — which matters now that patterns are saved and shared.
   *
   * Basslines live on the pattern rather than in a sequence of their own, so one entry
   * in the chain is one bar of the whole arrangement. It means a bassline cannot run at
   * a different length from the drums under it, which rules out one trick and buys back
   * the chain, the pattern buttons and the copy/clear behaviour working on everything
   * at once instead of on drums only.
   */
  bass?: Record<string, BassStep[]>
}

export interface Kit {
  /** Voice id to knob positions. */
  params: Record<string, VoiceParams>
  /** Bass voice id to knob positions. Optional for the same reason as `Pattern.bass`. */
  bass?: Record<string, BassParams>
  /**
   * How much of each voice goes to the delay and the reverb. Keyed by voice id, so the
   * same map covers both drum machines and the 303s.
   *
   * Deliberately NOT part of `VoiceParams`. A voice is a pure function from its knobs to
   * a spec, and where its output is routed afterwards is not something the synthesis
   * knows or should be able to reach. Putting a send level in with the tune and the
   * decay would be the first crack in that.
   */
  sends?: Record<string, SendLevels>
}

export interface Song {
  bpm: number
  swing: number
  patterns: Pattern[]
  /** Pattern ids in play order. A pattern may appear more than once. */
  chain: string[]
  kit: Kit
  /** Settings for the two send effects. Shared by everything, because the point of a
   *  send is that every voice lands in the same room. */
  fx?: FxParams
}

export function emptyPattern(id: string, name: string, length = 16): Pattern {
  return { id, name, length, tracks: {} }
}

export function stepAt(pattern: Pattern, voiceId: string, step: number): StepValue {
  const track = pattern.tracks[voiceId]
  if (!track) return 0
  return track[step % pattern.length] ?? 0
}

/** Immutable step edit — cycles off → on → accent → off, which is how the hardware's
 *  step buttons behave and means one control does all three. */
export function cycleStep(pattern: Pattern, voiceId: string, step: number): Pattern {
  const track = pattern.tracks[voiceId] ?? new Array<StepValue>(pattern.length).fill(0)
  const next = [...track]
  next[step] = (((track[step] ?? 0) + 1) % 3) as StepValue
  return { ...pattern, tracks: { ...pattern.tracks, [voiceId]: next } }
}

export function setStep(
  pattern: Pattern,
  voiceId: string,
  step: number,
  value: StepValue,
): Pattern {
  const track = pattern.tracks[voiceId] ?? new Array<StepValue>(pattern.length).fill(0)
  const next = [...track]
  next[step] = value
  return { ...pattern, tracks: { ...pattern.tracks, [voiceId]: next } }
}

export function clearTrack(pattern: Pattern, voiceId: string): Pattern {
  const tracks = { ...pattern.tracks }
  delete tracks[voiceId]
  return { ...pattern, tracks }
}

export function defaultKit(voiceIds: string[]): Kit {
  const params: Record<string, VoiceParams> = {}
  for (const id of voiceIds) params[id] = { ...DEFAULT_PARAMS }
  const bass: Record<string, BassParams> = {}
  for (const voice of BASS_VOICES) bass[voice.id] = { ...DEFAULT_BASS_PARAMS }
  return { params, bass, sends: {} }
}

export const defaultFx = (): FxParams => ({ ...DEFAULT_FX })

// ---- basslines ----------------------------------------------------------------
//
// The same immutable-edit shape as the drum tracks above. A bass step carries three
// things rather than one, so instead of a single cycling control there is a setter per
// property and the UI decides which gesture drives which.

export function bassLine(pattern: Pattern, voiceId: string): BassStep[] {
  return pattern.bass?.[voiceId] ?? []
}

export function bassStepAt(pattern: Pattern, voiceId: string, step: number): BassStep {
  const line = pattern.bass?.[voiceId]
  if (!line || pattern.length <= 0) return REST
  return line[step % pattern.length] ?? REST
}

/** Replace one step of a bassline, filling in rests if the line does not exist yet. */
export function setBassStep(
  pattern: Pattern,
  voiceId: string,
  step: number,
  value: BassStep,
): Pattern {
  const line = pattern.bass?.[voiceId] ?? []
  const next = Array.from({ length: pattern.length }, (_, i) => line[i] ?? { ...REST })
  next[step] = value
  return { ...pattern, bass: { ...pattern.bass, [voiceId]: next } }
}

export function clearBassLine(pattern: Pattern, voiceId: string): Pattern {
  const bass = { ...pattern.bass }
  delete bass[voiceId]
  return { ...pattern, bass }
}

/** Which pattern is playing on a given bar of the chain, and how far through the song
 *  we are. An empty chain falls back to the first pattern, so a song is never silent
 *  just because nobody built a chain. */
export function patternForBar(song: Song, bar: number): Pattern | undefined {
  if (song.patterns.length === 0) return undefined
  if (song.chain.length === 0) return song.patterns[0]
  const id = song.chain[((bar % song.chain.length) + song.chain.length) % song.chain.length]
  return song.patterns.find((p) => p.id === id) ?? song.patterns[0]
}
