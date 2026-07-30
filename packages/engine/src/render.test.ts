import { describe, expect, it, vi } from 'vitest'
import { renderVoice } from './render.js'
import type { VoiceSpec } from './types.js'

// The renderer needs an AudioContext, so it had no tests — and that is exactly where the
// worst bug in the project lived, from the first commit until somebody heard it: the
// renderer never read `Source.gain`. Every source played at whatever its envelope peaked
// at, so the 808 kick's click — declared at 0.175 to sit under the body — arrived at full
// scale on the transient, and its colour knob did nothing because turning it only changed
// a number nobody read.
//
// It only uses a handful of context methods, so a stub is enough to check what it
// schedules. That does not replace measuring the audio (docs/VERIFYING-AUDIO.md), but it
// does mean this particular silence cannot come back unnoticed.

interface Scheduled {
  kind: 'set' | 'linear' | 'exp'
  value: number
  time: number
}

class FakeParam {
  readonly calls: Scheduled[] = []
  value = 0
  setValueAtTime(value: number, time: number) {
    this.calls.push({ kind: 'set', value, time })
    return this
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ kind: 'linear', value, time })
    return this
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push({ kind: 'exp', value, time })
    return this
  }
  cancelScheduledValues() {
    return this
  }
  /** The largest value this param was ever told to reach. */
  get peak(): number {
    return this.calls.reduce((max, c) => Math.max(max, c.value), 0)
  }
}

class FakeNode {
  readonly starts: number[][] = []
  connect() {
    return this
  }
  disconnect() {}
  start(...args: number[]) {
    this.starts.push(args)
  }
  stop() {}
  onended: (() => void) | null = null
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakeOsc extends FakeNode {
  type = 'sine'
  frequency = new FakeParam()
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null
  loop = false
  loopStart = 0
  loopEnd = 0
  playbackRate = new FakeParam()
}

class FakeShaper extends FakeNode {
  curve: Float32Array<ArrayBuffer> | null = null
  oversample = ''
}

class FakeContext {
  sampleRate = 44100
  currentTime = 0
  /** Every gain node built, in creation order. */
  readonly gains: FakeGain[] = []
  readonly shapers: FakeShaper[] = []
  readonly bufferSources: FakeBufferSource[] = []
  readonly buffers: Array<{ channels: number; length: number; sampleRate: number; data: Float32Array }> = []
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createOscillator() {
    return new FakeOsc()
  }
  createBufferSource() {
    const source = new FakeBufferSource()
    this.bufferSources.push(source)
    return source
  }
  createBiquadFilter() {
    return { type: '', frequency: new FakeParam(), Q: new FakeParam(), ...new FakeNode() }
  }
  createWaveShaper() {
    const shaper = new FakeShaper()
    this.shapers.push(shaper)
    return shaper
  }
  createBuffer(channels = 1, length = 16, sampleRate = this.sampleRate) {
    const data = new Float32Array(Math.min(length, 256))
    this.buffers.push({ channels, length, sampleRate, data })
    return { duration: length / sampleRate, getChannelData: () => data }
  }
}

const render = (spec: VoiceSpec) => {
  const ctx = new FakeContext()
  renderVoice(ctx as unknown as BaseAudioContext, spec, new FakeNode() as never, 0)
  return ctx
}

const source = (gain: number) =>
  ({
    kind: 'osc' as const,
    type: 'sine' as const,
    frequency: 100,
    gain,
    amp: [
      { to: 1, at: 0.001, curve: 'lin' as const },
      { to: 0, at: 0.2 },
    ],
  })

describe('a source gain', () => {
  it('scales its amplitude envelope', () => {
    // The regression. Declared 0.25, so the envelope must be told to reach 0.25 — not 1.
    const ctx = render({ duration: 0.3, gain: 1, sources: [source(0.25)] })
    const envelope = ctx.gains.find((g) => g.gain.calls.some((c) => c.kind === 'linear'))!
    expect(envelope.gain.peak).toBeCloseTo(0.25, 6)
  })

  it('keeps two sources in the proportion they declare', () => {
    // What the bug actually cost: not loudness, which the per-voice trim hides, but the
    // BALANCE inside a voice. A kick's click against its body, a snare's snap against its
    // shells — every one of those was rendered at 1:1.
    const ctx = render({ duration: 0.3, gain: 1, sources: [source(1), source(0.2)] })
    const peaks = ctx.gains
      .filter((g) => g.gain.calls.some((c) => c.kind === 'linear'))
      .map((g) => g.gain.peak)
      .sort((a, b) => b - a)

    expect(peaks).toHaveLength(2)
    expect(peaks[0] / peaks[1]).toBeCloseTo(5, 6)
  })

  it('silences a source whose gain is zero', () => {
    // The symptom that gave it away: turning the 808 kick's colour knob to zero should
    // remove the click entirely, and did nothing at all.
    const ctx = render({ duration: 0.3, gain: 1, sources: [source(0)] })
    const envelope = ctx.gains.find((g) => g.gain.calls.length > 1)!
    expect(envelope.gain.peak).toBe(0)
  })

  it('leaves the voice gain and trim alone', () => {
    // Source gain, voice gain and trim are three separate stages; scaling one must not
    // quietly fold in another.
    const ctx = render({ duration: 0.3, gain: 0.5, sources: [source(0.25)], trim: 2 })
    const values = ctx.gains.map((g) => g.gain.calls[0]?.value)
    expect(values).toContain(0.5)
    expect(values).toContain(2)
  })
})

describe('a pitch envelope', () => {
  it('is not scaled by the source gain', () => {
    // Frequencies are absolute. Scaling one by a gain would transpose the voice, and a
    // shared helper makes that an easy mistake to make.
    const ctx = new FakeContext()
    const osc = { built: null as FakeOsc | null }
    const create = ctx.createOscillator.bind(ctx)
    ctx.createOscillator = () => {
      const o = create()
      osc.built = o
      return o
    }
    renderVoice(
      ctx as unknown as BaseAudioContext,
      {
        duration: 0.3,
        gain: 1,
        sources: [{ ...source(0.25), pitch: [{ to: 50, at: 0.04 }] }],
      },
      new FakeNode() as never,
      0,
    )
    expect(osc.built!.frequency.calls.map((c) => c.value)).toEqual([100, 50])
  })
})

describe('generated PCM noise', () => {
  const pcm = (): VoiceSpec => ({
    duration: 0.3,
    gain: 1,
    sources: [{
      kind: 'noise',
      gain: 1,
      amp: [
        { to: 1, at: 0.001, curve: 'lin' },
        { to: 0, at: 0.2 },
      ],
      sampleRate: 30000,
      bitDepth: 6,
      seed: 0x909,
      playbackRate: 1.1,
    }],
  })

  it('builds a low-rate buffer quantised to the requested bit depth', () => {
    const ctx = render(pcm())
    const [buffer] = ctx.buffers

    expect(buffer.sampleRate).toBe(30000)
    expect(buffer.length).toBe(120000)
    for (const sample of buffer.data) {
      const code = ((sample + 1) * 63) / 2
      expect(code).toBeCloseTo(Math.round(code), 5)
    }
  })

  it('recreates a seeded waveform exactly', () => {
    const a = render(pcm()).buffers[0].data
    const b = render(pcm()).buffers[0].data
    expect(a).toEqual(b)
  })

  it('reuses the generated ROM, applies tuning and starts it from the beginning', () => {
    const spec = pcm()
    spec.sources.push({ ...spec.sources[0] })
    const ctx = render(spec)

    expect(ctx.buffers).toHaveLength(1)
    expect(ctx.bufferSources).toHaveLength(2)
    for (const source of ctx.bufferSources) {
      expect(source.playbackRate.calls).toContainEqual({ kind: 'set', value: 1.1, time: 0 })
      expect(source.starts).toContainEqual([0, 0])
    }
  })
})

describe('drive curve caching', () => {
  it('builds a cache bucket identically regardless of which nearby value reaches it first', async () => {
    const spec = (drive: number): VoiceSpec => ({
      duration: 0.3,
      gain: 1,
      drive,
      sources: [source(0.25)],
    })

    // A fresh module gives each order an empty cache. Both values round to bucket 5,
    // whose curve must be a property of that bucket rather than of call history.
    vi.resetModules()
    const firstModule = await import('./render.js')
    const lowFirst = new FakeContext()
    firstModule.renderVoice(
      lowFirst as unknown as BaseAudioContext,
      spec(0.251),
      new FakeNode() as never,
      0,
    )

    vi.resetModules()
    const secondModule = await import('./render.js')
    const highFirst = new FakeContext()
    secondModule.renderVoice(
      highFirst as unknown as BaseAudioContext,
      spec(0.274),
      new FakeNode() as never,
      0,
    )

    expect(lowFirst.shapers[0].curve).toEqual(highFirst.shapers[0].curve)
  })
})
