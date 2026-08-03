import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useRack } from '../store.js'
import { ScalePlayer } from './ScalePlayer.js'

const PATCH: Patch = {
  modules: [{ id: 'scale', type: 'scale-player', params: { key: 2, scale: 5, filter: 0 } }],
  cables: [],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render() {
  const def = MODULES['scale-player']
  const module = useRack.getState().patch.modules[0]
  flushSync(() => root.render(createElement(ScalePlayer, {
    def,
    module,
    value: (id: string) => useRack.getState().paramValue(module.id, id),
    onChange: (id: string, value: number) => useRack.getState().setParam(module.id, id, value),
  })))
}

function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  )!
  expect(button, label).toBeTruthy()
  flushSync(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
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

describe('editing a scale map', () => {
  it('copies a preset to Custom and toggles the clicked note without rebuilding', () => {
    const before = useRack.getState().revision
    click('D# excluded from D Dorian')

    expect(useRack.getState().paramValue('scale', 'scale')).toBe(13)
    expect(useRack.getState().data('scale', 'customScale')).toEqual(
      [1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0],
    )
    expect(useRack.getState().revision).toBe(before)
  })

  it('does not allow the last note of a custom scale to be removed', () => {
    useRack.getState().setParam('scale', 'scale', 13)
    useRack.getState().setData('scale', 'customScale', [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    render()
    click('D included in D Custom')
    expect(useRack.getState().data('scale', 'customScale'))
      .toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})
