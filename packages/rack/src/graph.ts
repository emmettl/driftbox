import type { Plan, Processor, ProcessorClass } from './types.js'

// The audio thread. Walks a compiled plan, once per render quantum.
//
// This class is SELF-CONTAINED — no imports that survive compilation, no references to
// anything at module scope — because `worklet.ts` serialises it with toString() and
// evaluates it inside an AudioWorkletGlobalScope, which shares no scope with this module.
// Type-only imports are fine: they are erased. A value would be a ReferenceError at the
// moment the first patch loaded. `graph.test.ts` reproduces that scope exactly.
//
// It is also why this is testable. A Graph is arithmetic over Float32Arrays, so the tests
// run it in Node and measure what came out, the same trick `ladder.test.ts` uses one level
// further down.

interface Node {
  processor: Processor
  inlets: Float32Array[]
  outlets: Float32Array[]
  params: Float32Array[]
}

export class Graph {
  /** Module types the plan named that this build could not construct. Should always be
   *  empty — the compiler checked the host's registry — and will not be if the worklet was
   *  assembled from a different module set than the one that compiled the plan. */
  readonly missing: string[] = []

  private readonly sampleRate: number
  private readonly modules: Record<string, ProcessorClass>
  private readonly deps: Record<string, unknown>

  private frames: number
  private plan: Plan | null = null
  private buffers: Float32Array[] = []
  /** Where an outlet with no allocated buffer writes. Insurance: it means no module can
   *  write into buffer 0 and invent a signal for every unconnected inlet at once. */
  private scratch: Float32Array
  private nodes: Node[] = []
  private outputs: Float32Array[] = []

  private paramBuffers: Float32Array[] = []
  private values = new Float32Array(0)
  private targets = new Float32Array(0)
  private stepped = new Uint8Array(0)
  /** Set for one block after a param ramped, so the buffer is flattened back to a constant
   *  next block. Without it the ramp would be replayed for as long as the knob sat still. */
  private ramped = new Uint8Array(0)

  constructor(
    sampleRate: number,
    frames: number,
    modules: Record<string, ProcessorClass>,
    deps: Record<string, unknown>,
  ) {
    this.sampleRate = sampleRate
    this.frames = frames > 0 ? frames : 128
    this.modules = modules
    this.deps = deps
    this.scratch = new Float32Array(this.frames)
  }

  /** Apply a plan. Module state does not survive this: a patch edit rebuilds every
   *  processor, so a filter's history and an oscillator's phase both restart. Preserving
   *  them across an edit is a real feature and a later one — it needs identity for a
   *  module across two plans, which the compiler does not currently carry. */
  setPlan(plan: Plan): void {
    this.plan = plan
    this.build(false)
  }

  /** Aim a param at a new value. It arrives over the block that follows, ramped, so a knob
   *  turn does not click. Nothing here is scheduled against a frame yet — that is what
   *  sample-accurate automation will need, and it is not needed to make a sound. */
  setParam(slot: number, value: number): void {
    if (slot < 0 || slot >= this.targets.length) return
    if (!Number.isFinite(value)) return
    this.targets[slot] = value
  }

  /** Sum the rack into every channel it was handed. Mono for now: a stereo signal path is
   *  a decision about what a cable is, and this is not the place to take it quietly. */
  process(channels: Float32Array[]): void {
    const mix = channels[0]
    if (!mix) return
    if (mix.length !== this.frames) {
      this.frames = mix.length > 0 ? mix.length : this.frames
      if (this.plan) this.build(true)
    }
    const frames = this.frames

    for (let slot = 0; slot < this.paramBuffers.length; slot++) {
      const buffer = this.paramBuffers[slot]
      const target = this.targets[slot]
      const value = this.values[slot]
      if (value === target) {
        if (this.ramped[slot]) {
          buffer.fill(target)
          this.ramped[slot] = 0
        }
        continue
      }
      if (this.stepped[slot]) {
        buffer.fill(target)
      } else {
        const step = (target - value) / frames
        for (let i = 0; i < frames; i++) buffer[i] = value + step * (i + 1)
        this.ramped[slot] = 1
      }
      this.values[slot] = target
    }

    for (const node of this.nodes) {
      node.processor.process(node.inlets, node.outlets, node.params, frames)
    }

    if (this.outputs.length === 0) {
      for (let c = 0; c < channels.length; c++) channels[c].fill(0)
      return
    }
    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (let o = 0; o < this.outputs.length; o++) sum += this.outputs[o][i]
      // A modular can produce an infinity — patching an output back into its own input is
      // what that is for. A NaN reaching an AudioNode silences that node for the lifetime
      // of the context, so the tab would go quiet for good and a reload would be the only
      // way back. This keeps the rack alive. It does NOT rescue a module that has gone
      // unstable: that patch will sound wrong until it is unpatched, which is the correct
      // outcome and the audible sign that something is.
      mix[i] = Number.isFinite(sum) ? (sum > 4 ? 4 : sum < -4 ? -4 : sum) : 0
    }
    for (let c = 1; c < channels.length; c++) channels[c].set(mix)
  }

  /** Allocate everything the plan describes. `keepParams` carries the live knob positions
   *  across a re-allocation, which is what a change of render quantum needs — the plan's
   *  own values are where the patch was saved, not where the user has moved it since. */
  private build(keepParams: boolean): void {
    const plan = this.plan
    if (!plan) return
    this.missing.length = 0
    this.scratch = new Float32Array(this.frames)

    this.buffers = []
    for (let i = 0; i < plan.buffers; i++) this.buffers.push(new Float32Array(this.frames))

    const count = plan.params.length
    const previous = keepParams && this.targets.length === count ? this.targets : null
    this.paramBuffers = []
    this.values = new Float32Array(count)
    this.targets = new Float32Array(count)
    this.stepped = new Uint8Array(count)
    this.ramped = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      const value = previous ? previous[i] : plan.params[i].value
      this.values[i] = value
      this.targets[i] = value
      this.stepped[i] = plan.params[i].stepped ? 1 : 0
      const buffer = new Float32Array(this.frames)
      buffer.fill(value)
      this.paramBuffers.push(buffer)
    }

    // A buffer index the plan does not have reads as silence rather than crashing. The plan
    // crossed postMessage and may have been written by a build that is not this one.
    const at = (index: number) => this.buffers[index] ?? this.scratch

    this.nodes = []
    for (const node of plan.nodes) {
      const Constructor = this.modules[node.type]
      if (!Constructor) {
        this.missing.push(node.type)
        continue
      }
      this.nodes.push({
        processor: new Constructor(this.sampleRate, this.deps, node.id),
        inlets: node.inlets.map(at),
        outlets: node.outlets.map((index) => (index > 0 ? at(index) : this.scratch)),
        params: node.params.map((slot) => this.paramBuffers[slot] ?? this.scratch),
      })
    }

    this.outputs = plan.outputs.filter((index) => index > 0).map(at)
  }
}
