import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_TARGET,
  automationValueAt,
  bassParamsAt,
  bpmAt,
  clearAutomationLane,
  fxParamsAt,
  sendLevelsAt,
  setAutomationPoint,
  swingAt,
  voiceParamsAt,
} from './automation.js'
import { DEFAULT_BASS_PARAMS } from './bass.js'
import { defaultKit, type Song } from './pattern.js'
import { planSong, planStep } from './schedule.js'
import { decodeSong, encodeSong, SONG_FORMAT } from './song-io.js'

function song(over: Partial<Song> = {}): Song {
  return {
    bpm: 120,
    swing: 0,
    patterns: [{
      id: 'a',
      name: 'A',
      length: 4,
      tracks: { '808.bd': [1, 1, 1, 1] },
      bass: {
        '303.a': Array.from(
          { length: 4 },
          () => ({ note: 12, accent: false, slide: false }),
        ),
      },
    }],
    chain: [{ pattern: 'a', repeat: 2 }],
    kit: {
      ...defaultKit(['808.bd']),
      bass: { '303.a': { ...DEFAULT_BASS_PARAMS } },
    },
    ...over,
  }
}

describe('automation lanes', () => {
  it('holds the base before the first point and interpolates in transport steps', () => {
    let automated = setAutomationPoint(song(), 'test', 0, 3, 0, 'linear')
    automated = setAutomationPoint(automated, 'test', 1, 1, 1)
    expect(automationValueAt(automated, 'test', 0, 2, 0.25)).toBe(0.25)
    expect(automationValueAt(automated, 'test', 1, 0, 0.25)).toBeCloseTo(0.5)
    expect(automationValueAt(automated, 'test', 1, 2, 0.25)).toBe(1)
  })

  it('replaces a point at the same position and can remove its lane', () => {
    let automated = setAutomationPoint(song(), 'test', 2, 3, 0.2)
    automated = setAutomationPoint(automated, 'test', 0, 1, 0.4)
    automated = setAutomationPoint(automated, 'test', 2, 3, 0.8)
    expect(automated.automation?.[0].points).toEqual([
      { bar: 0, index: 1, value: 0.4 },
      { bar: 2, index: 3, value: 0.8 },
    ])
    expect(clearAutomationLane(automated, 'test').automation).toBeUndefined()
  })

  it('resolves song, voice, bass and per-voice swing targets', () => {
    let automated = setAutomationPoint(song(), AUTOMATION_TARGET.bpm, 0, 0, 180, 'hold')
    automated = setAutomationPoint(
      automated,
      AUTOMATION_TARGET.voice('808.bd', 'level'),
      0,
      0,
      0.2,
    )
    automated = setAutomationPoint(
      automated,
      AUTOMATION_TARGET.bass('303.a', 'cutoff'),
      0,
      0,
      0.9,
    )
    automated = setAutomationPoint(
      automated,
      AUTOMATION_TARGET.voiceSwing('808.bd'),
      0,
      0,
      0.75,
    )
    automated = setAutomationPoint(
      automated,
      AUTOMATION_TARGET.send('808.bd', 'reverb'),
      0,
      0,
      0.6,
    )
    automated = setAutomationPoint(
      automated,
      AUTOMATION_TARGET.fx('delayFeedback'),
      0,
      0,
      0.3,
    )
    expect(bpmAt(automated, 0, 0)).toBe(180)
    expect(voiceParamsAt(automated, '808.bd', 0, 0).level).toBe(0.2)
    expect(bassParamsAt(automated, '303.a', 0, 0).cutoff).toBe(0.9)
    expect(swingAt(automated, '808.bd', 0, 0)).toBe(0.5)
    expect(sendLevelsAt(automated, '808.bd', 0, 0).reverb).toBe(0.6)
    expect(fxParamsAt(automated, 0, 0).delayFeedback).toBe(0.3)
  })
})

describe('automation playback', () => {
  it('puts resolved drum knobs into the shared live/offline step plan', () => {
    const automated = setAutomationPoint(
      song(),
      AUTOMATION_TARGET.voice('808.bd', 'decay'),
      0,
      0,
      0.1,
      'hold',
    )
    const plan = planStep(automated, {
      absolute: 0,
      bar: 0,
      index: 0,
      time: 2,
      stepSeconds: 0.125,
    })
    expect(plan.drums[0].params.decay).toBe(0.1)
  })

  it('puts resolved sends and effects into the shared step plan', () => {
    let automated = setAutomationPoint(
      song(),
      AUTOMATION_TARGET.send('808.bd', 'delay'),
      0,
      0,
      0.7,
      'hold',
    )
    automated = setAutomationPoint(
      automated,
      AUTOMATION_TARGET.fx('delayTone'),
      0,
      0,
      0.2,
      'hold',
    )
    const plan = planStep(automated, {
      absolute: 0,
      bar: 0,
      index: 0,
      time: 0,
      stepSeconds: 0.125,
    })
    expect(plan.drums[0].sends.delay).toBe(0.7)
    expect(plan.fx.delayTone).toBe(0.2)
  })

  it('advances the offline timeline at the automated tempo', () => {
    let automated = setAutomationPoint(song(), AUTOMATION_TARGET.bpm, 0, 0, 120, 'hold')
    automated = setAutomationPoint(automated, AUTOMATION_TARGET.bpm, 0, 1, 240, 'hold')
    const plan = planSong(automated, 1)
    expect(plan.map((step) => step.time)).toEqual([0, 0.125, 0.1875, 0.25])
    expect(plan.map((step) => step.bpm)).toEqual([120, 240, 240, 240])
  })
})

describe('automation song files', () => {
  it('round-trips lanes in the current version', () => {
    const automated = setAutomationPoint(song(), AUTOMATION_TARGET.swing, 1, 2, 0.8)
    const text = encodeSong(automated)
    expect(JSON.parse(text).v).toBe(SONG_FORMAT)
    expect(decodeSong(text)?.automation).toEqual(automated.automation)
  })

  it('repairs malformed points and preserves safe unknown targets', () => {
    const original = song()
    const text = JSON.stringify({
      v: SONG_FORMAT,
      song: {
        ...original,
        automation: [
          {
            target: 'future/device/value',
            interpolation: 'surprise',
            points: [
              { bar: -4, index: 90, value: 2 },
              { bar: 0, index: 0, value: Number.POSITIVE_INFINITY },
            ],
          },
        ],
      },
    })
    expect(decodeSong(text)?.automation).toEqual([{
      target: 'future/device/value',
      interpolation: 'linear',
      points: [{ bar: 0, index: 63, value: 2 }],
    }])
  })
})
