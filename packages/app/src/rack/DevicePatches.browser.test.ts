import { MODULES, devicePatchesFor, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Chassis } from './Chassis.js'
import { sizeFor } from './faceplates/index.js'
import { layout } from './layout.js'
import { useRack } from './store.js'

// The browser is where this feature either exists or does not: the strip is rendered by the Chassis on top
// of a transparent drag grip, it reads a shelf out of real `localStorage`, and the name it shows is derived
// from the knobs rather than remembered. None of that is checkable from the store alone.

const PATCH: Patch = {
  modules: [
    { id: 'f', type: 'ladder', params: { cutoff: 500, resonance: 0.92 } },
    { id: 'speaker', type: 'out' },
  ],
  cables: [],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render() {
  const geometry = layout(useRack.getState().patch.modules, sizeFor(MODULES))
  flushSync(() => root.render(createElement(Chassis, { layout: geometry })))
}

/** The browser strip belonging to one module. */
function strip(moduleId: string) {
  return host.querySelector<HTMLDivElement>(`[data-module-id="${moduleId}"] .rk-device-patches`)!
}

function name(moduleId: string) {
  const select = strip(moduleId).querySelector('select')!
  return select.options[select.selectedIndex].textContent
}

/**
 * Put text in the naming field the way a person would.
 *
 * Not `field.value = ...`. React installs a value tracker on the node and skips an `input` event whose
 * value matches what it last wrote, so assigning directly leaves `onChange` unfired and the component
 * still holding the name it suggested — which looks like a passing save under the wrong name.
 */
function type(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  flushSync(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(moduleId: string, label: string) {
  const button = [...strip(moduleId).querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  )!
  expect(button, label).toBeTruthy()
  flushSync(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  localStorage.removeItem('driftbox.devicepatches.v1')
  useRack.getState().load(structuredClone(PATCH))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
  localStorage.removeItem('driftbox.devicepatches.v1')
})

describe('the browser on a faceplate', () => {
  it('appears on every device without any faceplate knowing about it', () => {
    render()
    // The Out has a hand-built faceplate and was never given a browser. It has one.
    expect(strip('f')).toBeTruthy()
    expect(strip('speaker')).toBeTruthy()
  })

  it('names the patch the knobs are actually set to', () => {
    // Derived, never remembered. These are the Acid settings, so it says Acid without having been told.
    render()
    expect(name('f')).toBe('Acid')
  })

  it('says Custom once a knob has moved away from every saved setting', () => {
    render()
    flushSync(() => useRack.getState().setParam('f', 'cutoff', 517))
    expect(name('f')).toBe('Custom')
  })

  it('loads the next patch in the bank, and the sound follows', () => {
    render()
    const bank = devicePatchesFor(MODULES.ladder)
    const next = bank[bank.findIndex((p) => p.name === 'Acid') + 1]
    click('f', 'Next Ladder patch')
    expect(name('f')).toBe(next.name)
    expect(useRack.getState().paramValue('f', 'cutoff')).toBe(next.params.cutoff)
  })

  it('wraps round rather than stopping at the end', () => {
    render()
    const bank = devicePatchesFor(MODULES.ladder)
    for (let i = 0; i < bank.length; i++) click('f', 'Next Ladder patch')
    expect(name('f')).toBe('Acid')
  })

  it('steps forward from Custom into the top of the bank', () => {
    render()
    flushSync(() => useRack.getState().setParam('f', 'cutoff', 517))
    click('f', 'Next Ladder patch')
    expect(name('f')).toBe('Init')
  })

  it('takes a device back to its defaults through Init', () => {
    render()
    const bank = devicePatchesFor(MODULES.ladder)
    const select = strip('f').querySelector('select')!
    select.value = String(bank.findIndex((patch) => patch.id === 'init'))
    flushSync(() => select.dispatchEvent(new Event('change', { bubbles: true })))
    for (const param of MODULES.ladder.params) {
      expect(useRack.getState().paramValue('f', param.id), param.id).toBe(param.default)
    }
  })

  it('does not select the module or start a drag when the browser is used', () => {
    // The strip sits on top of the drag grip, which is a transparent sheet across the whole title bar,
    // and inside a section that selects on pointerdown. Both would fire under a button otherwise.
    render()
    flushSync(() =>
      strip('f').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    )
    expect(useRack.getState().selection).toEqual([])
  })
})

describe('keeping your own', () => {
  it('saves the current settings and offers them back by name', () => {
    render()
    flushSync(() => useRack.getState().setParam('f', 'cutoff', 517))
    expect(name('f')).toBe('Custom')

    click('f', 'Save these Ladder settings')
    type(strip('f').querySelector('input')!, 'Mine')
    click('f', 'Keep these settings')

    // Named immediately, because the settings on the device now match a patch on the shelf.
    expect(name('f')).toBe('Mine')

    // And it survives leaving the settings and coming back.
    flushSync(() => useRack.getState().setParam('f', 'cutoff', 900))
    expect(name('f')).toBe('Custom')
    click('f', 'Previous Ladder patch')
    click('f', 'Next Ladder patch')
    expect(
      [...strip('f').querySelectorAll('option')].map((option) => option.textContent),
    ).toContain('Mine')
  })

  it('deletes one of yours, and never a factory one', () => {
    render()
    // On a factory patch there is nothing to delete.
    expect(
      [...strip('f').querySelectorAll('button')].some((button) =>
        button.getAttribute('aria-label')?.startsWith('Delete'),
      ),
    ).toBe(false)

    flushSync(() => useRack.getState().setParam('f', 'cutoff', 517))
    click('f', 'Save these Ladder settings')
    type(strip('f').querySelector('input')!, 'Mine')
    click('f', 'Keep these settings')

    click('f', 'Delete the Ladder patch Mine')
    expect(name('f')).toBe('Custom')
    expect(
      [...strip('f').querySelectorAll('option')].map((option) => option.textContent),
    ).not.toContain('Mine')
  })

  it('offers a name that is not already taken', () => {
    // A save that quietly replaced something is the one storage mistake you cannot undo, so accepting
    // the suggested name twice has to leave two patches rather than one overwritten one.
    render()
    flushSync(() => useRack.getState().setParam('f', 'cutoff', 517))
    click('f', 'Save these Ladder settings')
    expect(strip('f').querySelector('input')!.value).toBe('Ladder')
    click('f', 'Keep these settings')

    flushSync(() => useRack.getState().setParam('f', 'cutoff', 640))
    click('f', 'Save these Ladder settings')
    expect(strip('f').querySelector('input')!.value).toBe('Ladder 2')
    click('f', 'Keep these settings')

    const options = [...strip('f').querySelectorAll('option')].map((option) => option.textContent)
    expect(options).toContain('Ladder')
    expect(options).toContain('Ladder 2')
  })

  it('leaves the shelf alone when the naming is cancelled', () => {
    render()
    flushSync(() => useRack.getState().setParam('f', 'cutoff', 517))
    click('f', 'Save these Ladder settings')
    click('f', 'Cancel saving these settings')
    expect(name('f')).toBe('Custom')
    expect(strip('f').querySelector('input')).toBeNull()
  })

  it('keeps one device’s shelf out of another device’s browser', () => {
    useRack.getState().load({
      modules: [
        { id: 'f', type: 'ladder' },
        { id: 'g', type: 'svf' },
      ],
      cables: [],
    })
    render()
    flushSync(() => useRack.getState().setParam('f', 'cutoff', 517))
    click('f', 'Save these Ladder settings')
    type(strip('f').querySelector('input')!, 'Mine')
    click('f', 'Keep these settings')

    expect(
      [...strip('g').querySelectorAll('option')].map((option) => option.textContent),
    ).not.toContain('Mine')
  })
})
