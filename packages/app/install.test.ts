import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The manifest, held to the reasons a browser silently declines to install an app.
//
// It declines silently. A manifest with a relative `start_url` that escapes its scope, an icon
// that is not really the size it claims, or no maskable icon at all produces a devtools warning
// on a page nobody has devtools open on, and an install prompt that simply never appears. There
// is no failing request and nothing in the app looks wrong.

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
  shortcuts: { url: string }[]
}

/** A PNG's own idea of its size: the IHDR chunk, which starts at byte 16 of any valid file. */
function pngSize(src: string): { width: number; height: number } {
  const bytes = readFileSync(new URL(`./public/${src.replace(/^\.\//, '')}`, import.meta.url))
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('the web app manifest', () => {
  it('is relative throughout, because one build is served from two roots', () => {
    // Same rule as `base: './'` and the precache list. An absolute `start_url` would launch the
    // installed app at the wrong path on GitHub Pages or under `npx`, whichever one it was not
    // written for — and an installed app that opens a 404 is worse than one that never installed.
    const paths = [
      manifest.start_url,
      manifest.scope,
      ...manifest.icons.map((icon) => icon.src),
      ...manifest.shortcuts.map((shortcut) => shortcut.url),
    ]
    for (const path of paths) expect(path.startsWith('/')).toBe(false)
  })

  it('ships a maskable icon as well as a plain one', () => {
    // Android crops any icon to the launcher's shape. Without a maskable entry it crops the plain
    // one, which is edge-to-edge artwork, and the points of the bolt come off.
    const purposes = manifest.icons.map((icon) => icon.purpose)
    expect(purposes).toContain('maskable')
    expect(purposes).toContain('any')
  })

  it('has the two sizes an install actually requires', () => {
    // 192 for the launcher, 512 for the splash screen. Chrome refuses the install prompt without
    // both, and says so only in a devtools warning.
    const sizes = manifest.icons.filter((icon) => icon.purpose !== 'maskable').map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('has icons that really are the size they claim', () => {
    // `scripts/icons.mjs` regenerates these from favicon.svg, and the failure mode of forgetting
    // to re-run it is an icon that lies about its dimensions rather than one that is missing.
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split('x').map(Number)
      expect(pngSize(icon.src)).toEqual({ width, height })
    }
  })

  it('opens standalone, in the colours the pages already declare', () => {
    expect(manifest.display).toBe('standalone')
    // Anything else here and the installed app flashes a white splash before a dark visualiser.
    expect(manifest.theme_color).toBe('#07040f')
    expect(manifest.background_color).toBe('#07040f')
  })

  it('starts at the sequencer, with the rack as a shortcut', () => {
    // One installed app with two pages, rather than two icons for one product.
    expect(manifest.start_url).toBe('./')
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual(['./rack.html'])
  })
})

describe.each(['index.html', 'rack.html'])('%s', (page) => {
  const html = read(page)

  it('links the manifest', () => {
    // Both pages, because either can be the one somebody installs from.
    expect(html).toMatch(/<link rel="manifest" href="[^"]*manifest\.webmanifest" \/>/)
  })

  it('names an apple-touch-icon', () => {
    // iOS reads neither the manifest's icons nor an SVG favicon for the home screen. Without this
    // it renders a screenshot of the page, which for a dark visualiser is a black square.
    expect(html).toMatch(/<link rel="apple-touch-icon" href="[^"]*icon-192\.png" \/>/)
  })
})
