import { describe, expect, it } from 'vitest'
import {
  BLACK_HEIGHT,
  BLACK_WIDTH,
  WHITE_HEIGHT,
  WHITE_WIDTH,
  keyMap,
  keyboardWidth,
  noteName,
  pianoKeys,
} from './keys.js'

// The geometry of a keyboard, which is the part that is wrong in ways that are hard to see. What makes a
// keyboard legible at a glance is the two gaps — B→C and E→F — and they only appear if the black keys are
// placed by pitch. `app/src/ui/Keys.tsx` got this backwards once and the note there is worth reading.

describe('the piano layout', () => {
  it('starts on a C, because the rack’s zero volts is a C2', () => {
    // Not arbitrary. MIDI 36 is where 0 V sits for every pitch inlet in this rack, so a keyboard rooted
    // anywhere else would need a correction somewhere and would be a small permanent lie in the labels.
    expect(pianoKeys(1).find((k) => k.semitone === 0)!.name).toBe('C')
    expect(noteName(36)).toBe('C2')
    expect(noteName(60)).toBe('C4')
  })

  it('puts the white keys where a piano does', () => {
    const white = pianoKeys(1).filter((k) => !k.black).map((k) => k.semitone)
    expect(white).toEqual([0, 2, 4, 5, 7, 9, 11, 12])
  })

  it('puts the black keys where a piano does, gaps included', () => {
    // The whole point. Five blacks to an octave, in two groups, with nothing between B and C or E and F.
    const black = pianoKeys(1).filter((k) => k.black).map((k) => k.semitone)
    expect(black).toEqual([1, 3, 6, 8, 10])
  })

  it('leaves a visible gap where B meets C and E meets F', () => {
    // Stated as geometry rather than as a list of semitones, because this is the thing somebody actually
    // sees. Between the black keys either side of a gap there is more than one black key's width of space.
    const black = pianoKeys(2).filter((k) => k.black).sort((a, b) => a.x - b.x)
    const gaps: number[] = []
    for (let i = 1; i < black.length; i++) gaps.push(black[i].x - (black[i - 1].x + black[i - 1].width))
    // Two octaves: after D#, after A#, then after the next D# — three, not four, because the layout stops
    // on the trailing C before a second A# gap can occur.
    expect(gaps.filter((g) => g > BLACK_WIDTH).length).toBe(3)
  })

  it('centres every black key on the join between the two white keys it sits between', () => {
    // A black key nudged off its boundary is the sort of thing that looks "slightly wrong" without anybody
    // being able to say why.
    const keys = pianoKeys(1)
    for (const black of keys.filter((k) => k.black)) {
      const left = keys.find((k) => !k.black && k.semitone === black.semitone - 1)!
      const right = keys.find((k) => !k.black && k.semitone === black.semitone + 1)!
      const centre = black.x + black.width / 2
      expect(centre).toBeCloseTo(left.x + left.width, 10)
      expect(centre).toBeCloseTo(right.x, 10)
    }
  })

  it('draws the white keys before the black ones', () => {
    // Not cosmetic ordering: the blacks overlap the whites and have to be painted on top, and both SVG and
    // a stack of positioned divs paint in document order. Returning them mixed would need every caller to
    // sort, and one of them would forget.
    const keys = pianoKeys(2)
    const firstBlack = keys.findIndex((k) => k.black)
    expect(keys.slice(0, firstBlack).every((k) => !k.black)).toBe(true)
    expect(keys.slice(firstBlack).every((k) => k.black)).toBe(true)
  })

  it('finishes on a C rather than stopping on a B', () => {
    // A keyboard that ends on a B looks truncated and there is nowhere to finish a scale.
    for (const octaves of [1, 2, 3]) {
      const keys = pianoKeys(octaves)
      const highest = keys.reduce((a, b) => (b.semitone > a.semitone ? b : a))
      expect(highest.semitone).toBe(octaves * 12)
      expect(highest.name).toBe('C')
      expect(highest.black).toBe(false)
    }
  })

  it('never overlaps two white keys', () => {
    // They tile. Any overlap would make one key unclickable along its edge.
    const white = pianoKeys(3).filter((k) => !k.black).sort((a, b) => a.x - b.x)
    for (let i = 1; i < white.length; i++) {
      expect(white[i].x).toBeCloseTo(white[i - 1].x + white[i - 1].width, 10)
    }
  })

  it('reports a width that actually contains its keys', () => {
    // Used for the viewBox, so if it were short the last key would be clipped and if it were long there
    // would be a dead strip on the right that swallows clicks.
    for (const octaves of [1, 2, 3]) {
      const keys = pianoKeys(octaves)
      const right = Math.max(...keys.map((k) => k.x + k.width))
      expect(keyboardWidth(octaves)).toBeCloseTo(right, 10)
      expect(Math.min(...keys.map((k) => k.x))).toBeGreaterThanOrEqual(0)
    }
  })

  it('is taller than it is wide, so a key reads as a key', () => {
    // The first version drew into a `0 0 width 1` viewBox stretched with `preserveAspectRatio: none`, which
    // made a white key 63px wide and 92px tall — nearly square, with the black keys looking fat and the
    // rounded corners coming out as ovals because the axes scaled differently. Stated as a ratio because
    // that is the property; the pixel height is the CSS's business.
    expect(WHITE_HEIGHT).toBeGreaterThan(WHITE_WIDTH * 2)
    // And a black key stops well short of the bottom, or there is nowhere to play the white in front of it.
    expect(BLACK_HEIGHT).toBeLessThan(WHITE_HEIGHT * 0.75)
    expect(BLACK_HEIGHT).toBeGreaterThan(WHITE_HEIGHT * 0.5)
  })
})

describe('the computer keyboard mapping', () => {
  const map = keyMap()

  it('spells a C major scale along the home row', () => {
    // The mapping every tracker has used for thirty years. If this drifted, every written-down "play
    // zxcvbnm" instruction anywhere would become wrong.
    expect('zxcvbnm'.split('').map((k) => map.get(k))).toEqual([0, 2, 4, 5, 7, 9, 11])
  })

  it('puts the black keys above the white ones they sit between', () => {
    expect('sdghj'.split('').map((k) => map.get(k))).toEqual([1, 3, 6, 8, 10])
    // s is C#, and it is above the join between z (C) and x (D).
    expect(map.get('s')).toBe(map.get('z')! + 1)
    expect(map.get('s')).toBe(map.get('x')! - 1)
  })

  it('has no key where the piano has no black key', () => {
    // There is no black key between E and F, so nothing on the row above may play one. `f` and `k` sit
    // over those two gaps and must be unmapped — mapping them is the exact mistake that makes a computer
    // keyboard play a chromatic run when somebody expects a scale.
    expect(map.has('f')).toBe(false)
    expect(map.has('k')).toBe(false)
    expect(map.has('4')).toBe(false)
    expect(map.has('8')).toBe(false)
  })

  it('gives the upper rows the octave above', () => {
    for (const [low, high] of [['z', 'q'], ['x', 'w'], ['m', 'u'], ['s', '2'], ['j', '7']]) {
      expect(map.get(high)).toBe(map.get(low)! + 12)
    }
  })

  it('maps two full octaves and no key twice', () => {
    const semitones = [...map.values()]
    expect(new Set(semitones).size).toBe(semitones.length)
    expect(Math.min(...semitones)).toBe(0)
    expect(Math.max(...semitones)).toBe(23)
    expect(semitones.length).toBe(24)
  })

  it('does not claim keys the rest of the page needs', () => {
    // Tab flips the rack and the transport keys belong to the app. A note mapping that swallowed one of
    // those would break a control that works everywhere else on the page.
    for (const key of ['Tab', ' ', 'Enter', 'Escape', 'Backspace']) expect(map.has(key)).toBe(false)
  })
})
