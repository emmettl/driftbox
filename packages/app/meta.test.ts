import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Link previews, held to the things that break them silently.
//
// **A wrong preview never fails a build and never shows up in the app.** It is only visible in somebody
// else's chat window, after the link has been sent, which is the worst possible place to find out. Every
// assertion here is a failure that has a name: a relative `og:image` (the commonest reason a card comes
// back blank, because crawlers do not resolve one against the page), dimensions that no longer match the
// file (WhatsApp then falls back to a small square thumbnail instead of the wide card), or an image that
// is not in `public/` at all.
//
// Both pages are checked by the same rules rather than only the new one. The rack card exists because the
// sequencer's card would have been describing the wrong instrument; the same logic says the next page
// added should not be able to ship without one.

const pages = ['index.html', 'rack.html'] as const

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/** Every `<meta>` on the page, by `property` or `name`. Attribute order is not guaranteed, so this reads
 *  each tag's attributes rather than assuming `property` comes first. */
function metas(html: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, tag] of html.matchAll(/<meta\s([^>]*?)\/?>/gs)) {
    const key = /(?:property|name)=["']([^"']+)["']/s.exec(tag)?.[1]
    const content = /content=["']([^"']*)["']/s.exec(tag)?.[1]
    if (key && content !== undefined) found.set(key, content)
  }
  return found
}

const title = (html: string) => /<title>([^<]*)<\/title>/s.exec(html)?.[1]

/** A PNG's own idea of its size: the IHDR chunk, which starts at byte 16 of any valid file. */
function pngSize(name: string): { width: number; height: number } {
  const bytes = readFileSync(new URL(`./public/${name}`, import.meta.url))
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe.each(pages)('%s', (page) => {
  const html = read(page)
  const meta = metas(html)

  it('carries the whole card, not half of one', () => {
    // Half a card is worse than none: Slack shows a bare link, and WhatsApp shows the title with an
    // empty image box.
    for (const key of [
      'og:type',
      'og:site_name',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'og:image:secure_url',
      'og:image:type',
      'og:image:width',
      'og:image:height',
      'og:image:alt',
      'twitter:card',
      'twitter:title',
      'twitter:description',
      'twitter:image',
      'twitter:image:alt',
    ]) {
      expect(meta.get(key), `${page} is missing ${key}`).toBeTruthy()
    }
  })

  it('points at absolute https URLs', () => {
    // The one that costs a blank card. A crawler is not on the page and cannot resolve `/og.png`.
    for (const key of ['og:url', 'og:image', 'og:image:secure_url', 'twitter:image']) {
      expect(meta.get(key), key).toMatch(/^https:\/\/emmettl\.github\.io\/driftbox\//)
    }
  })

  it('declares the size the image actually is', () => {
    // Regenerating the screenshot at a different viewport is the obvious way to break this, and it is
    // exactly what these two files invite somebody to do.
    const file = meta.get('og:image')!.split('/').pop()!
    const { width, height } = pngSize(file)
    expect(Number(meta.get('og:image:width'))).toBe(width)
    expect(Number(meta.get('og:image:height'))).toBe(height)
    // Wide, not square. Under about 1.6:1 the card degrades to a thumbnail in several clients.
    expect(width / height).toBeGreaterThan(1.7)
  })

  it('says the same thing in the title, the og:title and the tweet', () => {
    expect(meta.get('og:title')).toBe(title(html))
    expect(meta.get('twitter:title')).toBe(title(html))
    expect(meta.get('og:image')).toBe(meta.get('og:image:secure_url'))
    expect(meta.get('og:image')).toBe(meta.get('twitter:image'))
  })

  it('describes the page in the description as well as the card', () => {
    expect(meta.get('description')).toBe(meta.get('og:description'))
  })
})

describe('the two pages together', () => {
  const cards = pages.map((page) => ({ page, meta: metas(read(page)) }))

  it('do not share a card', () => {
    // The whole reason the rack got its own: a shared rack link previewing as a step grid describes the
    // wrong instrument.
    const [sequencer, rack] = cards
    expect(rack.meta.get('og:url')).not.toBe(sequencer.meta.get('og:url'))
    expect(rack.meta.get('og:image')).not.toBe(sequencer.meta.get('og:image'))
    expect(rack.meta.get('og:title')).not.toBe(sequencer.meta.get('og:title'))
  })

  it('agree on whose site they are', () => {
    for (const { page, meta } of cards) {
      expect(meta.get('og:site_name'), page).toBe('Driftbox')
      expect(meta.get('twitter:card'), page).toBe('summary_large_image')
      expect(meta.get('og:locale'), page).toBe('en_GB')
    }
  })
})
