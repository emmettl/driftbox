import type { Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RackStemReviewTray } from './RackStemReviewTray.js'

const PATCH: Patch = {
  modules: [
    { id: 'main', type: 'out' },
    { id: 'cue', type: 'out' },
    { id: 'old', type: 'out', bypassed: true },
  ],
  cables: [],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
})

describe('rack stem review desk', () => {
  it('opens on the active Out buses without rendering audio early', () => {
    const prepareData = vi.fn(async () => ({}))
    const close = vi.fn()
    flushSync(() => root.render(createElement(RackStemReviewTray, {
      patch: PATCH,
      running: false,
      stopTransport: vi.fn(),
      filePrefix: 'my-rack',
      prepareData,
      onClose: close,
      onExported: vi.fn(),
    })))

    const dialog = document.querySelector<HTMLElement>('.stem-tray')!
    expect(dialog).toBeTruthy()
    expect([...dialog.querySelectorAll('.stem-name strong')].map((node) => node.textContent))
      .toEqual(['Out · main', 'Out · cue'])
    expect(dialog.querySelector('footer span')?.textContent).toBe('2 Out stems in this patch')
    expect(prepareData).not.toHaveBeenCalled()

    flushSync(() => dialog.querySelector<HTMLButtonElement>('.stem-close')!.click())
    expect(close).toHaveBeenCalledOnce()
  })
})
