import type { ModuleDef, Processor } from '../types.js'

// Reverb, as a feedback delay network.
//
// The engine reverbs with a `ConvolverNode` and an impulse response. That is not available here and could
// not be: an `AudioWorkletGlobalScope` has no Web Audio nodes in it, and a convolution long enough to be a
// room is tens of thousands of taps per sample. An FDN is the standard answer — a handful of delay lines
// fed back through a mixing matrix — and it is cheap enough to be an ordinary module rather than a special
// case.
//
// **Eight lines through a Householder matrix.** The matrix is what turns separate echoes into a room: every
// line feeds every other, so the echo density multiplies with each pass around the loop instead of staying
// at one repeat per line. Householder is used because at any size it is `subtract a share of the sum` — N
// multiply-adds rather than N² — and it is unitary, which guarantees the feedback path cannot gain energy
// whatever the delay lengths are. A matrix picked by hand would need proving stable.
//
// Eight and not four, and that was measured rather than assumed. With four lines a fifth of a second into
// the tail only 12% of samples were meaningfully non-zero: audibly a handful of discrete echoes rather than
// a room, which is the sparse rattle a small FDN makes. Doubling the lines costs eight delay reads a sample
// and nothing else.
//
// **The delay lengths are coprime.** Lengths sharing a factor put their echoes on top of each other and the
// tail rings at that period, which is the metallic sound of a bad reverb. Primes cannot.
//
// A damping filter sits in each feedback path, because a real room absorbs treble faster than bass, and a
// tail that keeps all its top end sounds like a spring rather than a space.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class ReverbProcessor implements Processor {
  private readonly lines: Float32Array[]
  private readonly lengths: number[]
  private readonly write: number[]
  /** One-pole lowpass state per line, for the damping in the feedback path. */
  private readonly damped: number[]
  /** Scratch for one sample's worth of line outputs. A field, not a local: allocating it per sample would
   *  be 44,100 arrays a second on the audio thread. */
  private readonly taps: number[]

  private lastDamp = Number.NaN
  private dampCoefficient = 0

  constructor(sampleRate: number) {
    // Prime numbers of samples, so no two lines share a factor. Lengths with a common factor stack their
    // echoes and the tail rings at that period, which is the metallic sound of a bad reverb — and rounding
    // milliseconds to samples is exactly how two lines end up sharing one by accident.
    const primes = [1327, 1543, 1873, 2053, 2399, 2687, 2927, 3271]
    // Scaled from the 44.1kHz these were chosen at, then nudged back to odd so the scaling cannot reintroduce
    // a common factor of two. Between 30ms and 74ms, which is a small room.
    this.lengths = primes.map((samples) => {
      const scaled = Math.max(1, Math.round((samples * sampleRate) / 44100))
      return scaled % 2 === 0 ? scaled + 1 : scaled
    })
    this.lines = this.lengths.map((length) => new Float32Array(length))
    this.write = this.lengths.map(() => 0)
    this.damped = this.lengths.map(() => 0)
    this.taps = this.lengths.map(() => 0)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const outLeft = outlets[0]
    const outRight = outlets[1]

    const sizeParam = params[0]
    const decayParam = params[1]
    const dampParam = params[2]
    const mixParam = params[3]

    const lines = this.lines
    const lengths = this.lengths
    const write = this.write
    const damped = this.damped
    const taps = this.taps

    for (let i = 0; i < frames; i++) {
      const damp = dampParam[i]
      if (damp !== this.lastDamp) {
        this.lastDamp = damp
        // 0 is no damping and 1 is as dark as this goes. Not a cutoff in Hz: the useful range of a reverb's
        // damping control is one end to the other, and a frequency knob would spend most of its travel in
        // the part nobody uses.
        this.dampCoefficient = damp < 0 ? 0 : damp > 0.99 ? 0.99 : damp
      }

      // Size shortens every line by the same fraction, so their ratios — and therefore their coprimeness in
      // spirit — survive the knob. Read per sample so the room can be swept, which is a good noise.
      let size = sizeParam[i]
      if (size < 0.1) size = 0.1
      else if (size > 1) size = 1

      // Read each line at its own, possibly shortened, length.
      const count = lines.length
      let sum = 0
      for (let line = 0; line < count; line++) {
        const buffer = lines[line]
        let at = write[line] - Math.max(1, Math.round(lengths[line] * size))
        if (at < 0) at += buffer.length
        const tap = buffer[at]
        taps[line] = tap
        sum += tap
      }

      let decay = decayParam[i]
      if (decay < 0) decay = 0
      // 0.98 and not 1: a unitary matrix with unity feedback sustains for ever, and a reverb that never
      // stops is an oscillator with extra steps.
      else if (decay > 0.98) decay = 0.98

      // The Householder reflection: subtract 2/N of the sum from each. Unitary, so the loop can never gain
      // energy, and it is N operations rather than an N-squared matrix multiply.
      const share = (2 * sum) / count
      const sample = input[i]
      let wet = 0
      // The right channel's tail is the same taps under an alternating sign. **Two output mixing vectors
      // over one network** is how an FDN is made stereo, and this pair is chosen so that the left channel
      // is arithmetically what it was before this module had two: a patch that folds this back to mono, or
      // one written before stereo existed, is unchanged sample for sample.
      //
      // Alternating signs rather than splitting the lines four and four. Both decorrelate, but a split
      // gives each side half the lines and therefore half the echo density — audibly sparser on both sides
      // than the mono version was. Signed, every line is in both channels at full density and the two are
      // still uncorrelated, because the tap sequence has no reason to favour one parity.
      let wetRight = 0
      for (let line = 0; line < count; line++) {
        const mixed = taps[line] - share
        // Damping in the feedback path, not on the output: it has to compound with each pass around the
        // loop, which is what makes the tail get darker as it decays rather than merely being dark.
        damped[line] = mixed + (damped[line] - mixed) * this.dampCoefficient
        const buffer = lines[line]
        buffer[write[line]] = sample + damped[line] * decay
        write[line]++
        if (write[line] >= buffer.length) write[line] = 0
        wet += taps[line]
        wetRight += line % 2 === 0 ? taps[line] : -taps[line]
      }

      // Divided by the line count, because N lines summed at full level is N times the input before the tail
      // has even started. This is the level that makes the mix knob mean what it says.
      wet /= count
      wetRight /= count
      let mix = mixParam[i]
      if (mix < 0) mix = 0
      else if (mix > 1) mix = 1
      // The dry half is the same mono input on both sides, so a dry reverb is centred rather than wide —
      // and at mix 0 the two channels are identical, which is what "no effect" has to mean.
      const dry = sample * (1 - mix)
      outLeft[i] = dry + wet * mix
      outRight[i] = dry + wetRight * mix
    }
  }
}

export const REVERB_MODULE: ModuleDef = {
  type: 'reverb',
  version: 1,
  name: 'Reverb',
  group: 'Space',
  blurb:
    'A room, built from feedback delay lines. Size, decay and damping rather than a list of presets.',
  logo: {
    paths: [
      'M8 31V9h48v22',
      'M15 25c6-10 12-10 18 0',
      'M11 29c10-17 21-17 31 0',
      'M7 34c15-24 31-24 48 0',
    ],
  },
  inlets: [{ id: 'in', name: 'In' }],
  // Stereo out of a mono in, which is what a room does: one source, two ears, two different arrival
  // patterns. The id is unchanged, so no existing cable moves — and a cable from here into anything mono
  // still carries exactly the signal it carried before.
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    { id: 'size', name: 'Size', min: 0.1, max: 1, default: 0.7 },
    { id: 'decay', name: 'Decay', min: 0, max: 0.98, default: 0.82 },
    { id: 'damp', name: 'Damp', min: 0, max: 0.99, default: 0.4 },
    // Dry by default. A reverb dropped into a patch should not change the sound until it is asked to, and
    // this one is usually wanted on a send rather than across the whole mix.
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.25 },
  ],
  processor: ReverbProcessor,
  // One room. Eight voices each with their own reverb is eight rooms, which is not what a reverb is and
  // costs eight times the memory — the same reasoning as the Delay.
  poly: false,
}
