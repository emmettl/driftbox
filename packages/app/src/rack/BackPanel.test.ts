import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CablePaths, TurningCables } from './BackPanel.js'
import { jacks, layout } from './layout.js'

const patch = {
  modules: [
    { id: 'osc', type: 'vco' },
    { id: 'speaker', type: 'out' },
  ],
  cables: [{ from: ['osc', 'out'] as [string, string], to: ['speaker', 'in'] as [string, string] }],
}

const geometry = layout(patch.modules, () => ({ span: 2, rows: 1 }))

describe('cables during a rack turn', () => {
  it('renders a non-interactive cable copy as soon as the turn to the back starts', () => {
    const resting = renderToStaticMarkup(
      createElement(TurningCables, { layout: geometry, flipped: false }),
    )
    const turning = renderToStaticMarkup(
      createElement(TurningCables, { layout: geometry, flipped: true }),
    )
    const cables = renderToStaticMarkup(
      createElement(CablePaths, {
        all: jacks(geometry.placements, MODULES),
        cables: patch.cables,
        delayed: new Set<string>(),
        swing: { elapsed: null, direction: 1 },
      }),
    )

    expect(resting).toContain('class="rk-turn-wires"')
    expect(resting).not.toContain('rk-turn-wires-on')
    expect(turning).toContain('class="rk-turn-wires rk-turn-wires-on"')
    expect(turning).toContain('aria-hidden="true"')
    expect(cables).toContain('rk-cable-line')
    expect(cables).not.toContain('rk-cable-grab')
  })
})
