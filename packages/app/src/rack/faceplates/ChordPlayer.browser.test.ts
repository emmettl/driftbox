import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRack } from '../store.js'
import { ChordPlayer } from './ChordPlayer.js'

const PATCH: Patch = {
  modules: [{ id: 'chord', type: 'chord-player' }],
  cables: [],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render() {
  const def = MODULES['chord-player']
  const module = useRack.getState().patch.modules[0]
  flushSync(() => root.render(createElement(ChordPlayer, {
    def,
    module,
    value: (id: string) => useRack.getState().paramValue(module.id, id),
    onChange: (id: string, value: number) => useRack.getState().setParam(module.id, id, value),
  })))
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

it('holds Alter only while the keyboard control is held', () => {
  const alter = host.querySelector<HTMLButtonElement>('[aria-label="Hold to alter chord"]')!
  expect(alter).toBeTruthy()
  flushSync(() => alter.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
  expect(useRack.getState().paramValue('chord', 'alter')).toBe(1)
  flushSync(() => alter.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })))
  expect(useRack.getState().paramValue('chord', 'alter')).toBe(0)
})
