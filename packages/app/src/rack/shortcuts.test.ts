import { describe, expect, it } from 'vitest'
import { historyIntent, isFlipKey, isFormControl, isHelpKey, isTextEntry } from './shortcuts.js'

// The rule under all of these is the same one: a keystroke aimed at a field belongs to the field. Getting
// it wrong in the undo direction is the worst version — Cmd+Z inside a rename box would undo a patch edit
// instead of the typing, which reads as "it deleted what I wrote" and cannot be reproduced by anybody who
// was not typing at the time.

/** Just enough of a browser event to answer the question. */
const on = (tagName: string) => ({ tagName }) as unknown as EventTarget

const key = (
  init: Partial<{ key: string; target: EventTarget | null; meta: boolean; ctrl: boolean; shift: boolean }>,
) => ({
  key: init.key ?? 'z',
  target: init.target ?? null,
  metaKey: init.meta ?? false,
  ctrlKey: init.ctrl ?? false,
  shiftKey: init.shift ?? false,
})

describe('what counts as somebody typing', () => {
  it('is a text field, and not the page around it', () => {
    expect(isTextEntry(on('INPUT'))).toBe(true)
    expect(isTextEntry(on('TEXTAREA'))).toBe(true)
    expect(isTextEntry(on('BUTTON'))).toBe(false)
    expect(isTextEntry(on('DIV'))).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })

  it('includes a select only where a typed character does something to it', () => {
    // A select jumps to a matching option as you type, so `?` belongs to it; Tab and Cmd+Z do not.
    expect(isFormControl(on('SELECT'))).toBe(true)
    expect(isTextEntry(on('SELECT'))).toBe(false)
  })
})

describe('the help key', () => {
  it('opens the guide from the page, and never out of a field', () => {
    expect(isHelpKey({ key: '?', target: on('DIV') })).toBe(true)
    expect(isHelpKey({ key: '?', target: on('INPUT') })).toBe(false)
    expect(isHelpKey({ key: '?', target: on('SELECT') })).toBe(false)
    expect(isHelpKey({ key: '/', target: on('DIV') })).toBe(false)
  })
})

describe('the flip key', () => {
  it('turns the rack, but leaves a rename field its tab stop', () => {
    expect(isFlipKey({ key: 'Tab', target: on('DIV') })).toBe(true)
    expect(isFlipKey({ key: 'Tab', target: on('INPUT') })).toBe(false)
    expect(isFlipKey({ key: 'Tab', target: on('TEXTAREA') })).toBe(false)
    expect(isFlipKey({ key: 'a', target: on('DIV') })).toBe(false)
  })
})

describe('undo and redo', () => {
  it('accepts both accents, on the keys every other program uses', () => {
    expect(historyIntent(key({ key: 'z', meta: true }))).toBe('undo')
    expect(historyIntent(key({ key: 'z', ctrl: true }))).toBe('undo')
    expect(historyIntent(key({ key: 'z', meta: true, shift: true }))).toBe('redo')
    // Ctrl+Y is what Windows habits reach for.
    expect(historyIntent(key({ key: 'y', ctrl: true }))).toBe('redo')
    // Shifted or not, an unmodified key is somebody typing a letter.
    expect(historyIntent(key({ key: 'z' }))).toBeNull()
    expect(historyIntent(key({ key: 'y' }))).toBeNull()
  })

  it('reads a capital Z as the same key', () => {
    expect(historyIntent(key({ key: 'Z', meta: true, shift: true }))).toBe('redo')
  })

  it('ignores every other accented key', () => {
    expect(historyIntent(key({ key: 's', meta: true }))).toBeNull()
    expect(historyIntent(key({ key: 'a', ctrl: true }))).toBeNull()
  })

  it('leaves a field its own undo history', () => {
    expect(historyIntent(key({ key: 'z', meta: true, target: on('INPUT') }))).toBeNull()
    expect(historyIntent(key({ key: 'y', ctrl: true, target: on('TEXTAREA') }))).toBeNull()
  })
})
