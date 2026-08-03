import type { ModuleDef, Processor } from '../types.js'

// A six-stage stereo phaser: an LFO sweeps a cascade of first-order allpass filters, then mixes it
// back with the dry signal.
//
// **Allpass is the missing primitive.** Chorus and flanging are a modulated Delay, which the rack
// could already patch. An allpass leaves magnitude alone and moves phase by frequency; several in
// series, mixed with dry, turn those phase rotations into the moving notches that make a phaser.
// There is no equivalent arrangement of the existing filters because each changes magnitude before
// the signals meet again.
//
// **Six stages.** One stage makes one broad cancellation and sounds like a tilting comb. Six gives
// three useful notches without turning every sample into the twelve-section cost of the largest old
// rack units. Each stage is a first-order allpass in its one-state lattice form:
//
//     y = a*x + z; z = x - a*y
//
// Its pole stays inside the unit circle while `a` is between -1 and 1, which the prewarped frequency
// coefficient guarantees. Feedback is around the whole cascade, short of unity.
//
// **Stereo by motion, not by pretending mono is two signals.** The two channels keep independent
// filter and feedback state, and the right sweep starts a quarter-cycle after the left. A mono cable
// is centred into both inputs by the rack, then opens into motion rather than remaining dual mono.
// The Sweep inlet moves both centres in octaves, on top of the internal LFO.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class PhaserProcessor implements Processor {
  private readonly sampleRate: number
  private readonly leftState = [0, 0, 0, 0, 0, 0]
  private readonly rightState = [0, 0, 0, 0, 0, 0]
  private phase = 0
  private feedbackLeft = 0
  private feedbackRight = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const inLeft = inlets[0]
    const inRight = inlets[1]
    const sweepCv = inlets[2]
    const outLeft = outlets[0]
    const outRight = outlets[1]
    const rateParam = params[0]
    const centerParam = params[1]
    const depthParam = params[2]
    const feedbackParam = params[3]
    const mixParam = params[4]

    const leftState = this.leftState
    const rightState = this.rightState
    const nyquist = this.sampleRate / 2
    let phase = this.phase
    let feedbackLeft = this.feedbackLeft
    let feedbackRight = this.feedbackRight

    for (let i = 0; i < frames; i++) {
      let rate = rateParam[i]
      if (!(rate > 0.02)) rate = 0.02
      else if (rate > 8) rate = 8

      let center = centerParam[i]
      if (!(center > 20)) center = 20
      else if (center > nyquist * 0.45) center = nyquist * 0.45

      let depth = depthParam[i]
      if (!(depth > 0)) depth = 0
      else if (depth > 1) depth = 1
      const span = depth * 3
      const radians = phase * 2 * Math.PI
      const shift = sweepCv[i]

      let frequencyLeft = center * Math.pow(2, Math.sin(radians) * span + shift)
      let frequencyRight = center * Math.pow(2, Math.sin(radians + Math.PI / 2) * span + shift)
      if (!(frequencyLeft > 20)) frequencyLeft = 20
      else if (frequencyLeft > nyquist * 0.9) frequencyLeft = nyquist * 0.9
      if (!(frequencyRight > 20)) frequencyRight = 20
      else if (frequencyRight > nyquist * 0.9) frequencyRight = nyquist * 0.9

      const tangentLeft = Math.tan((Math.PI * frequencyLeft) / this.sampleRate)
      const tangentRight = Math.tan((Math.PI * frequencyRight) / this.sampleRate)
      // Negative below Nyquist: with this lattice form, `(tan - 1) / (tan + 1)` puts one stage at
      // exactly -90 degrees at the requested frequency. Reversing the numerator's sign still makes a
      // stable allpass, but puts its corner near Nyquist — flat enough here to make the phaser inaudible.
      const coefficientLeft = (tangentLeft - 1) / (tangentLeft + 1)
      const coefficientRight = (tangentRight - 1) / (tangentRight + 1)

      let feedback = feedbackParam[i]
      if (!(feedback > -0.9)) feedback = -0.9
      else if (feedback > 0.9) feedback = 0.9

      let wetLeft = inLeft[i] + feedbackLeft * feedback
      let wetRight = inRight[i] + feedbackRight * feedback
      for (let stage = 0; stage < 6; stage++) {
        const nextLeft = coefficientLeft * wetLeft + leftState[stage]
        leftState[stage] = wetLeft - coefficientLeft * nextLeft
        wetLeft = nextLeft

        const nextRight = coefficientRight * wetRight + rightState[stage]
        rightState[stage] = wetRight - coefficientRight * nextRight
        wetRight = nextRight
      }

      feedbackLeft = wetLeft
      feedbackRight = wetRight

      let mix = mixParam[i]
      if (!(mix > 0)) mix = 0
      else if (mix > 1) mix = 1
      let outputLeft = inLeft[i] * (1 - mix) + wetLeft * mix
      let outputRight = inRight[i] * (1 - mix) + wetRight * mix

      if (!Number.isFinite(outputLeft) || !Number.isFinite(outputRight)) {
        for (let stage = 0; stage < 6; stage++) {
          leftState[stage] = 0
          rightState[stage] = 0
        }
        feedbackLeft = 0
        feedbackRight = 0
        outputLeft = 0
        outputRight = 0
      }

      outLeft[i] = outputLeft
      outRight[i] = outputRight
      phase += rate / this.sampleRate
      phase -= Math.floor(phase)
    }

    this.phase = phase
    this.feedbackLeft = feedbackLeft
    this.feedbackRight = feedbackRight
  }
}

export const PHASER_MODULE: ModuleDef = {
  type: 'phaser',
  version: 1,
  name: 'Phaser',
  group: 'Space',
  blurb:
    'Six swept allpass stages make moving notches. Stereo motion is built in; Sweep CV moves both sides in octaves.',
  logo: {
    paths: [
      'M5 12c7 0 7 20 14 20s7-20 14-20 7 20 14 20 7-20 12-20',
      'M8 38h48',
      'M18 35v6M32 35v6M46 35v6',
    ],
  },
  inlets: [
    { id: 'in', name: 'In', stereo: true },
    { id: 'sweep', name: 'Sweep' },
  ],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    { id: 'rate', name: 'Rate', min: 0.02, max: 8, default: 0.35 },
    { id: 'center', name: 'Center Hz', min: 80, max: 4000, default: 800 },
    { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.65 },
    { id: 'feedback', name: 'Feedback', min: -0.9, max: 0.9, default: 0.25 },
    // Unlike a delay's mix, this is not a hidden convenience mixer: the allpass has flat magnitude on
    // its own. Recombining wet and dry is the operation that creates the phaser's notches at all.
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.5 },
  ],
  processor: PhaserProcessor,
  poly: false,
}
