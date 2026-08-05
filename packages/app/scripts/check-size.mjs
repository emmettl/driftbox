// What it costs to open each page, asserted.
//
// Run against a built `dist/` — `npm run build` first, then `npm run check:size --workspace
// @driftbox/app`. CI runs it after its build.
//
// **The budget is per page, not per chunk.** A chunk table is easy to write and measures the wrong
// thing: splitting one 400kB chunk into four 100kB ones that are all still fetched on load looks
// like an improvement and is not. What a visitor pays is the entry script plus everything the
// build declared as a `modulepreload`, which is exactly the static import graph, and that is the
// number budgeted here.
//
// The structural assertion below it is the one that actually protects the scene split, and it is
// not a number at all: no scene may appear in a page's first-load graph. A single static import
// added to `scenes/index.ts` — a shared helper, a type that turns out to be a value — quietly
// welds all eighteen back into the entry, and the size ceiling alone would not necessarily catch
// it, because eighteen small scenes fit inside the headroom that keeps a ceiling from being
// brittle.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const DIST = join(here, '..', 'dist')

/**
 * Ceilings in gzipped kilobytes, which is what actually crosses a network.
 *
 * Headroom is deliberately small. A budget with 50% slack is a budget that notices nothing until
 * the damage is done; one this tight will occasionally need raising with a real dependency, and
 * raising it is then a decision somebody makes on purpose rather than a number nobody looked at.
 *
 * `three` is most of both figures — around 220kB gzipped on its own — and it is fetched eagerly
 * because a phone opens straight into the visuals. Deferring it is the next real win available
 * here, and it is a product decision rather than a build one.
 */
const BUDGET = {
  'index.html': 390,
  'rack.html': 515,
  /** Any one scene, fetched on demand. The largest today is GraphicLab at about 3.6kB. */
  scene: 8,
}

const gzipKb = (file) => gzipSync(readFileSync(join(DIST, file))).length / 1024

/** The component names in the registry, which are also the chunk names rolldown gives them. */
function sceneNames() {
  const registry = readFileSync(join(here, '..', 'src', 'visual', 'scenes', 'index.ts'), 'utf8')
  return [...registry.matchAll(/import\('\.\/(\w+)'\)/g)].map((match) => match[1])
}

/** Everything a page fetches before it can run: its entry, and every declared modulepreload. */
function firstLoad(page) {
  const html = readFileSync(join(DIST, page), 'utf8')
  return [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((match) => match[1])
}

const scenes = sceneNames()
const failures = []

for (const page of ['index.html', 'rack.html']) {
  const files = firstLoad(page)
  const total = files.reduce((sum, file) => sum + gzipKb(file), 0)
  const budget = BUDGET[page]
  const verdict = total <= budget ? '✓' : '✗'
  console.log(
    `${verdict} ${page.padEnd(11)} ${total.toFixed(0).padStart(4)}kB gzip of ${String(files.length).padStart(2)} files (budget ${budget}kB)`,
  )
  if (total > budget) failures.push(`${page} is ${(total - budget).toFixed(0)}kB over budget`)

  // The structural one. A scene in here means the registry stopped being lazy.
  const eager = files.filter((file) =>
    scenes.some((scene) => file.startsWith(`assets/${scene}-`)),
  )
  if (eager.length) {
    failures.push(`${page} loads ${eager.length} scene(s) eagerly: ${eager.join(', ')}`)
  }
}

const built = new Set([...firstLoad('index.html'), ...firstLoad('rack.html')])
const emitted = readdirSync(join(DIST, 'assets')).map((name) => `assets/${name}`)

let largest = { name: '', size: 0 }
for (const scene of scenes) {
  const file = emitted.find((name) => name.startsWith(`assets/${scene}-`) && name.endsWith('.js'))
  if (!file) {
    failures.push(`no chunk for scene ${scene} — did it stop being split out?`)
    continue
  }
  const size = gzipKb(file)
  if (size > largest.size) largest = { name: scene, size }
  if (size > BUDGET.scene) {
    failures.push(`scene ${scene} is ${size.toFixed(1)}kB gzip, over the ${BUDGET.scene}kB ceiling`)
  }
}
console.log(
  `${failures.length ? '·' : '✓'} scenes      ${scenes.length} split out, largest ${largest.name} at ${largest.size.toFixed(1)}kB gzip (ceiling ${BUDGET.scene}kB)`,
)

if (failures.length) {
  console.error('\n' + failures.map((line) => `  ${line}`).join('\n'))
  console.error(
    '\nIf the growth is real and wanted, raise the number in scripts/check-size.mjs in the same commit.',
  )
  process.exit(1)
}
console.log(`  (${built.size} distinct files across both first loads)`)
