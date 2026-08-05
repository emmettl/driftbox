// Rasterise the favicon into the PNGs a web app manifest needs.
//
// Run with `npm run icons --workspace @driftbox/app`. The outputs are committed, so this is
// not part of the build — it is the thing you re-run when `public/favicon.svg` changes, and
// the reason it exists at all is that nothing else in this repo can turn that SVG into a
// bitmap.
//
// **It has to be a browser, and that is not laziness.** `favicon.svg` is not paths and fills:
// it is fifteen blurred ellipses behind an alpha mask, in `color(display-p3 ...)`, composited
// through `feGaussianBlur`. A hand-rolled rasteriser would render a purple arrow with none of
// the glow, and every SVG library that gets it right is a large dependency this package has
// spent real effort not having. Chromium is already required to run the browser test project,
// so it is the one heavyweight tool that is not a new cost — same binary, same
// `DRIFTBOX_CHROMIUM` escape hatch as `vitest.config.ts`.
//
// Three outputs, and the third is the one people forget. `icon-192` and `icon-512` are the
// plain any-purpose icons. `icon-maskable-512` is the same artwork inset to 60% of the canvas
// on the theme background, because Android crops a maskable icon to whatever shape the launcher
// wants — a circle, a squircle, a rounded square — and only the middle 80% of the width is
// guaranteed to survive. An edge-to-edge logo declared maskable comes out with its points cut
// off, which is worse than not declaring it at all.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')

/** The page background, and the fill behind a maskable icon. Matches `theme-color` in both pages. */
const BACKGROUND = '#07040f'

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, inset: 1 },
  { file: 'icon-512.png', size: 512, inset: 1 },
  // 0.6 rather than the permitted 0.8: the artwork is a tall arrow with a point at the bottom,
  // and the safe zone is a circle inscribed in the square, so the corners of its bounding box
  // are outside it even at exactly 80%.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.6 },
]

const svg = await readFile(join(publicDir, 'favicon.svg'), 'utf8')

const browser = await chromium.launch({ executablePath: process.env.DRIFTBOX_CHROMIUM })
try {
  for (const { file, size, inset } of OUTPUTS) {
    // deviceScaleFactor rather than a large viewport: the SVG has a 48x46 viewBox and CSS
    // pixel dimensions, so scaling the device is what renders the blurs at full resolution
    // instead of rendering them small and letting the screenshot upscale.
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html, body { margin: 0; width: ${size}px; height: ${size}px; }
         body {
           background: ${inset < 1 ? BACKGROUND : 'transparent'};
           display: grid;
           place-items: center;
         }
         svg { width: ${Math.round(size * inset)}px; height: auto; display: block; }
       </style>
       ${svg}`,
      { waitUntil: 'load' },
    )
    const png = await page.screenshot({ omitBackground: inset === 1, type: 'png' })
    await mkdir(publicDir, { recursive: true })
    await writeFile(join(publicDir, file), png)
    await page.close()
    console.log(`${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)}kB`)
  }
} finally {
  await browser.close()
}
