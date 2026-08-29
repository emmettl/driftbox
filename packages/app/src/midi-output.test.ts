import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyboardBank, openMidi, type MidiEvents } from './midi.js'

function events(onOutputs = vi.fn()): MidiEvents {
  return {
    onVoice: vi.fn(),
    onMod: vi.fn(),
    onControl: vi.fn(),
    onOutputs,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('the Web MIDI output host', () => {
  it('lists ports and sends clock bytes at translated timestamps', async () => {
    const send = vi.fn()
    const clear = vi.fn()
    const output = { id: 'synth', name: 'Desk synth', send, clear }
    const access = {
      inputs: new Map(),
      outputs: new Map([['synth', output]]),
      onstatechange: null as (() => void) | null,
    }
    vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })

    const onOutputs = vi.fn()
    const handle = await openMidi(events(onOutputs), new KeyboardBank())
    expect(handle?.outputs).toEqual([{ id: 'synth', name: 'Desk synth' }])
    expect(onOutputs).toHaveBeenCalledWith([{ id: 'synth', name: 'Desk synth' }])

    expect(handle?.sendClock('synth', { message: 'start', time: 10.06 }, 10, 5000)).toBe(true)
    expect(send.mock.calls[0][0]).toEqual([0xfa])
    expect(send.mock.calls[0][1]).toBeCloseTo(5060, 9)
    handle?.clearOutput('synth')
    expect(clear).toHaveBeenCalledOnce()
  })

  it('updates outputs on hot-plug and refuses a missing destination', async () => {
    const outputs = new Map<string, { id: string; name: string; send: ReturnType<typeof vi.fn> }>()
    const access = {
      inputs: new Map(),
      outputs,
      onstatechange: null as (() => void) | null,
    }
    vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })

    const onOutputs = vi.fn()
    const handle = await openMidi(events(onOutputs), new KeyboardBank())
    expect(handle?.sendClock('gone', { message: 'tick', time: 1 }, 1, 1000)).toBe(false)

    outputs.set('drum', { id: 'drum', name: 'Drum machine', send: vi.fn() })
    access.onstatechange?.()
    expect(handle?.outputs).toEqual([{ id: 'drum', name: 'Drum machine' }])
    expect(onOutputs).toHaveBeenLastCalledWith([{ id: 'drum', name: 'Drum machine' }])
  })
})
