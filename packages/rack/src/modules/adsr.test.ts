import { describe, expect, it } from 'vitest'
import { AdsrProcessor } from './adsr.js'

// Every time knob on this module means something specific, and `adsr.ts` says what: the stage covers
// 99% of the distance to its target in the time on the knob, except the attack which is linear and
// arrives exactly. Those are the claims, so those are the tests — an envelope whose "200ms decay"
// takes 340ms is not wrong in any way a listener could name, and is wrong.

const SR = 44100

interface Settings {
  attack?: number
  decay?: number
  sustain?: number
  release?: number
}

/** Hold the gate high for `heldFor` seconds, then low for `thenFor`, and return every sample. */
function envelope(
  { attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.1 }: Settings,
  heldFor: number,
  thenFor: number,
  trigAt?: number,
): Float64Array {
  const samples = Math.ceil((heldFor + thenFor) * SR)
  const held = Math.floor(heldFor * SR)
  const gate = new Float32Array(samples)
  const trig = new Float32Array(samples)
  for (let i = 0; i < held; i++) gate[i] = 1
  if (trigAt !== undefined) {
    const at = Math.floor(trigAt * SR)
    for (let i = at; i < at + 64; i++) trig[i] = 1
  }
  const out = new Float32Array(samples)
  const params = [attack, decay, sustain, release].map((v) => new Float32Array(samples).fill(v))
  new AdsrProcessor(SR).process([gate, trig], [out], params, samples)
  return Float64Array.from(out)
}

const at = (data: Float64Array, seconds: number) => data[Math.floor(seconds * SR)]

describe('the envelope', () => {
  it('reaches exactly full scale exactly when the attack says', () => {
    // The reason the attack is linear rather than exponential: an exponential that only covers 99%
    // never reaches the peak, so a percussive patch loses its transient and a short attack sounds
    // soft. Linear arrives on time, at 1.0.
    for (const attack of [0.001, 0.01, 0.1]) {
      const data = envelope({ attack }, attack + 0.02, 0.01)
      expect(at(data, attack)).toBeCloseTo(1, 2)
      // And not before: half way through it should be half way up.
      expect(at(data, attack / 2)).toBeCloseTo(0.5, 1)
    }
  })

  it('gets 99% of the way to sustain in the decay time', () => {
    const sustain = 0.4
    for (const decay of [0.05, 0.2]) {
      const data = envelope({ attack: 0.001, decay, sustain }, decay + 0.05, 0.01)
      const value = at(data, 0.001 + decay)
      // 1% of the distance from 1.0 down to 0.4 is 0.006.
      expect(value).toBeGreaterThan(sustain)
      expect(value - sustain).toBeLessThan(0.012)
    }
  })

  it('holds at sustain for as long as the gate is held', () => {
    const data = envelope({ attack: 0.001, decay: 0.02, sustain: 0.35 }, 0.5, 0.01)
    expect(at(data, 0.2)).toBeCloseTo(0.35, 3)
    expect(at(data, 0.45)).toBeCloseTo(0.35, 3)
  })

  it('follows the sustain knob while it is holding', () => {
    // The decay stage settles onto sustain and hands over rather than approaching it forever, so a
    // sustain knob moved during a held note takes effect. Without the hand-over the knob would stop
    // working the moment a note settled, which is the sort of bug that gets blamed on the UI.
    const samples = Math.ceil(0.4 * SR)
    const gate = new Float32Array(samples).fill(1)
    const out = new Float32Array(samples)
    const sustain = new Float32Array(samples)
    for (let i = 0; i < samples; i++) sustain[i] = i < samples / 2 ? 0.3 : 0.8
    new AdsrProcessor(SR).process(
      [gate, new Float32Array(samples)],
      [out],
      [
        new Float32Array(samples).fill(0.001),
        new Float32Array(samples).fill(0.02),
        sustain,
        new Float32Array(samples).fill(0.1),
      ],
      samples,
    )
    expect(out[Math.floor(samples * 0.4)]).toBeCloseTo(0.3, 3)
    expect(out[samples - 1]).toBeCloseTo(0.8, 3)
  })

  it('gets within 1% of silence in the release time', () => {
    const sustain = 0.6
    for (const release of [0.05, 0.3]) {
      const data = envelope({ attack: 0.001, decay: 0.01, sustain, release }, 0.2, release + 0.05)
      expect(at(data, 0.2 + release)).toBeLessThan(sustain * 0.02)
      // And still audible a third of the way through, so "release" is not a synonym for "stop".
      expect(at(data, 0.2 + release / 3)).toBeGreaterThan(sustain * 0.1)
    }
  })

  it('retriggers from wherever it had got to', () => {
    // Not from zero. Restarting a fast repeated note from zero puts a discontinuity at the start of
    // every repeat, which is the click.
    const data = envelope({ attack: 0.05, decay: 0.05, sustain: 0.5, release: 0.4 }, 0.15, 0.4, 0.25)
    const beforeRetrigger = at(data, 0.2495)
    expect(beforeRetrigger).toBeGreaterThan(0.1)
    // The sample after the trigger arrives is a step up from where it was, not a step down to zero.
    expect(at(data, 0.2501)).toBeGreaterThanOrEqual(beforeRetrigger)
  })

  it('restarts on a trigger while the gate is still held', () => {
    // Which is the difference between a tie and two notes at the same pitch — a sequencer needs to
    // re-strike without the gate having to fall.
    const gated = envelope({ attack: 0.001, decay: 0.05, sustain: 0.2 }, 0.4, 0.05)
    const struck = envelope({ attack: 0.001, decay: 0.05, sustain: 0.2 }, 0.4, 0.05, 0.2)
    expect(at(gated, 0.21)).toBeCloseTo(0.2, 2)
    // The second strike climbs back to full scale.
    expect(Math.max(...struck.slice(Math.floor(0.2 * SR), Math.floor(0.21 * SR)))).toBeGreaterThan(0.9)
  })

  it('ignores a gate that never crosses the threshold', () => {
    // 0.5, so an audio-rate signal patched to a gate inlet does not retrigger on its own noise floor.
    const samples = 4096
    const gate = new Float32Array(samples).fill(0.4)
    const out = new Float32Array(samples)
    new AdsrProcessor(SR).process(
      [gate, new Float32Array(samples)],
      [out],
      [0.001, 0.01, 0.5, 0.01].map((v) => new Float32Array(samples).fill(v)),
      samples,
    )
    for (const x of out) expect(x).toBe(0)
  })

  it('never overshoots or goes negative', () => {
    const data = envelope({ attack: 0.0005, decay: 0.0005, sustain: 1, release: 0.0005 }, 0.05, 0.05)
    for (const x of data) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
    }
  })
})
