import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Chassis } from './Chassis.js'
import { sizeFor } from './faceplates/index.js'
import { layout, type Layout, type Placement } from './layout.js'
import './rack.css'
import { useRack } from './store.js'

const PATCH: Patch = {
  modules: [
    { id: 'one', type: 'out' },
    { id: 'two', type: 'out' },
    { id: 'three', type: 'out' },
    { id: 'four', type: 'out' },
  ],
  cables: [],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let geometry: Layout

const moduleElement = (id: string) =>
  host.querySelector<HTMLElement>(`[data-module-id="${id}"]`)!
const face = () => host.querySelector<HTMLElement>('.rk-face')!

function screenPoint(placement: Placement, edge: 'start' | 'end') {
  const box = face().getBoundingClientRect()
  const x = edge === 'start' ? placement.x + 10 : placement.x + placement.width - 10
  const y = edge === 'start' ? placement.y + 10 : placement.y + placement.height - 10
  return {
    x: box.left + (x / geometry.width) * box.width,
    y: box.top + (y / geometry.height) * box.height,
  }
}

function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: { x: number; y: number },
  options: PointerEventInit = {},
) {
  flushSync(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 7,
        clientX: at.x,
        clientY: at.y,
        ...options,
      }),
    ),
  )
}

function dragFirstRow(options: PointerEventInit = {}) {
  const first = geometry.placements[0]
  const second = geometry.placements[1]
  pointer(moduleElement(first.id), 'pointerdown', screenPoint(first, 'start'), options)
  pointer(face(), 'pointermove', screenPoint(second, 'end'), options)
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
  // Synthetic pointer events are not registered as active pointers by the browser. The interaction is
  // delivered explicitly to the captured surface below; making capture a no-op keeps this a DOM test of
  // our gesture rather than a test of Chromium's trusted-event bookkeeping.
  vi.spyOn(HTMLDivElement.prototype, 'setPointerCapture').mockImplementation(() => undefined)
  flushSync(() => root.render(createElement(Chassis, { layout: geometry })))
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('rubber-band device selection', () => {
  it('keeps an unmoved press as the existing ordinary click', () => {
    const first = geometry.placements[0]
    const at = screenPoint(first, 'start')
    pointer(moduleElement(first.id), 'pointerdown', at)
    pointer(face(), 'pointerup', at)
    expect(useRack.getState().selection).toEqual(['one'])
  })

  it('selects both half-width devices touched by a live band', () => {
    dragFirstRow()
    expect(useRack.getState().selection).toEqual(['one', 'two'])

    const band = host.querySelector<HTMLElement>('.rk-selection-band')
    expect(band).toBeTruthy()
    expect(Number.parseFloat(band!.style.width)).toBeGreaterThan(0)
    expect(face().dataset.selecting).toBe('true')

    pointer(face(), 'pointerup', screenPoint(geometry.placements[1], 'end'))
    expect(host.querySelector('.rk-selection-band')).toBeNull()
  })

  it('adds band hits to the existing group with the platform modifier', () => {
    flushSync(() => useRack.getState().select('four'))
    dragFirstRow({ metaKey: true })
    expect(useRack.getState().selection).toEqual(['four', 'one', 'two'])
  })
})
