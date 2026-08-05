import { describe, expect, it } from 'vitest'
import { claimsKey, keysKeyDown, keysKeyUp } from './keys-shortcuts.js'

// The guard at the top of this is the one that matters. `a` through `k` are notes, so without it, typing
// a pattern name plays a tune and writes nothing — and it was an inline array literal inside the
// listener, one of four spellings of the same rule in this app.

const field = (tag: string) => ({ tagName: tag }) as unknown as EventTarget

const playing = { octave: 0, entry: false }
const entering = { octave: 0, entry: true }

describe('a key that belongs to a field', () => {
  it('is left alone in every kind of field', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(keysKeyDown({ key: 'a', target: field(tag) }, playing)).toBeNull()
    }
  })

  it('includes SELECT, which types too', () => {
    // A select jumps to a matching option on a typed character, so a note key landing on somebody's
    // half-finished choice is the same theft as the text case.
    expect(keysKeyDown({ key: 'd', target: field('SELECT') }, playing)).toBeNull()
  })

  it('still reaches the page from anywhere else', () => {
    expect(keysKeyDown({ key: 'a', target: field('BUTTON') }, playing)).toEqual({
      kind: 'note',
      semitone: 0,
    })
    expect(keysKeyDown({ key: 'a' }, playing)).toEqual({ kind: 'note', semitone: 0 })
  })
})

describe('keys that are not ours', () => {
  it('refuses auto-repeat, which is the opposite of holding a note', () => {
    expect(keysKeyDown({ key: 'a', repeat: true }, playing)).toBeNull()
  })

  it('refuses every accelerator, so the page keeps its own shortcuts', () => {
    // A keyboard that plays a note on Cmd+S is one you cannot save from.
    expect(keysKeyDown({ key: 's', metaKey: true }, playing)).toBeNull()
    expect(keysKeyDown({ key: 's', ctrlKey: true }, playing)).toBeNull()
    expect(keysKeyDown({ key: 'a', altKey: true }, playing)).toBeNull()
  })

  it('ignores a key that means nothing here', () => {
    expect(keysKeyDown({ key: 'q' }, playing)).toBeNull()
    expect(keysKeyDown({ key: 'ArrowLeft' }, playing)).toBeNull()
  })
})

describe('playing', () => {
  it('reads a note from the layout, at the current octave', () => {
    expect(keysKeyDown({ key: 'k' }, playing)).toEqual({ kind: 'note', semitone: 12 })
    expect(keysKeyDown({ key: 'a' }, { ...playing, octave: 1 })).toEqual({
      kind: 'note',
      semitone: 12,
    })
    expect(keysKeyDown({ key: 'k' }, { ...playing, octave: -1 })).toEqual({
      kind: 'note',
      semitone: 0,
    })
  })

  it('takes an upper-case letter, because Shift is the accent', () => {
    expect(keysKeyDown({ key: 'A' }, playing)).toEqual({ kind: 'note', semitone: 0 })
  })

  it('moves the grid on z and x, and accents on Shift', () => {
    expect(keysKeyDown({ key: 'z' }, playing)).toEqual({ kind: 'octave', delta: -1 })
    expect(keysKeyDown({ key: 'x' }, playing)).toEqual({ kind: 'octave', delta: 1 })
    expect(keysKeyDown({ key: 'Shift' }, playing)).toEqual({ kind: 'accent', down: true })
  })
})

describe('step entry', () => {
  it('writes a rest and a tie only while entry is open', () => {
    expect(keysKeyDown({ key: 'Backspace' }, entering)).toEqual({ kind: 'rest' })
    expect(keysKeyDown({ key: 'Enter' }, entering)).toEqual({ kind: 'tie' })
  })

  it('leaves both keys their usual meaning when it is not', () => {
    // A rest written into a tom lane is not a thing, and Backspace elsewhere navigates.
    expect(keysKeyDown({ key: 'Backspace' }, playing)).toBeNull()
    expect(keysKeyDown({ key: 'Enter' }, playing)).toBeNull()
  })

  it('does not shadow a note key with an entry key', () => {
    expect(keysKeyDown({ key: 'a' }, entering)).toEqual({ kind: 'note', semitone: 0 })
  })
})

describe('what the browser is allowed to keep', () => {
  it('claims the three keys that would otherwise do something visible', () => {
    expect(claimsKey(keysKeyDown({ key: 'a' }, playing))).toBe(true)
    expect(claimsKey(keysKeyDown({ key: 'Backspace' }, entering))).toBe(true)
    expect(claimsKey(keysKeyDown({ key: 'Enter' }, entering))).toBe(true)
  })

  it('leaves the octave and accent keys alone', () => {
    // Suppressing them would take `z` away from an undo somebody meant for the page.
    expect(claimsKey(keysKeyDown({ key: 'z' }, playing))).toBe(false)
    expect(claimsKey(keysKeyDown({ key: 'Shift' }, playing))).toBe(false)
    expect(claimsKey(null)).toBe(false)
  })
})

describe('letting go', () => {
  it('lifts the note the key plays at the current octave', () => {
    expect(keysKeyUp({ key: 'g' }, 0)).toEqual({ kind: 'note', semitone: 7 })
    expect(keysKeyUp({ key: 'g' }, 1)).toEqual({ kind: 'note', semitone: 19 })
  })

  it('drops the accent when Shift comes up', () => {
    expect(keysKeyUp({ key: 'Shift' }, 0)).toEqual({ kind: 'accent', down: false })
  })

  it('ignores anything else', () => {
    expect(keysKeyUp({ key: 'q' }, 0)).toBeNull()
    expect(keysKeyUp({ key: 'Backspace' }, 0)).toBeNull()
  })
})
