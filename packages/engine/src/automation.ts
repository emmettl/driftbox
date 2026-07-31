import { DEFAULT_BASS_PARAMS, type BassParams } from './bass.js'
import {
  barLengthForBar,
  swingFor,
  type AutomationInterpolation,
  type AutomationLane,
  type AutomationPoint,
  type Song,
} from './pattern.js'
import { DEFAULT_PARAMS, type VoiceParams } from './types.js'

/** Stable target names. Keeping construction here prevents the editor and rack from
 * inventing subtly different spellings for the same engine parameter. */
export const AUTOMATION_TARGET = {
  bpm: 'song/bpm',
  swing: 'song/swing',
  voice: (voiceId: string, key: keyof VoiceParams): string => `voice/${voiceId}/${key}`,
  bass: (voiceId: string, key: keyof BassParams): string => `bass/${voiceId}/${key}`,
  voiceSwing: (voiceId: string): string => `swing/${voiceId}`,
} as const

function comparePoints(a: AutomationPoint, b: AutomationPoint): number {
  return a.bar - b.bar || a.index - b.index
}

function stepDistance(
  song: Song,
  fromBar: number,
  fromIndex: number,
  toBar: number,
  toIndex: number,
): number {
  const start = Math.max(0, Math.min(barLengthForBar(song, fromBar) - 1, fromIndex))
  const end = Math.max(0, Math.min(barLengthForBar(song, toBar) - 1, toIndex))
  if (fromBar === toBar) return end - start
  let distance = barLengthForBar(song, fromBar) - start
  for (let bar = fromBar + 1; bar < toBar; bar++) distance += barLengthForBar(song, bar)
  return distance + end
}

/** Value of one lane at a transport position. Before its first point, the underlying
 * parameter remains in charge; after its last point, the last recorded value is held. */
export function automationValueAt(
  song: Song,
  target: string,
  bar: number,
  index: number,
  fallback: number,
): number {
  const lane = song.automation?.find((candidate) => candidate.target === target)
  if (!lane || lane.points.length === 0) return fallback

  let previous: AutomationPoint | undefined
  for (const point of lane.points) {
    if (point.bar > bar || (point.bar === bar && point.index > index)) {
      if (!previous) return fallback
      if (lane.interpolation === 'hold') return previous.value
      const span = stepDistance(song, previous.bar, previous.index, point.bar, point.index)
      if (span <= 0) return point.value
      const elapsed = stepDistance(song, previous.bar, previous.index, bar, index)
      const amount = elapsed / span
      return previous.value + (point.value - previous.value) * amount
    }
    previous = point
  }
  return previous?.value ?? fallback
}

/** Insert or replace a point without mutating the song. A lane is created on first use,
 * which makes this suitable for record-as-you-turn controls in any host. */
export function setAutomationPoint(
  song: Song,
  target: string,
  bar: number,
  index: number,
  value: number,
  interpolation: AutomationInterpolation = 'linear',
): Song {
  if (target.trim() === '' || !Number.isFinite(value)) return song
  const pointBar = Math.max(0, Math.floor(bar))
  const point: AutomationPoint = {
    bar: pointBar,
    index: Math.max(0, Math.min(barLengthForBar(song, pointBar) - 1, Math.floor(index))),
    value,
  }
  const lanes = song.automation ?? []
  const existing = lanes.find((lane) => lane.target === target)
  const points = [...(existing?.points ?? []).filter(
    (candidate) => candidate.bar !== point.bar || candidate.index !== point.index,
  ), point].sort(comparePoints)
  const lane: AutomationLane = { target, interpolation, points }
  return {
    ...song,
    automation: existing
      ? lanes.map((candidate) => candidate.target === target ? lane : candidate)
      : [...lanes, lane],
  }
}

export function clearAutomationLane(song: Song, target: string): Song {
  if (!song.automation) return song
  const automation = song.automation.filter((lane) => lane.target !== target)
  if (automation.length === song.automation.length) return song
  return { ...song, ...(automation.length > 0 ? { automation } : { automation: undefined }) }
}

function automatedKnobs<T extends object>(
  song: Song,
  target: (key: keyof T) => string,
  base: T,
  bar: number,
  index: number,
): T {
  const result = { ...base }
  const source = base as Record<string, number>
  const output = result as Record<string, number>
  for (const key of Object.keys(base) as (keyof T)[]) {
    const name = String(key)
    const fallback = source[name]
    output[name] = Math.max(
      0,
      Math.min(1, automationValueAt(song, target(key), bar, index, fallback)),
    )
  }
  return result
}

export function voiceParamsAt(song: Song, voiceId: string, bar: number, index: number): VoiceParams {
  const base = song.kit.params[voiceId] ?? DEFAULT_PARAMS
  return automatedKnobs(song, (key) => AUTOMATION_TARGET.voice(voiceId, key), base, bar, index)
}

export function bassParamsAt(song: Song, voiceId: string, bar: number, index: number): BassParams {
  const base = song.kit.bass?.[voiceId] ?? DEFAULT_BASS_PARAMS
  return automatedKnobs(song, (key) => AUTOMATION_TARGET.bass(voiceId, key), base, bar, index)
}

export function bpmAt(song: Song, bar: number, index: number): number {
  return Math.max(20, Math.min(300, automationValueAt(
    song,
    AUTOMATION_TARGET.bpm,
    bar,
    index,
    song.bpm,
  )))
}

export function swingAt(song: Song, voiceId: string, bar: number, index: number): number {
  const songSwing = Math.max(0, Math.min(1, automationValueAt(
    song,
    AUTOMATION_TARGET.swing,
    bar,
    index,
    song.swing,
  )))
  const baseOffset = song.kit.swing?.[voiceId]
  const offset = Math.max(0, Math.min(1, automationValueAt(
    song,
    AUTOMATION_TARGET.voiceSwing(voiceId),
    bar,
    index,
    baseOffset ?? 0.5,
  )))
  if (baseOffset === undefined && !song.automation?.some(
    (lane) => lane.target === AUTOMATION_TARGET.voiceSwing(voiceId),
  )) return songSwing
  return Math.max(0, Math.min(1, songSwing + (offset - 0.5) * 2))
}

/** Exported for hosts that need the unautomated effective value when drawing a lane. */
export function baseSwingFor(song: Song, voiceId: string): number {
  return swingFor(song, voiceId)
}
