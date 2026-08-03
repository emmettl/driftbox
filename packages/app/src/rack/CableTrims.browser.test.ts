import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackPanel } from './BackPanel.js'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { useRack } from './store.js'

// The trim as a person meets it: a pot on the back panel, dragged.
//
// Worth doing in a browser rather than against the store, because the two things most likely to be wrong
// are not arithmetic. One is that the control sits on top of a jack, and a pointerdown that reached the jack
// would start dragging a cable instead of turning a knob. The other is that a trim exists per *cable*, and
// getting the wiring wrong gives one control that turns all of them.

const PATCH: Patch = {
  modules: [
    { id: 'osc', type: 'vco' },
    { id: 'f', type: 'ladder' },
    { id: 'speaker', type: 'out' },
  ],
  cables: [
    { from: ['osc', 'out'], to: ['f', 'in'] },
    { from: ['f', 'out'], to: ['speaker', 'in'] },
  ],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render() {
  const geometry = layout(useRack.getState().patch.modules, sizeFor(MODULES))
  flushSync(() => root.render(createElement(BackPanel, { layout: geometry })))
}

/** The trim on the cable arriving at one inlet. */
function trim(moduleId: string, portId: string) {
  return [...host.querySelectorAll<SVGGElement>('.rk-trim')].find((node) =>
    node.getAttribute('aria-label')?.endsWith(`into ${moduleId} ${portId}`),
  )!
}

/**
 * Press on a control, capture and all.
 *
 * `setPointerCapture` throws in a real browser unless a live pointer of that id exists, and a dispatched
 * `PointerEvent` is not one. Stubbed on the node rather than faking the drag at a lower level, so the
 * component's own handler is the thing under test.
 */
function press(node: SVGGElement, clientY: number) {
  const target = node as unknown as { setPointerCapture: unknown; releasePointerCapture: unknown }
  target.setPointerCapture = () => {}
  target.releasePointerCapture = () => {}
  flushSync(() => node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY })))
}

/** Drag one vertically by `by` pixels — up is more. */
function drag(node: SVGGElement, by: number) {
  press(node, 200)
  flushSync(() =>
    node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 200 - by })),
  )
  flushSync(() => node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })))
}

beforeEach(() => {
  useRack.getState().load(structuredClone(PATCH))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
})

describe('the trim on the back panel', () => {
  it('gives one to every occupied inlet, and none to an empty one', () => {
    render()
    expect(host.querySelectorAll('.rk-trim')).toHaveLength(2)
    // The VCO's pitch inlet has no cable, so it has no trim — an empty rack carries no furniture.
    expect(
      [...host.querySelectorAll('.rk-trim')].some((node) =>
        node.getAttribute('aria-label')?.endsWith('into osc pitch'),
      ),
    ).toBe(false)
  })

  it('reads as unity before anybody turns it', () => {
    render()
    expect(trim('f', 'in').getAttribute('aria-valuenow')).toBe('1')
  })

  it('turns down when dragged down', () => {
    render()
    drag(trim('f', 'in'), -40)
    const value = useRack.getState().patch.cables[0].trim!
    expect(value).toBeLessThan(1)
    expect(value).toBeGreaterThan(-1)
  })

  it('reaches the far side of unity, which is what makes it an attenuverter', () => {
    render()
    // Far enough to cross zero. An attenuator would stop there; this is the half of the range that
    // replaces an inline Offset at gain −1.
    drag(trim('f', 'in'), -400)
    expect(useRack.getState().patch.cables[0].trim).toBe(-1)
  })

  it('turns one cable and leaves the other alone', () => {
    render()
    drag(trim('speaker', 'in'), -40)
    expect(useRack.getState().patch.cables[0].trim).toBeUndefined()
    expect(useRack.getState().patch.cables[1].trim).toBeLessThan(1)
  })

  it('does not start a cable drag from the jack underneath it', () => {
    // The control sits on the inlet. A pointerdown reaching the panel would arm a cable instead of a knob,
    // and the first thing anybody did with a trim would be to unplug something.
    render()
    const panel = host.querySelector<SVGSVGElement>('[data-dragging]')!
    press(trim('f', 'in'), 200)
    expect(panel.getAttribute('data-dragging')).toBe('')
  })

  it('takes the trim off on a double click, cable and all still patched', () => {
    render()
    drag(trim('f', 'in'), -40)
    expect(useRack.getState().patch.cables[0].trim).toBeDefined()
    flushSync(() =>
      trim('f', 'in').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    )
    expect('trim' in useRack.getState().patch.cables[0]).toBe(false)
    expect(useRack.getState().patch.cables).toHaveLength(2)
  })

  it('moves on the arrow keys, because a rack has to be playable without a pointer', () => {
    // The same standard the jacks hold themselves to: "a modular whose whole point is the cables is a
    // poor thing to make mouse-only".
    render()
    flushSync(() =>
      trim('f', 'in').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    )
    expect(useRack.getState().patch.cables[0].trim).toBeCloseTo(0.9, 5)
  })

  it('unplugs nothing when Delete lands on the trim rather than the jack', () => {
    // The back panel binds Delete at a jack to removing the cable. On the trim it means the smaller thing.
    render()
    drag(trim('f', 'in'), -40)
    flushSync(() =>
      trim('f', 'in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })),
    )
    expect(useRack.getState().patch.cables).toHaveLength(2)
    expect('trim' in useRack.getState().patch.cables[0]).toBe(false)
  })

  it('marks a trim that is away from unity, and only then', () => {
    render()
    expect(trim('f', 'in').classList.contains('rk-trim-on')).toBe(false)
    drag(trim('f', 'in'), -40)
    expect(trim('f', 'in').classList.contains('rk-trim-on')).toBe(true)
  })

  it('leaves a trim of exactly one unmarked, because it is doing nothing', () => {
    render()
    flushSync(() => useRack.getState().setTrim(useRack.getState().patch.cables[0], 1))
    expect(trim('f', 'in').classList.contains('rk-trim-on')).toBe(false)
  })
})
