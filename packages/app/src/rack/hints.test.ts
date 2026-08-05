import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { rackHint } from './hints.js'
import { RackFooter } from './RackFooter.js'
import { nextRackView, type RackView } from './view.js'

// The footer hint is the only instruction on the page, and it is wrong in a way nothing catches: a hint
// telling you to drag a knob while you are looking at the back of the rack is not a crash, not a visual
// glitch and not something a person reports — they simply conclude the instrument does not work the way
// it says. Six pairings, all six checked.

const VIEWS: RackView[] = ['rack', 'split', 'pad']

describe('the hint under the rack', () => {
  it('says something different for every side of every view', () => {
    const hints = VIEWS.flatMap((view) => [rackHint(view, false), rackHint(view, true)])
    expect(new Set(hints).size).toBe(6)
  })

  it('offers patching only where there are jacks to patch between', () => {
    expect(rackHint('rack', true)).toContain('Drag between jacks')
    // The back of the rack is not on screen in full-pad mode; the filter still is.
    expect(rackHint('pad', true)).toContain('filter still works')
    expect(rackHint('pad', true)).not.toContain('jacks')
  })

  it('offers the knobs only where a knob is reachable', () => {
    expect(rackHint('rack', false)).toContain('Drag a knob')
    expect(rackHint('split', false)).toContain('Drag knobs and pad together')
    expect(rackHint('pad', false)).toContain('Drag the pad')
    expect(rackHint('pad', false)).not.toContain('knob')
  })

  it('covers the whole cycle the View button walks', () => {
    let view: RackView = 'rack'
    for (let press = 0; press < 3; press++) {
      expect(rackHint(view, false)).not.toBe('')
      view = nextRackView(view)
    }
    expect(view).toBe('rack')
  })
})

describe('the footer', () => {
  it('counts the patch and carries the hint for the view it is under', () => {
    const html = renderToStaticMarkup(
      createElement(RackFooter, { modules: 7, cables: 12, rackView: 'split', flipped: true }),
    )
    expect(html).toContain('7 modules')
    expect(html).toContain('12 cables')
    expect(html).toContain(rackHint('split', true))
    // Findable rather than prominent: the build label is last, and it is the answer to "which build is
    // this?" — asked once, when something is wrong.
    expect(html).toContain('class="rk-build"')
    expect(html.indexOf('rk-hint')).toBeLessThan(html.indexOf('rk-build'))
  })
})
