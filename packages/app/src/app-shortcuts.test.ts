import { describe, expect, it } from 'vitest'
import { appKeyDown, claimsKey } from './app-shortcuts.js'

// Six keys that were a ladder of `if`s inside a listener, including the fifth copy in this app of the
// rule about not stealing keys from fields. Two of the guards below are new; the comments say which.

const field = (tag: string) => ({ tagName: tag }) as unknown as EventTarget

const press = (over: Partial<Parameters<typeof appKeyDown>[0]> = {}) => ({
  key: 'a',
  ...over,
})

describe('the six keys', () => {
  it('starts and stops on the space bar, by physical key', () => {
    // The code rather than what it types, so a layout that puts something else there still has one.
    expect(appKeyDown(press({ key: ' ', code: 'Space' }), false)).toEqual({ kind: 'transport' })
  })

  it('opens the guide on ?', () => {
    expect(appKeyDown(press({ key: '?' }), false)).toEqual({ kind: 'help' })
  })

  it('toggles performance mode on v, in either case', () => {
    expect(appKeyDown(press({ key: 'v' }), false)).toEqual({ kind: 'performance' })
    expect(appKeyDown(press({ key: 'V' }), false)).toEqual({ kind: 'performance' })
  })

  it('changes the meter on x and the scene on c', () => {
    expect(appKeyDown(press({ key: 'x' }), false)).toEqual({ kind: 'scope' })
    expect(appKeyDown(press({ key: 'C' }), false)).toEqual({ kind: 'scene' })
  })

  it('ignores a key that means nothing here', () => {
    expect(appKeyDown(press({ key: 'q' }), false)).toBeNull()
    expect(appKeyDown(press({ key: 'ArrowUp' }), false)).toBeNull()
  })
})

describe('Escape, which is the one key that depends on where you are', () => {
  it('leaves performance mode', () => {
    expect(appKeyDown(press({ key: 'Escape' }), true)).toEqual({ kind: 'performance' })
  })

  it('means nothing outside it', () => {
    // Otherwise Escape would drop somebody into performance mode from the console, which is the
    // opposite of what a person pressing Escape wants.
    expect(appKeyDown(press({ key: 'Escape' }), false)).toBeNull()
  })
})

describe('keys that belong to somebody else', () => {
  it('leaves a field alone, in all three shapes', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(appKeyDown(press({ key: ' ', code: 'Space', target: field(tag) }), false)).toBeNull()
      expect(appKeyDown(press({ key: 'c', target: field(tag) }), false)).toBeNull()
    }
  })

  it('reaches the page from anywhere else', () => {
    expect(appKeyDown(press({ key: 'c', target: field('BUTTON') }), false)).toEqual({
      kind: 'scene',
    })
  })

  it('refuses an accelerator, which it did not before', () => {
    // v, x and c are the performance, scope and scene keys, so Cmd+C on a selection changed the visual
    // scene and Cmd+X changed the meter. Copying something off the page is not a request to redecorate.
    expect(appKeyDown(press({ key: 'c', metaKey: true }), false)).toBeNull()
    expect(appKeyDown(press({ key: 'x', ctrlKey: true }), false)).toBeNull()
    expect(appKeyDown(press({ key: 'v', metaKey: true }), false)).toBeNull()
    expect(appKeyDown(press({ key: ' ', code: 'Space', altKey: true }), false)).toBeNull()
  })

  it('refuses auto-repeat, which it did not before either', () => {
    // Space is the transport and the handler suppresses the browser's own scroll, so holding it down
    // toggled play and stop thirty times a second.
    expect(appKeyDown(press({ key: ' ', code: 'Space', repeat: true }), false)).toBeNull()
  })

  it('still takes ?, which is Shift and therefore not an accelerator', () => {
    expect(appKeyDown(press({ key: '?' }), false)).toEqual({ kind: 'help' })
  })
})

describe('what the browser keeps', () => {
  it('claims the two keys that would otherwise do something visible', () => {
    // Space scrolls the page; ? opens a find bar in some browsers.
    expect(claimsKey(appKeyDown(press({ key: ' ', code: 'Space' }), false))).toBe(true)
    expect(claimsKey(appKeyDown(press({ key: '?' }), false))).toBe(true)
  })

  it('leaves Escape alone, so a native dialog above this one still closes', () => {
    expect(claimsKey(appKeyDown(press({ key: 'Escape' }), true))).toBe(false)
  })

  it('leaves the three letter keys alone', () => {
    expect(claimsKey(appKeyDown(press({ key: 'v' }), false))).toBe(false)
    expect(claimsKey(appKeyDown(press({ key: 'x' }), false))).toBe(false)
    expect(claimsKey(appKeyDown(press({ key: 'c' }), false))).toBe(false)
    expect(claimsKey(null)).toBe(false)
  })
})
