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
      expect(host.querySelectorAll('.rk-cable-smoke')).toHaveLength(15)

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

describe('rear-panel input trims', () => {
  it('puts an accessible bipolar pot beside every inlet and edits without repatching', () => {
    useRack.getState().load(structuredClone(patch))
    const geometry = layout(patch.modules, sizeFor(MODULES))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      flushSync(() => root.render(createElement(BackPanel, { layout: geometry })))
      const inlets = geometry.placements.reduce(
        (count, placement) => count + MODULES[placement.type].inlets.length,
        0,
      )
      expect(host.querySelectorAll('.rk-input-trim')).toHaveLength(inlets)

      const trim = host.querySelector<SVGGElement>(
        '[role="slider"][aria-label="speaker In input trim"]',
      )!
      expect(trim).toBeTruthy()
      expect(trim.getAttribute('aria-valuemin')).toBe('-1')
      expect(trim.getAttribute('aria-valuemax')).toBe('1')
      expect(trim.getAttribute('aria-valuenow')).toBe('1')

      flushSync(() =>
        trim.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
      )
      expect(useRack.getState().inputTrimValue('speaker', 'in')).toBe(0.95)
      expect(useRack.getState().patch.cables).toEqual(patch.cables)
      expect(trim.getAttribute('aria-valuenow')).toBe('0.95')

      flushSync(() =>
        trim.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })),
      )
      expect(useRack.getState().inputTrimValue('speaker', 'in')).toBe(-1)
    } finally {
      flushSync(() => root.unmount())
      host.remove()
    }
  })

  it('marks a pot that is away from unity, and only then', () => {
    // Every inlet carries one of these, so "which of these is doing something" is not a question the panel
    // can answer by drawing them all the same. Engaged is also precisely when the inlet costs the graph a
    // slot, so the mark and the cost turn on together.
    useRack.getState().load(structuredClone(patch))
    const geometry = layout(patch.modules, sizeFor(MODULES))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      flushSync(() => root.render(createElement(BackPanel, { layout: geometry })))
      const trim = host.querySelector<SVGGElement>(
        '[role="slider"][aria-label="speaker In input trim"]',
      )!
      expect(trim.classList.contains('rk-input-trim-on')).toBe(false)

      flushSync(() =>
        trim.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
      )
      expect(trim.classList.contains('rk-input-trim-on')).toBe(true)

      // Back to exactly unity is back to unmarked — the same edge the store uses to drop the slot.
      flushSync(() =>
        trim.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
      )
      expect(useRack.getState().inputTrimValue('speaker', 'in')).toBe(1)
      expect(trim.classList.contains('rk-input-trim-on')).toBe(false)
    } finally {
      flushSync(() => root.unmount())
      host.remove()
    }
  })
})
