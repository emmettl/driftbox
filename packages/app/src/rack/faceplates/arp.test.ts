import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Arp } from './Arp.js'
import { arpPreview } from './arp-display.js'

describe('the Arp faceplate', () => {
  it('previews the exact Root intervals and keeps all sixteen positions visible', () => {
    const def = MODULES.arp
    const values: Record<string, number> = {
      source: 0, chord: 3, octaves: 2, mode: 0, gate: 0.5,
      hold: 0, shift: 0, velocityMode: 0, velocity: 0.8,
      timing: 0, division: 4, rate: 8, patternLength: 16,
    }
    const markup = renderToStaticMarkup(createElement(Arp, {
      def,
      module: { id: 'arp', type: 'arp' },
      value: (id: string) => values[id] ?? 0,
      onChange: () => {},
    }))
    expect(markup).toContain('Arp Field')
    expect(markup).toContain('Root · Up · external clock')
    expect(markup).toContain('Min intervals')
    expect(markup.match(/class="rk-arp-step(?: |")/g)).toHaveLength(16)
  })

  it('shows collected lanes without claiming to know their live pitches', () => {
    const preview = arpPreview({ source: 1, chord: 0, octaves: 1, mode: 0, shift: 0, steps: 8 })
    expect(preview.map((step) => step.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(preview[0].description).toContain('Played input lane 1')
  })

  it('mirrors downward and turning directions with octave shift', () => {
    expect(arpPreview({ source: 0, chord: 2, octaves: 1, mode: 1, shift: -1, steps: 4 })
      .map((step) => step.label)).toEqual(['-5', '-8', '-12', '-5'])
    expect(arpPreview({ source: 0, chord: 2, octaves: 1, mode: 2, shift: 0, steps: 6 })
      .map((step) => step.label)).toEqual(['0', '+4', '+7', '+4', '0', '+4'])
  })
})
