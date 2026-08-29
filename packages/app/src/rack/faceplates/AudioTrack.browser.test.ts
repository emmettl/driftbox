import { MODULES, type Patch } from '@driftbox/rack'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRack } from '../store.js'
import { AudioTrack } from './AudioTrack.js'

const PATCH: Patch = { modules: [{ id: 'track', type: 'audio-track' }], cables: [] }
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render() {
  const module = useRack.getState().patch.modules[0]
  flushSync(() =>
    root.render(
      createElement(AudioTrack, {
        def: MODULES['audio-track'],
        module,
        value: (id: string) => useRack.getState().paramValue(module.id, id),
        onChange: (id: string, value: number) => useRack.getState().setParam(module.id, id, value),
      }),
    ),
  )
}

function type(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  flushSync(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  useRack.getState().load(structuredClone(PATCH))
  useRack.getState().setAudioTrack('track', null)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  render()
})

afterEach(() => {
  flushSync(() => root.unmount())
  host.remove()
})

it('places the recording by bar and sixteenth without rebuilding the graph', () => {
  const before = useRack.getState().revision
  type(host.querySelector('[aria-label="Audio track start bar"]')!, '3')
  render()
  type(host.querySelector('[aria-label="Audio track start sixteenth"]')!, '5')
  expect(useRack.getState().paramValue('track', 'start')).toBe(36)
  expect(useRack.getState().revision).toBe(before)
})

it('draws retained recording metadata without putting PCM in the patch', () => {
  useRack.getState().setAudioTrack('track', {
    name: 'field-take.wav',
    seconds: 12.5,
    channels: 2,
    peaks: [0.2, 0.8, 0.4],
  })
  render()
  expect(host.textContent).toContain('field-take.wav')
  expect(host.textContent).toContain('stereo · 12.50s')
  expect(host.querySelectorAll('.rk-audio-track-display rect')).toHaveLength(3)
  expect(useRack.getState().patch.modules[0].data).toBeUndefined()
})
