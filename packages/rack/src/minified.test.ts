import { rolldown } from 'rolldown'
import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { Graph } from './graph.js'
import { MODULES } from './modules/index.js'
import type { Patch, Registry } from './types.js'

// The one failure that only happens in somebody else's build.
//
// `worklet.ts` assembles the audio thread's source with `toString()`, so what the browser evaluates is
// whatever the *consumer's bundler* left behind. This runs that for real: the package is bundled and
// minified by rolldown — the bundler the app's own Vite build uses, and the one whose output produced the
// discovery recorded at the top of `worklet.ts` — and the worklet is then assembled from that minified
// module, evaluated in a bare scope, and measured against the same patch running unminified in this one.
//
// **What it guards is that the assembled source still parses and still sounds the same.** That is the
// "silent in production only" class of failure: a scheme that derives an identifier from `Class.name`, a
// downlevel helper hoisted to module scope, a transform that rewrites a class body into something
// `toString()` can no longer stand alone. All of them build fine, test fine unminified, and produce a
// worklet that fails to parse — every patch silent, in a consumer's build, with ours working perfectly.
//
// **What it does not guard is everything.** Two things were measured while writing it, both worth knowing
// and neither flattering to the idea that one bundler can settle this:
//
//   - Minified, a dep class serialises to `class{s0=0;...}` — anonymous, as `worklet.ts` says. But its
//     `.name` under rolldown 1.2.2 is not empty: it reads as the *mangled binding*, `me` or `Sn` or `Xt`.
//     So a name-derived scheme is not reliably broken, it is **bundler-dependently** broken — it would work
//     here and fail wherever the name really is empty. That is a stronger argument for looking dependencies
//     up by string key than the original one, not a weaker one, and it is why this test asserts on the
//     assembled artefact rather than on any bundler's behaviour.
//   - A minifier **inlines** a captured module-scope constant, so the classic capture bug — a processor
//     referring to something outside itself — can pass here while failing unminified. `modules.test.ts`
//     catches that one, and catches it in every module rather than in whichever ones a patch here happens
//     to use. The two are complementary; this is not a superset of that.
//
// The `@driftbox/engine` import is aliased to source the way `packages/app/vite.config.ts` aliases it, both
// so this does not depend on the engine having been built and because that alias is what the app really
// ships — the engine's `Ladder` goes through this same minifier on its way into the bundle.

const SR = 44100
const FRAMES = 128
const BLOCKS = 8

/** Everything the hazard touches at once: a module with a `deps` class, and one with the shared PRNG. */
const PATCH: Patch = {
  modules: [
    { id: 'osc', type: 'vco', params: { tune: 7 } },
    { id: 'hiss', type: 'noise', params: { colour: 1 } },
    { id: 'mix', type: 'mixer', params: { level1: 0.8, level2: 0.2 } },
    { id: 'filter', type: 'ladder', params: { cutoff: 900, resonance: 0.7 } },
    { id: 'out', type: 'out' },
  ],
  cables: [
    { from: ['osc', 'out'], to: ['mix', 'in1'] },
    { from: ['hiss', 'out'], to: ['mix', 'in2'] },
    { from: ['mix', 'out'], to: ['filter', 'in'] },
    { from: ['filter', 'out'], to: ['out', 'in'] },
  ],
}

interface Instance {
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
  port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: unknown): void }
}

interface Bundled {
  rackSource(registry: Registry): string
  compile: typeof compile
  MODULES: Registry
  RACK_PROCESSOR: string
}

/**
 * This package's own entry point, as a path rolldown will resolve.
 *
 * `new URL(...).pathname` rather than `fileURLToPath`: this package's tsconfig deliberately has no Node
 * types — everything in `src` is DOM or nothing — and one test is a poor reason to give the whole program
 * `process` and `Buffer`. Decoded because a checkout under a path with a space in it would otherwise arrive
 * percent-encoded.
 */
const entry = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname)

/** Bundle and minify this package, then load what came out. */
async function minifiedPackage(): Promise<Bundled> {
  const bundle = await rolldown({
    input: entry('./index.ts'),
    resolve: {
      alias: {
        '@driftbox/engine': entry('../../engine/src/index.ts'),
      },
    },
    // Quiet: rolldown warns about circular imports this package has always had and which are not what is
    // under test here.
    onwarn: () => {},
  })
  const { output } = await bundle.generate({ format: 'esm', minify: true })
  await bundle.close()

  const code = output[0].code
  // Imported as a data URL rather than written to disk: nothing here needs a file, and a temporary one in a
  // package that publishes `src` is a way to ship a stray artefact.
  // `encodeURIComponent` rather than base64 for the same reason: it needs no Buffer, and a data URL is a
  // data URL either way.
  const loaded = (await import(
    `data:text/javascript,${encodeURIComponent(code)}`
  )) as Bundled
  return loaded
}

/** Evaluate assembled worklet source in a scope of its own, as `worklet.test.ts` does. */
function instantiate(source: string, processorName: string): Instance {
  class FakeAudioWorkletProcessor {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: () => {},
    }
  }

  const registered = new Map<string, new () => Instance>()
  const evaluate = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)
  evaluate(
    FakeAudioWorkletProcessor,
    (name: string, Constructor: new () => Instance) => registered.set(name, Constructor),
    SR,
  )

  const Processor = registered.get(processorName)
  expect(Processor, 'the minified worklet registered no processor').toBeDefined()
  return new Processor!()
}

function render(instance: Instance, blocks: number): Float64Array {
  const out = new Float64Array(blocks * FRAMES)
  for (let block = 0; block < blocks; block++) {
    ;(globalThis as { currentFrame?: number }).currentFrame = block * FRAMES
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    expect(instance.process([], [channels])).toBe(true)
    out.set(channels[0], block * FRAMES)
  }
  return out
}

/** The same patch through a Graph in this scope, unminified — the answer to match. */
function locally(blocks: number): Float64Array {
  const modules: Record<string, Registry[string]['processor']> = {}
  const deps: Record<string, unknown> = {}
  for (const def of Object.values(MODULES)) {
    modules[def.type] = def.processor
    for (const [name, dep] of Object.entries(def.deps ?? {})) deps[name] = dep
  }
  const graph = new Graph(SR, FRAMES, modules, deps)
  graph.setPlan(compile(PATCH, MODULES))

  const out = new Float64Array(blocks * FRAMES)
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  for (let block = 0; block < blocks; block++) {
    graph.process(channels)
    out.set(channels[0], block * FRAMES)
  }
  return out
}

function rms(data: Float64Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

describe('the package after a consumer has minified it', () => {
  it('still assembles a worklet that parses, runs, and sounds identical', async () => {
    const bundled = await minifiedPackage()

    // The assembled source is the artefact. Named classes are gone by now — that is the point — so the
    // check is that nothing in it depends on a name.
    const source = bundled.rackSource(bundled.MODULES)
    expect(source).toContain('const DEPS')
    expect(source).not.toContain('const  =')

    const instance = instantiate(source, bundled.RACK_PROCESSOR)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: bundled.compile(PATCH, bundled.MODULES) } })

    const minified = render(instance, BLOCKS)
    expect(rms(minified), 'the minified worklet made no sound').toBeGreaterThan(0.01)

    // Sample for sample. Minification changes names, never arithmetic, so anything less than equality here
    // would mean a transform had rewritten the DSP.
    expect(Array.from(minified)).toEqual(Array.from(locally(BLOCKS)))
  }, 60_000)

  it('keeps every dependency reachable by the key its modules ask for', async () => {
    // The specific repair `worklet.ts` made: `deps.Ladder` rather than an identifier. A minifier does not
    // touch string keys, so the two halves cannot disagree — and this fails loudly if anybody ever writes
    // `const ${dep.name} =` again, because the emitted key would no longer match the lookup.
    const bundled = await minifiedPackage()
    const source = bundled.rackSource(bundled.MODULES)

    for (const def of Object.values(MODULES)) {
      for (const name of Object.keys(def.deps ?? {})) {
        expect(source, `${def.type} asks for a dependency called ${name}`).toContain(
          `${JSON.stringify(name)}:`,
        )
      }
    }
  }, 60_000)
})
