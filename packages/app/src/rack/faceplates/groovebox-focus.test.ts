import {
  bassStepAt,
  setBassStep,
  type Pattern,
  type StepValue,
} from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import {
  alterFocus,
  canPasteFocus,
  clearFocus,
  copyFocus,
  focusLabel,
  focusedName,
  grooveboxFocus,
  pasteFocus,
  pasteTitle,
  randomizeFocus,
  rotateFocus,
  type FocusClipboard,
} from './groovebox-focus.js'

// One toggle decides whether a button means one drum lane or eleven, and six controls read it. Every
// claim here is about that toggle: what the label promises, and what the edit beside it actually does.
// Before the split, the only way to notice a rotation had taken the whole machine with it was to scroll
// to a lane you were not watching.

const lane = (...steps: StepValue[]): StepValue[] =>
  Array.from({ length: 16 }, (_, index) => steps[index] ?? 0)

const drums = (): Pattern => ({
  id: 'one',
  name: 'One',
  length: 16,
  tracks: {
    '808.bd': lane(1, 0, 0, 0, 1, 0, 0, 0),
    '808.sd': lane(0, 0, 0, 0, 2),
    '808.cp': lane(0, 0, 1),
  },
  bass: {},
})

const bassline = (): Pattern =>
  setBassStep({ id: 'one', name: 'One', length: 16, tracks: {}, bass: {} }, '303.a', 0, {
    note: 7,
    accent: true,
    slide: false,
  })

const lanes = (pattern: Pattern, id: string) => pattern.tracks[id] ?? []

describe('what the focus is', () => {
  it('points at the first lane of a machine until one is asked for', () => {
    expect(grooveboxFocus('tr808', '', false).voice?.id).toBe('808.bd')
    expect(grooveboxFocus('tr808', '808.cp', false).voice?.id).toBe('808.cp')
  })

  it('drops a lane that belongs to the machine you just left', () => {
    // The wanted voice is remembered across a machine change; a 909 lane is not an 808 lane.
    expect(grooveboxFocus('tr808', '909.rim', false).voice?.id).toBe('808.bd')
  })

  it('holds one lane, or all of them, and never a 303 lane at all', () => {
    expect(grooveboxFocus('tr808', '808.cp', false).lanes.map((v) => v.id)).toEqual(['808.cp'])
    expect(grooveboxFocus('tr808', '', true).lanes.length).toBeGreaterThan(1)
    expect(grooveboxFocus('303.a', '', true).lanes).toEqual([])
    expect(grooveboxFocus('303.b', '', false).bass).toBe(true)
  })
})

describe('what the buttons promise', () => {
  it('names the lane when the toggle is off, and says "whole" when it is on', () => {
    expect(focusLabel(grooveboxFocus('tr808', '808.sd', false))).toBe('Snare')
    expect(focusLabel(grooveboxFocus('tr808', '808.sd', true))).toBe('whole 808')
    expect(focusLabel(grooveboxFocus('tr909', '909.cp', true))).toBe('whole 909')
  })

  it('never says "whole" on a 303, which has one lane to say it about', () => {
    // The toggle is not even drawn for a 303, so a stale `true` must not leak into the label.
    expect(focusLabel(grooveboxFocus('303.a', '', true))).toBe('303 A')
    expect(focusedName(grooveboxFocus('303.b', '', true))).toBe('303 B')
  })

  it('keeps the single-lane name separate from the toggle-following one', () => {
    const focus = grooveboxFocus('tr909', '909.bd', true)
    // Randomise and alter act on one lane and say so, beside a rotate that acts on eleven.
    expect(focusedName(focus)).toBe('Bass Drum')
    expect(focusLabel(focus)).toBe('whole 909')
  })
})

describe('rotating', () => {
  it('moves only the focused lane', () => {
    const next = rotateFocus(drums(), grooveboxFocus('tr808', '808.bd', false), 1)
    expect(lanes(next, '808.bd').slice(0, 6)).toEqual([0, 1, 0, 0, 0, 1])
    expect(lanes(next, '808.sd')).toEqual(lanes(drums(), '808.sd'))
  })

  it('moves every lane of the machine when the toggle is on', () => {
    const next = rotateFocus(drums(), grooveboxFocus('tr808', '808.bd', true), 1)
    expect(lanes(next, '808.bd').slice(0, 6)).toEqual([0, 1, 0, 0, 0, 1])
    expect(lanes(next, '808.sd').slice(0, 6)).toEqual([0, 0, 0, 0, 0, 2])
    expect(lanes(next, '808.cp').slice(0, 4)).toEqual([0, 0, 0, 1])
  })

  it('rotates a 303 line whatever the toggle says', () => {
    const next = rotateFocus(bassline(), grooveboxFocus('303.a', '', true), 1)
    expect(bassStepAt(next, '303.a', 1).note).toBe(7)
    expect(bassStepAt(next, '303.a', 0).note).toBeNull()
  })
})

describe('randomise and alter, which do not follow the toggle', () => {
  it('replaces one lane even when the toggle is set to the whole machine', () => {
    const before = drums()
    const next = randomizeFocus(before, grooveboxFocus('tr808', '808.bd', true))
    // The other lanes are the same arrays, not merely equal ones: nothing touched them.
    expect(next.tracks['808.sd']).toBe(before.tracks['808.sd'])
    expect(next.tracks['808.cp']).toBe(before.tracks['808.cp'])
  })

  it('rearranges one lane the same way', () => {
    const before = drums()
    const next = alterFocus(before, grooveboxFocus('tr808', '808.cp', true))
    expect(next.tracks['808.bd']).toBe(before.tracks['808.bd'])
  })

  it('leaves the pattern alone when a machine has no lane selected', () => {
    const before = drums()
    const empty = { ...grooveboxFocus('tr808', '', false), voice: undefined }
    expect(randomizeFocus(before, empty)).toBe(before)
    expect(alterFocus(before, empty)).toBe(before)
  })
})

describe('the clipboard', () => {
  it('copies one lane, labelled as that lane', () => {
    const copied = copyFocus(drums(), grooveboxFocus('tr808', '808.sd', false))
    expect(copied?.kind).toBe('drum')
    expect(copied?.label).toBe('Snare')
    expect(copied?.kind === 'drum' && copied.lanes.length).toBe(1)
  })

  it('copies a whole machine, labelled as the machine', () => {
    const copied = copyFocus(drums(), grooveboxFocus('tr808', '', true))
    expect(copied?.label).toBe('whole 808')
    expect(copied?.kind === 'drum' && copied.lanes.length).toBeGreaterThan(1)
  })

  it('copies a 303 line as a line, not as a lane', () => {
    const copied = copyFocus(bassline(), grooveboxFocus('303.a', '', false))
    expect(copied?.kind).toBe('bass')
    expect(copied?.label).toBe('303 A')
  })

  it('cuts exactly what it copied', () => {
    const focus = grooveboxFocus('tr808', '', true)
    const next = clearFocus(drums(), focus)
    expect(next.tracks['808.bd']).toBeUndefined()
    expect(next.tracks['808.sd']).toBeUndefined()

    const one = clearFocus(drums(), grooveboxFocus('tr808', '808.sd', false))
    expect(one.tracks['808.sd']).toBeUndefined()
    expect(one.tracks['808.bd']).toBeDefined()
  })
})

describe('what the clipboard fits', () => {
  const oneLane = copyFocus(drums(), grooveboxFocus('tr808', '808.sd', false))
  const wholeMachine = copyFocus(drums(), grooveboxFocus('tr808', '', true))
  const line = copyFocus(bassline(), grooveboxFocus('303.a', '', false))

  it('never crosses between a drum lane and a 303 line', () => {
    expect(canPasteFocus(oneLane, grooveboxFocus('303.a', '', false))).toBe(false)
    expect(canPasteFocus(line, grooveboxFocus('tr808', '', false))).toBe(false)
  })

  it('takes one lane anywhere, including the other machine', () => {
    expect(canPasteFocus(oneLane, grooveboxFocus('tr808', '808.cp', false))).toBe(true)
    expect(canPasteFocus(oneLane, grooveboxFocus('tr909', '909.sd', false))).toBe(true)
  })

  it('keeps a whole machine on its own machine', () => {
    // The 808 and 909 have different lanes in a different order; lining them up by index would
    // put a rimshot where a clap was and call it a paste.
    expect(canPasteFocus(wholeMachine, grooveboxFocus('tr808', '', false))).toBe(true)
    expect(canPasteFocus(wholeMachine, grooveboxFocus('tr909', '', false))).toBe(false)
  })

  it('takes a 303 line into either 303', () => {
    expect(canPasteFocus(line, grooveboxFocus('303.a', '', false))).toBe(true)
    expect(canPasteFocus(line, grooveboxFocus('303.b', '', false))).toBe(true)
  })

  it('has nothing to paste before anything is copied', () => {
    expect(canPasteFocus(null, grooveboxFocus('tr808', '', false))).toBe(false)
  })
})

describe('pasting', () => {
  const oneLane = copyFocus(drums(), grooveboxFocus('tr808', '808.bd', false))
  const wholeMachine = copyFocus(drums(), grooveboxFocus('tr808', '', true))

  it('puts a single lane on the selected lane and nowhere else', () => {
    const before = drums()
    const next = pasteFocus(before, oneLane, grooveboxFocus('tr808', '808.cp', false))
    expect(lanes(next, '808.cp').slice(0, 5)).toEqual([1, 0, 0, 0, 1])
    expect(next.tracks['808.sd']).toEqual(before.tracks['808.sd'])
  })

  it('still lands on the selected lane when the toggle is left on', () => {
    // The one behaviour change in this split. Before it, `lanes` began at the machine's first voice,
    // so this pasted over the bass drum while the button read "into whole 808".
    const next = pasteFocus(drums(), oneLane, grooveboxFocus('tr808', '808.cp', true))
    expect(lanes(next, '808.cp').slice(0, 5)).toEqual([1, 0, 0, 0, 1])
    expect(lanes(next, '808.sd').slice(0, 5)).toEqual([0, 0, 0, 0, 2])
    expect(pasteTitle(oneLane, grooveboxFocus('tr808', '808.cp', true))).toBe(
      'Paste Bass Drum into Clap',
    )
  })

  it('puts a whole machine back over the machine, toggle or not', () => {
    const emptied = clearFocus(drums(), grooveboxFocus('tr808', '', true))
    const next = pasteFocus(emptied, wholeMachine, grooveboxFocus('tr808', '808.cp', false))
    expect(lanes(next, '808.bd').slice(0, 5)).toEqual([1, 0, 0, 0, 1])
    expect(lanes(next, '808.sd').slice(0, 5)).toEqual([0, 0, 0, 0, 2])
    expect(lanes(next, '808.cp').slice(0, 3)).toEqual([0, 0, 1])
  })

  it('refuses a paste it cannot make, rather than half-making it', () => {
    const before = drums()
    expect(pasteFocus(before, wholeMachine, grooveboxFocus('tr909', '', false))).toBe(before)
    expect(pasteFocus(before, null, grooveboxFocus('tr808', '', false))).toBe(before)
  })

  it('pastes a 303 line into the other 303', () => {
    const line = copyFocus(bassline(), grooveboxFocus('303.a', '', false))
    const next = pasteFocus(bassline(), line, grooveboxFocus('303.b', '', false))
    expect(bassStepAt(next, '303.b', 0).note).toBe(7)
    expect(bassStepAt(next, '303.b', 0).accent).toBe(true)
  })
})

describe('what the paste button says when it cannot', () => {
  it('names both ends when it can', () => {
    const copied = copyFocus(drums(), grooveboxFocus('tr808', '808.sd', false))
    expect(pasteTitle(copied, grooveboxFocus('tr909', '909.cp', false))).toBe(
      'Paste Snare into Clap',
    )
  })

  it('explains the one restriction that exists', () => {
    const copied = copyFocus(drums(), grooveboxFocus('tr808', '', true))
    expect(pasteTitle(copied, grooveboxFocus('tr909', '', false))).toBe(
      'A whole-machine clipboard pastes into the same drum machine',
    )
  })

  it('asks for the right kind of copy on each machine', () => {
    expect(pasteTitle(null, grooveboxFocus('tr808', '', false))).toBe(
      'Copy a drum lane or machine first',
    )
    expect(pasteTitle(null, grooveboxFocus('303.a', '', false))).toBe('Copy a 303 line first')
  })

  it('asks again rather than offering a paste across the drum/303 line', () => {
    const line: FocusClipboard | null = copyFocus(bassline(), grooveboxFocus('303.a', '', false))
    expect(pasteTitle(line, grooveboxFocus('tr808', '', false))).toBe(
      'Copy a drum lane or machine first',
    )
  })
})
