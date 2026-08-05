import type { Breakpoint, FilterSpec, Source, VoiceSpec } from './types.js'

// Turning a VoiceSpec into Web Audio nodes. This is the only file in the engine that
// touches an AudioContext, and it is deliberately dumb: it reads the spec and builds
// exactly what it says. All the musical decisions live in the voices.

/** Web Audio refuses to ramp exponentially to or from zero, and silently produces
 *  nothing if you try. Everything that decays to silence decays to this instead — far
 *  below audibility, but a legal target. */
const SILENCE = 1e-4

/** Noise buffers are shared by context and format. Snares and claps use full-rate noise;
 *  the 909's digital cymbals use quantised low-rate noise so each hit reads the same
 *  generated "ROM" rather than allocating a waveform per trigger. */
const noiseBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>()

/**
 * The seed ordinary noise gets when a voice does not name one.
 *
 * **This used to be `Math.random`, and the cost of that was not variety — it was that no two
 * renders of the same song were the same song.** Within one context nothing changed either way:
 * the buffer is generated once and shared, so every snare in a session already read the same
 * noise. What moved was everything across contexts. A stem rendered offline got different noise
 * from the mix it was supposed to match. The busiest pattern's measured peak wandered between
 * runs. And any test comparing one render to another was comparing two different pieces of noise
 * — which is exactly how it was found, by a test asserting that two renders of `808.bd` had the
 * same peak, which they should and did not.
 *
 * White noise is white noise: a fixed stream sounds the same as a fresh one, and nobody can hear
 * which realisation they got. What they can hear is a stem that does not sit back into its mix.
 */
const DEFAULT_NOISE_SEED = 0x64726966

interface NoiseBufferOptions {
  sampleRate?: number
  bitDepth?: number
  seed?: number
}

/** A deterministic stream of 0..1. Exported because the reverb's impulse response needs the same
 *  one — two noise generators with different characters would be two things to reason about. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    // xorshift32: tiny, deterministic and amply long for a few seconds of noise.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

export function noiseBuffer(
  ctx: BaseAudioContext,
  options: NoiseBufferOptions = {},
): AudioBuffer {
  const sampleRate = options.sampleRate ?? ctx.sampleRate
  // `'default'` rather than the seed's value, so that unseeded noise and a voice that happened to
  // ask for exactly DEFAULT_NOISE_SEED stay different entries — they are different lengths.
  const key = `${sampleRate}:${options.bitDepth ?? 'float'}:${options.seed ?? 'default'}`
  let buffers = noiseBuffers.get(ctx)
  if (!buffers) {
    buffers = new Map()
    noiseBuffers.set(ctx, buffers)
  }
  const cached = buffers.get(key)
  if (cached) return cached

  // Four seconds covers the longest cymbal decay without looping its generated ROM.
  // Ordinary noise keeps the original two-second allocation and can loop invisibly. The length
  // still keys off whether a seed was *asked for*, not off the seed used — everything is seeded
  // now, and conflating the two would quietly make every snare buffer twice the size.
  const seconds = options.seed === undefined ? 2 : 4
  const length = Math.floor(sampleRate * seconds)
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  const random = seededRandom(options.seed ?? DEFAULT_NOISE_SEED)
  const maximumCode = options.bitDepth
    ? Math.pow(2, Math.max(2, Math.min(16, options.bitDepth))) - 1
    : 0
  for (let i = 0; i < data.length; i++) {
    const value = random() * 2 - 1
    data[i] = maximumCode
      ? (Math.round(((value + 1) * maximumCode) / 2) / maximumCode) * 2 - 1
      : value
  }
  buffers.set(key, buffer)
  return buffer
}

/**
 * Apply an envelope to a param, starting from `from`. Breakpoints are relative to
 * `time`. An exponential segment that would touch zero is clamped rather than dropped,
 * so a decay-to-silence still sounds like a decay.
 *
 * `scale` multiplies every destination. Amplitude envelopes are written as a 0..1 shape
 * and scaled by the source's own gain; a pitch envelope has no such thing and leaves it
 * at 1. Scaling here rather than with a second gain node keeps a source to one node.
 */
function applyEnvelope(
  param: AudioParam,
  from: number,
  points: Breakpoint[] | undefined,
  time: number,
  scale = 1,
): void {
  let previous = from
  param.setValueAtTime(previous === 0 ? 0 : Math.max(previous, SILENCE), time)
  if (!points) return

  for (const point of points) {
    const at = time + point.at
    const to = point.to * scale
    const exponential = (point.curve ?? 'exp') === 'exp' && previous > 0 && to !== 0
    if (exponential) param.exponentialRampToValueAtTime(Math.max(to, SILENCE), at)
    else param.linearRampToValueAtTime(to, at)
    previous = to
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
  // Build from the same quantised value used as the cache key. Building from the raw
  // amount made a bucket's curve depend on which nearby knob value happened to reach it
  // first, so two fresh sessions could render the same setting differently.
  const quantised = key / 20
  const k = 1 + quantised * 40
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  driveCurves.set(key, curve)
  return curve
}

/**
 * Which slice of the noise buffer this particular hit should read from.
 *
 * **A function of the hit rather than of chance, and the distinction is the whole point.** The
 * offset exists so that two noise sources overlapping do not read the same samples and comb-filter
 * each other — most audibly inside a clap, which is one voice retriggering itself three times.
 * That needs the offsets to differ *from each other*. It never needed them to differ between one
 * render and the next, and `Math.random()` gave both: a clap was a slightly different clap every
 * time the page loaded, and a stem could not be cut to match the mix it came from.
 *
 * So it hashes the three things that make a hit that hit — which voice, which source within it,
 * and when — into a seed. Two sources in one clap have different `delay`s and therefore different
 * `start`s. Two voices landing on the same step have different ids. The same song rendered twice
 * has the same times, so it gets the same offsets, and the clap still does not comb-filter itself.
 *
 * Live playback still varies, because `start` there is an absolute context time that depends on
 * when somebody pressed play. That is the one place variation was ever worth anything.
 */
function noiseOffsetSeed(voice: string, index: number, start: number): number {
  let hash = 0x811c9dc5
  const mix = (value: number) => {
    hash ^= value
    hash = Math.imul(hash, 0x01000193)
  }
  for (let i = 0; i < voice.length; i++) mix(voice.charCodeAt(i))
  mix(index + 1)
  // Milliseconds, so that a float that differs in its last bit between two otherwise identical
  // schedules cannot land on a different slice of noise.
  mix(Math.round(start * 1000))
  // A final avalanche. FNV alone leaves adjacent inputs — index 0 and index 1 — with seeds that
  // are close, and xorshift32's first output from two close seeds is close too, which would put
  // two sources of one clap almost on top of each other.
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x2c1b3c6d)
  hash ^= hash >>> 12
  return hash >>> 0
}

function buildSource(
  ctx: BaseAudioContext,
  source: Source,
  destination: AudioNode,
  time: number,
  duration: number,
  /** Identifies this source among all the ones that could be sounding at once. */
  offsetSeed = 0,
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
          noise.buffer = noiseBuffer(ctx, source)
          noise.loop = true
          noise.loopStart = 0
          noise.loopEnd = noise.buffer.duration
          if (source.playbackRate !== undefined) {
            noise.playbackRate.setValueAtTime(source.playbackRate, start)
          }
          return noise
        })()

  const gain = ctx.createGain()
  // Scaled by the source's own gain.
  //
  // This was missing, from the first commit until it was heard rather than found: every
  // source played at whatever its envelope peaked at, and `Source.gain` — declared 39
  // times across the two kits — did nothing at all. The audible symptom was the 808
  // kick's click, a noise burst meant to sit at 0.175 under the body and arriving at
  // full scale on the transient instead. Its colour knob could not turn it down either,
  // because turning the knob only changed a number nobody read.
  applyEnvelope(gain.gain, 0, source.amp, start, source.gain)
  gain.gain.setValueAtTime(0, time + duration)

  let tail: AudioNode = gain
  if (source.filter) {
    const filter = buildFilter(ctx, source.filter, start)
    gain.connect(filter)
    tail = filter
  }

  node.connect(gain)
  tail.connect(destination)

  // `source.kind` rather than `instanceof AudioBufferSourceNode`: the spec already says
  // which this is, and the global only exists in a browser — so the instanceof made the
  // renderer unusable anywhere else, including from a test.
  if (source.kind === 'noise') {
    // Ordinary analogue-style noise starts at an offset of its own, so overlapping claps do
    // not comb-filter. A seeded source represents generated PCM ROM and starts at zero:
    // repeated hits being identical is part of a sampled voice's character.
    //
    // Derived from the hit rather than drawn at random — see `noiseOffsetSeed`. The stream is
    // advanced once before it is read, because xorshift32's first output still carries some of
    // the shape of its seed.
    const pick = seededRandom(offsetSeed || 1)
    pick()
    const offset = source.seed === undefined ? pick() * 1.5 : 0
    const noise = node as AudioBufferSourceNode
    noise.start(start, offset)
  } else node.start(start)
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
  /**
   * Which voice this is, used only to keep two of them landing on the same step from reading the
   * same slice of noise. Optional and defaulted because a `VoiceSpec` does not carry an id — a
   * caller that has one should pass it, and the metronome, which is alone on its own output, has
   * nothing to collide with.
   */
  voice = '',
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

  const nodes = spec.sources.map((source, index) =>
    buildSource(
      ctx,
      source,
      out,
      time,
      spec.duration,
      noiseOffsetSeed(voice, index, time + (source.delay ?? 0)),
    ),
  )

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
