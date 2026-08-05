import { describe, expect, it } from 'vitest'
import { Wavetable } from './wavetable.js'

// The claim this file has to prove is stronger than the VCO's, and it is worth being precise about the
// difference. `vco.test.ts` measures how *much* alias PolyBLEP suppresses, because a correction that
// approximates a band-limited edge always leaves some. A table built from a spectrum that stops below
// Nyquist has a different promise: the folding harmonics were never synthesised, so what is measured here
// is that there is essentially nothing at the image frequencies at all — and that the harmonics which are
// supposed to survive did.
//
// The mip crossfade gets its own measurements, because it is the part that is easy to write backwards and
// impossible to hear as a bug: getting it inside out still produces sound, still passes an alias test at
// most pitches, and only misbehaves in the half-octave band where the wrong table is being faded in.

const SR = 44100

const SINE = 0
const TRIANGLE = 1 / 7
const ORGAN = 2 / 7
const SQUARE = 3 / 7
const SAW = 4 / 7
const PULSE_12 = 1

/** `samples` of the oscillator at a fixed frequency and position, with no phase modulation. */
function run(frequency: number, samples: number, position: number, offset = 0): Float64Array {
  const osc = new Wavetable()
  const dt = frequency / SR
  const out = new Float64Array(samples)
  for (let i = 0; i < samples; i++) out[i] = osc.next(dt, position, offset)
  return out
}

/** Energy at one frequency, by correlating against a sine and a cosine at it. The same trick
 *  `vco.test.ts` and the engine's `ladder.test.ts` use. */
function magnitudeAt(data: Float64Array, frequency: number): number {
  let re = 0
  let im = 0
  for (let i = 0; i < data.length; i++) {
    // Phase (i+1), matching the oscillator: it advances before it writes.
    const phase = (2 * Math.PI * frequency * (i + 1)) / SR
    re += data[i] * Math.cos(phase)
    im += data[i] * Math.sin(phase)
  }
  return (2 * Math.hypot(re, im)) / data.length
}

function rms(data: Float64Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

const peak = (data: Float64Array) => data.reduce((max, x) => Math.max(max, Math.abs(x)), 0)
const mean = (data: Float64Array) => data.reduce((sum, x) => sum + x, 0) / data.length

/** The first index where `ok` fails, or −1. One assertion per array rather than one per sample. */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

describe('the wavetable bank', () => {
  it('builds every waveform at every harmonic limit, and shares one bank', () => {
    const a = new Wavetable()
    const b = new Wavetable()
    // Reaching the cache the way the constructor does, rather than by naming the class — the same
    // constraint the constructor is written under.
    const owner = (a as unknown as { constructor: { bank: Float32Array[][] } }).constructor
    const other = (b as unknown as { constructor: { bank: Float32Array[][] } }).constructor

    expect(owner.bank).toHaveLength(8)
    for (const slot of owner.bank) {
      expect(slot).toHaveLength(11)
      // Four samples per harmonic, floored at 64 so that interpolating the sparsest table is still clean.
      for (let level = 0; level <= 10; level++) {
        expect(slot[level].length).toBe(Math.max(64, (1024 >> level) * 4))
      }
    }
    // Eight voices building 260KB of tables each is the thing the cache exists to prevent, so identity is
    // the assertion rather than equality.
    expect(other.bank).toBe(owner.bank)
  })

  it('normalises each waveform once rather than once per level', () => {
    const owner = (new Wavetable() as unknown as { constructor: { bank: Float32Array[][] } })
      .constructor

    for (const slot of owner.bank) {
      expect(peak(Float64Array.from(slot[0]))).toBeCloseTo(1, 6)
      // Every other level is the same waveform with harmonics removed, sharing the richest one's divisor
      // rather than being renormalised to its own peak — which would make a note change level as it
      // crossed an octave.
      //
      // A few of them come out slightly ABOVE 1 and that is Gibbs rather than a bug: the richest table's
      // peak includes the 18% overshoot at its discontinuity, so dividing by it leaves the sparse levels —
      // which have no discontinuity left to overshoot — a little hotter. Measured worst case is 1.094, on
      // the 25% pulse at the two-harmonic level, which is a note near Nyquist and 0.8dB.
      for (let level = 1; level <= 10; level++) {
        expect(peak(Float64Array.from(slot[level]))).toBeLessThan(1.1)
      }
    }
  })

  it('carries no DC on any waveform, including the pulses', () => {
    // The pulses are built as a sawtooth minus a delayed sawtooth precisely so that no n = 0 term can
    // appear. A DC offset here would travel down every cable in the patch and show up as asymmetric
    // clipping three modules later, which is a horrible thing to debug.
    for (const position of [SINE, TRIANGLE, ORGAN, SQUARE, SAW, 5 / 7, 6 / 7, PULSE_12]) {
      expect(Math.abs(mean(run(220, Math.ceil(SR / 4), position)))).toBeLessThan(0.01)
    }
  })
})

describe('the oscillator', () => {
  it('puts essentially nothing where a naive oscillator folds its images', () => {
    // The same frequency/image pairs `vco.test.ts` uses, so the two families are measured against the
    // same yardstick. A band-limited saw has precisely nothing at these frequencies, so whatever is there
    // is alias and nothing else — and where PolyBLEP leaves 25 to 52dB of suppression, a table that never
    // held those harmonics leaves the noise floor.
    for (const [frequency, image] of [
      [5000, 4100],
      [5000, 9100],
      [2000, 2100],
      [3000, 2100],
    ]) {
      expect(magnitudeAt(run(frequency, SR, SAW), image)).toBeLessThan(1e-3)
    }
  })

  it('keeps the harmonics a sawtooth is supposed to have', () => {
    // The other half of the claim: removing what would fold must not cost the sound its top end. A saw's
    // nth harmonic is exactly 1/n of its fundamental, and this is where the wavetable is *better* than
    // PolyBLEP rather than merely different — the VCO's third harmonic is 3dB shy at 5kHz, and these land
    // within a twentieth of a percent.
    const audio = run(220, SR, SAW)
    const fundamental = magnitudeAt(audio, 220)
    for (const harmonic of [2, 3, 4, 8]) {
      expect(magnitudeAt(audio, 220 * harmonic) / fundamental).toBeCloseTo(1 / harmonic, 3)
    }

    // Further up, linear interpolation starts to cost something: the 16th harmonic comes back 1.3% shy.
    // That is the whole price of reading the table with two taps instead of four, and it is measured here
    // rather than assumed — a table stored at less than four samples per harmonic would show it as a much
    // bigger number, and this is the test that would say so.
    const sixteenth = magnitudeAt(audio, 220 * 16) / fundamental
    expect(sixteenth).toBeGreaterThan((1 / 16) * 0.97)
    expect(sixteenth).toBeLessThanOrEqual(1 / 16)

    // And the absolute level, which is 0.540 rather than an ideal saw's 2/π. The difference is the 18%
    // Gibbs overshoot at the discontinuity: a table normalised so it cannot exceed ±1 has to divide by a
    // peak that includes the overshoot, leaving the fundamental 1.4dB below a VCO's. Worth pinning,
    // because the alternative — normalising to the ideal peak and letting the table overshoot — is a
    // defensible choice somebody could make by accident while changing something else.
    expect(fundamental).toBeCloseTo(0.54, 2)
  })

  it('is still the right waveform at the top of the keyboard', () => {
    // 5kHz leaves room for four harmonics below Nyquist. The first two are there at full strength — a mip
    // selection one level too cautious would pass every alias test in this file and quietly turn the top
    // octave into a sine, and this is what catches it.
    const audio = run(5000, SR, SAW)
    const fundamental = magnitudeAt(audio, 5000)
    expect(fundamental).toBeCloseTo(0.54, 2)
    expect(magnitudeAt(audio, 10000) / fundamental).toBeCloseTo(0.5, 2)

    // The third and fourth are attenuated, and that is the crossfade doing its job rather than a fault:
    // 5kHz sits nine tenths of the way through the four-harmonic level's safe range, so the fade to the
    // two-harmonic level is most of the way done. What it costs is content above 15kHz on a note whose
    // fundamental is already 5kHz; what it buys is the absence of a step, measured below.
    expect(magnitudeAt(audio, 15000) / fundamental).toBeGreaterThan(0.05)
    expect(magnitudeAt(audio, 15000) / fundamental).toBeLessThan(0.25)
  })

  it('makes a recognisably different waveform at each end and in the middle', () => {
    // 4900 samples at 441Hz is 49 whole cycles, which matters: a window holding a fractional cycle leaks
    // the fundamental into every other measurement here and turns an exact zero into a few thousandths.
    const samples = 4900
    // A sine is all fundamental; a square is all peak and no slope; a saw sits between them. RMS
    // separates them where a peak measurement would not. The numbers are lower than a unit-amplitude
    // textbook waveform's for the Gibbs reason above — a square's flat top sits at 0.848, not 1.
    expect(rms(run(441, samples, SINE))).toBeCloseTo(0.707, 2)
    expect(rms(run(441, samples, SQUARE))).toBeCloseTo(0.84, 2)
    expect(rms(run(441, samples, SAW))).toBeCloseTo(0.483, 2)
    // The 12% pulse is genuinely thinner, which is the reason the guide warns about level across the bank.
    expect(rms(run(441, samples, PULSE_12))).toBeLessThan(0.4)
    // And the organ really is a drawbar stack: harmonic 3 is absent where a saw's is not.
    const organ = run(220, SR, ORGAN)
    expect(magnitudeAt(organ, 440)).toBeGreaterThan(0.1)
    expect(magnitudeAt(organ, 660)).toBeLessThan(1e-4)
    expect(magnitudeAt(organ, 880)).toBeGreaterThan(0.05)
  })

  it('crossfades between neighbouring waveforms rather than switching', () => {
    // Position is the device. If it snapped to the nearest table, halfway between square and saw would be
    // one of them rather than a blend, and every sweep would be a staircase.
    const samples = 8820
    const square = run(220, samples, SQUARE)
    const saw = run(220, samples, SAW)
    const between = run(220, samples, (SQUARE + SAW) / 2)

    // The blend is linear in the tables, so the second harmonic — absent from a square, present in a
    // saw — must come in at half strength exactly halfway.
    const second = (data: Float64Array) => magnitudeAt(data, 440)
    expect(second(square)).toBeLessThan(1e-5)
    expect(second(between)).toBeCloseTo(second(saw) / 2, 4)
  })

  it('sweeps position without a step anywhere across the bank', () => {
    // Walking the knob and measuring how much the sound changes per step. A bank that switched rather
    // than crossfaded would show one large jump at each of the seven boundaries.
    const samples = 2048
    let previous = run(220, samples, 0)
    let worst = 0
    for (let i = 1; i <= 140; i++) {
      const current = run(220, samples, i / 140)
      let difference = 0
      for (let n = 0; n < samples; n++) difference += Math.abs(current[n] - previous[n])
      worst = Math.max(worst, difference / samples)
      previous = current
    }
    expect(worst).toBeLessThan(0.05)
  })

  it('does not alias while the mip crossfade is running', () => {
    // The half-octave either side of each level boundary is exactly where a crossfade written the obvious
    // way — fading the sharper table in as the pitch rises — would be blending in a table that has
    // already started folding. Sweeping across several boundaries catches it; a spot check at one pitch
    // does not.
    for (const frequency of [700, 900, 1100, 1400, 1800, 2300, 2900, 3700]) {
      const audio = run(frequency, SR, SAW)
      // Halfway between two harmonics of the fundamental, where a band-limited signal has nothing.
      for (const gap of [1.5, 2.5, 3.5]) {
        const probe = frequency * gap
        if (probe > SR / 2 - 100) continue
        expect(
          magnitudeAt(audio, probe),
          `alias at ${probe}Hz from a ${frequency}Hz saw`,
        ).toBeLessThan(2e-3)
      }
    }
  })

  it('changes brightness smoothly as the pitch crosses a mip boundary', () => {
    // The artefact the crossfade exists for: a step in brightness where a swept pitch crosses an octave.
    // Measured as total harmonic energy relative to the fundamental, which falls gradually as harmonics
    // run out of room and would fall in visible steps without the fade.
    const brightness = (frequency: number) => {
      const audio = run(frequency, Math.ceil(SR / 2), SAW)
      let above = 0
      for (let n = 2; n * frequency < SR / 2 - 100; n++) above += magnitudeAt(audio, n * frequency)
      return above / magnitudeAt(audio, frequency)
    }

    // Level 0's limit is 2^0/2048 of the sample rate — about 21.5Hz — so the boundaries in the audible
    // range are its octaves: 43, 86, 172, 345, 689, 1378, 2756Hz. Straddle two of them closely.
    for (const boundary of [689.06, 1378.12]) {
      const below = brightness(boundary * 0.97)
      const above = brightness(boundary * 1.03)
      // Brightness must fall with pitch — never rise, which is what a backwards fade produces — and the
      // fall across a 6% span must be a fraction of the halving a bare mip switch would give.
      expect(above).toBeLessThanOrEqual(below + 1e-9)
      expect(above).toBeGreaterThan(below * 0.8)
    }
  })

  it('offsets the phase without moving the pitch', () => {
    // What makes PM different from FM: an offset displaces the waveform and integrates to nothing, so a
    // constant one is inaudible and a moving one is a timbre rather than a detune.
    const samples = 4900
    const plain = run(440, samples, SAW)
    const shifted = run(440, samples, SAW, 0.25)
    expect(rms(shifted)).toBeCloseTo(rms(plain), 2)

    // A quarter cycle at 440Hz is 25 samples, so the shifted copy leads the plain one by that much.
    const lag = Math.round(SR / 440 / 4)
    let error = 0
    for (let i = 0; i < samples - lag; i++) error += Math.abs(shifted[i] - plain[i + lag])
    expect(error / (samples - lag)).toBeLessThan(0.02)
  })

  it('survives a hostile phase offset', () => {
    // The offset is whatever a cable brought, and a cable can carry anything the patch produced —
    // including a value that would index outside a table if the wrap were trusted rather than checked.
    for (const offset of [0, -3.5, 900, -1e9, Number.POSITIVE_INFINITY, Number.NaN]) {
      const audio = run(440, 512, SAW, offset)
      expect(firstBad(audio, Number.isFinite), `offset ${offset}`).toBe(-1)
      expect(peak(audio)).toBeLessThan(1.1)
    }
  })

  it('stays inside its range at every position and pitch', () => {
    // Every crossfade here is convex — between two waveforms, and between two harmonic limits — so the
    // output cannot exceed the loudest table involved, and the tables are normalised. What is left is the
    // 9% the Gibbs argument above accounts for, well inside the 1.2 the VCO's own overshoot is allowed.
    // A module whose output quietly exceeded that would make every level and trim downstream of it wrong.
    for (let step = 0; step <= 14; step++) {
      for (const frequency of [20, 55, 440, 4000, 12000]) {
        expect(peak(run(frequency, 2048, step / 14))).toBeLessThan(1.1)
      }
    }
    expect(peak(run(440, 2048, SAW))).toBeGreaterThan(0.9)
  })

  it('holds still at zero and does not run backwards below it', () => {
    // A negative frequency arrives whenever FM drives the carrier through zero, and the module clamps it
    // to zero rather than reversing. What matters here is that zero means a held sample rather than a
    // NaN or a table index that walks off the end.
    const osc = new Wavetable()
    const held = Array.from({ length: 64 }, () => osc.next(0, SAW, 0))
    expect(firstBad(held, Number.isFinite)).toBe(-1)
    expect(new Set(held).size).toBe(1)
  })

  it('restarts at the top when it is reset', () => {
    // A voice resets its oscillators on a note so that every note begins identically — the same argument
    // `voice.ts` makes about phase and analogue character.
    const osc = new Wavetable()
    const first = Array.from({ length: 32 }, () => osc.next(440 / SR, SAW, 0))
    osc.reset()
    const second = Array.from({ length: 32 }, () => osc.next(440 / SR, SAW, 0))
    expect(second).toEqual(first)
  })

  it('agrees with a direct sum of its own spectrum', () => {
    // The inverse FFT is the one piece of this file that is an optimisation rather than a decision, and
    // an optimisation is exactly the kind of code that can be subtly wrong and still sound plausible. So
    // it is checked against the quadratic sum it replaced, on a table small enough to compute directly.
    const sine = new Float64Array(1025)
    const cosine = new Float64Array(1025)
    for (let n = 1; n <= 8; n++) {
      sine[n] = 1 / n
      cosine[n] = Math.sin(n) / (n + 1)
    }

    const length = 64
    const table = Wavetable.synth(sine, cosine, 8, length)
    for (let i = 0; i < length; i++) {
      let expected = 0
      for (let n = 1; n <= 8; n++) {
        const angle = (2 * Math.PI * n * i) / length
        expected += sine[n] * Math.sin(angle) + cosine[n] * Math.cos(angle)
      }
      expect(table[i]).toBeCloseTo(expected, 5)
    }
  })

  it('still works when serialised into a scope of its own', () => {
    // `worklet.ts` ships this class to the audio thread as `Wavetable.toString()`, into a scope that
    // shares nothing with this module. This class is the riskiest one in the package for that rule,
    // because it has static methods that call each other and a cache reached through `this.constructor` —
    // any of which becomes a ReferenceError if it is ever written as a plain reference to the class name.
    const Rebuilt = new Function(`"use strict"; return ${Wavetable.toString()}`)() as typeof Wavetable

    const original = new Wavetable()
    const copy = new Rebuilt()
    for (const position of [SINE, SQUARE, SAW, PULSE_12]) {
      for (let i = 0; i < 256; i++) {
        expect(copy.next(440 / SR, position, 0)).toBe(original.next(440 / SR, position, 0))
      }
    }
  })
})
