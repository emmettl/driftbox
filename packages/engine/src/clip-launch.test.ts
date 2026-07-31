import { describe, expect, it, vi } from 'vitest'
import { ClipLauncher } from './clip-launch.js'

describe('quantized clip launches', () => {
  it('keeps a queued clip out of the active selection until the boundary', () => {
    const launcher = new ClipLauncher()
    launcher.queue('tr909', 'fill')
    expect(launcher.selection).toEqual({})

    launcher.activate()
    expect(launcher.selection).toEqual({ tr909: 'fill' })
  })

  it('returns a machine to the authored arrangement at the boundary', () => {
    const launcher = new ClipLauncher()
    launcher.queue('303.a', 'acid')
    launcher.activate()
    launcher.queue('303.a', null)
    expect(launcher.selection).toEqual({ '303.a': 'acid' })

    launcher.activate()
    expect(launcher.selection).toEqual({})
  })

  it('reports queued and active phases without exposing its mutable state', () => {
    const listener = vi.fn()
    const launcher = new ClipLauncher()
    const unsubscribe = launcher.onChange(listener)
    launcher.queue('tr808', 'break')
    launcher.activate()
    unsubscribe()
    launcher.queue('tr808', 'other')

    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { section: 'tr808', patternId: 'break', phase: 'queued' },
      { section: 'tr808', patternId: 'break', phase: 'active' },
    ])
    const selection = launcher.selection
    selection.tr808 = 'mutated'
    expect(launcher.selection).toEqual({ tr808: 'break' })
  })
})
