// Rasterise the app icon into the PNGs a web app manifest and iOS need.
//
// Run with `npm run icons --workspace @driftbox/app`. The outputs are committed, so this is
// not part of the build — it is the thing you re-run when `scripts/icon.svg` changes, and
// the reason it exists at all is that nothing else in this repo can turn that SVG into a
// bitmap.
//
// **It has to be a browser, and that is not laziness.** The icon's lit pads and its lead glow
// through `feGaussianBlur`, and its full-bleed variant is made by restyling the tile's geometry
// from CSS. A hand-rolled rasteriser would render flat squares with none of the glow, and every
// SVG library that gets it right is a large dependency this package has spent real effort not
// having. Chromium is already required to run the browser test project, so it is the one
// heavyweight tool that is not a new cost — same binary, same `DRIFTBOX_CHROMIUM` escape hatch
// as `vitest.config.ts`.
//
// Two drawings, not one. `public/favicon.svg` is its own small picture — four pads — because at
// sixteen pixels the full icon's sixteen pads and lead are a smudge, and the browser draws that
// file itself. `scripts/icon.svg` is the full picture, the same one the native app's icon is.
//
// Four outputs from it, and the last two are the ones people forget. `icon-192` and `icon-512`
// are the plain any-purpose icons: the rounded tile on transparent. `icon-maskable-512` bleeds the
// tile to the edges and draws it smaller, because Android crops a maskable icon to whatever shape
// the launcher wants and only a circle of 80% of the width is guaranteed to survive — so the
// view box is widened until every pad and the jack are inside it (the lead is meant to run off
// the edge). `apple-touch-icon` bleeds too, at iOS's 180: iOS rounds the corners itself, and a
// tile that was already rounded would sit in its own black corners.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')

/** The drawing's own view box: the 824 body of Apple's 1024 icon template. */
const TILE = '100 100 824 824'
/**
 * Wide enough that the pads and the jack sit inside the maskable safe circle: centred on them at
 * (512, 556), where the farthest of them — the jack's outer edge — is 459 away, and 459 is 40% of
 * 1148.
 */
const SAFE = '-62 -18 1148 1148'

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, bleed: false, viewBox: TILE },
  { file: 'icon-512.png', size: 512, bleed: false, viewBox: TILE },
  { file: 'icon-maskable-512.png', size: 512, bleed: true, viewBox: SAFE },
  { file: 'apple-touch-icon.png', size: 180, bleed: true, viewBox: TILE },
]

const svg = await readFile(join(here, 'icon.svg'), 'utf8')

const browser = await chromium.launch({ executablePath: process.env.DRIFTBOX_CHROMIUM })
try {
  for (const { file, size, bleed, viewBox } of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; }
         svg { display: block; width: ${size}px; height: ${size}px; }
       </style>
       ${svg}`,
      { waitUntil: 'load' },
    )
    await page.evaluate(
      ({ bleed, viewBox }) => {
        const root = document.querySelector('svg')
        root.setAttribute('viewBox', viewBox)
        if (bleed) root.classList.add('bleed')
      },
      { bleed, viewBox },
    )
    const png = await page.screenshot({ omitBackground: !bleed, type: 'png' })
    await mkdir(publicDir, { recursive: true })
    await writeFile(join(publicDir, file), png)
    await page.close()
    console.log(`${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)}kB`)
  }
} finally {
  await browser.close()
}
