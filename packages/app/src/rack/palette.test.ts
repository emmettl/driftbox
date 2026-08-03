import { CHUNKS, MODULE_LIST } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { browse } from './browse.js'
import { Palette } from './Palette.js'

// The picker, which is where somebody finds out what this instrument can do.
//
// Two things worth holding it to. **Everything is reachable**: a module that exists but never appears here
// might as well not exist, and the flat list it replaced at least had the virtue of being obviously
// complete. And **the search finds things by what they are for**, not only by name — "wobble" should find
// the LFO, because that is how somebody who does not yet know the word "LFO" would look for one.

describe('browsing everything', () => {
  it('shows every module the rack has', () => {
    const { shelves } = browse('')
    const shown = shelves.flatMap((shelf) => shelf.modules)
    expect(shown).toHaveLength(MODULE_LIST.length)
    expect(shown.map((def) => def.type).sort()).toEqual(MODULE_LIST.map((def) => def.type).sort())
  })

  it('shows every chunk', () => {
    expect(browse('').chunks).toHaveLength(CHUNKS.length)
  })

  it('opens each shelf exactly once', () => {
    // One pass over MODULE_LIST, so a module out of group order would open a second shelf with the same
    // heading. `modules.test.ts` holds the list to the order; this checks the consequence here.
    const groups = browse('').shelves.map((shelf) => shelf.group)
    expect(new Set(groups).size).toBe(groups.length)
  })

  it('keeps the list order inside a shelf', () => {
    // Grouping by sorting would lose it, and the order is deliberate: the thing you probably want first.
    for (const shelf of browse('').shelves) {
      const positions = shelf.modules.map((def) => MODULE_LIST.indexOf(def))
      expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    }
  })

  it('starts with sources and ends with the output', () => {
    const groups = browse('').shelves.map((shelf) => shelf.group)
    expect(groups[0]).toBe('Sources')
    expect(groups[groups.length - 1]).toBe('Mixing')
  })
})

describe('searching', () => {
  const types = (query: string) =>
    browse(query)
      .shelves.flatMap((shelf) => shelf.modules)
      .map((def) => def.type)

  it('finds a module by name, whatever the case', () => {
    // The Voice matches too, because its description says it has a ladder filter in it — which is a
    // better answer than hiding it, not a false positive. What matters is that the module actually
    // called Ladder is found; the search deliberately reads descriptions as well as names.
    expect(types('ladder')).toContain('ladder')
    expect(types('LADDER')).toEqual(types('ladder'))
  })

  it('finds a module by what it is for rather than by its name', () => {
    // The whole reason the blurbs are searched and not only the names. Somebody who wants a wobble does
    // not know to type "LFO", and a picker that only matched names would tell them the rack has nothing.
    expect(types('wobble')).toContain('lfo')
    expect(types('chopping')).toContain('sampler')
    expect(types('scale')).toContain('quantizer')
  })

  it('finds a whole shelf by its heading', () => {
    expect(types('filters')).toEqual(['ladder', 'svf', 'alligator', 'vocoder'])
  })

  it('searches the chunks too', () => {
    expect(browse('chopped').chunks.length).toBeGreaterThan(0)
  })

  it('comes back empty rather than falling back to everything', () => {
    // A search with no hits that quietly showed the whole list would read as "your search did nothing"
    // and is the more confusing of the two failures.
    const { chunks, shelves } = browse('zzzzz')
    expect(shelves).toEqual([])
    expect(chunks).toEqual([])
  })
})

/** Text as React will have written it into the markup. Only the entities these sentences actually use. */
const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#x27;')

describe('what the picker draws', () => {
  const markup = renderToStaticMarkup(
    createElement(Palette, { onModule: () => {}, onChunk: () => {}, onClose: () => {} }),
  )

  it('gives every module a card with its name and its sentence', () => {
    for (const def of MODULE_LIST) {
      expect(markup, def.type).toContain(`>${escaped(def.name)}<`)
      // The description is the point of the whole exercise, so a module whose blurb silently failed to
      // render would leave exactly the list of bare names this replaced.
      //
      // Compared against the escaped text, because React escapes an apostrophe to `&#x27;` and half these
      // sentences have one in — "the 303's filter", "another's shape".
      expect(markup, def.type).toContain(escaped(def.blurb!).slice(0, 40))
    }
  })

  it('draws every shipped module logo as safe SVG path data', () => {
    expect(markup.match(/class="rk-card-logo"/g)).toHaveLength(MODULE_LIST.length)
    expect(markup.match(/<svg /g)).toHaveLength(MODULE_LIST.length)
    expect(markup).not.toContain('dangerouslySetInnerHTML')
  })

  it('heads each shelf', () => {
    for (const shelf of browse('').shelves) expect(markup).toContain(`>${shelf.group}<`)
  })

  it('marks chunks as chunks, because dropping one does more than adding a module', () => {
    expect(markup).toContain('rk-card-chunk')
  })

  it('is an explicit, dismissible catalog with a scroll cue', () => {
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-label="Close module catalog"')
    expect(markup).toContain('Scroll to browse')
  })
})
