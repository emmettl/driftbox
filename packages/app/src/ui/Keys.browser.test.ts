import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Keys } from './Keys.js'
import { useBox } from '../store.js'

// The rules are proved in `keys-shortcuts.test.ts` and `keys-hold.test.ts`; these claims are about the
// listener that carries them. A predicate nothing is wired to is not a behaviour, and the wiring is
// exactly where the field guard used to live as an inline array literal — a page-level `keydown` that
// plays notes is either attached correctly or it makes the app unusable to type in.

let host: HTMLElement | null = null
let root: ReturnType<typeof createRoot> | null = null

function mount() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root!.render(createElement(Keys)))
}

afterEach(() => {
  flushSync(() => window.dispatchEvent(new Event('blur')))
  root?.unmount()
  host?.remove()
  root = null
  host = null
  useBox.setState({ view: 'tr808' })
})

const key = (label: string): HTMLButtonElement => {
  const found = host!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  if (!found) throw new Error(`no key labelled ${label}`)
  return found
}

const lit = (label: string) => key(label).classList.contains('on')

const board = () => host!.querySelector<HTMLElement>('.keys')!

const send = (
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit,
  target: EventTarget = window,
) => flushSync(() => target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init })))

describe('the computer keyboard, attached to the page', () => {
  it('lights the key it plays, and puts the panel into its sounding state', () => {
    mount()
    expect(lit('A, key a')).toBe(false)

    send('keydown', { key: 'a' })
    expect(lit('A, key a')).toBe(true)
    expect(board().classList.contains('sounding')).toBe(true)
  })

  it('puts it out again on the way up', () => {
    mount()
    send('keydown', { key: 'a' })
    send('keyup', { key: 'a' })

    expect(lit('A, key a')).toBe(false)
    expect(board().classList.contains('sounding')).toBe(false)
  })

  it('holds several at once, because the grid shows every finger down', () => {
    mount()
    send('keydown', { key: 'a' })
    send('keydown', { key: 'g' })

    expect(lit('A, key a')).toBe(true)
    expect(lit('E, key g')).toBe(true)
  })

  it('keeps the older key lit when the newer one is released', () => {
    mount()
    send('keydown', { key: 'a' })
    send('keydown', { key: 'g' })
    send('keyup', { key: 'g' })

    // The audible half of this — falling back rather than going silent — is `keys-hold.test.ts`.
    expect(lit('A, key a')).toBe(true)
    expect(lit('E, key g')).toBe(false)
  })
})

describe('keys that are not the keyboard', () => {
  it('never steals one from a field somebody is typing in', () => {
    mount()
    const field = document.createElement('input')
    host!.append(field)

    send('keydown', { key: 'a' }, field)
    // Without this guard, naming a pattern plays a tune and writes nothing.
    expect(lit('A, key a')).toBe(false)
  })

  it('leaves a select alone too, which also consumes typed characters', () => {
    mount()
    const select = document.createElement('select')
    host!.append(select)

    send('keydown', { key: 'd' }, select)
    expect(lit('C, key d')).toBe(false)
  })

  it('ignores auto-repeat rather than retriggering thirty times a second', () => {
    mount()
    send('keydown', { key: 'a' })
    send('keydown', { key: 'a', repeat: true })

    expect(lit('A, key a')).toBe(true)
  })

  it('leaves an accelerator to the page', () => {
    mount()
    send('keydown', { key: 'a', metaKey: true })
    expect(lit('A, key a')).toBe(false)
  })
})

describe('moving the grid', () => {
  it('shifts an octave on x, and stops at the top', () => {
    mount()
    const readout = () => host!.querySelector('.keys-octave span')!.textContent

    expect(readout()).toBe('0')
    send('keydown', { key: 'x' })
    expect(readout()).toBe('+1')
    // One octave is as far as the grid goes; notes run 0..24.
    send('keydown', { key: 'x' })
    expect(readout()).toBe('+1')
  })

  it('shifts back down on z, and stops at the bottom', () => {
    mount()
    const readout = () => host!.querySelector('.keys-octave span')!.textContent

    send('keydown', { key: 'z' })
    expect(readout()).toBe('-1')
    send('keydown', { key: 'z' })
    expect(readout()).toBe('-1')
  })

  it('plays the shifted note, keeping the key lit under the same letter', () => {
    mount()
    send('keydown', { key: 'x' })
    send('keydown', { key: 'a' })

    // `a` is still an A, an octave up, and it is the shifted semitone that lights.
    expect(lit('A, key a')).toBe(true)
  })
})

describe('losing focus mid-phrase', () => {
  it('releases everything, because a held key sends no key-up once focus has gone', () => {
    mount()
    send('keydown', { key: 'a' })
    send('keydown', { key: 'g' })

    flushSync(() => window.dispatchEvent(new Event('blur')))

    expect(lit('A, key a')).toBe(false)
    expect(lit('E, key g')).toBe(false)
    expect(board().classList.contains('sounding')).toBe(false)
  })
})
