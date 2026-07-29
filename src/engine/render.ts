import type { Breakpoint, FilterSpec, Source, VoiceSpec } from './types'

// Turning a VoiceSpec into Web Audio nodes. This is the only file in the engine that
// touches an AudioContext, and it is deliberately dumb: it reads the spec and builds
// exactly what it says. All the musical decisions live in the voices.

/** Web Audio refuses to ramp exponentially to or from zero, and silently produces
 *  nothing if you try. Everything that decays to silence decays to this instead — far
 *  below audibility, but a legal target. */
const SILENCE = 1e-4

/** One shared noise buffer per context. Snares, hats and claps all draw from it, and
 *  allocating two seconds of random floats per hit at 140bpm is not an option. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx)
  if (cached) return cached

  const length = Math.floor(ctx.sampleRate * 2)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffers.set(ctx, buffer)
  return buffer
}

/** Apply an envelope to a param, starting from `from`. Breakpoints are relative to
 *  `time`. An exponential segment that would touch zero is clamped rather than
 *  dropped, so a decay-to-silence still sounds like a decay. */
function applyEnvelope(
  param: AudioParam,
  from: number,
  points: Breakpoint[] | undefined,
  time: number,
): void {
  let previous = from
  param.setValueAtTime(previous === 0 ? 0 : Math.max(previous, SILENCE), time)
  if (!points) return

  for (const point of points) {
    const at = time + point.at
    const exponential = (point.curve ?? 'exp') === 'exp' && previous > 0 && point.to !== 0
    if (exponential) param.exponentialRampToValueAtTime(Math.max(point.to, SILENCE), at)
    else param.linearRampToValueAtTime(point.to, at)
    previous = point.to
  }
}

function buildFilter(ctx: BaseAudioContext, spec: FilterSpec, time: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  filter.type = spec.type
  filter.Q.setValueAtTime(spec.Q ?? 1, time)
  applyEnvelope(filter.frequency, spec.frequency, spec.envelope, time)
  return filter
}

/** A soft-clipping curve. Used sparingly — enough to thicken a 909 kick, not enough to
 *  turn it into a fuzz pedal. */
const driveCurves = new Map<number, Float32Array<ArrayBuffer>>()

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(amount * 20)
  const cached = driveCurves.get(key)
  if (cached) return cached

  const samples = 1024
  const curve = new Float32Array(samples)
  const k = 1 + amount * 40
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  driveCurves.set(key, curve)
  return curve
}

function buildSource(
  ctx: BaseAudioContext,
  source: Source,
  destination: AudioNode,
  time: number,
  duration: number,
): AudioScheduledSourceNode {
  const start = time + (source.delay ?? 0)

  const node =
    source.kind === 'osc'
      ? (() => {
          const osc = ctx.createOscillator()
          osc.type = source.type
          applyEnvelope(osc.frequency, source.frequency, source.pitch, start)
          return osc
        })()
      : (() => {
          const noise = ctx.createBufferSource()
          noise.buffer = noiseBuffer(ctx)
          noise.loop = true
          // Start somewhere random in the buffer, so repeated hits are not identical
          // — two claps in a row from the same offset comb-filter against each other.
          noise.loopStart = 0
          noise.loopEnd = noise.buffer.duration
          return noise
        })()

  const gain = ctx.createGain()
  applyEnvelope(gain.gain, 0, source.amp, start)
  gain.gain.setValueAtTime(0, time + duration)

  let tail: AudioNode = gain
  if (source.filter) {
    const filter = buildFilter(ctx, source.filter, start)
    gain.connect(filter)
    tail = filter
  }

  node.connect(gain)
  tail.connect(destination)

  if (node instanceof AudioBufferSourceNode) node.start(start, Math.random() * 1.5)
  else node.start(start)
  node.stop(time + duration)

  return node
}

/** A voice that is currently sounding. The gain node is the handle a choke group uses
 *  to cut it short — closed hats silencing a ringing open hat, as on the hardware. */
export interface VoiceHandle {
  output: GainNode
  endsAt: number
}

/**
 * Render one hit of a voice into `destination`, starting at `time` on the context's
 * clock. Nodes release themselves when the voice ends.
 */
export function renderVoice(
  ctx: BaseAudioContext,
  spec: VoiceSpec,
  destination: AudioNode,
  time: number,
): VoiceHandle {
  // The last node before the destination, kept as a bare gain so a choke can duck the
  // whole voice without knowing anything about how it was built.
  const output = ctx.createGain()
  output.gain.setValueAtTime(spec.trim ?? 1, time)
  output.connect(destination)

  const out = ctx.createGain()
  out.gain.setValueAtTime(spec.gain, time)

  let head: AudioNode = out
  if (spec.drive && spec.drive > 0) {
    const shaper = ctx.createWaveShaper()
    shaper.curve = driveCurve(spec.drive)
    shaper.oversample = '2x'
    out.connect(shaper)
    head = shaper
  }

  if (spec.filter) {
    const filter = buildFilter(ctx, spec.filter, time)
    head.connect(filter)
    head = filter
  }

  if (spec.pan !== undefined && spec.pan !== 0 && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner()
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, spec.pan)), time)
    head.connect(panner)
    head = panner
  }

  head.connect(output)

  const nodes = spec.sources.map((source) => buildSource(ctx, source, out, time, spec.duration))

  // Release the graph once the tail has run out. Without this, a few minutes of a
  // pattern at 140bpm leaves thousands of dead nodes connected to the master bus.
  const last = nodes[nodes.length - 1]
  if (last) {
    last.onended = () => {
      out.disconnect()
      head.disconnect()
      output.disconnect()
    }
  }

  return { output, endsAt: time + spec.duration }
}
