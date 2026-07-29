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
}

export interface Kit {
  /** Voice id to knob positions. */
  params: Record<string, VoiceParams>
}

export interface Song {
  bpm: number
  swing: number
  patterns: Pattern[]
  /** Pattern ids in play order. A pattern may appear more than once. */
  chain: string[]
  kit: Kit
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
  return { params }
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
