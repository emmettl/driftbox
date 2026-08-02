import { DEFAULT_BASS_PARAMS, type BassParams, type BassStep } from './bass.js'
import { DEFAULT_FX, DEFAULT_SENDS, type SendLevels } from './effects.js'
import {
  CLIP_SLOTS,
  type AutomationLane,
  type AutomationPoint,
  type ChainStep,
  type ClipSlot,
  type Kit,
  type Pattern,
  type Song,
  type StepValue,
} from './pattern.js'
import { DEFAULT_PARAMS, type VoiceParams } from './types.js'

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

/**
 * Bumped when the shape changes in a way a reader cannot infer from the value alone.
 *
 * 5 — songs may carry recordable parameter automation lanes.
 * 4 — patterns may carry 909 flam marks and the kit may carry their global width.
 * 3 — chain entries may independently select an 808, 909 and each 303 clip.
 * 2 — the chain became a list of `{ pattern, repeat }` rather than a list of pattern ids,
 *     so an arrangement can say "eight bars of this" without eight entries.
 * 1 — the original.
 *
 * Old songs are migrated on the way in, never on the way out: everything is written in
 * the current format. The migration below is deliberately written against the *shape*
 * rather than against the version number, because a v1 file and a hand-written one with
 * no version at all are the same problem, and only one of them announces itself.
 */
export const SONG_FORMAT = 5

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

function flamLine(value: unknown, length: number): boolean[] | null {
  if (!Array.isArray(value)) return null
  return Array.from({ length }, (_, index) => value[index] === true)
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

  const flams: Record<string, boolean[]> = {}
  if (isRecord(value.flams)) {
    for (const [voiceId, marks] of Object.entries(value.flams)) {
      const parsed = flamLine(marks, length)
      if (parsed) flams[voiceId] = parsed
    }
  }

  const pcf = steps(value.pcf, length)

  return {
    id,
    name: typeof value.name === 'string' && value.name !== '' ? value.name : id,
    length,
    tracks,
    bass,
    ...(Object.keys(flams).length > 0 ? { flams } : {}),
    ...(pcf ? { pcf } : {}),
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

  const swing: Record<string, number> = {}
  if (isRecord(source.swing)) {
    for (const [voiceId, value] of Object.entries(source.swing)) {
      // 0.5 is the centre — no offset from the song's swing — so it is the right value
      // to fall back to for anything unreadable.
      swing[voiceId] = clamp(value, 0, 1, 0.5)
    }
  }

  // Every field of `Kit`, listed. This has been got wrong twice: adding a field here and
  // forgetting one of the places that rebuilds a Kit loses it silently, and the symptom
  // is a knob that works until you reload. `song-io.test.ts` round-trips a fully
  // populated kit for exactly that reason.
  const flam =
    typeof source.flam === 'number' && Number.isFinite(source.flam)
      ? clamp(source.flam, 0, 1, 0.4)
      : undefined
  return { params, bass, sends, swing, ...(flam === undefined ? {} : { flam }) }
}

function automation(value: unknown): AutomationLane[] {
  if (!Array.isArray(value)) return []
  const lanes: AutomationLane[] = []
  const seen = new Set<string>()
  // These bounds are generous for authored music and keep an imported file from turning
  // one lookup per scheduled step into unbounded work.
  for (const rawLane of value.slice(0, 256)) {
    if (!isRecord(rawLane)) continue
    const target =
      typeof rawLane.target === 'string' && rawLane.target.trim() !== ''
        ? rawLane.target.slice(0, 160)
        : undefined
    if (!target || seen.has(target) || !Array.isArray(rawLane.points)) continue
    const byPosition = new Map<string, AutomationPoint>()
    for (const rawPoint of rawLane.points.slice(0, 4096)) {
      if (!isRecord(rawPoint) || typeof rawPoint.value !== 'number' || !Number.isFinite(rawPoint.value)) {
        continue
      }
      const point: AutomationPoint = {
        bar: Math.round(clamp(rawPoint.bar, 0, 4095, 0)),
        index: Math.round(clamp(rawPoint.index, 0, 63, 0)),
        value:
          target === 'song/bpm'
            ? clamp(rawPoint.value, 20, 300, 120)
            : target.startsWith('song/') ||
                target.startsWith('voice/') ||
                target.startsWith('bass/') ||
                target.startsWith('swing/') ||
                target.startsWith('send/') ||
                target.startsWith('fx/')
              ? clamp(rawPoint.value, 0, 1, 0)
              : clamp(rawPoint.value, -1_000_000, 1_000_000, 0),
      }
      byPosition.set(`${point.bar}:${point.index}`, point)
    }
    const points = [...byPosition.values()].sort((a, b) => a.bar - b.bar || a.index - b.index)
    if (points.length === 0) continue
    seen.add(target)
    lanes.push({
      target,
      interpolation: rawLane.interpolation === 'hold' ? 'hold' : 'linear',
      points,
    })
  }
  return lanes
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
    .map((entry): ChainStep | null => {
      // A v1 chain is a bare list of pattern ids. Each one is a single bar, so it
      // migrates to a repeat of 1 and the song sounds exactly as it did before.
      if (typeof entry === 'string') return { pattern: entry, repeat: 1 }
      if (!isRecord(entry) || typeof entry.pattern !== 'string') return null
      const clips: Partial<Record<ClipSlot, string>> = {}
      if (isRecord(entry.clips)) {
        for (const slot of CLIP_SLOTS) {
          const patternId = entry.clips[slot]
          if (typeof patternId === 'string' && ids.has(patternId)) clips[slot] = patternId
        }
      }
      const step: ChainStep = {
        pattern: entry.pattern,
        repeat: Math.round(clamp(entry.repeat, 1, 64, 1)),
      }
      if (Object.keys(clips).length > 0) step.clips = clips
      return step
    })
    // A chain entry naming a pattern that is not here would play the wrong bar rather
    // than nothing, because `patternForBar` falls back to the first pattern.
    .filter((entry): entry is ChainStep => entry !== null && ids.has(entry.pattern))

  const lanes = automation(body.automation)
  const visual =
    typeof body.visual === 'string' && body.visual.trim() !== ''
      ? body.visual.trim().slice(0, 120)
      : undefined
  return {
    bpm: Math.round(clamp(body.bpm, 20, 300, 120)),
    swing: clamp(body.swing, 0, 1, 0),
    patterns,
    chain,
    kit: kit(body.kit),
    fx: knobs(body.fx, DEFAULT_FX),
    ...(lanes.length > 0 ? { automation: lanes } : {}),
    ...(visual ? { visual } : {}),
  }
}
