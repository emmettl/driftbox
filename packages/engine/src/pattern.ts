import { BASS_VOICES, DEFAULT_BASS_PARAMS, REST, type BassParams, type BassStep } from './bass.js'
import { DEFAULT_FX, type FxParams, type SendLevels } from './effects.js'
import { DEFAULT_PARAMS, type VoiceParams } from './types.js'

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
  /** Optional flam marks, parallel to drum tracks. Only 909 voices render them today. */
  flams?: Record<string, boolean[]>
  /**
   * Bass voice id to its line. Optional, so a pattern written before the 303s existed
   * still loads — which matters now that patterns are saved and shared.
   *
   * A pattern is still a convenient whole-groove snapshot. Chain clips may independently
   * choose the 808, 909 and each 303 line from different snapshots, so the same pool works
   * both as the original Driftbox pattern bank and as ReBirth-style machine sequences.
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
  /**
   * Per-voice swing, as an offset from the song's own. 0.5 is no offset — the voice
   * follows `Song.swing` — and the ends of the knob are enough to reach dead straight
   * or fully shuffled whatever the song is set to.
   *
   * An offset rather than an absolute value, so that moving the song's swing moves
   * everything with it and the per-voice knobs keep meaning what they meant. Absolute
   * values would silently freeze every voice you had ever touched.
   */
  swing?: Record<string, number>
  /** Global TR-909 flam spacing, 0..1. Optional for pre-flam songs. */
  flam?: number
}

/** How much a voice actually swings: the song's swing, shifted by that voice's offset.
 *  A voice with no entry simply swings with the song. */
export function swingFor(song: Song, voiceId: string): number {
  const offset = song.kit.swing?.[voiceId]
  if (offset === undefined) return song.swing
  return Math.max(0, Math.min(1, song.swing + (offset - 0.5) * 2))
}

/**
 * One entry in the arrangement: a pattern, and how many bars it holds for.
 *
 * The repeat count is what makes this a song rather than a loop. An arrangement is
 * mostly "this one for eight bars, then that one for four", and writing that as a flat
 * list of pattern ids means sixteen identical entries to scroll past and re-edit every
 * time you change your mind about the length.
 */
export const CLIP_SLOTS = ['tr808', 'tr909', '303.a', '303.b'] as const
export type ClipSlot = (typeof CLIP_SLOTS)[number]

export interface ChainStep {
  /**
   * The whole-groove fallback. Old songs only have this field and therefore sound
   * byte-for-byte as before. A clip override replaces just one machine's material.
   */
  pattern: string
  clips?: Partial<Record<ClipSlot, string>>
  /** Bars. At least 1. */
  repeat: number
}

export type AutomationInterpolation = 'hold' | 'linear'

export interface AutomationPoint {
  /** Absolute arrangement bar, zero based. */
  bar: number
  /** Step within that bar, zero based. */
  index: number
  value: number
}

/**
 * One recordable parameter over the song timeline.
 *
 * Targets are stable strings rather than object paths. Hosts may persist lanes they do
 * not understand yet, while the helpers in `automation.ts` construct the targets this
 * engine can currently play.
 */
export interface AutomationLane {
  target: string
  interpolation: AutomationInterpolation
  points: AutomationPoint[]
}

export interface Song {
  bpm: number
  swing: number
  patterns: Pattern[]
  /** The arrangement, in play order, looping at the end. A pattern may appear as often
   *  as it likes. An empty chain plays the first pattern forever. */
  chain: ChainStep[]
  kit: Kit
  /** Settings for the two send effects. Shared by everything, because the point of a
   *  send is that every voice lands in the same room. */
  fx?: FxParams
  /** Optional so every song written before automation remains a valid Song. */
  automation?: AutomationLane[]
}

export function emptyPattern(id: string, name: string, length = 16): Pattern {
  return { id, name, length, tracks: {}, bass: {} }
}

// ---- the pattern list ----------------------------------------------------------
//
// Adding, copying and removing whole patterns. Pure Song transforms, so they live here
// rather than in the app's store: a host driving the engine has as much reason to build
// a pattern list as a sequencer UI does.

/** An id nothing else is using, derived from `base`. Ids are stable keys — the chain
 *  refers to them — so they are generated once and never renamed afterwards. */
export function uniquePatternId(song: Song, base = 'pattern'): string {
  const taken = new Set(song.patterns.map((p) => p.id))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`
    if (!taken.has(id)) return id
  }
}

/** A name nothing else is using. Unlike ids, names are for humans and can repeat — but
 *  defaulting to a duplicate makes the pattern buttons unreadable. */
function uniquePatternName(song: Song, base: string): string {
  const taken = new Set(song.patterns.map((p) => p.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`
    if (!taken.has(name)) return name
  }
}

export function addPattern(song: Song, length = 16): { song: Song; id: string } {
  const id = uniquePatternId(song, `pattern-${song.patterns.length + 1}`)
  const name = uniquePatternName(song, `Pattern ${song.patterns.length + 1}`)
  return {
    song: { ...song, patterns: [...song.patterns, emptyPattern(id, name, length)] },
    id,
  }
}

/**
 * Copy a pattern, everything in it, and put the copy after the original.
 *
 * The usual way anybody writes a second pattern: take the one that works and change two
 * things. Starting from empty every time is why people end up with one pattern.
 */
export function duplicatePattern(song: Song, id: string): { song: Song; id: string } {
  const index = song.patterns.findIndex((p) => p.id === id)
  if (index === -1) return { song, id }

  const source = song.patterns[index]
  const copyId = uniquePatternId(song, `${source.id}-copy`)
  const copy: Pattern = {
    ...source,
    id: copyId,
    name: uniquePatternName(song, `${source.name} copy`),
    // Deep enough to be independent. A shallow copy would share the step arrays, so
    // editing the copy would silently edit the original — the worst kind of bug,
    // because it looks like it worked until you play the other one.
    tracks: Object.fromEntries(Object.entries(source.tracks).map(([v, t]) => [v, [...t]])),
    ...(source.flams
      ? {
          flams: Object.fromEntries(
            Object.entries(source.flams).map(([voiceId, marks]) => [voiceId, [...marks]]),
          ),
        }
      : {}),
    bass: Object.fromEntries(
      Object.entries(source.bass ?? {}).map(([v, line]) => [v, line.map((s) => ({ ...s }))]),
    ),
  }

  const patterns = [...song.patterns]
  patterns.splice(index + 1, 0, copy)
  return { song: { ...song, patterns }, id: copyId }
}

export function renamePattern(song: Song, id: string, name: string): Song {
  const trimmed = name.trim()
  if (trimmed === '') return song
  return {
    ...song,
    patterns: song.patterns.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  }
}

/**
 * Remove a pattern, and every reference to it in the arrangement.
 *
 * Leaving the chain entries behind would not error — `patternForBar` falls back to the
 * first pattern for an unknown id — it would just quietly play the wrong bar, which is
 * worse than an obvious failure.
 *
 * Refuses to remove the last one: a song with no patterns has nothing to show in the
 * grid and no sensible state for the editor to be in.
 */
export function removePattern(song: Song, id: string): Song {
  if (song.patterns.length <= 1) return song
  if (!song.patterns.some((p) => p.id === id)) return song
  return {
    ...song,
    patterns: song.patterns.filter((p) => p.id !== id),
    chain: song.chain
      .filter((step) => step.pattern !== id)
      .map((step) => {
        if (!step.clips || !Object.values(step.clips).includes(id)) return step
        const clips = Object.fromEntries(
          Object.entries(step.clips).filter(([, patternId]) => patternId !== id),
        ) as Partial<Record<ClipSlot, string>>
        return Object.keys(clips).length > 0
          ? { ...step, clips }
          : { pattern: step.pattern, repeat: step.repeat }
      }),
  }
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
  if (next[step] === 0 && pattern.flams?.[voiceId]) {
    const flams = {
      ...pattern.flams,
      [voiceId]: pattern.flams[voiceId].map((mark, index) =>
        index === step ? false : mark,
      ),
    }
    return { ...pattern, tracks: { ...pattern.tracks, [voiceId]: next }, flams }
  }
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
  if (value === 0 && pattern.flams?.[voiceId]) {
    const flams = {
      ...pattern.flams,
      [voiceId]: pattern.flams[voiceId].map((mark, index) =>
        index === step ? false : mark,
      ),
    }
    return { ...pattern, tracks: { ...pattern.tracks, [voiceId]: next }, flams }
  }
  return { ...pattern, tracks: { ...pattern.tracks, [voiceId]: next } }
}

export function clearTrack(pattern: Pattern, voiceId: string): Pattern {
  const tracks = { ...pattern.tracks }
  delete tracks[voiceId]
  if (!pattern.flams?.[voiceId]) return { ...pattern, tracks }
  const flams = { ...pattern.flams }
  delete flams[voiceId]
  return { ...pattern, tracks, flams }
}

export function flamAt(pattern: Pattern, voiceId: string, step: number): boolean {
  return pattern.flams?.[voiceId]?.[step % pattern.length] === true
}

/** Toggle a 909 flam. Enabling one on a rest also creates the hit it articulates. */
export function toggleFlam(pattern: Pattern, voiceId: string, step: number): Pattern {
  const marks = Array.from(
    { length: pattern.length },
    (_, index) => pattern.flams?.[voiceId]?.[index] === true,
  )
  marks[step] = !marks[step]
  const track = Array.from(
    { length: pattern.length },
    (_, index) => pattern.tracks[voiceId]?.[index] ?? 0,
  )
  if (marks[step] && track[step] === 0) track[step] = 1
  return {
    ...pattern,
    tracks: { ...pattern.tracks, [voiceId]: track },
    flams: { ...pattern.flams, [voiceId]: marks },
  }
}

// ---- pattern transforms -------------------------------------------------------
//
// ReBirth put these on a menu. They live beside the pattern data here instead of in the
// app so a rack clip editor, a game or a script gets exactly the same operation. Every
// transform is immutable and bounded by `pattern.length`; hidden array tails must never
// reappear after a rotate.

export type RandomSource = () => number

function rotate<T>(values: readonly T[], length: number, delta: number, fallback: () => T): T[] {
  if (length <= 0) return []
  const source = Array.from({ length }, (_, index) => values[index] ?? fallback())
  const offset = ((Math.round(delta) % length) + length) % length
  return Array.from({ length }, (_, index) => source[(index - offset + length) % length])
}

/** Move one drum lane around the loop. Positive is right/later, negative left/earlier. */
export function rotateTrack(pattern: Pattern, voiceId: string, delta: number): Pattern {
  const track = pattern.tracks[voiceId]
  if (!track) return pattern
  const marks = pattern.flams?.[voiceId]
  return {
    ...pattern,
    tracks: { ...pattern.tracks, [voiceId]: rotate(track, pattern.length, delta, () => 0) },
    flams: marks
      ? { ...pattern.flams, [voiceId]: rotate(marks, pattern.length, delta, () => false) }
      : pattern.flams,
  }
}

/** Move one 303 line around the loop, preserving every note's articulation flags. */
export function rotateBassLine(pattern: Pattern, voiceId: string, delta: number): Pattern {
  const line = pattern.bass?.[voiceId]
  if (!line) return pattern
  return {
    ...pattern,
    bass: {
      ...pattern.bass,
      [voiceId]: rotate(line, pattern.length, delta, () => ({ ...REST })),
    },
  }
}

/** Transpose the sounding notes in one 303 line; rests and articulation stay untouched. */
export function transposeBassLine(
  pattern: Pattern,
  voiceId: string,
  semitones: number,
): Pattern {
  const line = pattern.bass?.[voiceId]
  if (!line) return pattern
  const by = Math.round(semitones)
  return {
    ...pattern,
    bass: {
      ...pattern.bass,
      [voiceId]: Array.from({ length: pattern.length }, (_, index) => {
        const step = line[index] ?? REST
        return step.note === null
          ? { ...step }
          : { ...step, note: Math.max(0, Math.min(24, step.note + by)) }
      }),
    },
  }
}

/** Create a fresh drum lane. The bias towards rests keeps the result a rhythm, not noise. */
export function randomizeTrack(
  pattern: Pattern,
  voiceId: string,
  random: RandomSource = Math.random,
): Pattern {
  const track = Array.from({ length: pattern.length }, (): StepValue => {
    const value = random()
    return value < 0.58 ? 0 : value < 0.88 ? 1 : 2
  })
  if (!pattern.flams?.[voiceId]) {
    return { ...pattern, tracks: { ...pattern.tracks, [voiceId]: track } }
  }
  const flams = { ...pattern.flams }
  delete flams[voiceId]
  return { ...pattern, tracks: { ...pattern.tracks, [voiceId]: track }, flams }
}

/** Create pitches and articulation for one 303 while leaving the other machines alone. */
export function randomizeBassLine(
  pattern: Pattern,
  voiceId: string,
  random: RandomSource = Math.random,
): Pattern {
  const line = Array.from({ length: pattern.length }, (): BassStep => {
    if (random() < 0.46) return { ...REST }
    const note = Math.min(24, Math.floor(random() * 25))
    return { note, accent: random() < 0.24, slide: random() < 0.18 }
  })
  return { ...pattern, bass: { ...pattern.bass, [voiceId]: line } }
}

function shuffled<T>(values: readonly T[], random: RandomSource): T[] {
  const next = [...values]
  for (let index = next.length - 1; index > 0; index--) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)))
    ;[next[index], next[swap]] = [next[swap], next[index]]
  }
  return next
}

/**
 * Reorder the material already in a drum lane. Unlike randomise, the number of normal
 * hits, accents and rests is exactly preserved.
 */
export function alterTrack(
  pattern: Pattern,
  voiceId: string,
  random: RandomSource = Math.random,
): Pattern {
  const track = pattern.tracks[voiceId]
  if (!track) return pattern
  const source = Array.from({ length: pattern.length }, (_, index) => ({
    value: track[index] ?? 0,
    flam: pattern.flams?.[voiceId]?.[index] === true,
  }))
  const altered = shuffled(source, random)
  const next: Pattern = {
    ...pattern,
    tracks: {
      ...pattern.tracks,
      [voiceId]: altered.map((step) => step.value),
    },
  }
  if (pattern.flams?.[voiceId]) {
    next.flams = {
      ...pattern.flams,
      [voiceId]: altered.map((step) => step.flam),
    }
  }
  return next
}

/** Reorder existing 303 steps without inventing or discarding notes or articulation. */
export function alterBassLine(
  pattern: Pattern,
  voiceId: string,
  random: RandomSource = Math.random,
): Pattern {
  const line = pattern.bass?.[voiceId]
  if (!line) return pattern
  const source = Array.from({ length: pattern.length }, (_, index) => ({
    ...(line[index] ?? REST),
  }))
  return {
    ...pattern,
    bass: { ...pattern.bass, [voiceId]: shuffled(source, random) },
  }
}

export function defaultKit(voiceIds: string[]): Kit {
  const params: Record<string, VoiceParams> = {}
  for (const id of voiceIds) params[id] = { ...DEFAULT_PARAMS }
  const bass: Record<string, BassParams> = {}
  for (const voice of BASS_VOICES) bass[voice.id] = { ...DEFAULT_BASS_PARAMS }
  // Every collection field, so a fresh kit and a decoded one are the same shape. Optional
  // scalar articulation settings such as flam width stay absent until somebody uses them.
  return { params, bass, sends: {}, swing: {} }
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

// ---- the arrangement ----------------------------------------------------------

/** How long the whole song is, in bars, before it loops. */
export function songBars(song: Song): number {
  let total = 0
  for (const step of song.chain) total += Math.max(1, Math.floor(step.repeat))
  return total
}

/** Absolute bar where a chain entry begins. Clamped so callers can safely ask for the
 * add button just past the end and receive the total song length. */
export function chainBarAt(song: Song, index: number): number {
  const end = Math.max(0, Math.min(song.chain.length, Math.floor(index)))
  let bar = 0
  for (let position = 0; position < end; position++) {
    bar += Math.max(1, Math.floor(song.chain[position].repeat))
  }
  return bar
}

/**
 * Which entry of the chain a given bar falls in, and how far into its repeat.
 *
 * Walked rather than expanded into a flat array of bars. An arrangement with a
 * hundred-bar section is a perfectly reasonable thing to write, and this is called on
 * every bar boundary from the scheduler — allocating that array each time would be a
 * garbage-collection pause landing exactly on the downbeat.
 */
export function chainPositionAt(
  song: Song,
  bar: number,
): { index: number; step: ChainStep; barWithin: number } | undefined {
  const total = songBars(song)
  if (total <= 0) return undefined

  let remaining = ((bar % total) + total) % total
  for (let index = 0; index < song.chain.length; index++) {
    const step = song.chain[index]
    const repeat = Math.max(1, Math.floor(step.repeat))
    if (remaining < repeat) return { index, step, barWithin: remaining }
    remaining -= repeat
  }
  return undefined
}

/** Which pattern is playing on a given bar of the chain. An empty chain falls back to
 *  the first pattern, so a song is never silent just because nobody built one. */
export function patternForBar(song: Song, bar: number): Pattern | undefined {
  if (song.patterns.length === 0) return undefined
  if (song.chain.length === 0) return song.patterns[0]
  const position = chainPositionAt(song, bar)
  if (!position) return song.patterns[0]
  return song.patterns.find((p) => p.id === position.step.pattern) ?? song.patterns[0]
}

/** The sequencer lane a voice belongs to. Unknown future voices use the whole-pattern
 * fallback, so an older engine never silently steals them into the wrong machine. */
export function clipSlotForVoice(voiceId: string): ClipSlot | undefined {
  if (voiceId === '303.a' || voiceId === '303.b') return voiceId
  if (voiceId.startsWith('808.')) return 'tr808'
  if (voiceId.startsWith('909.')) return 'tr909'
  return undefined
}

/** Resolve one machine's clip for a bar, falling back to the section's whole pattern. */
export function patternForClip(song: Song, bar: number, slot: ClipSlot): Pattern | undefined {
  const fallback = patternForBar(song, bar)
  if (!fallback || song.chain.length === 0) return fallback
  const patternId = chainPositionAt(song, bar)?.step.clips?.[slot]
  return patternId ? song.patterns.find((pattern) => pattern.id === patternId) ?? fallback : fallback
}

/** Resolve the pattern that supplies one voice on a bar. */
export function patternForVoice(song: Song, bar: number, voiceId: string): Pattern | undefined {
  const slot = clipSlotForVoice(voiceId)
  return slot ? patternForClip(song, bar, slot) : patternForBar(song, bar)
}

/**
 * A section lasts as long as its longest selected clip. Shorter clips wrap at their own
 * length in `planStep`, so an 8-step 909 can loop twice under a 16-step 303.
 */
export function barLengthForBar(song: Song, bar: number): number {
  const fallback = patternForBar(song, bar)
  if (!fallback) return 16
  if (song.chain.length === 0) return fallback.length
  return Math.max(fallback.length, ...CLIP_SLOTS.map((slot) => patternForClip(song, bar, slot)?.length ?? 0))
}

// ---- editing the arrangement ----

export function chainAppend(song: Song, patternId: string): ChainStep[] {
  return [...song.chain, { pattern: patternId, repeat: 1 }]
}

export function chainRemove(song: Song, index: number): ChainStep[] {
  return song.chain.filter((_, i) => i !== index)
}

export function chainSetRepeat(song: Song, index: number, repeat: number): ChainStep[] {
  const clamped = Math.max(1, Math.min(64, Math.round(repeat)))
  return song.chain.map((step, i) => (i === index ? { ...step, repeat: clamped } : step))
}

export function chainSetPattern(song: Song, index: number, patternId: string): ChainStep[] {
  return song.chain.map((step, i) => (i === index ? { ...step, pattern: patternId } : step))
}

/** Override one machine in a section. Choosing the fallback again removes the override,
 * keeping old-style sections compact and exactly backward-compatible. */
export function chainSetClip(
  song: Song,
  index: number,
  slot: ClipSlot,
  patternId: string,
): ChainStep[] {
  return song.chain.map((step, i) => {
    if (i !== index) return step
    const clips = { ...step.clips }
    if (patternId === step.pattern) delete clips[slot]
    else clips[slot] = patternId
    if (Object.keys(clips).length === 0) {
      const next = { ...step }
      delete next.clips
      return next
    }
    return { ...step, clips }
  })
}

/** Move an entry by `delta` places, clamped. Reordering a song is mostly nudging one
 *  section earlier or later, which is one gesture rather than a drag-and-drop library. */
export function chainMove(song: Song, index: number, delta: number): ChainStep[] {
  const to = index + delta
  if (index < 0 || index >= song.chain.length || to < 0 || to >= song.chain.length) {
    return song.chain
  }
  const next = [...song.chain]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved)
  return next
}
