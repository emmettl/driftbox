import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CablePaths, CableUnplugs } from './BackPanel.js'
import { cablePath } from './cable.js'
import { jackAt, jacks, layout, withDraggedPlacement } from './layout.js'

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
        folded: new Set<string>(),
        swing: { elapsed: null, direction: 1 },
      }),
    )
    const interactive = renderToStaticMarkup(
      createElement(CablePaths, {
        all: jacks(geometry.placements, MODULES),
        cables: patch.cables,
        delayed: new Set<string>(),
        folded: new Set<string>(),
        swing: { elapsed: null, direction: 1 },
        disconnect: () => {},
      }),
    )

    expect(passive).toContain('rk-cable-line')
    expect(passive).not.toContain('rk-cable-grab')
    expect(interactive).toContain('rk-cable-grab')
  })

  it('gives every cable a visible, keyboard-accessible unplug control at its inlet', () => {
    const drawn = renderToStaticMarkup(
      createElement(CableUnplugs, {
        all: jacks(geometry.placements, MODULES),
        cables: patch.cables,
        disconnect: () => {},
      }),
    )

    expect(drawn).toContain('rk-cable-unplug-button')
    expect(drawn).toContain('role="button"')
    expect(drawn).toContain('tabindex="0"')
    expect(drawn).toContain('aria-label="Unplug osc Out from speaker In"')
  })

  it('marks a cable that loses its right channel', () => {
    // The compiler decides the fold and reports it; drawing it is the other half of that bargain. A patch
    // that behaves unlike its picture is worse than one that admits it.
    const key = 'osc.out>speaker.in'
    const drawn = renderToStaticMarkup(
      createElement(CablePaths, {
        all: jacks(geometry.placements, MODULES),
        cables: patch.cables,
        delayed: new Set<string>(),
        folded: new Set([key]),
        swing: { elapsed: null, direction: 1 },
      }),
    )
    expect(drawn).toContain('rk-cable-folded')
  })

  it('anchors an attached cable to the pointer-following rear ghost', () => {
    const moved = withDraggedPlacement(geometry.placements, {
      id: 'osc',
      at: { x: 300, y: 260 },
      grab: { x: 100, y: 30 },
      width: geometry.placements[0].width,
      height: geometry.placements[0].height,
    })
    const all = jacks(moved, MODULES)
    const from = jackAt(all, 'osc', 'out', 'out')!
    const to = jackAt(all, 'speaker', 'in', 'in')!
    const markup = renderToStaticMarkup(
      createElement(CablePaths, {
        all,
        cables: patch.cables,
        delayed: new Set<string>(),
        folded: new Set<string>(),
        swing: { elapsed: null, direction: 1 },
      }),
    )

    expect(markup).toContain(cablePath(from, to))
    expect(from.y).toBeGreaterThan(geometry.placements[0].height)
  })

  it('jiggles only leads attached to the moving module', () => {
    const props = {
      all: jacks(geometry.placements, MODULES),
      cables: patch.cables,
      delayed: new Set<string>(),
      folded: new Set<string>(),
      swing: { elapsed: null, direction: 1 },
    }
    const still = renderToStaticMarkup(createElement(CablePaths, props))
    const attached = renderToStaticMarkup(
      createElement(CablePaths, {
        ...props,
        jiggle: { module: 'osc', angle: 0.45 },
      }),
    )
    const unrelated = renderToStaticMarkup(
      createElement(CablePaths, {
        ...props,
        jiggle: { module: 'somewhere-else', angle: 0.45 },
      }),
    )

    expect(attached).not.toBe(still)
    expect(unrelated).toBe(still)
  })
})
