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

  it('keeps the legacy default queued until a bar boundary', () => {
    const launcher = new ClipLauncher()
    launcher.queue('tr909', 'fill')
    launcher.activate('step')
    launcher.activate('beat')
    expect(launcher.selection).toEqual({})
    launcher.activate('bar')
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

  it('activates step and beat queues at their requested boundaries', () => {
    const launcher = new ClipLauncher()
    launcher.queue('tr808', 'kick-fill', 'step')
    launcher.queue('tr909', 'hat-fill', 'beat')
    launcher.queue('303.a', 'acid-fill', 'bar')

    launcher.activate('step')
    expect(launcher.selection).toEqual({ tr808: 'kick-fill' })

    launcher.activate('beat')
    expect(launcher.selection).toEqual({ tr808: 'kick-fill', tr909: 'hat-fill' })

    launcher.activate('bar')
    expect(launcher.selection).toEqual({
      tr808: 'kick-fill',
      tr909: 'hat-fill',
      '303.a': 'acid-fill',
    })
  })

  it('lets a bar boundary satisfy every finer queue together', () => {
    const launcher = new ClipLauncher()
    launcher.queue('tr808', 'kick-fill', 'step')
    launcher.queue('tr909', 'hat-fill', 'beat')
    launcher.activate('bar')
    expect(launcher.selection).toEqual({ tr808: 'kick-fill', tr909: 'hat-fill' })
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
      { section: 'tr808', patternId: 'break', phase: 'queued', quantization: 'bar' },
      { section: 'tr808', patternId: 'break', phase: 'active', quantization: 'bar' },
    ])
    const selection = launcher.selection
    selection.tr808 = 'mutated'
    expect(launcher.selection).toEqual({ tr808: 'break' })
  })

  it('reports the exact activation bar without assigning one to a queued launch', () => {
    const listener = vi.fn()
    const launcher = new ClipLauncher()
    launcher.onChange(listener)
    launcher.queue('303.b', 'line', 'bar')
    launcher.activate('bar', 7)
    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { section: '303.b', patternId: 'line', phase: 'queued', quantization: 'bar' },
      { section: '303.b', patternId: 'line', phase: 'active', quantization: 'bar', bar: 7 },
    ])
  })
})
