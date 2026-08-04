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
})
