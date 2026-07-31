import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CablePaths } from './BackPanel.js'
import { jacks, layout } from './layout.js'

const patch = {
  modules: [
    { id: 'osc', type: 'vco' },
    { id: 'speaker', type: 'out' },
  ],
  cables: [{ from: ['osc', 'out'] as [string, string], to: ['speaker', 'in'] as [string, string] }],
}

const geometry = layout(patch.modules, () => ({ span: 2, rows: 1 }))

describe('the shared cable renderer', () => {
  it('only includes interactive grab targets when given a disconnect action', () => {
    const passive = renderToStaticMarkup(
      createElement(CablePaths, {
        all: jacks(geometry.placements, MODULES),
        cables: patch.cables,
        delayed: new Set<string>(),
        swing: { elapsed: null, direction: 1 },
      }),
    )
    const interactive = renderToStaticMarkup(
      createElement(CablePaths, {
        all: jacks(geometry.placements, MODULES),
        cables: patch.cables,
        delayed: new Set<string>(),
        swing: { elapsed: null, direction: 1 },
        disconnect: () => {},
      }),
    )

    expect(passive).toContain('rk-cable-line')
    expect(passive).not.toContain('rk-cable-grab')
    expect(interactive).toContain('rk-cable-grab')
  })
})
