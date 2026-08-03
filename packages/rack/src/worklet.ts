import { Graph } from './graph.js'
import type { Dep, Registry } from './types.js'

// Getting the rack onto the audio thread.
//
// The trick is `@driftbox/engine`'s, from `src/dsp/worklet.ts`: an AudioWorklet has to be a
// separate script loaded into a global scope with no module graph of its own, so rather than
// adding a second build entry point — which would stop the package being importable as one
// module — the processor's source is assembled here from `toString()` and handed over as a
// blob URL. Every module is therefore written ONCE, in ordinary TypeScript, unit-tested as
// ordinary arithmetic, and the audio thread gets that exact code rather than a second copy
// of it that can drift.
//
// The rule it imposes is the one already written down in the engine: a class that gets
// serialised must reference nothing outside itself, because the AudioWorkletGlobalScope
// shares no scope with this module and a captured constant would be a ReferenceError at the
// moment the first patch loaded.
//
// Here that rule needs one addition the engine did not, and it is worth reading carefully
// because getting it wrong fails only in production.
//
// The engine has one dependency, `Ladder`, and both halves of its reference to it are
// LITERAL TEXT inside the template string: it writes `const Ladder = ` and its processor body
// says `new Ladder(sampleRate)`, neither of which a bundler can see, let alone rename. That
// is safe and stays safe.
//
// The rack cannot do that. Its dependencies come from module defs, so their names are not
// known when the template is written, and its processor bodies are themselves stringified
// from real classes — which means a bundler HAS seen them and has renamed whatever they
// refer to. The obvious repair is to emit `const ${dep.name} = <source>` and let the
// minified body find it. Run this package through rolldown with minify on, which is what the
// app's Vite build does, and `Ladder.toString()` comes out as:
//
//     class{s0=0;s1=0;s2=0;s3=0;...}
//
// The SOURCE TEXT is anonymous. When this was written `dep.name` was the empty string with it,
// so the assembler emitted `const  = class{...}` and the whole worklet failed to parse: every
// patch silent, in production only, with the development build working perfectly.
//
// **Re-measured under rolldown 1.2.2, `.name` is no longer empty — it is the mangled binding,
// `me`.** Which is worse, not better. A name-derived scheme now works under this bundler and
// fails under whichever one still hands back nothing, so the failure has become somebody else's
// build rather than every build, and it is still silence rather than an error. The conclusion is
// the same one and the argument for it is stronger. `minified.test.ts` measures this on the real
// bundled artefact, so if it moves again the number moves with it.
//
// So dependencies are not referenced by identifier at all. They are passed in as an object
// and looked up by string key: `deps.Ladder`. A minifier does not touch string keys or object
// property names, so the two halves cannot disagree, and the class's own name is irrelevant
// because nothing ever says it. `worklet.test.ts` reproduces the failure by mangling the
// class name and rebuilding the whole source in a scope of its own.

export const RACK_PROCESSOR = 'driftbox-rack'

/** How the host talks to the graph. This is the ABI — keep it small. */
export type RackMessage =
  | { kind: 'plan'; plan: unknown }
  /**
   * `frame` is optional and is the whole of what sample-accurate automation needed: absent, the change
   * lands at the next block boundary as it always has; present, it starts at that sample. Frames count
   * from the start of the context — `currentFrame` here, `Rack.frameFor` on the other side.
   */
  | { kind: 'param'; slot: number; value: number; voice?: number; frame?: number }
  | { kind: 'transport'; tempo: number; running: boolean; shuffle?: number }
  /** Enable low-rate meter readings only while a host faceplate is listening. */
  | { kind: 'monitor'; enabled: boolean }
  /** `data` is transferred rather than copied — see `Rack.setData`. */
  | { kind: 'data'; module: string; slot: string; data: Float32Array }

/**
 * Assemble the processor source for a set of modules.
 *
 * Exported so it can be tested without a browser: the assembled string is the artefact that
 * either works or does not, and it is checkable by evaluating it.
 */
export function rackSource(registry: Registry): string {
  const deps = new Map<string, Dep>()
  for (const def of Object.values(registry)) {
    for (const [name, dep] of Object.entries(def.deps ?? {})) {
      const existing = deps.get(name)
      // Loud on purpose. Two modules asking for different classes under one name would give
      // one of them silently the wrong DSP, and that is a developer error at load time
      // rather than anything a user did.
      if (existing && existing !== dep) {
        throw new Error(`two modules disagree about what the rack dependency "${name}" is`)
      }
      deps.set(name, dep)
    }
  }

  const entries = (pairs: [string, unknown][]) =>
    pairs.map(([name, value]) => `  ${JSON.stringify(name)}: ${String(value)},`).join('\n')

  return `"use strict";

const DEPS = {
${entries([...deps])}
}

const MODULES = {
${entries(Object.values(registry).map((def) => [def.type, def.processor]))}
}

const Graph = ${Graph.toString()}

class RackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    // 128 is the render quantum. The Graph reallocates if it is ever handed a different
    // one, so this is a starting size rather than an assumption.
    this.graph = new Graph(sampleRate, 128, MODULES, DEPS)
    this.monitoring = false
    this.reportBlock = 0

    // Everything the node was constructed with, applied before a single sample is asked for.
    //
    // This exists because of OFFLINE rendering. A message posted to a port is delivered on the audio
    // thread, and an OfflineAudioContext does not run that thread until \`startRendering\`. So a plan sent
    // by \`postMessage\` and a render started immediately afterwards is a race, and it is one that loses
    // silently: the file comes out the right length and completely empty. Measured — five exports in a
    // row, all silent, from code that had produced audio minutes earlier.
    //
    // \`processorOptions\` is structured-cloned into this constructor synchronously when the node is built,
    // so there is no thread and no ordering to get wrong. The live path takes the same route and is a
    // little safer for it.
    const seed = options && options.processorOptions
    if (seed) {
      if (seed.plan) this.graph.setPlan(seed.plan)
      if (seed.transport) this.graph.setTransport(seed.transport.tempo, seed.transport.running, seed.transport.shuffle)
      for (const entry of seed.data || []) this.graph.setData(entry.module, entry.slot, entry.data)
      // Scheduled param changes, for the same reason as the plan and the data: an offline render never
      // sees a port message posted before it started, so automation would silently not be in the file.
      for (const p of seed.params || []) this.graph.setParam(p.slot, p.value, p.voice, p.frame)
    }
    this.port.onmessage = (event) => {
      const message = event.data
      if (!message) return
      if (message.kind === 'plan') {
        this.graph.setPlan(message.plan)
        // Only ever non-empty when the worklet was assembled from a different module set
        // than the one that compiled the plan. Silence would be a very confusing symptom.
        if (this.graph.missing.length > 0) {
          this.port.postMessage({ kind: 'missing', types: this.graph.missing.slice() })
        }
      } else if (message.kind === 'param') {
        this.graph.setParam(message.slot, message.value, message.voice, message.frame)
      } else if (message.kind === 'transport') {
        this.graph.setTransport(message.tempo, message.running, message.shuffle)
      } else if (message.kind === 'monitor') {
        this.monitoring = message.enabled === true
      } else if (message.kind === 'data') {
        this.graph.setData(message.module, message.slot, message.data)
      }
    }
  }

  process(inputs, outputs) {
    // \`currentFrame\` is the first sample of this block on the context's clock, and it is the only clock
    // both sides can see: the host schedules against it through \`ctx.currentTime\`. Passing it rather than
    // letting the Graph count its own blocks means a scheduled change cannot drift from what the host asked
    // for, however many blocks the context has dropped or however this processor was constructed.
    this.graph.process(outputs[0], inputs, currentFrame)
    // Eight render quanta is roughly 46Hz at 48kHz: fluid enough for a needle, far below sample rate, and
    // small enough that several meters remain cheap. Offline rendering never enables this, so exporting a
    // patch does not fill the main-thread queue with display messages.
    this.reportBlock = (this.reportBlock + 1) & 7
    if (this.monitoring && this.reportBlock === 0) {
      const readings = this.graph.meters()
      if (readings.length > 0) this.port.postMessage({ kind: 'meters', readings })
    }
    // Never retire. A rack with a self-oscillating filter or a feedback patch makes sound
    // with no input at all, so the usual "no input, no output, shut down" optimisation
    // would silence exactly the patches this whole thing exists to allow.
    return true
  }
}

registerProcessor(${JSON.stringify(RACK_PROCESSOR)}, RackProcessor)
`
}

/** One load per context. `addModule` on an already-registered name throws. */
const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>()

/**
 * Make sure the rack processor is registered on this context.
 *
 * Resolves `false` rather than throwing when worklets are unavailable — an old browser, or a
 * Content-Security-Policy that will not run a blob script. Unlike the engine's ladder there
 * is no fallback to fall back to: a rack without a worklet is not a rack. The caller's job
 * is to say so rather than to appear broken.
 */
export function loadRack(ctx: BaseAudioContext, registry: Registry): Promise<boolean> {
  const existing = loaded.get(ctx)
  if (existing) return existing

  const attempt = (async () => {
    if (!ctx.audioWorklet) return false
    try {
      const source = rackSource(registry)
      const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      return true
    } catch {
      return false
    }
  })()

  loaded.set(ctx, attempt)
  return attempt
}
