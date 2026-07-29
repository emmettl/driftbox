import { DEFAULT_BASS_PARAMS, bassNote, previousStep, type BassNote } from './bass.js'
import { patternForBar, stepAt, swingFor, type Song } from './pattern.js'
import { swingDelay } from './timing.js'
import type { StepEvent } from './transport.js'

// What one step of the arrangement plays.
//
// This used to live inside the engine's `playStep`, which was fine while the live
// transport was the only thing that ever asked. Rendering stems needs exactly the same
// answer — which voice, at which time, how hard — computed against an offline clock, and
// two copies of "what does this step play" is the kind of duplication that stays correct
// for about a week.
//
// So it is a pure function of the song and a step event. It reads nothing, schedules
// nothing and touches no audio node; the caller decides whether the answer becomes a
// sound or a sample buffer.

export interface DrumHit {
  voiceId: string
  /** Absolute time on whatever clock the step event came from. */
  time: number
  /** 1 for an accent, 0.55 for a normal hit — the two velocities the grid has. */
  accent: number
}

export interface BassHit {
  voiceId: string
  time: number
  note: BassNote
}

export interface StepPlan {
  drums: DrumHit[]
  bass: BassHit[]
}

const EMPTY: StepPlan = { drums: [], bass: [] }

/**
 * Everything one step of the song plays, at absolute times.
 *
 * Swing is applied here, per voice, rather than by the transport — which is the whole
 * point of the transport emitting straight times. Hats shuffling against a kick that stays
 * on the grid is a groove you cannot get from one global setting.
 */
export function planStep(song: Song, event: StepEvent): StepPlan {
  const pattern = patternForBar(song, event.bar)
  if (!pattern) return EMPTY

  const swung = (voiceId: string) =>
    event.time + swingDelay(event.index, swingFor(song, voiceId), event.stepSeconds)

  const drums: DrumHit[] = []
  for (const voiceId of Object.keys(pattern.tracks)) {
    const value = stepAt(pattern, voiceId, event.index)
    if (value === 0) continue
    drums.push({ voiceId, time: swung(voiceId), accent: value === 2 ? 1 : 0.55 })
  }

  const bass: BassHit[] = []
  for (const [voiceId, line] of Object.entries(pattern.bass ?? {})) {
    const step = line[event.index % pattern.length]
    if (!step) continue
    // Gate lengths are in seconds, so the line has to know how long a step currently is.
    // Read per step rather than cached, so a tempo change shortens the notes with it
    // instead of leaving them overlapping.
    const note = bassNote(
      song.kit.bass?.[voiceId] ?? DEFAULT_BASS_PARAMS,
      step,
      previousStep(line, event.index, pattern.length),
      event.stepSeconds,
    )
    if (note) bass.push({ voiceId, time: swung(voiceId), note })
  }

  return { drums, bass }
}

/**
 * Every step of a whole song, in order, as if a transport had played it start to finish.
 *
 * `bar` counts from zero and the times start at `from`. Used by the stem renderer; the
 * live engine does not need it, because its transport is already walking the same ground
 * one step at a time.
 */
export function planSong(song: Song, bars: number, from = 0): StepPlan[] {
  const out: StepPlan[] = []
  let time = from
  for (let bar = 0; bar < bars; bar++) {
    const pattern = patternForBar(song, bar)
    const length = pattern?.length ?? 16
    for (let index = 0; index < length; index++) {
      const stepSeconds = 60 / song.bpm / 4
      out.push(planStep(song, { absolute: out.length, index, bar, time, stepSeconds }))
      time += stepSeconds
    }
  }
  return out
}
