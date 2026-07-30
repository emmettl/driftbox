import { MODULES } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import { rowsForJacks } from '../layout.js'
import { Generic, faceplateFor, genericRows, sizeFor } from './index.js'

// The registry is sparse and there is a fallback, and that is the whole design. These are the properties
// that make it worth having rather than sixteen hand-written components.

describe('choosing a faceplate', () => {
  it('gives every module in the registry something to draw', () => {
    for (const type of Object.keys(MODULES)) {
      expect(faceplateFor(type), type).toBeTypeOf('function')
    }
  })

  it('falls back to the generic one for a module nobody has drawn', () => {
    expect(faceplateFor('mixer')).toBe(Generic)
    expect(faceplateFor('quantizer')).toBe(Generic)
  })

  it('falls back for a module type that does not exist at all', () => {
    // Which is the case that matters for a patch from a newer build, and for third-party modules if they
    // ever happen: a faceplate without trusting anybody's markup.
    expect(faceplateFor('wavefolder')).toBe(Generic)
  })

  it('uses a hand-built faceplate where there is one', () => {
    expect(faceplateFor('vco')).not.toBe(Generic)
    expect(faceplateFor('ladder')).not.toBe(Generic)
  })
})

describe('how big a module is', () => {
  const size = sizeFor(MODULES)

  it('is at least as tall as its jacks need', () => {
    // The Mixer is the case: two knobs and eight inlets, so its height comes from the back panel and not
    // from the front. Getting this wrong puts its eighth inlet on top of the module below.
    for (const type of Object.keys(MODULES)) {
      expect(size(type).rows, type).toBeGreaterThanOrEqual(rowsForJacks(MODULES[type]))
    }
    expect(size('mixer').rows).toBeGreaterThan(1)
  })

  it('is at least as tall as its controls need', () => {
    for (const type of Object.keys(MODULES)) {
      const def = MODULES[type]
      const { span, rows } = size(type)
      // Only meaningful for the generic ones; a hand-built faceplate declares its own height.
      if (faceplateFor(type) !== Generic) continue
      expect(rows, type).toBeGreaterThanOrEqual(genericRows(def, span))
    }
  })

  it('makes the sequencer tall, because eighteen params do not fit in one row', () => {
    expect(size('seq').rows).toBeGreaterThan(3)
  })

  it('gives a module it has never heard of a size rather than throwing', () => {
    expect(size('wavefolder')).toMatchObject({ span: 2 })
    expect(size('wavefolder').rows).toBeGreaterThan(0)
  })

  it('keeps every module half or full width and nothing else', () => {
    for (const type of Object.keys(MODULES)) {
      expect([1, 2]).toContain(size(type).span)
    }
  })
})
