import { DEFAULT_BASS_PARAMS, type BassParams, type BassStep } from './bass'
import { DEFAULT_FX, DEFAULT_SENDS, type SendLevels } from './effects'
import type { Kit, Pattern, Song, StepValue } from './pattern'
import { DEFAULT_PARAMS, type VoiceParams } from './types'

// Turning a Song into text and back.
//
// The writing half is nearly nothing — a Song is already plain JSON, which was the
// point of building it that way. The reading half is where the work is, and it is worth
// being clear about why it is this careful: **a song arrives from outside the program**.
// From localStorage written by an older build, from a file somebody edited by hand, or
// from a URL somebody else sent them. None of that is trustworthy, and the failure mode
// for trusting it is not a subtle bug — it is the app white-screening on load with the
// user's work apparently gone, and no obvious way back.
//
// So `decodeSong` never throws on a value it can repair. It clamps numbers into range,
// fills in anything missing from the defaults, drops what it cannot understand, and only
// gives up if what it was handed is not a song at all. A pattern with a corrupt step
// should cost you that step, not the session.
//
// This lives in the engine because the engine owns the Song schema. Nothing here touches
// storage, the DOM or the network — see `src/persistence.ts` for that.

/** Bumped when the shape changes in a way `decodeSong` cannot infer. It has not yet. */
export const SONG_FORMAT = 1

interface Envelope {
  v: number
  song: unknown
}

export function encodeSong(song: Song): string {
  return JSON.stringify({ v: SONG_FORMAT, song } satisfies Envelope)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Anything that is not an actual finite number falls back rather than being coerced.
 *  `Number(null)` is 0, which would quietly turn a missing tempo into the slowest one
 *  the app allows instead of the sensible default. */
function clamp(value: unknown, low: number, high: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(low, Math.min(high, value))
}

/** Knob positions are all 0..1, so one function does every voice and every synth. */
function knobs<T extends object>(value: unknown, defaults: T): T {
  const source = isRecord(value) ? value : {}
  const out = { ...defaults } as Record<string, number>
  for (const [key, fallback] of Object.entries(defaults) as [string, number][]) {
    out[key] = clamp(source[key], 0, 1, fallback)
  }
  return out as T
}

function steps(value: unknown, length: number): StepValue[] | null {
  if (!Array.isArray(value)) return null
  return Array.from({ length }, (_, i) => {
    const step = value[i]
    return step === 1 || step === 2 ? step : 0
  })
}

function bassLine(value: unknown, length: number): BassStep[] | null {
  if (!Array.isArray(value)) return null
  return Array.from({ length }, (_, i) => {
    const step: unknown = value[i]
    if (!isRecord(step)) return { note: null, accent: false, slide: false }
    const note = step.note
    return {
      // Notes are clamped to the two octaves the grid can show. A note outside that
      // would be unreachable and un-editable, which is worse than a wrong pitch.
      note: typeof note === 'number' && Number.isFinite(note) ? clamp(note, 0, 24, 0) : null,
      accent: step.accent === true,
      slide: step.slide === true,
    }
  })
}

function pattern(value: unknown, index: number): Pattern | null {
  if (!isRecord(value)) return null

  const id = typeof value.id === 'string' && value.id !== '' ? value.id : `pattern-${index}`
  const length = Math.round(clamp(value.length, 1, 64, 16))

  const tracks: Record<string, StepValue[]> = {}
  if (isRecord(value.tracks)) {
    for (const [voiceId, track] of Object.entries(value.tracks)) {
      const parsed = steps(track, length)
      if (parsed) tracks[voiceId] = parsed
    }
  }

  const bass: Record<string, BassStep[]> = {}
  if (isRecord(value.bass)) {
    for (const [voiceId, line] of Object.entries(value.bass)) {
      const parsed = bassLine(line, length)
      if (parsed) bass[voiceId] = parsed
    }
  }

  return {
    id,
    name: typeof value.name === 'string' && value.name !== '' ? value.name : id,
    length,
    tracks,
    bass,
  }
}

function kit(value: unknown): Kit {
  const source = isRecord(value) ? value : {}

  // Voice ids are NOT checked against the kit registry. An id this build does not know
  // is kept as it is: it may belong to a machine added later, and silently deleting
  // somebody's settings because they opened an older build is not a repair.
  const params: Record<string, VoiceParams> = {}
  if (isRecord(source.params)) {
    for (const [voiceId, value] of Object.entries(source.params)) {
      params[voiceId] = knobs(value, DEFAULT_PARAMS)
    }
  }

  const bass: Record<string, BassParams> = {}
  if (isRecord(source.bass)) {
    for (const [voiceId, value] of Object.entries(source.bass)) {
      bass[voiceId] = knobs(value, DEFAULT_BASS_PARAMS)
    }
  }

  const sends: Record<string, SendLevels> = {}
  if (isRecord(source.sends)) {
    for (const [voiceId, value] of Object.entries(source.sends)) {
      sends[voiceId] = knobs(value, DEFAULT_SENDS)
    }
  }

  return { params, bass, sends }
}

/**
 * Read a song back. Returns `null` only when the input is not a song at all —
 * unparseable, the wrong shape, or with no usable pattern in it.
 *
 * A song from a future format version is refused rather than guessed at. Everything
 * else is repaired: the caller gets a Song it can hand straight to the engine.
 */
export function decodeSong(text: string): Song | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  // Accept a bare Song as well as an enveloped one, so a file somebody assembled by
  // hand out of `JSON.stringify(song)` still loads.
  const body = isRecord(parsed.song) ? parsed.song : parsed
  if (typeof parsed.v === 'number' && parsed.v > SONG_FORMAT) return null

  const rawPatterns = Array.isArray(body.patterns) ? body.patterns : []
  const patterns = rawPatterns
    .map((value, index) => pattern(value, index))
    .filter((value): value is Pattern => value !== null)
  if (patterns.length === 0) return null

  const ids = new Set(patterns.map((p) => p.id))
  const chain = (Array.isArray(body.chain) ? body.chain : [])
    // A chain entry naming a pattern that is not here would play the wrong bar rather
    // than nothing, because `patternForBar` falls back to the first pattern.
    .filter((entry): entry is string => typeof entry === 'string' && ids.has(entry))

  return {
    bpm: Math.round(clamp(body.bpm, 20, 300, 120)),
    swing: clamp(body.swing, 0, 1, 0),
    patterns,
    chain,
    kit: kit(body.kit),
    fx: knobs(body.fx, DEFAULT_FX),
  }
}
