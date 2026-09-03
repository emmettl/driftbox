import { test } from 'vitest'
import { compile } from './compile.js'
import { Graph } from './graph.js'
import { MODULES } from './modules/index.js'
import { CHUNKS, insertChunk } from './chunks/index.js'
import { PATCHES } from './patches/index.js'
import { EMPTY_PATCH } from './index.js'
import type { ModuleDef, Patch } from './types.js'

// How much headroom the audio thread has, measured rather than assumed.
//
// **Not part of `npm test`.** Vitest picks benchmarks up only under `vitest bench`, which is deliberate: a
// timing assertion in CI fails on a slow runner and teaches everybody to ignore it, which is worse than
// having no number at all. Run `npm run bench` when a change might be expensive — a new module with a
// filter bank in it, anything that touches `Graph.process`.
//
// A Graph is arithmetic over Float32Arrays with no AudioContext anywhere, which is what makes this
// possible in Node at all — the same property the tests rely on.
//
// **What the number is not.** This is Node on a developer machine, not an AudioWorklet on somebody's
// phone. A worklet has a hard deadline and a phone can be the best part of an order of magnitude slower,
// so treat the ratio as a relative measure between patches and between commits, not as a promise about
// any particular device. The useful reading is "this patch is three times the work of that one", and
// "this commit did not make it five times worse".

const SR = 44100
const FRAMES = 128
/** Enough blocks that the measurement is not dominated by the harness. */
const BLOCKS = 400

function ready(patch: Patch) {
  const modules: Record<string, ModuleDef['processor']> = {}
  const deps: Record<string, unknown> = {}
  for (const def of Object.values(MODULES)) {
    modules[def.type] = def.processor
    for (const [key, dep] of Object.entries(def.deps ?? {})) deps[key] = dep
  }
  const graph = new Graph(SR, FRAMES, modules, deps)
  graph.setPlan(compile(patch, MODULES))
  graph.setTransport(174, true)
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  // Warm, so the first measured iteration is not paying for JIT and for every filter's first-block
  // coefficient computation.
  for (let i = 0; i < 200; i++) graph.process(channels)
  return () => {
    for (let i = 0; i < BLOCKS; i++) graph.process(channels)
  }
}

test('shipped patches', async ({ bench }) => {
  await bench.compare(...PATCHES.map((preset) => bench(preset.id, ready(preset.build()))))
})

test('chunks, one at a time', async ({ bench }) => {
  await bench.compare(
    ...CHUNKS.map((chunk) => bench(chunk.id, ready(insertChunk(EMPTY_PATCH, chunk).patch))),
  )
})

test('deliberately heavy', async ({ bench }) => {
  // Every chunk at once — more than anybody would build, and the honest ceiling.
  let all = EMPTY_PATCH
  for (const chunk of CHUNKS) all = insertChunk(all, chunk).patch
  // The most expensive module in the rack, four times over at its widest setting: 256 filters and 128
  // envelope followers per sample. Nothing sensible looks like this; it is here to bound the worst case.
  await bench.compare(
    bench(`every chunk (${all.modules.length} modules)`, ready(all)),
    bench(
      'four 32-band vocoders',
      ready({
        modules: [
          { id: 'n', type: 'noise' },
          ...Array.from({ length: 4 }, (_, i) => ({
            id: `v${i}`,
            type: 'vocoder',
            params: { bands: 2 },
          })),
          { id: 'out', type: 'out' },
        ],
        cables: [
          ...Array.from({ length: 4 }, (_, i) => ({
            from: ['n', 'white'] as [string, string],
            to: [`v${i}`, 'carrier'] as [string, string],
          })),
          ...Array.from({ length: 4 }, (_, i) => ({
            from: ['n', 'pink'] as [string, string],
            to: [`v${i}`, 'mod'] as [string, string],
          })),
          ...Array.from({ length: 4 }, (_, i) => ({
            from: [`v${i}`, 'out'] as [string, string],
            to: ['out', 'in'] as [string, string],
          })),
        ],
      }),
    ),
  )
})
