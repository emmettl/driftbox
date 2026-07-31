import { bassNote, previousStep, type BassNote } from './bass.js'
import { bassParamsAt, bpmAt, swingAt, voiceParamsAt } from './automation.js'
import {
  CLIP_SLOTS,
  barLengthForBar,
  flamAt,
  patternForBar,
  patternForClip,
  patternForVoice,
  stepAt,
  type Song,
} from './pattern.js'
import { swingDelay } from './timing.js'
import type { StepEvent } from './transport.js'
import type { VoiceParams } from './types.js'

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
  /** Knobs resolved at this exact song position, shared by live and offline playback. */
  params: VoiceParams
}

export interface BassHit {
  voiceId: string
  time: number
  note: BassNote
}

export interface StepPlan {
  time: number
  stepSeconds: number
  bpm: number
  drums: DrumHit[]
  bass: BassHit[]
}

/**
 * Everything one step of the song plays, at absolute times.
 *
 * Swing is applied here, per voice, rather than by the transport — which is the whole
 * point of the transport emitting straight times. Hats shuffling against a kick that stays
 * on the grid is a groove you cannot get from one global setting.
 */
export function planStep(song: Song, event: StepEvent): StepPlan {
  const bpm = bpmAt(song, event.bar, event.index)
  const stepSeconds = 60 / bpm / 4
  const pattern = patternForBar(song, event.bar)
  if (!pattern) return { time: event.time, stepSeconds, bpm, drums: [], bass: [] }

  const swung = (voiceId: string) =>
    event.time + swingDelay(
      event.index,
      swingAt(song, voiceId, event.bar, event.index),
      stepSeconds,
    )

  // The union tells us which voice ids might exist; `patternForVoice` then reads each
  // from its selected machine clip. Sets avoid scheduling a voice twice when several
  // slots fall back to the same whole-groove pattern.
  const sources = [
    pattern,
    ...CLIP_SLOTS.map((slot) => patternForClip(song, event.bar, slot)).filter(
      (source) => source !== undefined,
    ),
  ]

  const drumVoices = new Set(sources.flatMap((source) => Object.keys(source.tracks)))
  const drums: DrumHit[] = []
  for (const voiceId of drumVoices) {
    const source = patternForVoice(song, event.bar, voiceId)
    if (!source) continue
    const value = stepAt(source, voiceId, event.index)
    if (value === 0) continue
    const time = swung(voiceId)
    const accent = value === 2 ? 1 : 0.55
    const params = voiceParamsAt(song, voiceId, event.bar, event.index)
    drums.push({ voiceId, time, accent, params })
    if (voiceId.startsWith('909.') && flamAt(source, voiceId, event.index)) {
      // ReBirth's flam knob controls the gap between the two strikes. Keep the useful
      // range narrow enough to read as one articulated hit rather than an echo.
      const spacing = 0.012 + (song.kit.flam ?? 0.4) * 0.048
      drums.push({ voiceId, time: time + spacing, accent, params })
    }
  }

  const bassVoices = new Set(
    sources.flatMap((source) => Object.keys(source.bass ?? {})),
  )
  const bass: BassHit[] = []
  for (const voiceId of bassVoices) {
    const source = patternForVoice(song, event.bar, voiceId)
    const line = source?.bass?.[voiceId]
    if (!source || !line) continue
    const step = line[event.index % source.length]
    if (!step) continue
    // Gate lengths are in seconds, so the line has to know how long a step currently is.
    // Read per step rather than cached, so a tempo change shortens the notes with it
    // instead of leaving them overlapping.
    const note = bassNote(
      bassParamsAt(song, voiceId, event.bar, event.index),
      step,
      previousStep(line, event.index, source.length),
      stepSeconds,
    )
    if (note) bass.push({ voiceId, time: swung(voiceId), note })
  }

  return { time: event.time, stepSeconds, bpm, drums, bass }
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
    const length = barLengthForBar(song, bar)
    for (let index = 0; index < length; index++) {
      const stepSeconds = 60 / bpmAt(song, bar, index) / 4
      out.push(planStep(song, { absolute: out.length, index, bar, time, stepSeconds }))
      time += stepSeconds
    }
  }
  return out
}
