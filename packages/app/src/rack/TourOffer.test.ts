import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TourOffer } from './TourOffer.js'

// The one thing this page ever asks anybody. It is shown once, on the first visit this browser has ever
// made, and both buttons have to answer it — a "not now" that leaves the offer to reappear on the next
// visit is a dialog that cannot be dismissed.

describe('the offer of a guided tour', () => {
  it('asks a question, and offers both answers as buttons', () => {
    const html = renderToStaticMarkup(
      createElement(TourOffer, { onStart: () => {}, onDecline: () => {} }),
    )
    expect(html).toContain('First time in the rack?')
    expect(html).toContain('Start the tour')
    expect(html).toContain('Not now')
    // Both are real buttons rather than a link and an ×, so both are reachable from the keyboard.
    expect(html.match(/<button type="button"/g)).toHaveLength(2)
    // Neither submits anything: this paragraph has lived inside a form-less page and must stay that way.
    expect(html).not.toContain('type="submit"')
  })

  it('leads with the answer that does something', () => {
    const html = renderToStaticMarkup(
      createElement(TourOffer, { onStart: () => {}, onDecline: () => {} }),
    )
    expect(html.indexOf('Start the tour')).toBeLessThan(html.indexOf('Not now'))
    expect(html).toContain('rk-primary')
  })

  it('promises what the tour costs and what it does not touch', () => {
    const html = renderToStaticMarkup(
      createElement(TourOffer, { onStart: vi.fn(), onDecline: vi.fn() }),
    )
    expect(html).toContain('three-minute')
    // The rack is somebody's document from the first frame; a tour that edited it would be unforgivable.
    expect(html).toContain('never touches the rack itself')
  })
})
