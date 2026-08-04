import type { Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_HISTORY } from './history.js'
import { AutomationDesk } from './AutomationDesk.js'
import { useRack } from './store.js'

const PATCH: Patch = {
  modules: [
    { id: 'filter', type: 'ladder' },
    { id: 'output', type: 'out' },
  ],
  cables: [],
  automation: [
    { target: ['filter', 'cutoff'], points: [{ at: 0, value: 400 }, { at: 16, value: 2000 }] },
    { target: ['output', 'mute'], curve: 'hold', points: [{ at: 8, value: 1 }] },
  ],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  useRack.setState({ patch: structuredClone(PATCH), history: NO_HISTORY })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
})

describe('rack automation desk', () => {
  it('shows recorded curves and clears lanes through undoable store edits', () => {
    flushSync(() => root.render(createElement(AutomationDesk, { onClose: vi.fn() })))
    const dialog = document.querySelector<HTMLElement>('.rk-auto-desk')!
    expect(dialog).toBeTruthy()
    expect(dialog.querySelectorAll('.rk-auto-row')).toHaveLength(2)
    expect(dialog.querySelectorAll('.rk-auto-curve path')).toHaveLength(2)

    flushSync(() => dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Clear Cutoff automation on Ladder filter"]',
    )!.click())
    expect(useRack.getState().patch.automation).toHaveLength(1)
    expect(dialog.querySelectorAll('.rk-auto-row')).toHaveLength(1)

    flushSync(() => [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Clear all automation',
    )!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(useRack.getState().patch.automation).toBeUndefined()
    expect(dialog.querySelector('.rk-auto-empty')).toBeTruthy()

    flushSync(() => useRack.getState().undo())
    expect(useRack.getState().patch.automation).toHaveLength(1)
  })

  it('edits point values, curves, and individual points', () => {
    flushSync(() => root.render(createElement(AutomationDesk, { onClose: vi.fn() })))
    const dialog = document.querySelector<HTMLElement>('.rk-auto-desk')!
    flushSync(() => dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Edit Cutoff automation on Ladder filter"]',
    )!.click())

    const value = dialog.querySelector<HTMLInputElement>('[aria-label="Value at 1.1 for Cutoff"]')!
    value.value = '3000'
    flushSync(() => value.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(useRack.getState().patch.automation?.[0].points[0].value).toBe(3000)

    flushSync(() => [...dialog.querySelectorAll<HTMLButtonElement>('.rk-auto-curve-choice button')]
      .find((button) => button.textContent === 'Hold')!.click())
    expect(useRack.getState().patch.automation?.[0].curve).toBe('hold')
    expect(dialog.querySelector<HTMLButtonElement>('.rk-auto-curve-choice button[aria-pressed="true"]')
      ?.textContent).toBe('Hold')

    flushSync(() => dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Remove Cutoff point at 1.1"]',
    )!.click())
    expect(useRack.getState().patch.automation?.[0].points).toEqual([{ at: 16, value: 2000 }])
    expect(dialog.querySelectorAll('.rk-auto-point')).toHaveLength(1)
  })

  it('adds a point and moves it by musical position', () => {
    flushSync(() => root.render(createElement(AutomationDesk, { onClose: vi.fn() })))
    const dialog = document.querySelector<HTMLElement>('.rk-auto-desk')!
    flushSync(() => dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Edit Cutoff automation on Ladder filter"]',
    )!.click())

    flushSync(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Add point after 2.1'))!.click())
    expect(useRack.getState().patch.automation?.[0].points).toEqual([
      { at: 0, value: 400 },
      { at: 16, value: 2000 },
      { at: 17, value: 2000 },
    ])

    const position = dialog.querySelector<HTMLInputElement>(
      '[aria-label="Position for Cutoff point at 2.2"]',
    )!
    position.value = '1.9'
    flushSync(() => position.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(useRack.getState().patch.automation?.[0].points).toEqual([
      { at: 0, value: 400 },
      { at: 8, value: 2000 },
      { at: 16, value: 2000 },
    ])
    expect(dialog.querySelector<HTMLInputElement>(
      '[aria-label="Position for Cutoff point at 1.9"]',
    )).toBeTruthy()
  })

  it('draws a snapped pencil stroke as one undo step', () => {
    flushSync(() => root.render(createElement(AutomationDesk, { onClose: vi.fn() })))
    const dialog = document.querySelector<HTMLElement>('.rk-auto-desk')!
    flushSync(() => dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Edit Cutoff automation on Ladder filter"]',
    )!.click())

    const pencil = dialog.querySelector<SVGSVGElement>('.rk-auto-pencil')!
    vi.spyOn(pencil, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 100,
      width: 320,
      height: 100,
      toJSON: () => ({}),
    })
    let captured = false
    Object.defineProperties(pencil, {
      setPointerCapture: { value: () => { captured = true } },
      hasPointerCapture: { value: () => captured },
      releasePointerCapture: { value: () => { captured = false } },
    })

    flushSync(() => {
      pencil.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 80,
        clientY: 50,
      }))
      pencil.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        buttons: 1,
        clientX: 100,
        clientY: 25,
      }))
      pencil.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    })

    expect(useRack.getState().patch.automation?.[0].points.map((point) => point.at)).toEqual([
      0, 8, 9, 10, 16,
    ])
    expect(useRack.getState().history.past).toHaveLength(1)
    flushSync(() => useRack.getState().undo())
    expect(useRack.getState().patch.automation?.[0].points).toEqual([
      { at: 0, value: 400 },
      { at: 16, value: 2000 },
    ])
  })

  it('locks stepped parameters to hold curves', () => {
    flushSync(() => root.render(createElement(AutomationDesk, { onClose: vi.fn() })))
    const dialog = document.querySelector<HTMLElement>('.rk-auto-desk')!
    flushSync(() => dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Edit Mute automation on Out output"]',
    )!.click())
    const choices = dialog.querySelectorAll<HTMLButtonElement>('.rk-auto-curve-choice button')
    expect(choices[0].textContent).toBe('Linear')
    expect(choices[0].disabled).toBe(true)
    expect(choices[1].getAttribute('aria-pressed')).toBe('true')
  })
})
