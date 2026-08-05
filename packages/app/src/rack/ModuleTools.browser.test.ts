import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Chassis } from './Chassis.js'
import { sizeFor } from './faceplates/index.js'
import { layout, type Layout } from './layout.js'
import './rack.css'
import { useRack } from './store.js'

// The module tools and the device patch browser are both anchored to the top-right corner of a faceplate,
// and for a while they were drawn on top of each other: selecting a module covered its own patch browser,
// and on a half-width panel it covered the port readout and the name as well. Nothing in a DOM test could
// have seen it — both elements existed, both had their labels, and `getBoundingClientRect` is only real
// once the stylesheet is.
//
// So these are geometric assertions in a browser, with `rack.css` loaded, and they are here for the same
// reason the z-index bug before it is written up in `RACK.md`: only driving the page finds this.

const PATCH: Patch = {
  modules: [
    // One of each width. The corner is tightest on the half-width panel — 240 units holds a name, a
    // readout, a browser and now a trigger — so a rule that fits there fits everywhere.
    { id: 'delay-1', type: 'delay' },
    { id: 'comp-1', type: 'compressor' },
  ],
  cables: [],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let geometry: Layout

const moduleElement = (id: string) => host.querySelector<HTMLElement>(`[data-module-id="${id}"]`)!
const within = <T extends Element>(id: string, selector: string) =>
  moduleElement(id).querySelector<T>(selector)

const click = (element: Element) => {
  flushSync(() => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
  flushSync(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
}

/** Whether two boxes share any pixel at all. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** Whether a control is the thing a pointer would actually hit in the middle of it. */
function reachable(element: Element): boolean {
  const box = element.getBoundingClientRect()
  const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return at === element || element.contains(at)
}

beforeEach(() => {
  useRack.getState().load(structuredClone(PATCH))
  geometry = layout(PATCH.modules, sizeFor(MODULES))
  host = document.createElement('div')
  host.style.position = 'relative'
  host.style.width = `${geometry.width}px`
  host.style.height = `${geometry.height}px`
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root.render(createElement(Chassis, { layout: geometry })))
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
})

describe('the module tools in a corner they share', () => {
  for (const id of ['delay-1', 'comp-1']) {
    it(`leaves the patch browser of ${id} visible and reachable while selected`, () => {
      flushSync(() => useRack.getState().select(id))

      const trigger = within(id, '.rk-module-tools-trigger')!
      const browser = within(id, '.rk-device-patches')!
      expect(trigger).toBeTruthy()
      expect(overlaps(trigger.getBoundingClientRect(), browser.getBoundingClientRect())).toBe(false)

      // Not merely uncovered: the drag grip is a transparent sheet across this whole strip, so both of
      // these have to win the hit test against it as well.
      expect(reachable(trigger)).toBe(true)
      expect(reachable(within(id, '.rk-device-name')!)).toBe(true)
      expect(reachable(within(id, '.rk-module-help-trigger')!)).toBe(true)
    })

    it(`keeps ${id}'s own name legible while it is selected`, () => {
      const name = within<HTMLElement>(id, '.rk-name')!
      const before = name.getBoundingClientRect().width
      flushSync(() => useRack.getState().select(id))
      expect(name.getBoundingClientRect().width).toBeCloseTo(before, 0)
      expect(name.scrollWidth).toBeLessThanOrEqual(Math.ceil(name.clientWidth))
    })

    it(`opens ${id}'s tools inside its own faceplate`, () => {
      flushSync(() => useRack.getState().select(id))
      click(within(id, '.rk-module-tools-trigger')!)

      const panel = within(id, '.rk-module-tools-panel')!
      expect(panel).toBeTruthy()
      const box = panel.getBoundingClientRect()
      const module = moduleElement(id).getBoundingClientRect()
      // A faceplate clips what overflows it, so a panel that escaped one would be a menu with its own
      // buttons cut off. It drops below the strip rather than over it, which is what keeps the browser
      // beside it usable while the tools are open.
      expect(box.left).toBeGreaterThanOrEqual(module.left)
      expect(box.right).toBeLessThanOrEqual(module.right)
      expect(box.bottom).toBeLessThanOrEqual(module.bottom)
      expect(overlaps(box, within(id, '.rk-device-patches')!.getBoundingClientRect())).toBe(false)
    })
  }

  it('has no trigger at all until the module is selected', () => {
    expect(within('delay-1', '.rk-module-tools-trigger')).toBeNull()
    flushSync(() => useRack.getState().select('delay-1'))
    expect(within('delay-1', '.rk-module-tools-trigger')).toBeTruthy()
    flushSync(() => useRack.getState().selectMany([]))
    expect(within('delay-1', '.rk-module-tools-trigger')).toBeNull()
  })

  it('stays open across a bypass, because comparing is why you press it', () => {
    flushSync(() => useRack.getState().select('delay-1'))
    click(within('delay-1', '.rk-module-tools-trigger')!)
    const bypass = within<HTMLButtonElement>('delay-1', '[aria-label="Bypass"]')!

    click(bypass)
    expect(useRack.getState().patch.modules[0].bypassed).toBe(true)
    expect(within('delay-1', '.rk-module-tools-panel')).toBeTruthy()
    expect(within('delay-1', '[aria-label="Bypass"]')!.getAttribute('aria-pressed')).toBe('true')

    click(within('delay-1', '[aria-label="Bypass"]')!)
    expect(useRack.getState().patch.modules[0].bypassed).toBeFalsy()
  })

  it('shuts on Escape and on a press outside it, and on doing something', () => {
    flushSync(() => useRack.getState().select('delay-1'))
    const open = () => click(within('delay-1', '.rk-module-tools-trigger')!)

    open()
    flushSync(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(within('delay-1', '.rk-module-tools-panel')).toBeNull()

    open()
    flushSync(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(within('delay-1', '.rk-module-tools-panel')).toBeNull()

    open()
    click(within('delay-1', '[aria-label="Duplicate"]')!)
    expect(useRack.getState().patch.modules).toHaveLength(3)
    expect(within('delay-1', '.rk-module-tools-panel')).toBeNull()
  })

  it('removes the whole group when the module is part of one', () => {
    flushSync(() => useRack.getState().selectMany(['delay-1', 'comp-1']))
    click(within('delay-1', '.rk-module-tools-trigger')!)
    const remove = within<HTMLButtonElement>('delay-1', '[aria-label="Remove 2 modules"]')!
    expect(remove).toBeTruthy()

    click(remove)
    expect(useRack.getState().patch.modules).toEqual([])
  })
})
