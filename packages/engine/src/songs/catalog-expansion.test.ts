import { describe, expect, it } from 'vitest'
import { planSong } from '../schedule.js'
import { offsetSong } from './offset.js'
import { firstLightSong } from './firstlight.js'
import { switchbackSong } from './switchback.js'
import { songBars } from '../pattern.js'

it('keeps First Light beatless and its low voice tied throughout the score', () => {
  const song = firstLightSong()
  const score = planSong(song, songBars(song))
  expect(score.every((step) => step.drums.length === 0)).toBe(true)
  expect(score.every((step) => step.bass.some((hit) =>
    hit.voiceId === '303.b' && !hit.note.retrigger && hit.note.gate > step.stepSeconds,
  ))).toBe(true)
})

it('leaves three full beats without new notes at Switchback’s blind corner', () => {
  const score = planSong(switchbackSong(), 13).slice(12 * 16)
  expect(score[0].drums.length).toBeGreaterThan(0)
  expect(score.slice(4).every((step) => step.drums.length === 0 && step.bass.length === 0)).toBe(true)
})

describe('Offset’s interlocking phrase', () => {
  it('carries the rim across bar boundaries and returns after fifteen bars', () => {
    const song = offsetSong()
    // Skip the four-bar introduction. Use the actual scheduler, not the stored pattern
    // arrays: resetting a short lane at every bar would destroy this composition.
    const score = planSong(song, 34).slice(4 * 16)
    const rim = score.map((step) => step.drums.find((hit) => hit.voiceId === '808.rs')?.accent ?? 0)
    const phrase = rim.slice(0, 240)
    expect(phrase.slice(0, 16)).not.toEqual(phrase.slice(16, 32))
    expect(phrase.slice(0, 15)).toEqual(phrase.slice(15, 30))
    expect(rim.slice(240, 480)).toEqual(phrase)
    // The kick remains on its sixteen-step foundation throughout the moving phrase.
    for (let bar = 0; bar < 15; bar++) {
      const kicks = score.slice(bar * 16, bar * 16 + 16)
        .flatMap((step, index) => step.drums.some((hit) => hit.voiceId === '808.bd') ? [index] : [])
      expect(kicks).toEqual([0, 8])
    }
  })
})
