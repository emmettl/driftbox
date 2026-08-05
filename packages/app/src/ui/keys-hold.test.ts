import { describe, expect, it } from 'vitest'
import { liftNote, pressNote, releaseAll } from './keys-hold.js'

// Both rules here are audible and neither is visible. A missed fallback is a hole in a phrase somebody
// plays once and cannot reproduce; a missed legato is a retriggered envelope that just sounds a bit
// wrong. They were three lines wedged between a `useRef` mutation and an engine call.

describe('pressing', () => {
  it('is not legato on its own', () => {
    expect(pressNote([], 4)).toEqual({ held: [4], legato: false })
  })

  it('glides when something is already down, which is the 303 slide', () => {
    expect(pressNote([4], 7)).toEqual({ held: [4, 7], legato: true })
  })

  it('keeps the newest note last, because that is the one that sounds', () => {
    expect(pressNote([4, 7], 0).held).toEqual([4, 7, 0])
  })

  it('moves a note already down rather than holding it twice', () => {
    // A pointer sliding back onto a key it never left would otherwise stack a duplicate, and the
    // duplicate would survive the matching lift.
    const { held, legato } = pressNote([4, 7], 4)
    expect(held).toEqual([7, 4])
    expect(legato).toBe(true)
  })

  it('is not legato when the only note down is the one being pressed', () => {
    expect(pressNote([4], 4)).toEqual({ held: [4], legato: false })
  })
})

describe('lifting', () => {
  it('closes the gate when the last key goes up', () => {
    expect(liftNote([4], 4)).toEqual({ held: [], sounding: null })
  })

  it('falls back to the note still down rather than going silent', () => {
    // This is the claim: rolling between two keys never leaves a gap.
    expect(liftNote([4, 7], 7)).toEqual({ held: [4], sounding: 4 })
  })

  it('falls back to the newest of several, not the oldest', () => {
    expect(liftNote([0, 4, 7], 7).sounding).toBe(4)
  })

  it('keeps sounding the top note when a key underneath is released', () => {
    // Letting go of the first key while still holding the second must not restart the second.
    expect(liftNote([4, 7], 4)).toEqual({ held: [7], sounding: 7 })
  })

  it('ignores a key that was never down', () => {
    expect(liftNote([4], 9)).toEqual({ held: [4], sounding: 4 })
    expect(liftNote([], 9)).toEqual({ held: [], sounding: null })
  })
})

describe('losing focus', () => {
  it('drops everything and closes the gate', () => {
    // A key held while the window loses focus never sends its key-up. Without this the note
    // sustains until something else happens to stop it, which on a mono voice can be minutes.
    expect(releaseAll()).toEqual({ held: [], sounding: null })
  })
})

describe('a phrase, end to end', () => {
  it('glides in and falls back out without a gap', () => {
    let held: number[] = []
    const gates: (number | null)[] = []

    for (const note of [0, 4, 7]) {
      const press = pressNote(held, note)
      held = press.held
      gates.push(note)
      expect(press.legato).toBe(held.length > 1)
    }
    // Everything after the first note glided; the gate never closed.
    expect(gates).toEqual([0, 4, 7])

    for (const note of [7, 4, 0]) {
      const lift = liftNote(held, note)
      held = lift.held
      gates.push(lift.sounding)
    }
    // Releasing in reverse walks back down the phrase and only then goes silent.
    expect(gates.slice(3)).toEqual([4, 0, null])
  })
})
