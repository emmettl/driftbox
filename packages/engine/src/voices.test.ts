import { describe, expect, it } from 'vitest'
import { ALL_VOICES, TR808_VOICES, TR909_VOICES } from './index.js'
import { DEFAULT_PARAMS, type OscSource, type VoiceParams, type VoiceSpec } from './types.js'

// Because every voice is a pure function from knobs to a spec, the synthesis can be
// checked without an audio device: a kick either sweeps down into sub-bass or it does
// not. These are the assertions that would otherwise only be answerable by ear, which
// in practice means never answered at all.

const knobs = (over: Partial<VoiceParams> = {}): VoiceParams => ({ ...DEFAULT_PARAMS, ...over })

function oscillators(spec: VoiceSpec): OscSource[] {
  return spec.sources.filter((s): s is OscSource => s.kind === 'osc')
}

/** Latest moment any envelope in the spec is still doing something. */
function envelopeEnd(spec: VoiceSpec): number {
  let end = 0
  for (const source of spec.sources) {
    const delay = source.delay ?? 0
    for (const point of source.amp) end = Math.max(end, delay + point.at)
  }
  return end
}

describe('every voice', () => {
  it.each(ALL_VOICES)('$id is well formed', (voice) => {
    const spec = voice.build(knobs(), 1)

    expect(spec.sources.length).toBeGreaterThan(0)
    expect(spec.duration).toBeGreaterThan(0)
    expect(spec.gain).toBeGreaterThan(0)

    for (const source of spec.sources) {
      expect(source.amp.length).toBeGreaterThan(0)
      // An envelope must start by rising, or the voice is silent.
      expect(source.amp[0].to).toBeGreaterThan(0)
      for (const point of source.amp) expect(point.at).toBeGreaterThanOrEqual(0)
    }
  })

  it.each(ALL_VOICES)('$id lasts long enough to contain its own envelopes', (voice) => {
    // A duration shorter than the envelopes means the voice is cut off mid-decay, which
    // is audible as a click and is always a bug rather than a choice.
    const spec = voice.build(knobs({ decay: 1 }), 1)
    expect(spec.duration).toBeGreaterThanOrEqual(envelopeEnd(spec))
  })

  it.each(ALL_VOICES)('$id rings longer as decay is turned up', (voice) => {
    const short = voice.build(knobs({ decay: 0 }), 1)
    const long = voice.build(knobs({ decay: 1 }), 1)
    expect(long.duration).toBeGreaterThan(short.duration)
  })

  it.each(ALL_VOICES)('$id gets louder with accent', (voice) => {
    const soft = voice.build(knobs(), 0)
    const hard = voice.build(knobs(), 1)
    expect(hard.gain).toBeGreaterThan(soft.gain)
  })

  it.each(ALL_VOICES)('$id stays within audible frequencies', (voice) => {
    // Catches a tune range that has been scaled wrongly — an oscillator above Nyquist
    // aliases into noise, and one near DC is felt rather than heard.
    for (const tune of [0, 0.5, 1]) {
      for (const source of oscillators(voice.build(knobs({ tune }), 1))) {
        expect(source.frequency).toBeGreaterThan(20)
        expect(source.frequency).toBeLessThan(18000)
        for (const point of source.pitch ?? []) {
          expect(point.to).toBeGreaterThan(20)
          expect(point.to).toBeLessThan(18000)
        }
      }
    }
  })
})

describe('bass drums', () => {
  it.each([TR808_VOICES[0], TR909_VOICES[0]])('$id sweeps downward into the bass', (voice) => {
    const spec = voice.build(knobs(), 1)
    const [body] = oscillators(spec)

    expect(body.pitch).toBeDefined()
    const landing = body.pitch![body.pitch!.length - 1].to
    // The drop is what makes a kick a kick rather than a low beep.
    expect(landing).toBeLessThan(body.frequency)
    expect(landing).toBeLessThan(100)
  })

  it('the 909 kick punches harder and shorter than the 808 at the same settings', () => {
    const eight = TR808_VOICES[0].build(knobs(), 1)
    const nine = TR909_VOICES[0].build(knobs(), 1)

    // The characteristic difference between the two machines: the 808 gets out of the
    // way, the 909 hits you. Shorter tail, steeper sweep, and some saturation.
    expect(nine.duration).toBeLessThan(eight.duration)
    expect(nine.drive ?? 0).toBeGreaterThan(eight.drive ?? 0)

    const eightSweep = oscillators(eight)[0]
    const nineSweep = oscillators(nine)[0]
    expect(nineSweep.frequency / nineSweep.pitch![0].to).toBeGreaterThan(
      eightSweep.frequency / eightSweep.pitch![0].to,
    )
  })
})

describe('metallic voices', () => {
  const hats = ALL_VOICES.filter((v) => v.choke !== undefined)

  it('there are hats on both machines, and they choke each other', () => {
    expect(hats.map((h) => h.id).sort()).toEqual(['808.ch', '808.oh', '909.ch', '909.oh'])
  })

  it.each(hats)('$id is built from six inharmonic oscillators', (voice) => {
    const oscs = oscillators(voice.build(knobs(), 1))
    expect(oscs.length).toBeGreaterThanOrEqual(6)

    // The point of the 808's hat circuit: no two partials form a simple ratio, so the
    // ear cannot resolve a pitch and hears metal instead. If these ever collapsed onto
    // a harmonic series the hats would start to sound like a chord.
    const ratios = oscs.slice(0, 6).map((o) => o.frequency / oscs[0].frequency)
    for (let i = 1; i < ratios.length; i++) {
      const nearestHarmonic = Math.round(ratios[i])
      const off = Math.abs(ratios[i] - nearestHarmonic)
      if (nearestHarmonic > 1) expect(off).toBeGreaterThan(0.04)
    }
  })

  it('open hats ring longer than closed ones', () => {
    const closed = ALL_VOICES.find((v) => v.id === '909.ch')!.build(knobs(), 1)
    const open = ALL_VOICES.find((v) => v.id === '909.oh')!.build(knobs(), 1)
    expect(open.duration).toBeGreaterThan(closed.duration * 2)
  })

  it.each(['909.ch', '909.oh', '909.rd', '909.cr'])(
    '%s carries a deterministic 6-bit, 30kHz PCM layer',
    (id) => {
      const spec = ALL_VOICES.find((v) => v.id === id)!.build(knobs(), 1)
      const pcm = spec.sources.find((source) => source.kind === 'noise' && source.seed !== undefined)

      expect(pcm).toMatchObject({ sampleRate: 30000, bitDepth: 6 })
    },
  )

  it.each(['909.ch', '909.oh', '909.rd', '909.cr'])(
    '%s tune moves both the PCM and modal layers',
    (id) => {
      const voice = ALL_VOICES.find((v) => v.id === id)!
      const low = voice.build(knobs({ tune: 0 }), 1)
      const high = voice.build(knobs({ tune: 1 }), 1)
      const lowPcm = low.sources.find((source) => source.kind === 'noise' && source.seed !== undefined)!
      const highPcm = high.sources.find((source) => source.kind === 'noise' && source.seed !== undefined)!

      expect(lowPcm.kind === 'noise' && highPcm.kind === 'noise').toBe(true)
      if (lowPcm.kind !== 'noise' || highPcm.kind !== 'noise') return
      expect(highPcm.playbackRate!).toBeGreaterThan(lowPcm.playbackRate!)

      const lowModes = oscillators(low)
      const highModes = oscillators(high)
      expect(highModes).toHaveLength(lowModes.length)
      highModes.forEach((mode, index) => {
        expect(mode.frequency).toBeGreaterThan(lowModes[index].frequency)
      })
    },
  )
})

describe('claps', () => {
  it.each(['808.cp', '909.cp'])('%s retriggers rather than firing once', (id) => {
    const spec = ALL_VOICES.find((v) => v.id === id)!.build(knobs(), 1)
    const delays = spec.sources.map((s) => s.delay ?? 0)
    // Several bursts a few milliseconds apart is what makes it sound like hands rather
    // than a single puff of noise.
    expect(new Set(delays).size).toBeGreaterThanOrEqual(3)
  })
})

describe('the kits', () => {
  it('have no duplicate voice ids', () => {
    const ids = ALL_VOICES.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cover both machines', () => {
    expect(TR808_VOICES.every((v) => v.machine === 'tr808')).toBe(true)
    expect(TR909_VOICES.every((v) => v.machine === 'tr909')).toBe(true)
    expect(TR808_VOICES.length).toBeGreaterThanOrEqual(10)
    expect(TR909_VOICES.length).toBeGreaterThanOrEqual(10)
  })
})
