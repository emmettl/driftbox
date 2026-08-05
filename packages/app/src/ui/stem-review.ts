import { ALL_VOICES, BASS_VOICES, planSong, songBars, type Song } from '@driftbox/engine'

// What the stem review desk shows, and what it has already rendered.
//
// Out of `StemTray.tsx` because none of it is React and none of it could be reached: every claim here sits
// behind an `OfflineAudioContext` render, so exercising the tray by hand means waiting several seconds per
// stem and then listening. The row model was three ternaries reading five variables, the cache was a pair
// of `useRef` maps, and the preview window was a `planSong` scan wedged between them.

/** How much of a stem a preview plays. Long enough to recognise, short enough to render on a click. */
export const PREVIEW_SECONDS = 4

/** A lead-in before the first hit, so a preview does not open on the attack transient. */
const PREVIEW_LEAD_IN = 0.25

/** A voice id as the name on the machine, across both kits and the two 303s. */
export function stemName(id: string): string {
  return (
    ALL_VOICES.find((voice) => voice.id === id)?.name ??
    BASS_VOICES.find((voice) => voice.id === id)?.name ??
    id
  )
}

/**
 * Where a stem's preview should start: just before that voice's first entrance.
 *
 * A four-second window from bar one is silence for most of a kit — a voice that first plays in bar nine
 * would preview as nothing at all, and the desk would look broken rather than empty. A voice that never
 * plays has no entrance, so it previews from the top and the window is honestly silent.
 */
export function stemPreviewStart(song: Song, id: string): number {
  const plan = planSong(song, songBars(song))
  const times = plan.flatMap((step) => [
    ...step.drums.filter((hit) => hit.voiceId === id).map((hit) => hit.time),
    ...step.bass.filter((hit) => hit.voiceId === id).map((hit) => hit.time),
  ])
  return Math.max(0, (times[0] ?? 0) - PREVIEW_LEAD_IN)
}

/**
 * A stem's file name, numbered so a folder of them sorts into playing order.
 *
 * Deliberately blunter than `rack/download.ts`'s `wavFileName`: this one lowercases and keeps only
 * letters and digits, because these names are voice names rather than names a person typed, and a
 * consistent `808-bass-drum` reads better in a folder than a faithful transliteration would.
 *
 * The prefix falls back rather than producing a name that starts with a hyphen — an empty document name
 * is the ordinary case for a song nobody has saved yet.
 */
export function stemFileName(name: string, index: number, prefix = 'driftbox'): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const document = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${document || 'driftbox'}-${index + 1}-${safe}.wav`
}

/** What the sentence in the footer says when a render fails. */
export const PROBLEMS = {
  render: (name: string) => `Could not render ${name}.`,
  exportAll: 'Could not export the complete stem set.',
} as const

/**
 * The footer line: a problem, what is happening, or what is here.
 *
 * A problem outranks progress, because an error that scrolls past under "Rendering…" is an error nobody
 * saw.
 */
export function trayStatus(
  error: string | null,
  busyName: string | null,
  idle: string,
): string {
  if (error) return error
  return busyName ? `Rendering ${busyName}…` : idle
}

export type StemRowState = 'rendering' | 'playing' | 'ready' | 'idle'

export interface StemRowInput {
  id: string
  /** Length of the cached preview, once one has been rendered and kept. */
  duration?: number
  /** Whether a preview has finished for this stem at some point. */
  ready: boolean
  /** Whether this stem is the one sounding. */
  playing: boolean
  /** Whether this stem is the one being rendered, for a preview or for a save. */
  rendering: boolean
  /** Whether anything in the tray is busy, which is what locks the other rows. */
  busy: boolean
}

export interface StemRow {
  state: StemRowState
  /**
   * Whether the play button now means stop.
   *
   * Not the same as `state === 'playing'`. A stem can be sounding while a full-quality render for its
   * save button is still running, and in that moment the row reads "rendering" while the button still has
   * to offer to stop the sound somebody can hear.
   */
  sounding: boolean
  glyph: string
  status: string
  /** The small line under the name: the id, and what is known about its audio. */
  detail: string
  playDisabled: boolean
  saveDisabled: boolean
}

/**
 * One row of the desk, from everything the tray knows about it.
 *
 * The four states are ordered by what a person needs to know most urgently, which is not the order they
 * arrive in: a row that is both rendering and sounding says "rendering", because the spinner is the part
 * that explains why the desk is not responding.
 *
 * Every other row locks while one is busy. Two offline renders at once is not a correctness problem, but
 * it is slower than either alone and it makes the first one look stuck.
 */
export function stemRow(input: StemRowInput): StemRow {
  const state: StemRowState = input.rendering
    ? 'rendering'
    : input.playing
      ? 'playing'
      : input.duration !== undefined
        ? 'ready'
        : 'idle'

  const detail =
    input.duration !== undefined
      ? `${input.id} · ${input.duration.toFixed(1)}s`
      : input.ready
        ? `${input.id} · ready`
        : input.id

  return {
    state,
    sounding: input.playing,
    glyph: state === 'rendering' ? '…' : input.playing ? '■' : '▶',
    status:
      state === 'rendering'
        ? 'rendering'
        : state === 'playing'
          ? 'playing'
          : state === 'ready'
            ? 'ready'
            : 'not rendered',
    detail,
    // The row that is sounding keeps its button live, because that button is how you stop it.
    playDisabled: input.busy && !input.playing,
    saveDisabled: input.busy,
  }
}

/**
 * Rendered stems, and the ones still being rendered.
 *
 * The in-flight half is the part worth having. Every render here is an `OfflineAudioContext` that takes
 * seconds, and a second click during one — or a save pressed while a preview is still going — would
 * otherwise start a whole second render of the same audio and race the first to the cache. Handing back
 * the promise already running makes the second caller wait for the first rather than duplicate it.
 *
 * A render that produces nothing is not cached, so a stem that failed once can be asked for again.
 */
export class StemCache<T> {
  private readonly done = new Map<string, T>()
  private readonly inFlight = new Map<string, Promise<T | null>>()
  private readonly render: (id: string) => Promise<T | null>

  constructor(render: (id: string) => Promise<T | null>) {
    this.render = render
  }

  /** What is already to hand, without starting anything. */
  cached(id: string): T | undefined {
    return this.done.get(id)
  }

  /** Whether a render for this stem is running right now. */
  pending(id: string): boolean {
    return this.inFlight.has(id)
  }

  /**
   * The stem, rendering it if this is the first ask.
   *
   * `onReady` fires once per stem that actually renders, so a caller can light the row up without
   * polling. It does not fire for a cache hit, which has nothing new to report.
   */
  async ensure(id: string, onReady?: (id: string) => void): Promise<T | null> {
    const cached = this.done.get(id)
    if (cached) return cached
    const existing = this.inFlight.get(id)
    if (existing) return existing

    const work = this.render(id)
      .then((stem) => {
        if (!stem) return null
        this.done.set(id, stem)
        onReady?.(id)
        return stem
      })
      .finally(() => {
        this.inFlight.delete(id)
      })
    this.inFlight.set(id, work)
    return work
  }
}
