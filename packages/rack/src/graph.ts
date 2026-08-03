import type {
  MeterReading,
  ModuleData,
  Plan,
  Processor,
  ProcessorClass,
  Transport,
} from './types.js'

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

/**
 * One module, once per voice — or once in total when the module is `poly: false`.
 *
 * `voices` is a list of what to hand each instance, rather than one set of buffers with an index into it,
 * because the four cases a polyphonic graph has to get right are all decided at *build* time:
 *
 *   consumer  source   the inlet gets
 *   --------  ------   ---------------------------------------------
 *   poly      same     that voice's buffer
 *   poly      narrower the source voice shared by this child lane
 *   poly      mono     the one buffer, the same for every voice
 *   mono      poly     a scratch holding every voice summed
 *   collector poly     that sum, plus every independent voice in `voiceInlets`
 *   mono      mono     the one buffer
 *
 * Deciding them once and storing the answer keeps `process()` a list-walker. Deciding them per sample would
 * be four branches in the innermost loop in the program.
 */
interface Node {
  /** The patch id, so a visual reading reaches the faceplate for the right instance. */
  id: string
  processor: Processor
  inlets: Float32Array[]
  outlets: Float32Array[]
  params: Float32Array[]
  /** Inlets that need summing before this instance runs, with the voice buffers to sum. Empty for a
   *  polyphonic module, which never collapses anything. */
  collapse: { into: Float32Array; from: Float32Array[] }[]
  /** Per-sample inlet gain, after any polyphonic collapse and before the processor sees the signal. */
  trims: { into: Float32Array; from: Float32Array; gain: Float32Array }[]
  /** Independent per-inlet voice buffers for a mono collector. Empty for every ordinary module. */
  voiceInlets: Float32Array[][]
  /** Per-voice input trims applied before a collector reads `voiceInlets`. */
  voiceTrims: { into: Float32Array; from: Float32Array; gain: Float32Array }[]
}

/** A param change waiting for its frame. `voice` undefined means every voice, which is what a knob means. */
interface Scheduled {
  slot: number
  value: number
  voice: number | undefined
  frame: number
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
  /** Performed voices. A widened stream can allocate more processor instances without changing this. */
  private voices = 1
  /** Widest stream in the plan, bounded by the compiler to eight notes times eight chord lanes. */
  private voiceCapacity = 1
  /** `[bufferIndex][voice]`. A buffer can now be mono, patch-wide, or expanded. */
  private buffers: Float32Array[][] = []
  /** Where an outlet with no allocated buffer writes. Insurance: it means no module can
   *  write into buffer 0 and invent a signal for every unconnected inlet at once. */
  private scratch: Float32Array
  private nodes: Node[] = []
  /**
   * What reaches the speakers: a signal buffer and, optionally, the pan buffer that places it.
   *
   * One entry per voice per terminal module. `pan` is a live Float32Array rather than a number so that
   * turning the knob works without recompiling, which is the same reason `setParam` does not bump the
   * revision on the host side.
   */
  private outputs: {
    signal: Float32Array
    /** The right channel, for a terminal module whose outlet is stereo. Null means `signal` is both. */
    right: Float32Array | null
    pan: Float32Array | null
    mute: Float32Array | null
    solo: Float32Array | null
  }[] = []

  /** Peak follower and smoothed gain for the master limiter. Persist across blocks or it ticks. */
  private limitEnvelope = 0
  private limitGain = 1

  /** `[slot][voice]`. A knob writes every voice; MIDI writes one — which is the whole reason a param is
   *  per-voice rather than shared, and the one addition polyphony needed to the message ABI. */
  /**
   * Where the transport is. Accumulated per block rather than derived from an absolute frame count, so changing
   * the tempo mid-bar carries on from where the music was rather than jumping to wherever the new arithmetic
   * lands.
   */
  private tempo = 120
  private running = false
  private beat = 0

  /**
   * Bulk data, in two layers on purpose.
   *
   * `pushed` came from `setData` — a sample buffer — and **survives a rebuild**, because it is not part of the
   * patch and recompiling must not throw away a break somebody loaded. `seeded` came from the plan — a
   * pattern — and is replaced every build, because there it *is* the document. `pushed` wins where both have a
   * slot, which is only reachable if a module accepts the same data from either source.
   */
  private pushed = new Map<string, Map<string, Float32Array>>()
  private seeded = new Map<string, Map<string, Float32Array>>()

  private paramBuffers: Float32Array[][] = []
  private values: Float32Array[] = []
  private targets: Float32Array[] = []
  private stepped = new Uint8Array(0)
  /** Set for one block after a param ramped, so the buffer is flattened back to a constant
   *  next block. Without it the ramp would be replayed for as long as the knob sat still. */
  private ramped: Uint8Array[] = []
  /**
   * `[slot][voice]` — the sample within the coming block at which that param's ramp starts.
   *
   * Zero for a knob, which is every param change there has ever been until now and is why the immediate
   * path is byte-identical to before this existed. Non-zero only for a change scheduled against a frame.
   * Cleared as it is consumed, so one scheduled move cannot offset the next knob turn.
   */
  private rampAt: Int32Array[] = []

  /**
   * Param changes waiting for their frame, and where the block clock is.
   *
   * `frame` counts samples since the context started, which is the clock `currentFrame` gives the worklet
   * and the one a host can compute from `ctx.currentTime`. It is kept here as well so a Graph driven
   * directly — every test in this package, and the offline path before it had a context — still has a
   * consistent clock without the caller having to invent one.
   */
  private frame = 0
  private scheduled: Scheduled[] = []
  /** Reused so applying a block's due events allocates nothing on the audio thread. */
  private due: Scheduled[] = []

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

  /**
   * Aim a param at a new value. It arrives over the block that follows, ramped, so a knob turn does not
   * click.
   *
   * `voice` undefined means every voice, which is what a knob means: one knob, one value, all eight notes.
   * A specific voice is what a keyboard means — that is how eight MIDI modules hold eight different notes,
   * and it is the only thing polyphony added to the message ABI.
   *
   * **`frame` is the second, and it is what recorded automation needed.** Without it a param change lands
   * at the next block boundary, so it is up to 2.9ms early or late at 44.1kHz — inaudible for a knob
   * somebody is turning and quite audible for a filter that is supposed to open exactly on the downbeat.
   * With it the change starts at the sample asked for.
   *
   * Frames count from the start of the context, which is `currentFrame` inside the worklet and
   * `Math.round(ctx.currentTime * sampleRate)` outside it — see `Rack.frameFor`. A frame already gone by
   * applies at once rather than being dropped: late is a timing error and silence is a mystery.
   *
   * **Sample-accurate timing, block-rate resolution.** Two changes to one param inside one block leave only
   * the later one audible, because a param is one ramp per block and always has been. That is the right
   * trade for automation — a lane wants its move to *start* in the right place, and a value that moves more
   * often than 344Hz is an LFO, which this rack has a module for.
   */
  setParam(slot: number, value: number, voice?: number, frame?: number): void {
    const perVoice = this.targets[slot]
    if (!perVoice) return
    if (!Number.isFinite(value)) return
    // A voice outside the patch is nonsense and has always been ignored rather than clamped — including
    // −1, which is why "every voice" is `undefined` here and not a negative sentinel. Reusing −1 for it
    // would have turned a host's bad input into a change on all eight voices; `poly.test.ts` says so.
    if (voice !== undefined && (voice < 0 || voice >= perVoice.length)) return
    // Anything that is not a usable frame is a knob, including a NaN from a host that did arithmetic on an
    // undefined time. Treating it as "now" is the behaviour that existed before scheduling did.
    if (frame === undefined || !Number.isFinite(frame)) {
      this.aim(slot, value, voice, 0)
      return
    }
    // Bounded so a host that schedules a lane far ahead cannot grow this without limit on the audio thread.
    // Full means the oldest waiting change is applied now rather than discarded — early beats vanished.
    if (this.scheduled.length >= 512) this.applyDue(this.scheduled.shift()!, 0)
    this.scheduled.push({ slot, value, voice, frame })
  }

  /** Point a param at a value, and say where in the coming block its ramp begins. */
  private aim(slot: number, value: number, voice: number | undefined, offset: number): void {
    if (voice === undefined) {
      this.targets[slot].fill(value)
      this.rampAt[slot].fill(offset)
      return
    }
    this.targets[slot][voice] = value
    this.rampAt[slot][voice] = offset
  }

  /** Apply one waiting change, at `offset` samples into the coming block. */
  private applyDue(event: Scheduled, offset: number): void {
    // The plan can have been replaced since this was scheduled, so the slot may be gone and the voice
    // count may have shrunk. Re-checked here rather than trusted from when it was queued.
    const perVoice = this.targets[event.slot]
    if (!perVoice) return
    if (event.voice !== undefined && event.voice >= perVoice.length) return
    this.aim(event.slot, event.value, event.voice, offset)
  }

  /**
   * Apply every waiting change that falls in this block, in frame order.
   *
   * Frame order rather than the order they arrived, because "two in one block, the later one wins" is only
   * a defensible rule if "later" means later in time. A host that posts a lane out of order would otherwise
   * hear whichever message happened to be delivered last.
   *
   * Partitioned into a reused array rather than filtered into a new one: this runs on the audio thread and
   * allocating per block is how a graph starts dropping buffers under load.
   */
  private drain(blockStart: number, frames: number): void {
    const blockEnd = blockStart + frames
    this.due.length = 0
    let kept = 0
    for (let i = 0; i < this.scheduled.length; i++) {
      const event = this.scheduled[i]
      if (event.frame >= blockEnd) {
        this.scheduled[kept++] = event
        continue
      }
      this.due.push(event)
    }
    this.scheduled.length = kept
    if (this.due.length === 0) return
    if (this.due.length > 1) this.due.sort((a, b) => a.frame - b.frame)
    for (const event of this.due) {
      // A frame already gone by lands at the top of this block. Late, and audibly so if it is very late —
      // but a change that never arrives is a bug nobody can diagnose from the sound.
      const offset = event.frame <= blockStart ? 0 : Math.min(frames - 1, Math.round(event.frame - blockStart))
      this.applyDue(event, offset)
    }
    this.due.length = 0
  }

  /** Where the transport is now. Tempo may change while running; position does not jump when it does. */
  setTransport(tempo: number, running: boolean): void {
    if (Number.isFinite(tempo) && tempo > 0) this.tempo = Math.max(20, Math.min(400, tempo))
    // Restarting from a stop rewinds; changing tempo while running does not.
    if (running && !this.running) this.beat = 0
    this.running = running
  }

  /**
   * Hand a module some bulk data. Survives a patch edit, because it is not part of the patch.
   *
   * The array is kept by reference and never copied — the host transferred it across `postMessage`, so this
   * side owns it and a copy here would undo the point of transferring it.
   */
  setData(module: string, slot: string, data: Float32Array): void {
    const forModule = this.pushed.get(module) ?? new Map<string, Float32Array>()
    forModule.set(slot, data)
    this.pushed.set(module, forModule)
  }

  /**
   * Read only the processors that volunteered display telemetry.
   *
   * Called at animation rate by the worklet, never per sample, and only while the host is listening. Keeping
   * the opt-in on the processor avoids teaching the graph that one particular module type is a meter.
   */
  meters(): MeterReading[] {
    const readings: MeterReading[] = []
    for (const node of this.nodes) {
      const reading = node.processor.meter?.()
      if (reading) readings.push({ id: node.id, ...reading })
      for (const child of node.processor.meters?.() ?? []) readings.push(child)
    }
    return readings
  }

  /**
   * Sum the rack into the channels it was handed, panned and limited.
   *
   * **A cable carries whatever its source port declares.** This used to say cables were mono and that
   * making them stereo "would double every buffer and make every module answer what it means to filter a
   * stereo signal". Neither turned out to be the price, because stereo is declared per PORT rather than per
   * cable: a module that says nothing owns one buffer and sees one, exactly as before, and only the ports
   * that opt in cost a second. See `stereo.ts` for the three connection rules.
   *
   * Placing a mono terminal in the field is still what a mono terminal does, and `docs/DNB.md`'s argument
   * for it — two chains hard-panned give a Reese that actually phases — is untouched.
   *
   * The pan law is **balance, not equal-power.** Equal-power puts centre at 0.707 on both channels, which
   * would have made every patch shared before this quietly 3dB quieter. Balance leaves centre at unity, so
   * the default is a genuine no-op, and hard-panning loses 3dB of total power exactly as a balance control
   * on a mixer does.
   */
  process(channels: Float32Array[], hostInputs: Float32Array[][] = [], frame?: number): void {
    const mix = channels[0]
    if (!mix) return
    if (mix.length !== this.frames) {
      this.frames = mix.length > 0 ? mix.length : this.frames
      if (this.plan) this.build(true)
    }
    const frames = this.frames

    // Where this block sits on the context's clock. The worklet passes `currentFrame`, which is the only
    // clock a host can also see; anything driving a Graph directly gets the internal count, which agrees
    // with itself and is what the tests and the offline path use.
    const blockStart = frame !== undefined && Number.isFinite(frame) ? frame : this.frame
    this.frame = blockStart + frames
    if (this.scheduled.length > 0) this.drain(blockStart, frames)

    for (let slot = 0; slot < this.paramBuffers.length; slot++) {
      const perVoice = this.paramBuffers[slot]
      const stepped = this.stepped[slot]
      for (let voice = 0; voice < perVoice.length; voice++) {
        const buffer = perVoice[voice]
        const target = this.targets[slot][voice]
        const value = this.values[slot][voice]
        // Not cleared here: `aim` is the only thing that writes a target and it always writes the offset
        // beside it, so the two cannot drift apart. Clearing here as well would be a second guard on the
        // same invariant, and a redundant guard is worse than none — it makes the mutation that breaks the
        // real one survive, so the test that should have caught it passes.
        const at = this.rampAt[slot][voice]
        if (value === target) {
          if (this.ramped[slot][voice]) {
            buffer.fill(target)
            this.ramped[slot][voice] = 0
          }
          continue
        }
        if (stepped) {
          // The old value up to the sample asked for, the new one from it. A selector must not be caught
          // between two settings, so there is nothing to interpolate — only a moment to change at.
          if (at > 0) buffer.fill(value, 0, at)
          buffer.fill(target, at)
        } else {
          // Hold, then ramp over what is left of the block. At an offset of zero — every knob, and every
          // param change that existed before scheduling did — this is exactly the old arithmetic.
          if (at > 0) buffer.fill(value, 0, at)
          const span = frames - at
          const step = (target - value) / span
          for (let i = 0; i < span; i++) buffer[at + i] = value + step * (i + 1)
          this.ramped[slot][voice] = 1
        }
        this.values[slot][voice] = target
      }
    }

    // One transport view per block, shared by every module that reads it — which is one of them.
    const transport: Transport = {
      tempo: this.tempo,
      running: this.running,
      beat: this.beat,
      // Zero while stopped, because no beats pass in a block during which nothing is playing. Reporting the
      // running figure regardless was a real bug: a module interpolating position across the block then crept
      // forward and snapped back every block, so a stopped bar ramp wobbled instead of holding still. `tempo` is
      // still here for anything that wants a synced time while stopped.
      beatsPerBlock: this.running ? (frames * this.tempo) / (60 * this.sampleRate) : 0,
    }
    this.beat += transport.beatsPerBlock

    for (const node of this.nodes) {
      // The collapse: every voice of a polyphonic outlet summed into one buffer before a module that runs
      // once reads it. Done here rather than in the module, because a module has no idea how many voices
      // exist and should not have to.
      for (const { into, from } of node.collapse) {
        into.set(from[0])
        for (let source = 1; source < from.length; source++) {
          const other = from[source]
          for (let i = 0; i < frames; i++) into[i] += other[i]
        }
      }
      for (const { into, from, gain } of node.trims) {
        for (let i = 0; i < frames; i++) into[i] = from[i] * gain[i]
      }
      for (const { into, from, gain } of node.voiceTrims) {
        for (let i = 0; i < frames; i++) into[i] = from[i] * gain[i]
      }
      node.processor.process(
        node.inlets,
        node.outlets,
        node.params,
        frames,
        transport,
        hostInputs,
        node.voiceInlets.length > 0 ? node.voiceInlets : undefined,
      )
    }

    if (this.outputs.length === 0) {
      for (let c = 0; c < channels.length; c++) channels[c].fill(0)
      return
    }

    const right = channels[1]
    // A millisecond to catch a transient, a tenth of a second to let go. Recomputed per block rather than
    // cached because it costs two `exp` calls and removes a field that could go stale after a rate change.
    const attack = Math.exp(-1 / (0.001 * this.sampleRate))
    const release = Math.exp(-1 / (0.1 * this.sampleRate))

    for (let i = 0; i < frames; i++) {
      // Whether anything is soloed, asked once per sample across every channel. Solo is the one mix control
      // that cannot be a property of a module: soloing one channel silences the OTHERS, and a module has no
      // idea the others exist. This is the only place that sees them all.
      let soloed = false
      for (let o = 0; o < this.outputs.length; o++) {
        const solo = this.outputs[o].solo
        if (solo !== null && solo[i] >= 0.5) {
          soloed = true
          break
        }
      }

      let left = 0
      let rightSum = 0
      for (let o = 0; o < this.outputs.length; o++) {
        const output = this.outputs[o]
        // Muted, or not the one being soloed. Skipped before the pan arithmetic rather than multiplied by
        // zero afterwards, which is the same answer and less work.
        if (output.mute !== null && output.mute[i] >= 0.5) continue
        if (soloed && !(output.solo !== null && output.solo[i] >= 0.5)) continue
        // A mono terminal is one sample placed in the field; a stereo one is a pair already in it. The
        // arithmetic below is the same either way — which is the point of reading the right channel here
        // rather than giving the mix loop a second branch per sample.
        const sample = output.signal[i]
        const other = output.right === null ? sample : output.right[i]
        if (output.pan === null) {
          left += sample
          rightSum += other
          continue
        }
        let pan = output.pan[i]
        if (pan < -1) pan = -1
        else if (pan > 1) pan = 1
        // Balance: unity on both at centre, so no pan is no change. On a stereo pair this attenuates one
        // side rather than moving a point source, which is what a pan control on a stereo channel does on
        // every mixer ever built — and it is why the knob keeps its name instead of gaining a second one.
        left += pan <= 0 ? sample : sample * (1 - pan)
        rightSum += pan >= 0 ? other : other * (1 + pan)
      }

      // A modular can produce an infinity — patching an output back into its own input is
      // what that is for. A NaN reaching an AudioNode silences that node for the lifetime
      // of the context, so the tab would go quiet for good and a reload would be the only
      // way back. This keeps the rack alive. It does NOT rescue a module that has gone
      // unstable: that patch will sound wrong until it is unpatched, which is the correct
      // outcome and the audible sign that something is.
      if (!Number.isFinite(left)) left = 0
      if (!Number.isFinite(rightSum)) rightSum = 0

      // The master limiter, linked across the pair so that a peak on one side does not shift the image.
      //
      // It replaces a bare clamp at ±4. The clamp is still below, because it is the thing that keeps a
      // feedback patch from killing the tab and no amount of gain riding substitutes for that — but a loud
      // mix used to meet a brick wall, and drum and bass is a genre held together by compression.
      const peak = Math.max(left < 0 ? -left : left, rightSum < 0 ? -rightSum : rightSum)
      const coefficient = peak > this.limitEnvelope ? attack : release
      this.limitEnvelope = peak + (this.limitEnvelope - peak) * coefficient
      // 0.95 rather than 1: it leaves headroom for the inter-sample peaks no sample-domain limiter can see.
      const wanted = this.limitEnvelope > 0.95 ? 0.95 / this.limitEnvelope : 1
      // Downward gain changes take effect immediately and upward ones are eased in, which is what stops the
      // release from pumping. Taking the minimum is what makes the attack instant without a lookahead.
      this.limitGain = wanted < this.limitGain ? wanted : wanted + (this.limitGain - wanted) * release
      left *= this.limitGain
      rightSum *= this.limitGain

      // A soft ceiling, because the limiter alone overshoots.
      //
      // Reacting to a peak as it arrives cannot catch the peak itself — the gain is only down a sample
      // later. Measured on an export of three chunks at once: a peak of 1.17, which is above full scale and
      // clips audibly on playback, and that is exactly what a master limiter exists to prevent.
      //
      // A lookahead would fix it by construction and was tried first: delay the audio, drive the gain from
      // the undelayed signal. It works, and it costs three milliseconds of latency on a rack somebody plays
      // with a keyboard, plus it breaks sample alignment for everything downstream. Too much for a defect
      // this size.
      //
      // So the transients meet a curve instead. Below 0.8 this is arithmetically the identity — the limiter
      // is already holding the sustained level under that — and above it, it bends asymptotically to 1.0.
      // Only the overshoot is distorted, which is what a mastering chain's clipper does after its limiter
      // and for the same reason.
      const outLeft = this.ceiling(left)
      const outRight = this.ceiling(rightSum)

      mix[i] = outLeft > 4 ? 4 : outLeft < -4 ? -4 : outLeft
      if (right) right[i] = outRight > 4 ? 4 : outRight < -4 ? -4 : outRight
    }
    // Anything beyond a pair gets the left channel: a rack asked for more channels than it has an opinion
    // about should still make a sound in all of them.
    for (let c = 2; c < channels.length; c++) channels[c].set(mix)
  }

  /**
   * Bend anything above the limiter's own threshold towards a ceiling of 1, leaving the rest untouched.
   *
   * The knee sits at 0.95 and not lower **because that is where the limiter is already holding things**.
   * A knee at 0.8 was the first attempt and it was wrong in a way worth recording: the limiter deliberately
   * parks sustained material just under 0.95, so a knee below that would bend everything loud, continuously,
   * rather than only the transients the limiter could not catch.
   *
   * Below the knee this is arithmetically the identity, which matters — a ceiling that coloured ordinary
   * signals would change the sound of every patch that never needed it.
   */
  private ceiling(x: number): number {
    const knee = 0.95
    const magnitude = x < 0 ? -x : x
    if (magnitude <= knee) return x
    const over = (magnitude - knee) / (1 - knee)
    const bent = knee + (1 - knee) * Math.tanh(over)
    return x < 0 ? -bent : bent
  }

  /** A live view of one module's bulk data. Pushed wins over seeded; see the note on those fields. */
  private dataFor(module: string): ModuleData {
    return {
      get: (slot) => this.pushed.get(module)?.get(slot) ?? this.seeded.get(module)?.get(slot),
    }
  }

  /** Allocate everything the plan describes. `keepParams` carries the live knob positions
   *  across a re-allocation, which is what a change of render quantum needs — the plan's
   *  own values are where the patch was saved, not where the user has moved it since. */
  private build(keepParams: boolean): void {
    const plan = this.plan
    if (!plan) return
    this.missing.length = 0
    this.scratch = new Float32Array(this.frames)
    this.voices = Math.max(1, Math.min(8, Math.round(plan.voices || 1)))
    this.voiceCapacity = this.voices
    for (const width of plan.voiceWidths ?? []) {
      if (Number.isFinite(width)) this.voiceCapacity = Math.max(this.voiceCapacity, Math.round(width))
    }
    for (const node of plan.nodes) {
      if (Number.isFinite(node.voices)) this.voiceCapacity = Math.max(this.voiceCapacity, Math.round(node.voices!))
    }
    this.voiceCapacity = Math.max(1, Math.min(64, this.voiceCapacity))

    // Patch data is the document, so it is replaced wholesale each build. Pushed data is not, so it is left
    // alone — recompiling a patch must not throw away a sample somebody loaded into it.
    this.seeded = new Map()
    for (const node of plan.nodes) {
      if (!node.data) continue
      const forModule = new Map<string, Float32Array>()
      for (const [slot, values] of Object.entries(node.data)) {
        if (Array.isArray(values)) forModule.set(slot, Float32Array.from(values))
      }
      if (forModule.size > 0) this.seeded.set(node.id, forModule)
    }

    // New plans state the exact width. An old plan still has the mono/poly bit and means one or the patch
    // voice count exactly as it did before expansion existed.
    this.buffers = []
    for (let i = 0; i < plan.buffers; i++) {
      const described = plan.voiceWidths?.[i]
      const wide = described === undefined
        ? (plan.poly?.[i] ? this.voices : 1)
        : Math.max(1, Math.min(this.voiceCapacity, Math.round(described)))
      this.buffers.push(Array.from({ length: wide }, () => new Float32Array(this.frames)))
    }

    const count = plan.params.length
    const previous = keepParams && this.targets.length === count ? this.targets : null
    this.paramBuffers = []
    this.values = []
    this.targets = []
    this.stepped = new Uint8Array(count)
    this.ramped = []
    this.rampAt = []
    // A change scheduled against a slot the new plan does not have would otherwise sit in the queue for
    // ever, and one against a slot that still exists would land on whatever parameter now has that number.
    // `applyDue` re-checks the slot too; this is the cheaper half of the same guard.
    if (!keepParams) this.scheduled.length = 0
    for (let i = 0; i < count; i++) {
      const saved = plan.params[i].value
      const values = new Float32Array(this.voiceCapacity)
      const targets = new Float32Array(this.voiceCapacity)
      for (let voice = 0; voice < this.voiceCapacity; voice++) {
        // A knob position survives a re-allocation; a voice added by a change of count starts where the
        // patch says. `previous[i]` may be narrower than the new voice count, hence the fallback.
        const value = previous?.[i]?.[voice] ?? saved
        values[voice] = value
        targets[voice] = value
      }
      this.values.push(values)
      this.targets.push(targets)
      this.stepped[i] = plan.params[i].stepped ? 1 : 0
      this.ramped.push(new Uint8Array(this.voiceCapacity))
      this.rampAt.push(new Int32Array(this.voiceCapacity))
      this.paramBuffers.push(
        Array.from({ length: this.voiceCapacity }, (_, voice) => new Float32Array(this.frames).fill(values[voice])),
      )
    }

    // A buffer index the plan does not have reads as silence rather than crashing. The plan crossed
    // postMessage and may have been written by a build that is not this one.
    const at = (index: number, voice: number): Float32Array => {
      const perVoice = this.buffers[index]
      if (!perVoice) return this.scratch
      return perVoice[perVoice.length === 1 ? 0 : voice] ?? perVoice[0]
    }

    this.nodes = []
    for (const node of plan.nodes) {
      const Constructor = this.modules[node.type]
      if (!Constructor) {
        this.missing.push(node.type)
        continue
      }
      const poly = node.poly !== false
      const instances = poly
        ? Math.max(1, Math.min(this.voiceCapacity, Math.round(node.voices ?? this.voices)))
        : 1
      const lanes = poly ? Math.max(1, Math.min(8, Math.round(node.voiceLanes ?? 1))) : 1
      const shared: Record<string, unknown> = {}

      for (let voice = 0; voice < instances; voice++) {
        const collapse: Node['collapse'] = []
        const trims: Node['trims'] = []
        const voiceInlets: Node['voiceInlets'] = []
        const voiceTrims: Node['voiceTrims'] = []
        const inlets = node.inlets.map((index, inlet) => {
          const perVoice = this.buffers[index] ?? [this.scratch]
          const slot = node.inletTrims?.[inlet]
          if (!poly && node.collectVoices === true) {
            if (slot === undefined) voiceInlets.push(perVoice)
            else {
              const gain = this.paramBuffers[slot]?.[0] ?? this.scratch
              const gathered = perVoice.map((from) => {
                const into = new Float32Array(this.frames)
                voiceTrims.push({ into, from, gain })
                return into
              })
              voiceInlets.push(gathered)
            }
          }

          let source: Float32Array
          if (poly) {
            const width = this.buffers[index]?.length ?? 1
            // Broadcast a narrower stream over adjacent child voices. Equal widths are the old direct
            // mapping, and mono is still the same buffer for everybody.
            const mapped = width <= 1 ? 0 : Math.min(width - 1, Math.floor((voice * width) / instances))
            source = at(index, mapped)
          } else {
            const perVoice = this.buffers[index]
            // Mono module, polyphonic source: this is the collapse. A scratch buffer per inlet, summed before
            // the module runs — a module has no idea how many voices exist and should not have to.
            if (perVoice && perVoice.length > 1) {
              source = new Float32Array(this.frames)
              collapse.push({ into: source, from: perVoice })
            } else {
              source = at(index, 0)
            }
          }

          // Plans from before input trim have no slot and keep the direct buffer path. New plans always
          // allocate one, even at unity, because the host can turn it without rebuilding this graph.
          if (slot === undefined) return source
          const into = new Float32Array(this.frames)
          const gain = this.paramBuffers[slot]?.[poly ? voice : 0] ?? this.scratch
          trims.push({ into, from: source, gain })
          return into
        })

        this.nodes.push({
          id: node.id,
          // Voice 0 keeps the plain module id, so a one-voice patch sounds exactly as it did before
          // polyphony existed — which matters because anything random in the rack seeds from this. Later
          // voices get a suffix, so eight Noise modules are eight different noises rather than one 18dB
          // louder.
          processor: new Constructor(
            this.sampleRate,
            this.deps,
            voice === 0 ? node.id : `${node.id}#${voice}`,
            // A live view rather than a snapshot, because data can arrive long after the graph was built —
            // somebody loads a break into a patch that is already playing. Every voice of a module shares it.
            this.dataFor(node.id),
            {
              voice,
              sourceVoice: Math.floor(voice / lanes),
              lane: voice % lanes,
              lanes,
              voices: instances,
              shared,
            },
          ),
          inlets,
          outlets: node.outlets.map((index) =>
            index > 0 ? at(index, voice) : this.scratch,
          ),
          params: node.params.map(
            (slot) => this.paramBuffers[slot]?.[poly ? voice : 0] ?? this.scratch,
          ),
          collapse,
          trims,
          voiceInlets,
          voiceTrims,
        })
      }
    }

    // Every voice of every terminal outlet. An Out is `poly: false`, so in practice this is one entry per
    // Out — but a polyphonic terminal module would still work, and summing all its voices is right. Each
    // voice takes its own pan buffer where the param is polyphonic and voice 0's where it is not, which is
    // the same rule the nodes use for their params.
    this.outputs = []
    for (const output of plan.outputs) {
      if (output.buffer <= 0) continue
      const voices = this.buffers[output.buffer] ?? []
      // The right channel is a second buffer of the same width, so it is indexed by voice exactly as the
      // left one is. A plan from a build without stereo has no `right` at all, which reads as mono.
      const rights = output.right === null || output.right <= 0 ? null : this.buffers[output.right]
      const pan = output.pan === null ? null : this.paramBuffers[output.pan]
      const mute = output.mute === null ? null : this.paramBuffers[output.mute]
      const solo = output.solo === null ? null : this.paramBuffers[output.solo]
      const at = (buffers: Float32Array[] | null | undefined, voice: number) =>
        buffers ? (buffers[voice] ?? buffers[0] ?? null) : null
      for (let voice = 0; voice < voices.length; voice++) {
        this.outputs.push({
          signal: voices[voice],
          right: rights ? (rights[voice] ?? rights[0] ?? null) : null,
          pan: at(pan, voice),
          mute: at(mute, voice),
          solo: at(solo, voice),
        })
      }
    }
  }
}
