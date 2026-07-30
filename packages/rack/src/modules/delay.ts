import type { ModuleDef, Processor } from '../types.js'

// A delay line, with a modulatable time.
//
// **It outputs wet only.** No mix knob, and that is the same decision the Mixer's comment argues
// for: a mix knob inside a delay is a hidden two-channel mixer, and once every module has one you
// can no longer tell what a patch does by looking at the cables. Patch the dry and the wet into a
// Mixer and the crossfade is visible, adjustable, and CV-able, which a knob in here would not be.
//
// The read position is fractional and linearly interpolated. That is what makes the time inlet
// worth having — stepping the read pointer by whole samples turns a slow sweep into a stairway of
// clicks, and chorus and flanging are exactly a delay whose time is being swept by a few
// milliseconds. Linear interpolation is a gentle lowpass that gets gentler as the fraction
// approaches zero, so a modulated delay is very slightly duller than a static one. That is audible
// on a cymbal if you are listening for it and is the standard trade; the alternative is a
// higher-order interpolator and four times the arithmetic.
//
// The time inlet is in **octaves**, like every other frequency-shaped inlet here, so +1 halves the
// delay. On a delay that is more useful than it sounds: halving the time takes the echo up an
// octave in pitch when you sweep it, and the same CV depth does the same musical thing wherever
// the knob is set.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class DelayProcessor implements Processor {
  private readonly sampleRate: number
  private readonly buffer: Float32Array
  private write = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    // Two seconds, plus a couple of samples of slack so the interpolator's second tap can never
    // land on the sample about to be overwritten.
    this.buffer = new Float32Array(Math.ceil(sampleRate * 2) + 4)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const timeCv = inlets[1]
    const feedbackCv = inlets[2]
    const out = outlets[0]
    const time = params[0]
    const feedback = params[1]

    const buffer = this.buffer
    const length = buffer.length
    const longest = length - 3

    for (let i = 0; i < frames; i++) {
      let seconds = time[i]
      const octaves = timeCv[i]
      if (octaves !== 0) seconds /= Math.pow(2, octaves)

      let samples = seconds * this.sampleRate
      // At least one sample: a delay of zero is a read of the sample being written this instant,
      // which with any feedback at all is a divide-by-nothing loop.
      if (samples < 1) samples = 1
      else if (samples > longest) samples = longest

      let read = this.write - samples
      if (read < 0) read += length
      const index = Math.floor(read)
      const fraction = read - index
      const a = buffer[index]
      const b = buffer[index + 1 < length ? index + 1 : 0]
      const delayed = a + (b - a) * fraction

      out[i] = delayed

      let fb = feedback[i] + feedbackCv[i]
      if (fb < 0) fb = 0
      // Short of 1, always. At exactly 1 the line never decays, and every rounding error that
      // enters it stays there and accumulates until the loop is louder than the input.
      else if (fb > 0.98) fb = 0.98

      let written = input[i] + delayed * fb
      // A NaN in a delay line is permanent: it is fed back into itself, so one bad sample silences
      // the module for the lifetime of the patch. NaN fails every comparison, so this one test
      // catches it and an infinity together.
      if (!(written > -8 && written < 8)) written = written > 0 ? 8 : written < 0 ? -8 : 0
      buffer[this.write] = written

      this.write++
      if (this.write >= length) this.write = 0
    }
  }
}

export const DELAY_MODULE: ModuleDef = {
  type: 'delay',
  version: 1,
  name: 'Delay',
  group: 'Space',
  blurb:
    'An echo with a time you can modulate. Wet only, so patch the dry through a Mixer and the balance stays visible.',
  inlets: [
    { id: 'in', name: 'In' },
    { id: 'time', name: 'Time' },
    { id: 'fb', name: 'FB' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    // A third of a millisecond at the bottom, which is short enough to be a comb filter rather
    // than an echo — patch an oscillator through it and the delay becomes a resonator.
    { id: 'time', name: 'Time', min: 0.0003, max: 2, default: 0.25 },
    { id: 'feedback', name: 'FB', min: 0, max: 0.98, default: 0.3 },
  ],
  processor: DelayProcessor,
  // A shared delay is the point. Eight voices into eight separate delay lines is eight delays, which is not
  // what anybody patches a delay for — and it is also eight two-second buffers.
  poly: false,
}
