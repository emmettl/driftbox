import { describe, expect, it } from 'vitest'
import { MODULES } from './modules/index.js'
import { renderPatchStems } from './render.js'
import type { Patch } from './types.js'

const peak = (buffer: AudioBuffer, channel: number): number => {
  let value = 0
  for (const sample of buffer.getChannelData(channel)) value = Math.max(value, Math.abs(sample))
  return value
}

describe('rack-native Out stems', () => {
  it('renders each terminal strip alone with its level, pan and stable solo isolation', async () => {
    const patch: Patch = {
      tempo: 400,
      modules: [
        { id: 'a', type: 'offset', params: { gain: 0, offset: 0.1 } },
        { id: 'left', type: 'out', params: { level: 1, pan: -1 } },
        { id: 'b', type: 'offset', params: { gain: 0, offset: 0.2 } },
        { id: 'right', type: 'out', params: { level: 1, pan: 1 } },
      ],
      cables: [
        { from: ['a', 'out'], to: ['left', 'in'] },
        { from: ['b', 'out'], to: ['right', 'in'] },
      ],
      // These recorded moves would swap the active solo at the first frame if stem rendering did not remove
      // terminal-solo automation from its isolated document.
      automation: [
        { target: ['left', 'solo'], points: [{ at: 0, value: 0 }] },
        { target: ['right', 'solo'], points: [{ at: 0, value: 1 }] },
      ],
      modulation: [
        { from: ['a', 'offset'], to: ['left', 'solo'], min: 0, max: 0 },
        { from: ['b', 'offset'], to: ['right', 'solo'], min: 1, max: 1 },
      ],
    }

    const stems = await renderPatchStems(patch, {
      registry: MODULES,
      bars: 1,
      tail: 0,
      sampleRate: 8000,
    })

    expect(stems.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'left', name: 'Out · left' },
      { id: 'right', name: 'Out · right' },
    ])
    expect(peak(stems[0].buffer, 0)).toBeCloseTo(0.1, 3)
    expect(peak(stems[0].buffer, 1)).toBeLessThan(1e-5)
    expect(peak(stems[1].buffer, 0)).toBeLessThan(1e-5)
    expect(peak(stems[1].buffer, 1)).toBeCloseTo(0.2, 3)
  })

  it('can render a requested subset without changing patch order', async () => {
    const patch: Patch = {
      tempo: 400,
      modules: [
        { id: 'a', type: 'offset', params: { gain: 0, offset: 0.1 } },
        { id: 'one', type: 'out', params: { level: 1 } },
        { id: 'two', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['a', 'out'], to: ['two', 'in'] }],
    }

    const stems = await renderPatchStems(patch, {
      registry: MODULES,
      only: ['two'],
      bars: 1,
      tail: 0,
      sampleRate: 8000,
    })
    expect(stems).toHaveLength(1)
    expect(stems[0].id).toBe('two')
    expect(peak(stems[0].buffer, 0)).toBeGreaterThan(0.05)
  })
})
