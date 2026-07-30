import { describe, expect, it } from 'vitest'
import { Random } from '../dsp/random.js'
import { NoiseProcessor } from './noise.js'

const SR = 44100

function run(samples: number, id = 'noise1') {
  const noise = new NoiseProcessor(SR, { Random }, id)
  const white = new Float32Array(samples)
  const pink = new Float32Array(samples)
  noise.process([], [white, pink], [], samples)
  return { white: Float64Array.from(white), pink: Float64Array.from(pink) }
}

const rms = (d: Float64Array) => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)
const mean = (d: Float64Array) => d.reduce((s, x) => s + x, 0) / d.length

/**
 * Amplitude at one frequency, averaged over a spread of nearby ones.
 *
 * Correlation against a sine and a cosine, the same trick `ladder.test.ts` uses — but noise is
 * stochastic, so a single frequency is a noisy estimate of the spectrum and the average over two
 * dozen of them is not. A cascade of one-pole filters was the first attempt and it smeared the two
 * octaves together badly enough to measure a slope of 1.09 where the answer is 2.
 */
function amplitudeAt(data: Float64Array, centre: number): number {
  let total = 0
  const taps = 24
  for (let k = 0; k < taps; k++) {
    const frequency = centre * (1 + (k - taps / 2) * 0.004)
    let re = 0
    let im = 0
    for (let i = 0; i < data.length; i++) {
      const phase = (2 * Math.PI * frequency * i) / SR
      re += data[i] * Math.cos(phase)
      im += data[i] * Math.sin(phase)
    }
    total += (2 * Math.hypot(re, im)) / data.length
  }
  return total / taps
}

describe('noise', () => {
  it('makes white noise with no DC and a sane level', () => {
    // A noise source with DC on it pushes every filter downstream off centre, and a noise source
    // twice as loud as the oscillators is one nobody can mix.
    const { white } = run(SR)
    expect(Math.abs(mean(white))).toBeLessThan(0.01)
    expect(rms(white)).toBeGreaterThan(0.4)
    expect(rms(white)).toBeLessThan(0.75)
  })

  it('makes pink noise at the same level as the white', () => {
    // Two outlets on one module at different levels is a trap for anybody patching between them.
    // Kellet's suggested 0.11 left pink 9dB down; 0.325 is measured to match. If this drifts, every
    // patch that switches outlets needs a level change to go with it.
    const { white, pink } = run(SR)
    expect(rms(pink) / rms(white)).toBeCloseTo(1, 1)
  })

  it('wanders below the audio band, because that is what pink means', () => {
    // Not a bug and not something to fix. Pink noise has amplitude proportional to 1/sqrt(f), so its
    // energy keeps rising as the frequency falls and a mean taken over any finite window is a
    // measurement of its sub-audio content rather than of an offset. Demanding a zero mean here
    // would be demanding that pink not be pink — white is the one that has to sit still.
    //
    // What IS worth pinning is that the wander stays bounded. A pole at 0.99886 is close enough to
    // one that an arithmetic slip would turn the drift into a ramp, and a ramp would eat the
    // headroom of everything downstream before anybody heard it.
    const { pink } = run(SR)
    expect(Math.abs(mean(pink))).toBeLessThan(0.15)
    for (let i = 0; i < pink.length; i++) expect(Math.abs(pink[i])).toBeLessThan(4)
  })

  it('rolls pink off at 3dB per octave and leaves white flat', () => {
    // The actual definition of pink: amplitude proportional to 1/sqrt(f), so two octaves apart is a
    // factor of two. Measured 2.06 against an ideal of 2.00 when this was written, with white at
    // 1.03 against an ideal of 1.00 across the same span.
    const { white, pink } = run(SR * 2)
    expect(amplitudeAt(pink, 400) / amplitudeAt(pink, 1600)).toBeCloseTo(2, 0)
    expect(amplitudeAt(white, 400) / amplitudeAt(white, 1600)).toBeCloseTo(1, 0)
  })

  it('gives the same noise for the same module id', () => {
    // The property that makes a shared patch a shared sound. Rebuilding a graph — which happens on
    // every patch edit — must not change the noise.
    expect([...run(512, 'osc').white]).toEqual([...run(512, 'osc').white])
  })

  it('gives different noise to two different modules', () => {
    // Two identical noise sources summed are one source 6dB louder, not two sources 3dB louder.
    // Audible, and it reads as a gain bug rather than as a seeding bug.
    const a = run(SR, 'noise1').white
    const b = run(SR, 'noise2').white
    expect([...a.slice(0, 32)]).not.toEqual([...b.slice(0, 32)])

    // And genuinely uncorrelated, not merely offset from each other: summing them should give
    // about sqrt(2) times the level rather than 2 times it.
    const summed = Float64Array.from(a, (x, i) => x + b[i])
    const growth = rms(summed) / rms(a)
    expect(growth).toBeGreaterThan(1.3)
    expect(growth).toBeLessThan(1.55)
  })
})

describe('the PRNG', () => {
  it('spreads ids that differ in one character', () => {
    // FNV-1a rather than a sum of char codes, which would put `osc1` and `osc2` next to each other
    // and start them out correlated.
    const first = (id: string) => {
      const r = new Random(id)
      return [r.next(), r.next(), r.next()]
    }
    const a = first('osc1')
    const b = first('osc2')
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeGreaterThan(0.01)
  })

  it('never gets stuck, whatever it is seeded with', () => {
    // xorshift is stuck at zero forever, so a seed that hashes to zero has to be replaced.
    for (const seed of [0, 1, -1, 0x811c9dc5, '', 'a']) {
      const r = new Random(seed as string | number)
      const values = Array.from({ length: 64 }, () => r.next())
      expect(new Set(values).size).toBeGreaterThan(32)
      for (const v of values) {
        expect(Number.isFinite(v)).toBe(true)
        expect(Math.abs(v)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('still works when serialised into a scope of its own', () => {
    const Rebuilt = new Function(`"use strict"; return ${Random.toString()}`)() as typeof Random
    const original = new Random('x')
    const copy = new Rebuilt('x')
    for (let i = 0; i < 200; i++) expect(copy.next()).toBe(original.next())
  })
})
