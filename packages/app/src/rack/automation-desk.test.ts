import { MODULES, type Patch } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import {
  automationLaneViews,
  automationPosition,
  automationPositionLabel,
} from './automation-desk.js'

const PATCH: Patch = {
  modules: [
    { id: 'filter', type: 'ladder' },
    { id: 'scope', type: 'meter' },
  ],
  cables: [],
  automation: [
    {
      target: ['filter', 'cutoff'],
      points: [{ at: 0, value: 200 }, { at: 32, value: 4000 }],
    },
    {
      target: ['scope', 'mode'],
      curve: 'hold',
      points: [{ at: 4, value: 0 }, { at: 20, value: 2 }],
    },
  ],
}

describe('automation desk lane summaries', () => {
  it('round-trips one-based bar and sixteenth labels', () => {
    expect(automationPosition('1.1')).toBe(0)
    expect(automationPosition(' 2.16 ')).toBe(31)
    expect(automationPositionLabel(31)).toBe('2.16')
  })

  it('rejects incomplete and out-of-range musical positions', () => {
    expect(automationPosition('2')).toBeNull()
    expect(automationPosition('0.1')).toBeNull()
    expect(automationPosition('1.17')).toBeNull()
    expect(automationPosition('one.two')).toBeNull()
  })

  it('resolves module and parameter ids into readable names', () => {
    const lanes = automationLaneViews(PATCH, MODULES)
    expect(lanes[0]).toMatchObject({
      moduleName: 'Ladder',
      moduleId: 'filter',
      paramName: 'Cutoff',
      pointCount: 2,
      from: '1.1',
      to: '3.1',
      curve: 'linear',
      stepped: false,
      min: 20,
      max: 12000,
    })
    expect(lanes[0].points).toEqual([
      expect.objectContaining({ at: 0, value: 200, position: '1.1' }),
      expect.objectContaining({ at: 32, value: 4000, position: '3.1' }),
    ])
  })

  it('draws continuous and hold lanes with different path shapes', () => {
    const lanes = automationLaneViews(PATCH, MODULES)
    expect(lanes[0].path).toContain(' L ')
    expect(lanes[1].path).toContain(' H ')
    expect(lanes[1].path).toContain(' V ')
    expect(lanes[1]).toMatchObject({ stepped: true, min: 0, max: 2 })
  })

  it('keeps unknown saved targets visible rather than silently dropping them', () => {
    const patch: Patch = {
      modules: [{ id: 'future', type: 'future-module' }],
      cables: [],
      automation: [{ target: ['future', 'mystery'], points: [{ at: 0, value: 0.5 }] }],
    }
    expect(automationLaneViews(patch, MODULES)[0]).toMatchObject({
      moduleName: 'future-module',
      paramName: 'mystery',
    })
  })
})
