import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRack } from '../store.js'
import { Arp } from './Arp.js'

const PATCH: Patch = { modules: [{ id: 'arp', type: 'arp' }], cables: [] }
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render() {
  const def = MODULES.arp
  const module = useRack.getState().patch.modules[0]
  flushSync(() => root.render(createElement(Arp, {
    def,
    module,
    value: (id: string) => useRack.getState().paramValue(module.id, id),
    onChange: (id: string, value: number) => useRack.getState().setParam(module.id, id, value),
  })))
}

function choose(group: string, label: string) {
  const field = host.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${group}"]`)
  const control = [...(field?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  expect(control, `${group}: ${label}`).toBeTruthy()
  flushSync(() => control!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  useRack.getState().load(structuredClone(PATCH))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  render()
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
})

it('switches to played-chord collection and Hold without rebuilding the graph', () => {
  const before = useRack.getState().revision
  choose('Source', 'Played')
  choose('Hold', 'On')
  expect(useRack.getState().paramValue('arp', 'source')).toBe(1)
  expect(useRack.getState().paramValue('arp', 'hold')).toBe(1)
  expect(useRack.getState().revision).toBe(before)
})

it('stores muted rhythm steps as portable module data', () => {
  const second = host.querySelector<HTMLButtonElement>('[aria-label^="Step 2 enabled"]')
  expect(second).toBeTruthy()
  flushSync(() => second!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(useRack.getState().data('arp', 'pattern')).toEqual([
    1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  ])
})

it('keeps timing and pattern length on ordinary routed params', () => {
  choose('Timing', 'Tempo')
  const shorter = host.querySelector<HTMLButtonElement>('button[aria-label="Pattern Steps down"]')
  expect(shorter).toBeTruthy()
  flushSync(() => shorter!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(useRack.getState().paramValue('arp', 'timing')).toBe(1)
  expect(useRack.getState().paramValue('arp', 'patternLength')).toBe(15)
})

it('keeps Insert on the ordinary routed parameter path', () => {
  const higher = host.querySelector<HTMLButtonElement>('button[aria-label="Insert up"]')
  expect(higher).toBeTruthy()
  flushSync(() => higher!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(useRack.getState().paramValue('arp', 'insert')).toBe(1)
})

it('can disable single-note retriggering without rebuilding the graph', () => {
  const before = useRack.getState().revision
  choose('Single Note Repeat', 'Off')
  expect(useRack.getState().paramValue('arp', 'singleRepeat')).toBe(0)
  expect(useRack.getState().revision).toBe(before)
})
