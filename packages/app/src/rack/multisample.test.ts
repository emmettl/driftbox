import { describe, expect, it } from 'vitest'
import {
  midiNoteFromName,
  midiNoteName,
  suggestMultisampleZones,
  velocityFromName,
} from './multisample.js'

describe('multisample file-name inference', () => {
  it('reads conventional note names and explicit MIDI numbers', () => {
    expect(midiNoteFromName('Piano_C4_vel080.wav')).toBe(60)
    expect(midiNoteFromName('Rhodes-F#3-mf.aiff')).toBe(54)
    expect(midiNoteFromName('Cello_Db2.wav')).toBe(37)
    expect(midiNoteFromName('pluck_midi-72.flac')).toBe(72)
    expect(midiNoteFromName('take_01.wav')).toBeNull()
    expect(midiNoteName(60)).toBe('C4')
  })

  it('reads numeric and dynamic velocity hints', () => {
    expect(velocityFromName('Piano_C4_vel064.wav')).toBeCloseTo(64 / 127)
    expect(velocityFromName('Piano_C4_v127.wav')).toBe(1)
    expect(velocityFromName('Piano_C4_mf.wav')).toBeCloseTo(0.62)
    expect(velocityFromName('Piano_C4.wav')).toBeNull()
  })

  it('fills the keyboard between named root notes without changing file order', () => {
    const zones = suggestMultisampleZones([
      { name: 'Piano_C5.wav', sampleRate: 48_000 },
      { name: 'Piano_C3.wav', sampleRate: 44_100 },
      { name: 'Piano_C4.wav', sampleRate: 48_000 },
    ])
    expect(zones.map((zone) => zone.root)).toEqual([72, 48, 60])
    expect(zones.map(({ low, high }) => [low, high])).toEqual([[67, 127], [0, 54], [55, 66]])
    expect(zones[1].sampleRate).toBe(44_100)
  })

  it('turns recordings at the same root into velocity layers', () => {
    const zones = suggestMultisampleZones([
      { name: 'Piano_C4_ff.wav', sampleRate: 48_000 },
      { name: 'Piano_C4_pp.wav', sampleRate: 48_000 },
      { name: 'Piano_C4_mf.wav', sampleRate: 48_000 },
    ])
    expect(zones.map(({ velocityLow, velocityHigh }) => [velocityLow, velocityHigh])).toEqual([
      [2 / 3, 1],
      [0, 1 / 3],
      [1 / 3, 2 / 3],
    ])
  })

  it('places unnamed files chromatically around middle C', () => {
    expect(
      suggestMultisampleZones([
        { name: 'soft.wav', sampleRate: 48_000 },
        { name: 'medium.wav', sampleRate: 48_000 },
        { name: 'hard.wav', sampleRate: 48_000 },
      ]).map((zone) => zone.root),
    ).toEqual([59, 60, 61])
  })
})
