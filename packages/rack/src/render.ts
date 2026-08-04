import { STEPS_PER_BAR } from './automation.js'
import { grooveboxSong } from './groovebox.js'
import { Rack } from './index.js'
import type { Patch, Registry } from './types.js'

// Rendering a patch to a buffer, offline.
//
// The rack is already built for this and it took no change to make it possible: `Rack` takes a
// `BaseAudioContext` rather than an `AudioContext`, deliberately, and an `OfflineAudioContext` is one. The
// same worklet, the same plan, the same modules — just a context that renders as fast as it can rather than
// in real time.
//
// **Offline rather than tapping the live output**, which is the choice worth explaining. Recording what is
// playing would capture a performance — the pad, the keys, whatever somebody did with their hands — and it
// would take exactly as long as the recording. Rendering reproduces the *patch*: exact, deterministic,
// faster than real time, and the same thing anybody else opening the shared link would hear. A patch is the
// artefact this rack makes; a take is not, yet.
//
// The cost is honest and worth stating: **a performance is not captured.** Sweeping the Kaoss pad while
// exporting changes nothing about the file, because the pad is an insert on the live context and this is a
// different context entirely.
//
// **The rack's own render is deterministic**, and that was measured rather than assumed: anything random in
// the rack seeds from its module id, so two exports of a patch containing a Noise module come back
// byte-identical. So does a patch with no noise in it at all.
//
// A patch built on a **break** does not, and the reason is worth knowing: the break is synthesised by the
// engine on each export and the engine's drum voices are not seeded. Two exports of `Cut Up` differ; two
// exports of `Wobbler` do not. Nothing here can fix that — it would take a seeded generator in the engine —
// and it matters only if somebody expects byte-equality rather than the same performance.

export interface RenderOptions {
  /** How many bars. */
  bars?: number
  sampleRate?: number
  /**
   * Extra seconds after the last bar, for reverb tails and release stages.
   *
   * Without it a patch with any decay on it ends mid-ring, which is the one artefact that makes an export
   * sound broken rather than short.
   */
  tail?: number
  /** Bulk data per module — a Sampler's break, a Tracker's pattern. Without it a break patch renders silent. */
  data?: Record<string, Record<string, Float32Array>>
  /** Required, for the bundle-size reason at `Rack`: a default here would pull every module into every
   *  consumer's build, including one that never renders anything offline. */
  registry: Registry
  /** Injectable for testing, the same way `renderStems` takes one. */
  offline?: (channels: number, length: number, rate: number) => OfflineAudioContext
}

export interface PatchStemTarget {
  /** Stable module id, also used by `only`. */
  id: string
  /** Human-readable device and module identity. */
  name: string
}

export interface PatchStem extends PatchStemTarget {
  buffer: AudioBuffer
}

export interface PatchStemOptions extends RenderOptions {
  /** Render only these Out module ids. Absent means every eligible Out strip. */
  only?: readonly string[]
}

/**
 * The explicit rack-native stem boundary.
 *
 * A modular graph does not have an honest answer to “which source owns this shared reverb?”. Out strips do:
 * they are already the named terminal buses the compiler sums into the master. A terminal without a solo
 * control cannot be isolated without changing its graph, so it is deliberately not advertised as a stem.
 */
export function patchStemTargets(patch: Patch, registry: Registry): PatchStemTarget[] {
  return patch.modules.flatMap((module) => {
    const def = registry[module.type]
    if (!def?.terminal || !def.terminalSolo || module.bypassed === true) return []
    return [{ id: module.id, name: `${def.name} · ${module.id}` }]
  })
}

/** A copy whose terminal solo state selects exactly one Out for the complete offline render. */
function isolatedStemPatch(patch: Patch, selected: string, registry: Registry): Patch {
  const solos = new Map<string, string>()
  const modules = patch.modules.map((module) => {
    const solo = registry[module.type]?.terminalSolo
    if (!solo) return module
    solos.set(module.id, solo)
    return {
      ...module,
      params: { ...module.params, [solo]: module.id === selected ? 1 : 0 },
    }
  })
  // A recorded Solo move must not take the selected stem away halfway through its render. Level, pan and
  // mute automation remain part of that strip and are intentionally preserved.
  const automation = patch.automation?.filter(
    (lane) => solos.get(lane.target[0]) !== lane.target[1],
  )
  const modulation = patch.modulation?.filter(
    (route) => solos.get(route.to[0]) !== route.to[1],
  )
  const isolated: Patch = { ...patch, modules }
  if (automation && automation.length > 0) isolated.automation = automation
  else delete isolated.automation
  if (modulation && modulation.length > 0) isolated.modulation = modulation
  else delete isolated.modulation
  return isolated
}

/** Render one complete stereo file per eligible terminal Out strip. */
export async function renderPatchStems(
  patch: Patch,
  options: PatchStemOptions,
): Promise<PatchStem[]> {
  const wanted = options.only ? new Set(options.only) : null
  const targets = patchStemTargets(patch, options.registry).filter(
    (target) => !wanted || wanted.has(target.id),
  )
  const stems: PatchStem[] = []
  for (const target of targets) {
    stems.push({
      ...target,
      buffer: await renderPatch(isolatedStemPatch(patch, target.id, options.registry), options),
    })
  }
  return stems
}

/**
 * How long a render is, in samples.
 *
 * Pulled out and exported because it is the only part of this worth testing in Node — there is no
 * `OfflineAudioContext` there, and `breaks.ts` already records why stubbing one is the wrong shape: the stub
 * grows a method every time the graph touches one, and what it proves is that the stub is complete.
 */
export function renderLength(
  bars: number,
  tempo: number,
  sampleRate: number,
  tail: number,
  beatsPerBar = 4,
): number {
  const seconds = (bars * beatsPerBar * 60) / tempo + tail
  return Math.max(1, Math.round(seconds * sampleRate))
}

/**
 * Render a patch to a stereo buffer.
 *
 * Stereo because the rack's output is: phase C put a pan on the Out, and rendering to mono would throw away
 * the one thing that makes two hard-panned chains worth patching.
 */
export async function renderPatch(patch: Patch, options: RenderOptions): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100
  const bars = Math.max(1, Math.round(options.bars ?? 4))
  const tail = options.tail ?? 2
  const tempo = patch.tempo ?? 120

  const length = renderLength(bars, tempo, sampleRate, tail)
  const make =
    options.offline ??
    ((channels: number, frames: number, rate: number) =>
      new OfflineAudioContext(channels, frames, rate))
  const ctx = make(2, length, sampleRate)

  const rack = new Rack(ctx, options.registry)

  // **Everything before `start()`, and that ordering is the whole of why this works.**
  //
  // A port message is delivered on the audio thread, and an OfflineAudioContext does not run that thread
  // until `startRendering`. Setting any of this afterwards is a race that loses silently — the file comes
  // out exactly the right length and completely empty, which is what five consecutive exports did before
  // this was understood. Set first, and `Rack` hands it all to the processor's constructor instead.
  rack.patch = patch
  for (const [module, slots] of Object.entries(options.data ?? {})) {
    for (const [slot, values] of Object.entries(slots)) {
      // A copy per render: `setData` transfers, and an export must not empty the array the live rack is
      // still playing from.
      rack.setData(module, slot, values.slice())
    }
  }
  rack.setTransport(tempo, true, grooveboxSong(patch)?.swing ?? 0)

  // Recorded parameter moves, scheduled before `start()` for exactly the reason above — this is the case
  // the seeding path in `Rack.scheduleParam` exists for. Without it an exported file would have the patch
  // but not the performance, which is the sort of difference somebody only notices after sharing it.
  //
  // The whole lane goes in at once rather than through a lookahead scheduler. Offline has no "now" to look
  // ahead of: the render runs as fast as it can and every frame is known before the first sample.
  for (const lane of patch.automation ?? []) {
    for (const point of lane.points) {
      const seconds = (point.at * 4 * 60) / (STEPS_PER_BAR * tempo)
      rack.scheduleParam(lane.target[0], lane.target[1], point.value, Math.round(seconds * sampleRate))
    }
  }

  if (!(await rack.start())) {
    throw new Error('this browser cannot render a rack: no AudioWorklet')
  }
  rack.output?.connect(ctx.destination)

  return ctx.startRendering()
}
