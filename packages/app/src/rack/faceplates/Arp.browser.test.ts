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
