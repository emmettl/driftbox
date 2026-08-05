// Does it actually open with the network switched off?
//
// Run against a built `dist/` — `npm run build` first, then `npm run verify:offline --workspace
// @driftbox/app`. CI runs it after its build for the same reason the level measurements moved out
// of `docs/VERIFYING-AUDIO.md`: this is a claim that can only be tested by doing it, and a check
// that finds real problems should not depend on somebody remembering to do it.
//
// **Both roots, not one.** One build serves the Pages project site at `/driftbox/` and
// `npx @driftbox/app` at the root, and every path involved in offline support is relative so that
// it can — the precache list, the manifest, the registration, the scope. All four are correct at
// the root by accident even when written absolutely, so serving from the root alone would pass
// while the deployed site cached nothing. The subdirectory is the case that actually discriminates.
//
// It found the bug it was written for. The first version of the precache plugin ran at normal
// plugin order and emitted a list with every script in it and neither HTML document, and this is
// what noticed — the build succeeded, the app worked online, and reloading offline showed the
// browser's dinosaur.

import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
}

/** Serve dist/ under `prefix`, which is '' for the root and '/driftbox' for the Pages shape. */
function serve(prefix) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (prefix && !url.pathname.startsWith(prefix)) return res.writeHead(404).end()
      let path = url.pathname.slice(prefix.length) || '/'
      if (path.endsWith('/')) path += 'index.html'
      const file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''))
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-cache',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

async function check(prefix, label) {
  const server = await serve(prefix)
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}${prefix}/`
  const browser = await chromium.launch({ executablePath: process.env.DRIFTBOX_CHROMIUM })
  const context = await browser.newContext()
  const failures = []

  try {
    const page = await context.newPage()
    await page.goto(base, { waitUntil: 'load' })

    // The registration deliberately waits for load, so this waits for it in turn rather than
    // assuming it has already happened.
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
      timeout: 15_000,
    })
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
    if (!scope.endsWith(prefix ? `${prefix}/` : '/')) {
      failures.push(`scope is ${scope}, which does not control ${base}`)
    }

    // What the worker actually stored, rather than what it was asked to store. addAll is atomic,
    // so a single 404 in the list leaves this empty — which is the difference between an app that
    // opens offline and one that has a service worker and opens nothing.
    const cached = await page.evaluate(async () => {
      const names = await caches.keys()
      const cache = await caches.open(names.find((n) => n.startsWith('driftbox-')))
      return (await cache.keys()).map((request) => new URL(request.url).pathname)
    })
    if (!cached.some((path) => path.endsWith('index.html'))) failures.push('index.html not cached')
    if (!cached.some((path) => path.endsWith('rack.html'))) failures.push('rack.html not cached')
    if (!cached.some((path) => path.endsWith('/'))) failures.push('the directory itself not cached')

    // The measurement. Everything above is evidence; this is the claim.
    await context.setOffline(true)
    await page.reload({ waitUntil: 'load' })
    const mounted = await page.evaluate(() => document.getElementById('root')?.childElementCount)
    if (!mounted) failures.push('the app did not mount offline')

    // The rack too, because it is a second document and the shortcut in the manifest points at it.
    const rack = await context.newPage()
    await rack.goto(`${base}rack.html`, { waitUntil: 'load' })
    const rackMounted = await rack.evaluate(() => document.getElementById('root')?.childElementCount)
    if (!rackMounted) failures.push('the rack did not mount offline')

    console.log(
      failures.length
        ? `✗ ${label}: ${failures.join('; ')}`
        : `✓ ${label}: ${cached.length} entries cached, both pages open offline`,
    )
  } finally {
    await browser.close()
    server.close()
  }
  return failures.length === 0
}

try {
  await stat(join(DIST, 'sw.js'))
} catch {
  console.error('No dist/sw.js — run `npm run build` first.')
  process.exit(1)
}

const results = []
results.push(await check('', 'served at the root, as npx does'))
results.push(await check('/driftbox', 'served at /driftbox/, as GitHub Pages does'))
if (results.includes(false)) process.exit(1)
