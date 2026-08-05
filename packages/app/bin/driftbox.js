#!/usr/bin/env node
// `npx @driftbox/app` — serve the built app and open it.
//
// Node built-ins only, on purpose. What ships is a prebuilt bundle, so this needs no
// framework and no server library, and the package therefore has no runtime
// dependencies at all: npx fetches one small tarball and runs it. Adding express here
// would mean every user waits for an install tree to resolve before hearing a drum.
//
// Driftbox is a static single-page app with no routing and no backend — there is
// genuinely nothing to serve but files.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  // Without this the manifest is served as application/octet-stream and every browser ignores
  // it, so `npx @driftbox/app` would be the one way of running Driftbox that cannot be
  // installed — silently, because a rejected manifest is a devtools warning and nothing else.
  '.webmanifest': 'application/manifest+json',
}

function parseArgs(argv) {
  const args = { port: Number(process.env.PORT) || 4173, open: true, host: '127.0.0.1' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '-p') args.port = Number(argv[++i])
    else if (arg === '--host') args.host = argv[++i] ?? '0.0.0.0'
    else if (arg === '--no-open') args.open = false
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  return args
}

const HELP = `
  driftbox — a drum machine and step sequencer in the browser

  Usage
    npx @driftbox/app [options]

  Options
    -p, --port <number>   Port to listen on (default 4173, or $PORT)
        --host <address>  Address to bind (default 127.0.0.1)
        --no-open         Do not open a browser
    -h, --help            Show this

  Everything is saved in the browser, so your work stays on this machine.
`

function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    // Detached and ignored: if there is no browser to open — a container, a headless
    // box, an SSH session — that is not a reason to take the server down with it.
    spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
      .on('error', () => {})
      .unref()
  } catch {
    // The URL is printed either way; opening it is a convenience, not the feature.
  }
}

async function send(res, path, status = 200) {
  const body = await readFile(path)
  res.writeHead(status, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': body.length,
    // The app is served from disk and rebuilt by reinstalling, so caching only makes
    // a stale copy harder to get rid of.
    'cache-control': 'no-cache',
  })
  res.end(body)
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  process.stdout.write(HELP)
  process.exit(0)
}

try {
  await stat(join(ROOT, 'index.html'))
} catch {
  process.stderr.write(
    `driftbox: no built app found at ${ROOT}\n` +
      `If you are running from a checkout, build it first: npm run build\n`,
  )
  process.exit(1)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // normalize collapses `..` before it is joined, so a request for
    // /../../etc/passwd cannot climb out of dist.
    const path = normalize(decodeURIComponent(url.pathname))
    const target = join(ROOT, path)
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    const info = await stat(target).catch(() => null)
    if (info?.isFile()) return await send(res, target)
    if (path === '/') return await send(res, join(ROOT, 'index.html'))

    // Anything else redirects to the root rather than being served the app inline.
    //
    // Serving index.html here is the reflex, and it is wrong for this build: assets are
    // referenced relatively (`./assets/…`, so one dist/ works from both the Pages
    // subpath and the root), which means index.html served at /some/path sends the
    // browser looking for /some/assets/… — a miss, another index.html, and a page that
    // loads and then dies on a MIME type error. A redirect puts the app at the depth its
    // own relative paths were built for.
    //
    // Nothing is lost: Driftbox has no routes. The only meaningful URL is `/`, and a
    // shared song lives in the fragment, which the browser reapplies across a redirect
    // because it is never sent to the server in the first place.
    res.writeHead(302, { location: '/' })
    return res.end()
  } catch {
    res.writeHead(500).end('Internal error')
  }
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(
      `driftbox: port ${args.port} is already in use. Try: npx @driftbox/app --port ${args.port + 1}\n`,
    )
    process.exit(1)
  }
  throw error
})

server.listen(args.port, args.host, () => {
  const url = `http://${args.host === '0.0.0.0' ? 'localhost' : args.host}:${args.port}/`
  process.stdout.write(`\n  driftbox  ${url}\n  press ctrl-c to stop\n\n`)
  if (args.open) openBrowser(url)
})
