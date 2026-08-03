import { MODULES } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import {
  COLUMN,
  JACK,
  ROW,
  SNAP,
  boundsBetween,
  dragBounds,
  dropIndex,
  jackAt,
  jacks,
  layout,
  nearestJack,
  placementsInBounds,
  reordered,
  rowsForJacks,
  withDraggedPlacement,
  type Size,
} from './layout.js'

// The front panel, the back panel and the cables are all positioned from these numbers, so if they are
// wrong nothing lines up — a jack sits behind the wrong module, or a cable ends in mid-air. Being pure
// arithmetic is what makes that checkable here instead of by eye in a browser.

const module = (id: string, type: string) => ({ id, type })

const sizes = (overrides: Record<string, Partial<Size>> = {}) => (type: string): Size => ({
  span: overrides[type]?.span ?? 2,
  rows: overrides[type]?.rows ?? 1,
})

describe('stacking the rack', () => {
  it('puts each full-width module on its own row, in patch order', () => {
    const { placements, height } = layout(
      [module('a', 'vco'), module('b', 'ladder'), module('c', 'out')],
      sizes(),
    )

    expect(placements.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(placements.map((p) => p.y)).toEqual([0, ROW, ROW * 2])
    expect(placements.every((p) => p.x === 0 && p.width === COLUMN * 2)).toBe(true)
    expect(height).toBe(ROW * 3)
  })

  it('pairs two adjacent half-width modules into one row', () => {
    const { placements, rows } = layout(
      [module('a', 'out'), module('b', 'out'), module('c', 'vco')],
      sizes({ out: { span: 1 } }),
    )

    expect(placements[0]).toMatchObject({ id: 'a', column: 0, row: 0, x: 0, width: COLUMN })
    expect(placements[1]).toMatchObject({ id: 'b', column: 1, row: 0, x: COLUMN, width: COLUMN })
    expect(placements[2]).toMatchObject({ id: 'c', row: 1 })
    expect(rows).toBe(2)
  })

  it('leaves the other half of a row empty rather than reordering to fill it', () => {
    // Order-preserving on purpose. In a rack the arrangement IS the document, and a packer that
    // shuffled modules to close gaps would move things somebody had deliberately placed.
    const { placements } = layout(
      [module('a', 'out'), module('b', 'vco'), module('c', 'out')],
      sizes({ out: { span: 1 } }),
    )

    expect(placements.map((p) => [p.id, p.row, p.column])).toEqual([
      ['a', 0, 0],
      ['b', 1, 0],
      ['c', 2, 0],
    ])
  })

  it('gives a paired row the height of the taller of the two', () => {
    const { placements, rows } = layout(
      [module('a', 'out'), module('b', 'mixer')],
      sizes({ out: { span: 1, rows: 1 }, mixer: { span: 1, rows: 3 } }),
    )
    expect(placements[0].height).toBe(ROW * 3)
    expect(placements[1].height).toBe(ROW * 3)
    expect(rows).toBe(3)
  })

  it('is empty for an empty rack rather than throwing', () => {
    expect(layout([], sizes())).toMatchObject({ placements: [], rows: 0, height: 0 })
  })
})

describe('rubber-band selection', () => {
  const placements = layout(
    [
      module('top-left', 'small'),
      module('top-right', 'small'),
      module('bottom', 'wide'),
    ],
    sizes({ small: { span: 1 }, wide: { span: 2 } }),
  ).placements

  it('normalises a drag in every direction', () => {
    expect(boundsBetween({ x: 430, y: 110 }, { x: 20, y: 15 })).toEqual({
      x: 20,
      y: 15,
      width: 410,
      height: 95,
    })
  })

  it('takes every faceplate the band visibly overlaps, in rack order', () => {
    expect(
      placementsInBounds(placements, boundsBetween({ x: 20, y: 15 }, { x: 430, y: 90 })),
    ).toEqual(['top-left', 'top-right', 'bottom'])
  })

  it('distinguishes the two halves of a paired row', () => {
    expect(
      placementsInBounds(placements, boundsBetween({ x: 10, y: 10 }, { x: COLUMN - 1, y: 50 })),
    ).toEqual(['top-left'])
    expect(
      placementsInBounds(placements, boundsBetween({ x: COLUMN + 1, y: 10 }, { x: 470, y: 50 })),
    ).toEqual(['top-right'])
  })

  it('does not count merely touching the next row or column', () => {
    expect(
      placementsInBounds(placements, { x: 0, y: 0, width: COLUMN, height: ROW }),
    ).toEqual(['top-left'])
  })

  it('takes nothing from a zero-area click', () => {
    expect(
      placementsInBounds(placements, boundsBetween({ x: 10, y: 10 }, { x: 10, y: 10 })),
    ).toEqual([])
  })
})

describe('jacks', () => {
  it('puts inlets down the left edge and outlets down the right', () => {
    // So a signal chain reads left to right, and a patch with feedback in it visibly doubles back —
    // free information about what a patch does, from the geometry rather than from a label.
    const { placements } = layout([module('f', 'ladder')], sizes({ ladder: { rows: 2 } }))
    const all = jacks(placements, MODULES)

    const ins = all.filter((j) => j.kind === 'in')
    const outs = all.filter((j) => j.kind === 'out')
    expect(ins.map((j) => j.port)).toEqual(['in', 'cutoff', 'res'])
    expect(outs.map((j) => j.port)).toEqual(['out'])
    expect(new Set(ins.map((j) => j.x)).size).toBe(1)
    expect(outs[0].x).toBeGreaterThan(ins[0].x)
  })

  it('centres a jack column in its module rather than pinning it to the top', () => {
    const { placements } = layout([module('f', 'out')], sizes({ out: { rows: 2 } }))
    const all = jacks(placements, MODULES)
    // One inlet, two rows tall: it belongs in the middle.
    expect(all.find((j) => j.kind === 'in')?.y).toBeCloseTo(ROW, 0)
  })

  it('spaces a long column at the jack pitch', () => {
    const { placements } = layout([module('m', 'mixer')], sizes({ mixer: { rows: 3 } }))
    const ins = jacks(placements, MODULES).filter((j) => j.kind === 'in')
    expect(ins).toHaveLength(8)
    for (let i = 1; i < ins.length; i++) expect(ins[i].y - ins[i - 1].y).toBeCloseTo(JACK, 5)
  })

  it('keeps every jack inside its own module', () => {
    // The failure this prevents is a Mixer's eighth inlet sitting on top of the module below it, where
    // clicking it would patch the wrong thing.
    const modules = Object.keys(MODULES).map((type, i) => module(`m${i}`, type))
    const sizeFor = (type: string): Size => ({
      span: 2,
      rows: Math.max(1, rowsForJacks(MODULES[type])),
    })
    const { placements } = layout(modules, sizeFor)
    const all = jacks(placements, MODULES)

    for (const jack of all) {
      const slot = placements.find((p) => p.id === jack.module)!
      expect(jack.y, `${jack.module}.${jack.port}`).toBeGreaterThanOrEqual(slot.y)
      expect(jack.y, `${jack.module}.${jack.port}`).toBeLessThanOrEqual(slot.y + slot.height)
      expect(jack.x).toBeGreaterThanOrEqual(slot.x)
      expect(jack.x).toBeLessThanOrEqual(slot.x + slot.width)
    }
  })

  it('gives every module in the registry a jack for every port', () => {
    const modules = Object.keys(MODULES).map((type, i) => module(`m${i}`, type))
    const { placements } = layout(modules, sizes())
    const all = jacks(placements, MODULES)

    for (const placement of placements) {
      const def = MODULES[placement.type]
      // Each column asked for by name, because a port id is unique down one column but not across
      // both — `Arp` has `pitch` on each side, and a kindless lookup would find the inlet twice and
      // report an outlet it never checked as present.
      for (const port of def.inlets) {
        expect(jackAt(all, placement.id, port.id, 'in'), `${placement.type}.${port.id} in`).toBeDefined()
      }
      for (const port of def.outlets) {
        expect(
          jackAt(all, placement.id, port.id, 'out'),
          `${placement.type}.${port.id} out`,
        ).toBeDefined()
      }
    }
  })

  it('gives a module with the same port id on both sides two distinct jacks', () => {
    // `Arp` takes a V/Oct in and gives a V/Oct out, so `pitch` names a jack in each column. The patch
    // format has always allowed that — a cable's ends are an outlet and an inlet *by position*, so
    // `from` and `to` carry a direction this flat list does not.
    //
    // Every cable endpoint is resolved through `jackAt`, and while it ignored the kind it answered with
    // the inlet both times, because `jacks()` builds the inlet column first. A cable leaving the Arp was
    // drawn leaving the hole its input goes in.
    const { placements } = layout([module('a', 'arp')], sizes())
    const all = jacks(placements, MODULES)
    const inlet = jackAt(all, 'a', 'pitch', 'in')!
    const outlet = jackAt(all, 'a', 'pitch', 'out')!
    expect(inlet).toBeDefined()
    expect(outlet).toBeDefined()
    // Opposite edges of the slot, which is the whole difference the kind makes.
    expect(inlet.x).toBeLessThan(outlet.x)
  })

  it('skips a module whose type this build does not have', () => {
    // It still gets a slot on the front — the patch keeps it and saving must not destroy it — but there
    // is no def to read ports from, so it has no jacks and nothing can be patched to it.
    const { placements } = layout([module('x', 'wavefolder'), module('a', 'vco')], sizes())
    const all = jacks(placements, MODULES)
    expect(placements.map((p) => p.id)).toEqual(['x', 'a'])
    expect(all.some((j) => j.module === 'x')).toBe(false)
    expect(all.some((j) => j.module === 'a')).toBe(true)
  })
})

describe('finding what a cable was dropped on', () => {
  // This replaced asking the DOM, and the reason is in `layout.ts`: `pointerup`'s target is not the thing
  // under the pointer on a touchscreen, because implicit pointer capture delivers the release to the
  // element the touch STARTED on. Patching was completely broken on touch while working on a mouse.
  const { placements } = layout([module('a', 'vco'), module('f', 'ladder')], sizes({ vco: { rows: 2 }, ladder: { rows: 2 } }))
  const all = jacks(placements, MODULES)
  const pitch = jackAt(all, 'a', 'pitch', 'in')!
  const out = jackAt(all, 'a', 'out', 'out')!

  it('finds a jack the pointer is exactly on', () => {
    expect(nearestJack(all, pitch, SNAP)).toMatchObject({ module: 'a', port: 'pitch' })
  })

  it('snaps from nearby, because a fingertip is wider than a jack', () => {
    expect(nearestJack(all, { x: pitch.x + 11, y: pitch.y + 9 }, SNAP)).toMatchObject({ port: 'pitch' })
  })

  it('finds nothing when the pointer is nowhere near', () => {
    expect(nearestJack(all, { x: pitch.x + 400, y: pitch.y + 400 }, SNAP)).toBeUndefined()
  })

  it('takes the nearest when two are in range', () => {
    // Jacks are 30 apart and the snap radius is 30, so a point between two is inside both — "nearest"
    // is what makes a generous radius safe rather than ambiguous.
    const fm = jackAt(all, 'a', 'fm', 'in')!
    const between = { x: pitch.x, y: (pitch.y + fm.y) / 2 - 4 }
    expect(nearestJack(all, between, SNAP)).toMatchObject({ port: 'pitch' })
    const lower = { x: pitch.x, y: (pitch.y + fm.y) / 2 + 4 }
    expect(nearestJack(all, lower, SNAP)).toMatchObject({ port: 'fm' })
  })

  it('only offers the kind that was asked for', () => {
    // What makes the snap forgiving rather than merely tolerant: dragging from an outlet, only inlets are
    // candidates, so the nearest sensible target wins instead of the nearest one of any sort.
    expect(nearestJack(all, out, SNAP, 'in')).not.toMatchObject({ port: 'out' })
    expect(nearestJack(all, out, SNAP, 'out')).toMatchObject({ module: 'a', port: 'out' })
    // An outlet sitting right on top of the pointer is skipped entirely when inlets are wanted.
    const near = nearestJack(all, { x: out.x, y: out.y }, SNAP, 'in')
    expect(near === undefined || near.kind === 'in').toBe(true)
  })
})

describe('dragging a module to a new place', () => {
  it('keeps the lifted module under the exact point where it was grabbed', () => {
    expect(
      dragBounds({
        id: 'wide',
        at: { x: 410, y: 275 },
        grab: { x: 185, y: 35 },
        width: 480,
        height: 100,
      }),
    ).toEqual({ x: 225, y: 240, width: 480, height: 100 })
  })

  it('moves only the lifted placement and preserves its own width', () => {
    const placements = layout(
      [module('wide', 'wide'), module('left', 'narrow'), module('right', 'narrow')],
      sizes({ narrow: { span: 1 } }),
    ).placements
    const moved = withDraggedPlacement(placements, {
      id: 'right',
      at: { x: 160, y: 350 },
      grab: { x: 40, y: 20 },
      width: COLUMN,
      height: ROW,
    })

    expect(moved.find((placement) => placement.id === 'right')).toMatchObject({
      x: 120,
      y: 330,
      width: COLUMN,
      height: ROW,
    })
    expect(moved.find((placement) => placement.id === 'wide')).toBe(placements[0])
    expect(moved.find((placement) => placement.id === 'left')).toBe(placements[1])
  })

  const stack = (...types: string[]) =>
    layout(types.map((type, i) => ({ id: `m${i}`, type })), () => ({ span: 2, rows: 1 }))

  describe('where a drop lands', () => {
    const geometry = stack('vco', 'ladder', 'vca', 'out')
    const at = (x: number, y: number) => ({ x, y })

    it('is 0 above the first module, and past the end below the last', () => {
      // Total by construction: counting midpoints crossed has an answer everywhere, including off both
      // ends, which hit-testing a box does not.
      expect(dropIndex(geometry.placements, at(0, -500))).toBe(0)
      expect(dropIndex(geometry.placements, at(0, geometry.height + 500))).toBe(geometry.placements.length)
    })

    it('flips at each module’s midpoint', () => {
      const second = geometry.placements[1]
      expect(dropIndex(geometry.placements, at(COLUMN, second.y + second.height / 2 - 1))).toBe(1)
      expect(dropIndex(geometry.placements, at(COLUMN, second.y + second.height / 2 + 1))).toBe(2)
    })

    it('has an answer in the gap between rows', () => {
      // There is no gap in this layout, but the rule must not depend on that — a module's own boundary
      // is exactly where two placements meet, and neither owns it.
      const edge = geometry.placements[1].y
      expect(Number.isInteger(dropIndex(geometry.placements, at(COLUMN, edge)))).toBe(true)
    })

    it('inserts before, between or after two half-width modules by x position', () => {
      const compact = layout(
        [module('a', 'delay'), module('b', 'vca'), module('c', 'out')],
        sizes({ delay: { span: 1 }, vca: { span: 1 }, out: { span: 2 } }),
      )
      const y = ROW / 2

      expect(dropIndex(compact.placements, at(0, y))).toBe(0)
      expect(dropIndex(compact.placements, at(COLUMN, y))).toBe(1)
      expect(dropIndex(compact.placements, at(COLUMN * 2, y))).toBe(2)
    })

    it('uses the empty side of a lone half-width row as a pairing target', () => {
      const compact = layout(
        [module('a', 'delay'), module('b', 'out')],
        sizes({ delay: { span: 1 }, out: { span: 2 } }),
      )
      const y = ROW / 2

      expect(dropIndex(compact.placements, at(0, y))).toBe(0)
      expect(dropIndex(compact.placements, at(COLUMN * 1.5, y))).toBe(1)
    })
  })

  describe('reordering', () => {
    const list = ['a', 'b', 'c', 'd']

    it('moves a module up', () => {
      expect(reordered(list, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
    })

    it('moves a module down, accounting for its own removal', () => {
      // The classic off-by-one: remove from 1, insert at 3, and without the adjustment it lands at the
      // wrong place. Dragging one step down is the case that silently does nothing when this is wrong.
      expect(reordered(list, 1, 3)).toEqual(['a', 'c', 'b', 'd'])
      expect(reordered(list, 0, 4)).toEqual(['b', 'c', 'd', 'a'])
    })

    it('is the same array when the drop changes nothing', () => {
      // Identity, because the store bumps a revision on a structural edit and that rebuilds every
      // processor — a drag that ends where it started must not crackle.
      expect(reordered(list, 1, 1)).toBe(list)
      expect(reordered(list, 1, 2)).toBe(list)
    })

    it('clamps a drop outside the list rather than losing the module', () => {
      expect(reordered(list, 1, -10)).toEqual(['b', 'a', 'c', 'd'])
      expect(reordered(list, 1, 99)).toEqual(['a', 'c', 'd', 'b'])
    })

    it('ignores an index that is not in the list', () => {
      expect(reordered(list, -1, 2)).toBe(list)
      expect(reordered(list, 9, 2)).toBe(list)
    })

    it('never loses or duplicates a module, wherever it is dropped', () => {
      for (let from = 0; from < list.length; from++) {
        for (let to = 0; to <= list.length; to++) {
          const next = reordered(list, from, to)
          expect([...next].sort()).toEqual([...list].sort())
        }
      }
    })
  })
})
