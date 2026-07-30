import { describe, expect, it } from 'vitest'
import { Bassline } from './bassline.js'
import type { BassNote } from './bass.js'

// The 303's filter, on the audio thread it actually runs on.
//
// `dsp/ladder.test.ts` already checks the arithmetic, and `dsp/worklet.ts` explains why that is
// only half the story: the filter is shipped to the audio thread by stringifying the class into a
// blob URL, so the code that runs is assembled at runtime out of `Ladder.toString()`. Nothing in
// Node can load that. The failure mode it leaves open is a ReferenceError inside
// `AudioWorkletGlobalScope` at the moment the first note plays — which does not throw anywhere a
// test would see it, it just makes `Bassline.create` fall back to the biquad, and the symptom is
// that the basslines sound tame.
//
// So this asserts the three things in order: that the worklet loaded, that a note through it makes
// a sound, and that the filter is filtering. The last is the one that could not be faked by a
// processor that registered successfully and returned silence.

const SR = 44100

/** A steady note, with the filter parked rather than swept — `peak` equal to `base`, so the only
 *  thing separating the two renders below is where the cutoff sits. */
function note(cutoff: number): BassNote {
  return {
    frequency: 55,
    glide: 0,
    retrigger: true,
    gate: 0.4,
    wave: 'sawtooth',
    gain: 0.8,
    resonance: 0.3,
    filter: { peak: cutoff, base: cutoff, decay: 0.1 },
  }
}

async function play(n: BassNote): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(0.6 * SR), SR)
  const { bassline } = await Bassline.create(ctx)
  bassline.output.connect(ctx.destination)
  bassline.play(n, 0)
  return (await ctx.startRendering()).getChannelData(0)
}

function rms(data: Float32Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

/**
 * How much of the signal is up high, as a fraction of how much there is in total.
 *
 * The first difference of a waveform is a crude high-pass — it cancels whatever the sample before
 * it already had, so a slow-moving fundamental contributes almost nothing and the harmonics
 * contribute in proportion to their frequency. Dividing by the overall level is what makes the
 * comparison about tone rather than volume: closing a filter makes a note quieter as well as
 * darker, and without the division the quieter one would look darker even if it were not.
 */
function brightness(data: Float32Array): number {
  const diff = new Float32Array(data.length)
  for (let i = 1; i < data.length; i++) diff[i] = data[i] - data[i - 1]
  const level = rms(data)
  return level === 0 ? 0 : rms(diff) / level
}

describe('the ladder filter, on the audio thread', () => {
  it('is the real one and not the biquad standing in for it', async () => {
    // The precondition for everything else. `docs/VERIFYING-AUDIO.md` opens its 303 section with
    // this check for the same reason: a measurement of the fallback is a measurement of the wrong
    // filter, and it would look perfectly reasonable.
    const ctx = new OfflineAudioContext(1, SR, SR)
    const { usingLadder } = await Bassline.create(ctx)
    expect(usingLadder).toBe(true)
  })

  it('passes a note through rather than swallowing it', async () => {
    // A processor that registers and then returns silence satisfies every check that stops at
    // "the worklet loaded". This is the one that does not.
    const data = await play(note(2000))
    expect(rms(data)).toBeGreaterThan(0.01)
  })

  it('takes the top off a note when it is closed', async () => {
    // The assertion that says the DSP ran, and not merely that something did. A pass-through
    // processor — which is what a ladder whose state never updates degenerates to — would give
    // these two renders the same brightness.
    const dark = brightness(await play(note(200)))
    const bright = brightness(await play(note(6000)))
    expect(bright).toBeGreaterThan(dark * 2)
  })
})
