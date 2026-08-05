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

// The title strip has two tenants and only one of them is in normal flow.
//
// The faceplate draws the strip — a name, and at the right-hand end a readout, which on a generic
// faceplate is the module's own "2 in · 1 out". The Chassis draws the patch browser into the same corner
// from outside the faceplate, absolutely positioned. Nothing in flow knew the browser was there, so every
// readout in the rack was rendered underneath it: "Custom 2 in · 1 out", the two strings overlapping
// character for character, which is how the bug arrived — in a photograph of a phone.
//
// The fix is one number, `--rk-browser` in `rack.css`, that the browser is sized from and the title
// reserves. That makes this a geometry test and only a geometry test: it needs real CSS, real fonts and
// real layout, which is why it lives in the browser project. A unit test could only assert that the
// number is the number.
//
// Every module type, not a sample. The readouts are per-faceplate strings of unrelated lengths and the
// two spans have different room, so the ones that collide are exactly the ones nobody thought to look at:
// a Delay's twelve characters clear the browser by 8px, and a Ping-Pong Delay's do not clear it at all.

const PATCH: Patch = {
  modules: Object.keys(MODULES).map((type, index) => ({ id: `m${index}`, type })),
  cables: [],
}

interface Tenant {
  module: string
  text: string
  /** The module's own name, as opposed to a readout beside it. The two lose room in a fixed order. */
  isName: boolean
  el: HTMLElement
  browser: HTMLElement
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let geometry: Layout

/** Everything in a module's title strip that carries text, paired with the browser drawn over it. */
function tenants(): Tenant[] {
  return [...host.querySelectorAll<HTMLElement>('.rk-module')].flatMap((module) => {
    const browser = module.querySelector<HTMLElement>('.rk-device-patches')
    const title = module.querySelector<HTMLElement>('.rk-title')
    if (!browser || !title) return []
    return [...title.children]
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .filter((child) => (child.textContent ?? '').trim().length > 0)
      .map((child) => ({
        module: module.getAttribute('data-module-type') ?? '?',
        text: (child.textContent ?? '').trim(),
        isName: child.classList.contains('rk-name'),
        el: child,
        browser,
      }))
  })
}

/** How far two boxes run through each other. They share a row, so the horizontal span is the whole story. */
function overlap(a: DOMRect, b: DOMRect) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left)
}

/** How much text an element is too narrow to show — what the ellipsis is standing in for. */
function cutBy(el: HTMLElement) {
  return el.scrollWidth - el.clientWidth
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

describe('the title strip and the patch browser over it', () => {
  it('draws a strip and a browser for every module type in the build', () => {
    // Guards the test rather than the app: a rack that rendered nothing would pass everything below by
    // having nothing left to check.
    expect(tenants().length).toBeGreaterThan(Object.keys(MODULES).length)
  })

  it('never prints title text under the browser', () => {
    const collisions = tenants()
      .map((tenant) => ({
        module: tenant.module,
        text: tenant.text,
        by: Math.round(
          overlap(tenant.el.getBoundingClientRect(), tenant.browser.getBoundingClientRect()),
        ),
      }))
      .filter((tenant) => tenant.by > 0)
      .map((tenant) => `${tenant.module}: "${tenant.text}" under the browser by ${tenant.by}px`)
    expect(collisions).toEqual([])
  })

  it('keeps every readout whole, and takes what that costs out of the name', () => {
    // Which tenant gives way, asserted rather than left to whatever the flex defaults happen to do.
    // Half of "2 in · 1 out" is not a smaller truth, it is a wrong one, so the readout is never the one
    // that is cut. A shortened name still names the module it is sitting on top of.
    const cut = tenants()
      .filter((tenant) => cutBy(tenant.el) > 1 && !tenant.isName)
      .map((tenant) => `${tenant.module}: "${tenant.text}"`)
    expect(cut).toEqual([])
  })

  it('leaves the names alone on every module with the room for one', () => {
    // The reserve is not free and this is the bill, itemised: a half-width module with a long name pays
    // for its readout out of the name. Listed rather than counted so that a reserve which grew until it
    // started eating ordinary titles is a failing test, and not something to spot in a screenshot.
    const cut = tenants()
      .filter((tenant) => cutBy(tenant.el) > 1)
      .map((tenant) => tenant.module)
      .sort()
    expect(cut).toEqual(['imager', 'limiter', 'ping-pong', 'quantizer', 'tuner', 'wavetable'])
  })
})
