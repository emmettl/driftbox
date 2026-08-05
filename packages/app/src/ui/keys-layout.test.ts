import { describe, expect, it } from 'vitest'
import {
  LAYOUT,
  MAX_OCTAVE,
  MIN_OCTAVE,
  capFor,
  noteName,
  outOfRange,
  semitoneOf,
  shiftOctave,
} from './keys-layout.js'

// The claim worth writing down is that the colours follow the PITCH, not the scale. The first version of
// this array got it wrong — white keys at 0,2,4,5,7,9,11, the shape of a piano starting at C, while the
// 303's note 0 is an A — so C, F and G came out black and C#, F# and G# came out white. It looks fine in
// a screenshot and it is backwards from every keyboard ever built.

describe('the keyboard, as a piano', () => {
  it('covers a full octave with nothing missing and nothing twice', () => {
    expect(LAYOUT.map((cap) => cap.semitone)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
  })

  it('puts the black keys where a piano puts them, counting from A', () => {
    // A#, C#, D#, F#, G# — five blacks in the pattern 1, gap, 2, gap, 2.
    expect(LAYOUT.filter((cap) => cap.black).map((cap) => cap.semitone)).toEqual([1, 4, 6, 9, 11])
  })

  it('leaves the two gaps that make a keyboard readable at a glance', () => {
    const black = new Set(LAYOUT.filter((cap) => cap.black).map((cap) => cap.semitone))
    // B to C, and E to F. Adjacent white keys with no black between them.
    expect(black.has(2 + 1)).toBe(false)
    expect(black.has(7 + 1)).toBe(false)
  })

  it('spells the white keys as a natural minor scale from the root, which is what they are', () => {
    const white = LAYOUT.filter((cap) => !cap.black && cap.semitone < 12)
    expect(white.map((cap) => noteName(cap.semitone))).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G',
    ])
  })

  it('puts C major under the fingers from `d`, which is the escape hatch the comment promises', () => {
    const from = LAYOUT.findIndex((cap) => cap.key === 'd')
    const scale = LAYOUT.slice(from)
      .filter((cap) => !cap.black)
      .slice(0, 6)
    expect(scale.map((cap) => noteName(cap.semitone))).toEqual(['C', 'D', 'E', 'F', 'G', 'A'])
  })

  it('gives every key a distinct letter', () => {
    expect(new Set(LAYOUT.map((cap) => cap.key)).size).toBe(LAYOUT.length)
  })

  it('keeps the octave and transport letters off the keyboard', () => {
    // z, x and Shift move the grid; a keyboard that also played them would be unusable.
    for (const key of ['z', 'x']) expect(capFor(key)).toBeUndefined()
  })
})

describe('naming a note', () => {
  it('names from the 303 root, which is an A', () => {
    expect(noteName(0)).toBe('A')
    expect(noteName(3)).toBe('C')
    expect(noteName(12)).toBe('A')
  })

  it('names notes below the root as well as above it', () => {
    expect(noteName(-1)).toBe('G#')
    expect(noteName(-12)).toBe('A')
  })
})

describe('finding the key that was pressed', () => {
  it('is case-insensitive, because Shift is the accent', () => {
    expect(capFor('a')?.semitone).toBe(0)
    expect(capFor('A')?.semitone).toBe(0)
    expect(capFor('K')?.semitone).toBe(12)
  })

  it('finds nothing for a key that is not on the keyboard', () => {
    expect(capFor('q')).toBeUndefined()
    expect(capFor('Enter')).toBeUndefined()
  })
})

describe('moving the grid', () => {
  it('shifts a whole octave at a time', () => {
    expect(semitoneOf(capFor('a')!, 0)).toBe(0)
    expect(semitoneOf(capFor('a')!, 1)).toBe(12)
    expect(semitoneOf(capFor('k')!, -1)).toBe(0)
  })

  it('stops at both ends rather than running off the range the 303 has notes for', () => {
    expect(shiftOctave(0, 1)).toBe(MAX_OCTAVE)
    expect(shiftOctave(MAX_OCTAVE, 1)).toBe(MAX_OCTAVE)
    expect(shiftOctave(0, -1)).toBe(MIN_OCTAVE)
    expect(shiftOctave(MIN_OCTAVE, -1)).toBe(MIN_OCTAVE)
  })

  it('keeps the top of the grid inside the 0..24 the notes run over', () => {
    expect(semitoneOf(LAYOUT[LAYOUT.length - 1], MAX_OCTAVE)).toBe(24)
    expect(semitoneOf(LAYOUT[0], MIN_OCTAVE)).toBe(-12)
  })
})

describe('a pitched drum that cannot reach the whole keyboard', () => {
  // A tom tunes across a little under an octave, so the top of the grid is out of its reach.
  const tom = { low: 65, high: 122 }

  it('reaches the bottom of the keyboard', () => {
    expect(outOfRange(tom, 0)).toBe(false)
  })

  it('runs out a little under an octave up, which is where the next tom takes over', () => {
    expect(outOfRange(tom, 10)).toBe(false)
    expect(outOfRange(tom, 11)).toBe(true)
    expect(outOfRange(tom, 24)).toBe(true)
  })

  it('lets a 303 reach everything, having no range of its own', () => {
    expect(outOfRange(undefined, 24)).toBe(false)
  })
})
