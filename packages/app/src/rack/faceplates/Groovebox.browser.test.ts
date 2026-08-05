import {
  SONGS,
  encodeSong,
  trackLength,
  type Pattern,
  type Song,
} from '@driftbox/engine'
import { createElement, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { GrooveboxPatternEditor } from './Groovebox.js'

// The toggle, driven the way a person drives it.
//
// `groovebox-focus.test.ts` proves the rules — that "whole 808" means eleven lanes and that a one-lane
// paste lands on the selected lane — but a rule nothing is wired to is not a behaviour. These claims are
// about the wiring: that the toggle reaches the label above the buttons, that the label and the edit
// beneath it agree, and that a copy taken with the toggle in one position pastes according to where the
// toggle is when the paste happens rather than where it was.

const seed = (): Song => SONGS[0].build()

let host: HTMLElement | null = null
let root: ReturnType<typeof createRoot> | null = null
let edits: Pattern[] = []

/** The editor wired to a song that actually changes, the way the store wires it. */
function Harness() {
  const [song, setSong] = useState<Song>(seed)
  return createElement(GrooveboxPatternEditor, {
    encoded: encodeSong(song),
    setPattern: (pattern: Pattern) => {
      edits.push(pattern)
      setSong((current) => ({
        ...current,
        patterns: current.patterns.map((candidate) =>
          candidate.id === pattern.id ? pattern : candidate,
        ),
      }))
    },
    setClip: () => {},
    setVoiceParam: () => {},
    setBassParam: () => {},
    setFlamWidth: () => {},
    setSwing: () => {},
    setVoiceSwing: () => {},
    setSend: () => {},
    setFx: () => {},
    toggleTapRecording: () => {},
    setTapTarget: () => {},
    toggleAutomationRecording: () => {},
    clearAutomation: () => {},
  })
}

function mount() {
  edits = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root!.render(createElement(Harness)))
}

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

const find = <T extends HTMLElement>(selector: string): T => {
  const found = host!.querySelector<T>(selector)
  if (!found) throw new Error(`nothing matched ${selector}`)
  return found
}

const byLabel = <T extends HTMLElement>(label: string): T => find<T>(`[aria-label="${label}"]`)

/** The "lane"/"all" button, which is the only control in here without a label of its own. */
const toggle = (): HTMLButtonElement => {
  const tools = byLabel('Groovebox pattern transforms')
  const found = [...tools.querySelectorAll('button')].find(
    (button) => button.textContent === 'lane' || button.textContent === 'all',
  )
  if (!found) throw new Error('no whole-machine toggle')
  return found
}

const click = (element: HTMLElement) => flushSync(() => element.click())

const choose = (select: HTMLSelectElement, value: string) =>
  flushSync(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

/** React tracks an input's value itself, so a plain assignment looks like no change at all. */
const type = (input: HTMLInputElement, value: string) =>
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

/** What the transform and clipboard rows say they are about to act on. */
const promised = () => byLabel('Groovebox pattern transforms').querySelector('strong')!.textContent

const lastEdit = () => edits[edits.length - 1]

describe('the whole-machine toggle, as a person meets it', () => {
  it('starts on one lane and names it', () => {
    mount()
    expect(toggle().textContent).toBe('lane')
    expect(promised()).toBe('Bass Drum')
    expect(byLabel('Groovebox focused clipboard').querySelector('strong')!.textContent).toBe(
      'Bass Drum',
    )
  })

  it('changes what every button in both rows says, together', () => {
    mount()
    click(toggle())

    expect(toggle().textContent).toBe('all')
    expect(promised()).toBe('whole 808')
    // The rotate buttons, the cut and the copy all have to move with it, or one of them lies.
    expect(byLabel('Rotate whole 808 right')).toBeTruthy()
    expect(byLabel('Cut whole 808')).toBeTruthy()
    expect(byLabel('Copy whole 808')).toBeTruthy()
  })

  it('follows the voice selector when it is off', () => {
    mount()
    choose(byLabel<HTMLSelectElement>('Drum voice to edit'), '808.cp')
    expect(promised()).toBe('Clap')
    expect(byLabel('Rotate Clap left')).toBeTruthy()
  })

  it('is not offered on a 303, which has one lane', () => {
    mount()
    choose(byLabel<HTMLSelectElement>('Machine to edit'), '303.a')
    expect(promised()).toBe('303 A')
    expect(() => toggle()).toThrow()
  })
})

describe('what the rows then do', () => {
  it('rotates only the named lane with the toggle off', () => {
    mount()
    const before = seed().patterns[0]
    click(byLabel('Rotate Bass Drum right'))

    const next = lastEdit()
    expect(next.tracks['808.bd']).not.toEqual(before.tracks['808.bd'])
    expect(next.tracks['808.sd']).toEqual(before.tracks['808.sd'])
  })

  it('rotates every lane of the machine once it says "whole"', () => {
    mount()
    const before = seed().patterns[0]
    click(toggle())
    click(byLabel('Rotate whole 808 right'))

    const next = lastEdit()
    const moved = Object.keys(before.tracks).filter(
      (id) => id.startsWith('808.') && !arraysEqual(before.tracks[id], next.tracks[id]),
    )
    // More than the one lane the off position would have moved.
    expect(moved.length).toBeGreaterThan(1)
  })

  it('empties the whole machine on a cut, and says what it took', () => {
    mount()
    click(toggle())
    click(byLabel('Cut whole 808'))

    const next = lastEdit()
    for (const id of Object.keys(seed().patterns[0].tracks)) {
      if (id.startsWith('808.')) expect(next.tracks[id]).toBeUndefined()
    }
    expect(byLabel('Groovebox focused clipboard').textContent).toContain('whole 808 copied')
  })

  it('leaves the other machine alone while it does it', () => {
    mount()
    const before = seed().patterns[0]
    click(toggle())
    click(byLabel('Cut whole 808'))

    for (const id of Object.keys(before.tracks)) {
      if (id.startsWith('909.')) expect(lastEdit().tracks[id]).toEqual(before.tracks[id])
    }
  })
})

describe('copying one lane and pasting it somewhere else', () => {
  it('pastes into the lane the selector is on, not the one it was copied from', () => {
    mount()
    click(byLabel('Copy Bass Drum'))
    const copied = seed().patterns[0].tracks['808.bd']

    choose(byLabel<HTMLSelectElement>('Drum voice to edit'), '808.cp')
    expect(byLabel<HTMLButtonElement>('Paste into Clap').disabled).toBe(false)
    click(byLabel('Paste into Clap'))

    expect(lastEdit().tracks['808.cp']?.slice(0, copied.length)).toEqual([...copied])
  })

  it('pastes into the selected lane even with the toggle left on', () => {
    mount()
    click(byLabel('Copy Bass Drum'))
    const copied = seed().patterns[0].tracks['808.bd']

    choose(byLabel<HTMLSelectElement>('Drum voice to edit'), '808.cp')
    click(toggle())
    // The button says "whole 808", but a one-lane clipboard has one destination and names it.
    expect(byLabel<HTMLButtonElement>('Paste into whole 808').title).toBe(
      'Paste Bass Drum into Clap',
    )
    click(byLabel('Paste into whole 808'))

    expect(lastEdit().tracks['808.cp']?.slice(0, copied.length)).toEqual([...copied])
    expect(lastEdit().tracks['808.sd']).toEqual(seed().patterns[0].tracks['808.sd'])
  })

  it('refuses a whole-machine clipboard on the other machine, and explains why', () => {
    mount()
    click(toggle())
    click(byLabel('Copy whole 808'))

    choose(byLabel<HTMLSelectElement>('Machine to edit'), 'tr909')
    const paste = byLabel<HTMLButtonElement>('Paste into whole 909')
    expect(paste.disabled).toBe(true)
    expect(paste.title).toBe('A whole-machine clipboard pastes into the same drum machine')
  })

  it('refuses a drum lane on a 303 rather than pasting something shaped wrong', () => {
    mount()
    click(byLabel('Copy Bass Drum'))

    choose(byLabel<HTMLSelectElement>('Machine to edit'), '303.b')
    expect(byLabel<HTMLButtonElement>('Paste into 303 B').disabled).toBe(true)
    expect(byLabel<HTMLButtonElement>('Paste into 303 B').title).toBe('Copy a 303 line first')
  })
})

describe('a drum lane shorter than the pattern around it', () => {
  it('draws its steps past the end as outside the lane rather than as silent ones', () => {
    mount()
    type(byLabel<HTMLInputElement>('Drum lane steps'), '4')

    expect(trackLength(lastEdit(), '808.bd')).toBe(4)
    expect(byLabel('Bass Drum step 8: outside 4-step lane')).toBeTruthy()
    expect(byLabel<HTMLButtonElement>('Bass Drum step 8: outside 4-step lane').disabled).toBe(
      true,
    )
  })
})

function arraysEqual(a: readonly number[] | undefined, b: readonly number[] | undefined) {
  if (!a || !b) return a === b
  return a.length === b.length && a.every((value, index) => value === b[index])
}
