import { describe, expect, it } from 'vitest'
import { Wavetable } from '../dsp/wavetable.js'
import { WAVETABLE_MODULE, WavetableProcessor } from './wavetable.js'

// The oscillator itself is measured in `dsp/wavetable.test.ts` — alias floors, harmonic accuracy, the mip
// crossfade. What is left for this file is the wiring: that a volt is an octave, that the two modulation
// inlets are the two different things the module claims they are, and that a cable carrying anything at
// all cannot take the audio thread down.

const SR = 44100
const BASE = 65.40639132514966

const SAW = 4 / 7

/** The tune in semitones that puts the oscillator at `frequency` with no CV. */
const tuneFor = (frequency: number) => 12 * Math.log2(frequency / BASE)

interface Signals {
  pitch?: number | Float32Array
  fm?: number | Float32Array
  pm?: number | Float32Array
  pos?: number | Float32Array
  tune?: number
  position?: number
  index?: number
}

function fill(samples: number, value: number | Float32Array | undefined): Float32Array {
  if (value instanceof Float32Array) return value
  return new Float32Array(samples).fill(value ?? 0)
}

function run(
  samples: number,
  signals: Signals,
  Constructor: typeof WavetableProcessor = WavetableProcessor,
): Float64Array {
  const osc = new Constructor(SR, { Wavetable })
  const inlets = [
    fill(samples, signals.pitch),
    fill(samples, signals.fm),
    fill(samples, signals.pm),
    fill(samples, signals.pos),
  ]
  const params = [
    new Float32Array(samples).fill(signals.tune ?? 0),
    new Float32Array(samples).fill(signals.position ?? SAW),
    new Float32Array(samples).fill(signals.index ?? 0),
  ]
  const out = new Float32Array(samples)
  osc.process(inlets, [out], params, samples)
  return Float64Array.from(out)
}

/** Rising zero crossings per second, which for a sawtooth is its frequency. */
function frequencyOf(data: Float64Array): number {
  let crossings = 0
  for (let i = 1; i < data.length; i++) if (data[i - 1] <= 0 && data[i] > 0) crossings++
  return (crossings * SR) / data.length
}

function magnitudeAt(data: Float64Array, frequency: number): number {
  let re = 0
  let im = 0
  for (let i = 0; i < data.length; i++) {
    const phase = (2 * Math.PI * frequency * (i + 1)) / SR
    re += data[i] * Math.cos(phase)
    im += data[i] * Math.sin(phase)
  }
  return (2 * Math.hypot(re, im)) / data.length
}

const peak = (data: Float64Array) => data.reduce((max, x) => Math.max(max, Math.abs(x)), 0)

/** The first index where `ok` fails, or −1. */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

describe('the wavetable module', () => {
  it('reads a volt as an octave and a tune knob as semitones', () => {
    // The same convention as every other pitched module here, which is the point: a Seq or a MIDI module
    // patched at V/Oct has to mean the same thing whichever oscillator is on the other end.
    const samples = Math.ceil(SR / 4)
    expect(frequencyOf(run(samples, { tune: tuneFor(220) }))).toBeCloseTo(220, -1)
    expect(frequencyOf(run(samples, { tune: tuneFor(220), pitch: 1 }))).toBeCloseTo(440, -1)
    expect(frequencyOf(run(samples, { tune: tuneFor(220), pitch: -1 }))).toBeCloseTo(110, -1)
    expect(frequencyOf(run(samples, { tune: tuneFor(220) + 12 }))).toBeCloseTo(440, -1)
  })

  it('deviates by one carrier frequency for an FM input of 1', () => {
    // Linear FM with the index in units of the carrier, exactly as `vco.ts` does it — so swapping a VCO
    // for this device leaves an FM cable meaning what it meant. A constant input of 1.0 is an octave up.
    const samples = Math.ceil(SR / 4)
    expect(frequencyOf(run(samples, { tune: tuneFor(220), fm: 1 }))).toBeCloseTo(440, -1)
  })

  it('reads its pitch per sample rather than once a block', () => {
    // The reason this rack owns its graph rather than using native nodes: any inlet is modulatable at
    // audio rate, and a sweep applied per sample is a different sound from the same sweep applied once a
    // block.
    const samples = 2048
    const sweep = new Float32Array(samples)
    for (let i = 0; i < samples; i++) sweep[i] = (2 * i) / samples
    const audio = run(samples, { tune: tuneFor(220), pitch: sweep })

    const crossings = (from: number, to: number) => {
      let count = 0
      for (let i = from + 1; i < to; i++) if (audio[i - 1] <= 0 && audio[i] > 0) count++
      return count
    }
    expect(crossings(samples / 2, samples)).toBeGreaterThan(crossings(0, samples / 2) * 2)
  })

  it('adds the Position inlet to the Position knob, per sample', () => {
    // The inlet is the feature — an envelope here changes which harmonics exist. Adding rather than
    // replacing is what lets the knob set where the sweep starts, the way a cutoff knob and a filter
    // envelope work together.
    const samples = 8820
    const square = 3 / 7

    // A square has no second harmonic and a saw does. Driving the inlet from square up to saw must
    // produce what the knob alone produces at saw.
    const byKnob = run(samples, { tune: tuneFor(220), position: SAW })
    const byCable = run(samples, { tune: tuneFor(220), position: square, pos: SAW - square })
    expect(magnitudeAt(byCable, 440)).toBeCloseTo(magnitudeAt(byKnob, 440), 4)

    // And out of range is clamped rather than wrapped or indexed off the end of the bank.
    for (const cable of [-5, 5]) {
      const audio = run(1024, { tune: tuneFor(220), position: 0.5, pos: cable })
      expect(firstBad(audio, Number.isFinite), `position CV ${cable}`).toBe(-1)
      expect(peak(audio)).toBeLessThan(1.1)
    }
  })

  it('does nothing with the PM inlet until Index is turned up', () => {
    // Index scales the inlet rather than generating anything, which is worth pinning because a knob that
    // appears to do nothing is the sort of thing somebody later "fixes" into a phase offset of its own.
    // 8820 samples is 44 whole cycles at 220Hz and 88 at 440Hz, so every measurement below lands on a
    // whole number of cycles and an absent sideband reads as absent rather than as leakage.
    const samples = 8820
    const modulator = new Float32Array(samples)
    for (let i = 0; i < samples; i++) modulator[i] = Math.sin((2 * Math.PI * 440 * i) / SR)

    const plain = run(samples, { tune: tuneFor(220) })
    const silent = run(samples, { tune: tuneFor(220), pm: modulator, index: 0 })
    expect([...silent]).toEqual([...plain])

    // With Index up it is two-operator FM: sidebands appear around the carrier at the modulator spacing,
    // where a plain sawtooth has only its own harmonics.
    const modulated = run(samples, {
      tune: tuneFor(220),
      position: 0,
      pm: modulator,
      index: 1,
    })
    const clean = run(samples, { tune: tuneFor(220), position: 0 })
    // 220Hz carrier, 440Hz modulator: a sideband at 660 exists in one and not the other.
    expect(magnitudeAt(clean, 660)).toBeLessThan(1e-4)
    expect(magnitudeAt(modulated, 660)).toBeGreaterThan(0.05)
  })

  it('goes quiet rather than backwards when FM drives it through zero', () => {
    // Through-zero FM is a real feature and this is not it. What matters is that a negative frequency does
    // not run the phase backwards or produce a NaN that the rest of the patch inherits.
    const audio = run(2048, { tune: tuneFor(220), fm: -4 })
    expect(firstBad(audio, Number.isFinite)).toBe(-1)
    expect(peak(audio)).toBeLessThan(1.1)
  })

  it('holds together at the top of its range', () => {
    // Two octaves above the top of the keyboard, where dt approaches the clamp. The dullest level is a
    // single harmonic, so what should come out is a quiet sine rather than noise.
    const audio = run(4096, { tune: 24, pitch: 6 })
    expect(firstBad(audio, Number.isFinite)).toBe(-1)
    expect(peak(audio)).toBeLessThan(1.1)
  })

  it('declares a def whose param order the processor actually reads', () => {
    // `WavetableProcessor` reads params[0..2] and inlets[0..3] positionally. Reordering the def would
    // silently repurpose every saved knob, which is the failure this catches.
    expect(WAVETABLE_MODULE.params.map((param) => param.id)).toEqual(['tune', 'position', 'index'])
    expect(WAVETABLE_MODULE.inlets.map((port) => port.id)).toEqual(['pitch', 'fm', 'pm', 'pos'])
    expect(WAVETABLE_MODULE.outlets.map((port) => port.id)).toEqual(['out'])
    expect(WAVETABLE_MODULE.deps?.Wavetable).toBe(Wavetable)
    // Per voice, like every other oscillator: eight of these are eight different notes.
    expect(WAVETABLE_MODULE.poly).not.toBe(false)
  })

  it('still works when serialised into a scope of its own', () => {
    // `worklet.ts` ships this class to the audio thread as `WavetableProcessor.toString()`, into a scope
    // that shares nothing with this module. A reference to an import or a module constant throws a
    // ReferenceError here rather than going silent in the browser on the first patch.
    const Rebuilt = new Function(
      `"use strict"; return ${WavetableProcessor.toString()}`,
    )() as typeof WavetableProcessor

    for (const position of [0, SAW, 1]) {
      const original = run(2048, { tune: tuneFor(440), position })
      const copy = run(2048, { tune: tuneFor(440), position }, Rebuilt)
      expect([...copy]).toEqual([...original])
    }
  })
})
