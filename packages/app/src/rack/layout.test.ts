import { MODULES } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import { COLUMN, JACK, ROW, jackAt, jacks, layout, rowsForJacks, type Size } from './layout.js'

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
      for (const port of [...def.inlets, ...def.outlets]) {
        expect(jackAt(all, placement.id, port.id), `${placement.type}.${port.id}`).toBeDefined()
      }
    }
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
