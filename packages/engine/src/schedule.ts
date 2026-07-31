import { bassNote, previousStep, type BassNote } from './bass.js'
import {
  bassParamsAt,
  bpmAt,
  fxParamsAt,
  sendLevelsAt,
  swingAt,
  voiceParamsAt,
} from './automation.js'
import {
  CLIP_SLOTS,
  barLengthForBar,
  clipSlotForVoice,
  flamAt,
  patternForBar,
  patternForClip,
  stepAt,
  type ClipSlot,
  type Pattern,
  type Song,
} from './pattern.js'
import type { ClipSelection } from './clip-launch.js'
import { swingDelay } from './timing.js'
import type { StepEvent } from './transport.js'
import type { VoiceParams } from './types.js'
import type { FxParams, SendLevels } from './effects.js'

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
  sends: SendLevels
}

export interface BassHit {
  voiceId: string
  time: number
  note: BassNote
  sends: SendLevels
}

export interface StepPlan {
  time: number
  stepSeconds: number
  bpm: number
  fx: FxParams
  drums: DrumHit[]
  bass: BassHit[]
}

/** Resolve one machine through a session launch, falling back to the authored section. */
function selectedPattern(
  song: Song,
  bar: number,
  slot: ClipSlot,
  selection: ClipSelection,
): Pattern | undefined {
  const patternId = selection[slot]
  return (
    (patternId ? song.patterns.find((pattern) => pattern.id === patternId) : undefined) ??
    patternForClip(song, bar, slot)
  )
}

/** A launched polymetric clip may lengthen the incoming bar. */
export function barLengthForSelection(
  song: Song,
  bar: number,
  selection: ClipSelection = {},
): number {
  return Math.max(
    barLengthForBar(song, bar),
    ...CLIP_SLOTS.map((slot) => selectedPattern(song, bar, slot, selection)?.length ?? 0),
  )
}

/**
 * Everything one step of the song plays, at absolute times.
 *
 * Swing is applied here, per voice, rather than by the transport — which is the whole
 * point of the transport emitting straight times. Hats shuffling against a kick that stays
 * on the grid is a groove you cannot get from one global setting.
 */
export function planStep(
  song: Song,
  event: StepEvent,
  selection: ClipSelection = {},
): StepPlan {
  const bpm = bpmAt(song, event.bar, event.index)
  const stepSeconds = 60 / bpm / 4
  const fx = fxParamsAt(song, event.bar, event.index)
  const pattern = patternForBar(song, event.bar)
  if (!pattern) return { time: event.time, stepSeconds, bpm, fx, drums: [], bass: [] }

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
    ...CLIP_SLOTS.map((slot) => selectedPattern(song, event.bar, slot, selection)).filter(
      (source) => source !== undefined,
    ),
  ]

  const forVoice = (voiceId: string): Pattern | undefined => {
    const slot = clipSlotForVoice(voiceId)
    return slot
      ? selectedPattern(song, event.bar, slot, selection)
      : patternForBar(song, event.bar)
  }

  const drumVoices = new Set(sources.flatMap((source) => Object.keys(source.tracks)))
  const drums: DrumHit[] = []
  for (const voiceId of drumVoices) {
    const source = forVoice(voiceId)
    if (!source) continue
    const value = stepAt(source, voiceId, event.index)
    if (value === 0) continue
    const time = swung(voiceId)
    const accent = value === 2 ? 1 : 0.55
    const params = voiceParamsAt(song, voiceId, event.bar, event.index)
    const sends = sendLevelsAt(song, voiceId, event.bar, event.index)
    drums.push({ voiceId, time, accent, params, sends })
    if (voiceId.startsWith('909.') && flamAt(source, voiceId, event.index)) {
      // ReBirth's flam knob controls the gap between the two strikes. Keep the useful
      // range narrow enough to read as one articulated hit rather than an echo.
      const spacing = 0.012 + (song.kit.flam ?? 0.4) * 0.048
      drums.push({ voiceId, time: time + spacing, accent, params, sends })
    }
  }

  const bassVoices = new Set(
    sources.flatMap((source) => Object.keys(source.bass ?? {})),
  )
  const bass: BassHit[] = []
  for (const voiceId of bassVoices) {
    const source = forVoice(voiceId)
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
    if (note) {
      bass.push({
        voiceId,
        time: swung(voiceId),
        note,
        sends: sendLevelsAt(song, voiceId, event.bar, event.index),
      })
    }
  }

  return { time: event.time, stepSeconds, bpm, fx, drums, bass }
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
