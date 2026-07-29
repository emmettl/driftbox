import { describe, expect, it } from 'vitest'
import {
  BASS_VOICES,
  DEFAULT_BASS_PARAMS,
  REST,
  bassNote,
  previousStep,
  type BassParams,
  type BassStep,
} from './bass'

// Slide and accent are what separate an acid line from a monosynth playing sixteenths,
// and both are relationships between steps rather than properties of one. That makes
// them exactly the kind of thing that is invisible to a listening test done badly and
// obvious to an assertion.

const knobs = (over: Partial<BassParams> = {}): BassParams => ({ ...DEFAULT_BASS_PARAMS, ...over })
const note = (n: number, over: Partial<BassStep> = {}): BassStep => ({
  note: n,
  accent: false,
  slide: false,
  ...over,
})

const STEP = 0.14 // seconds per step, roughly 107bpm

describe('a 303 note', () => {
  it('is nothing at all on a rest', () => {
    expect(bassNote(knobs(), REST, REST, STEP)).toBeNull()
  })

  it('puts note 12 an octave above note 0', () => {
    const low = bassNote(knobs(), note(0), REST, STEP)!
    const high = bassNote(knobs(), note(12), REST, STEP)!
    expect(high.frequency / low.frequency).toBeCloseTo(2, 6)
  })

  it('sits in bass register across the whole tune range', () => {
    for (const tune of [0, 0.5, 1]) {
      const built = bassNote(knobs({ tune }), note(0), REST, STEP)!
      expect(built.frequency).toBeGreaterThan(25)
      expect(built.frequency).toBeLessThan(120)
    }
  })

  it('starts its filter above where the cutoff knob left it', () => {
    // The sweep is the instrument. A note whose filter envelope did not open above the
    // resting cutoff would just be a static lowpass, and no amount of resonance would
    // make that sound like a 303.
    const built = bassNote(knobs(), note(0), REST, STEP)!
    expect(built.filter.peak).toBeGreaterThan(built.filter.base * 2)
  })

  it('opens further as env mod is turned up, and not at all when it is off', () => {
    const off = bassNote(knobs({ envMod: 0 }), note(0), REST, STEP)!
    const full = bassNote(knobs({ envMod: 1 }), note(0), REST, STEP)!

    expect(off.filter.peak).toBeCloseTo(off.filter.base, 6)
    expect(full.filter.peak).toBeGreaterThan(off.filter.peak * 4)
  })

  it('never sweeps up into aliasing territory', () => {
    for (const cutoff of [0, 0.5, 1]) {
      const built = bassNote(knobs({ cutoff, envMod: 1 }), note(0, { accent: true }), REST, STEP)!
      expect(built.filter.peak).toBeLessThan(12000)
    }
  })

  it('leaves a gap after itself unless it is sliding', () => {
    // An articulate line needs the note to stop before the next one starts. A sliding
    // one must not, or there is nothing left sounding for the next note to glide out of.
    expect(bassNote(knobs(), note(0), REST, STEP)!.gate).toBeLessThan(STEP)
    expect(bassNote(knobs(), note(0, { slide: true }), REST, STEP)!.gate).toBeGreaterThan(STEP)
  })
})

describe('accent', () => {
  const plain = bassNote(knobs(), note(0), REST, STEP)!
  const accented = bassNote(knobs(), note(0, { accent: true }), REST, STEP)!

  it('drives level, brightness and resonance together', () => {
    // One flag, three destinations — as on the hardware, where the accent voltage feeds
    // the VCA, the filter envelope and the resonance circuit at once. Wiring it only to
    // the level is the single most common way to make a 303 emulation sound flat.
    expect(accented.gain).toBeGreaterThan(plain.gain)
    expect(accented.filter.peak).toBeGreaterThan(plain.filter.peak)
    expect(accented.resonance).toBeGreaterThan(plain.resonance)
  })

  it('does nothing when the accent knob is down', () => {
    const off = knobs({ accent: 0 })
    const a = bassNote(off, note(0, { accent: true }), REST, STEP)!
    const b = bassNote(off, note(0), REST, STEP)!
    // The knob still has a floor, so an accent is never literally nothing — but it
    // should be close, or the control does not reach the bottom of its range.
    expect(a.gain / b.gain).toBeLessThan(1.1)
  })

  it('cannot push resonance past self-oscillation', () => {
    const built = bassNote(knobs({ resonance: 1 }), note(0, { accent: true }), REST, STEP)!
    expect(built.resonance).toBeLessThanOrEqual(1)
  })
})

describe('slide', () => {
  it('glides into the note after a sliding step, without retriggering', () => {
    // The shared envelope is the whole point. Two notes, one attack.
    const built = bassNote(knobs(), note(7), note(0, { slide: true }), STEP)!
    expect(built.glide).toBeGreaterThan(0)
    expect(built.retrigger).toBe(false)
  })

  it('does not glide out of a rest that happens to be marked sliding', () => {
    const built = bassNote(knobs(), note(7), { note: null, accent: false, slide: true }, STEP)!
    expect(built.glide).toBe(0)
    expect(built.retrigger).toBe(true)
  })

  it('retriggers after an ordinary note', () => {
    const built = bassNote(knobs(), note(7), note(0), STEP)!
    expect(built.glide).toBe(0)
    expect(built.retrigger).toBe(true)
  })
})

describe('reading the step before', () => {
  const line: BassStep[] = [note(0), note(3), note(5, { slide: true }), note(7)]

  it('is the previous step in the middle of a bar', () => {
    expect(previousStep(line, 3, 4).note).toBe(5)
  })

  it('wraps to the last step of the bar at step 0', () => {
    // So a one-bar line loops into itself — the last step sliding into the first is how
    // an acid pattern keeps moving instead of restarting.
    expect(previousStep(line, 0, 4).note).toBe(7)
  })

  it('is a rest when the line is empty', () => {
    expect(previousStep([], 0, 0)).toEqual(REST)
    expect(previousStep([], 3, 4)).toEqual(REST)
  })
})

describe('the 303s', () => {
  it('there are two, as on ReBirth', () => {
    expect(BASS_VOICES).toHaveLength(2)
    expect(new Set(BASS_VOICES.map((v) => v.id)).size).toBe(2)
  })

  it('switch waveform across the middle of the knob', () => {
    expect(bassNote(knobs({ wave: 0 }), note(0), REST, STEP)!.wave).toBe('sawtooth')
    expect(bassNote(knobs({ wave: 1 }), note(0), REST, STEP)!.wave).toBe('square')
  })

  it('hold their notes proportionally at any tempo', () => {
    const slow = bassNote(knobs(), note(0), REST, 0.3)!
    const fast = bassNote(knobs(), note(0), REST, 0.1)!
    expect(slow.gate / fast.gate).toBeCloseTo(3, 6)
  })
})
