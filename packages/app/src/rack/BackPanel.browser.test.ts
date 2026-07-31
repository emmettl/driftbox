import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { BackPanel } from './BackPanel.js'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { useRack } from './store.js'

const patch: Patch = {
  modules: [
    { id: 'osc', type: 'vco' },
    { id: 'speaker', type: 'out' },
  ],
  cables: [{ from: ['osc', 'out'], to: ['speaker', 'in'] }],
}

describe('unplugging a cable from the back panel', () => {
  it('removes the cable represented by the visible inlet control', () => {
    useRack.getState().load(patch)
    const geometry = layout(patch.modules, sizeFor(MODULES))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      flushSync(() => root.render(createElement(BackPanel, { layout: geometry })))
      const unplug = host.querySelector<SVGGElement>('.rk-cable-unplug')

      expect(unplug).toBeTruthy()
      expect(unplug?.getAttribute('role')).toBe('button')
      expect(unplug?.getAttribute('aria-label')).toBe('Unplug osc Out from speaker In')

      flushSync(() => unplug!.dispatchEvent(new MouseEvent('click', { bubbles: true })))

      expect(useRack.getState().patch.cables).toEqual([])
      expect(host.querySelector('.rk-cable-unplug')).toBeNull()
      expect(host.querySelector('.rk-cable-evaporation')).toBeTruthy()
      expect(host.querySelectorAll('.rk-cable-smoke')).toHaveLength(9)

      flushSync(() =>
        host
          .querySelector('.rk-cable-evaporation')!
          .dispatchEvent(
            new AnimationEvent('animationend', {
              animationName: 'rk-cable-evaporation-life',
              bubbles: true,
            }),
          ),
      )
      expect(host.querySelector('.rk-cable-evaporation')).toBeNull()
    } finally {
      flushSync(() => root.unmount())
      host.remove()
    }
  })
})
