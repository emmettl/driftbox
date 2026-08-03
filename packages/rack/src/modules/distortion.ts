import type { ModuleDef, Processor } from '../types.js'

// Four distortion characters and a tone stage, sharing one amount control.
//
// **A selector rather than a larger Drive knob.** Drive is one normalised tanh curve: excellent at
// being predictable, and incapable of becoming a different circuit. These modes change the transfer
// function itself — tube is a soft sigmoid, tape is arctangent compression, fuzz reaches its rails
// exponentially, and digital clips then quantises. Amount changes each model in its own useful range.
//
// **Stereo state, shared controls.** A distortion near the end of a chain must not fold away the width
// created upstream. Both channels use the same selected curve and tone coefficient but keep independent
// lowpass and DC-blocker state, so nothing crosses from left to right.
//
// Bias happens before every curve because asymmetry is a property of the nonlinear stage, not an EQ.
// It also produces signal-dependent DC, so the output has the same 5Hz blocker as Drive. Tone is a
// one-pole lowpass after the curve: harmonics are what distortion creates, and removing some after the
// fact is a different sound from feeding less into the curve.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class DistortionProcessor implements Processor {
  private readonly sampleRate: number
  private readonly blockerPole: number
  private readonly toneState = [0, 0]
  private readonly blockerIn = [0, 0]
  private readonly blockerOut = [0, 0]
  private lastTone = Number.NaN
  private toneCoefficient = 1

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.blockerPole = Math.exp((-2 * Math.PI * 5) / this.sampleRate)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const inLeft = inlets[0]
    const inRight = inlets[1]
    const amountCv = inlets[2]
    const outLeft = outlets[0]
    const outRight = outlets[1]
    const modeParam = params[0]
    const amountParam = params[1]
    const toneParam = params[2]
    const biasParam = params[3]
    const levelParam = params[4]

    const toneState = this.toneState
    const blockerIn = this.blockerIn
    const blockerOut = this.blockerOut

    for (let i = 0; i < frames; i++) {
      let mode = Math.round(modeParam[i])
      if (!(mode > 0)) mode = 0
      else if (mode > 3) mode = 3

      let amount = amountParam[i] + amountCv[i]
      if (!(amount > 0)) amount = 0
      else if (amount > 1) amount = 1
      const gain = 1 + amount * 31

      let tone = toneParam[i]
      if (!(tone > 200)) tone = 200
      const ceiling = this.sampleRate * 0.45
      if (tone > ceiling) tone = ceiling
      if (tone !== this.lastTone) {
        this.lastTone = tone
        this.toneCoefficient = 1 - Math.exp((-2 * Math.PI * tone) / this.sampleRate)
      }

      let bias = biasParam[i]
      if (!(bias > -0.5)) bias = -0.5
      else if (bias > 0.5) bias = 0.5
      let level = levelParam[i]
      if (!(level > 0)) level = 0
      else if (level > 1.5) level = 1.5

      for (let channel = 0; channel < 2; channel++) {
        const input = channel === 0 ? inLeft[i] : inRight[i]
        const driven = (input + bias) * gain
        let shaped = 0

        if (mode === 0) {
          // Tube: the smoothest knee. Subtracting the bias's static contribution reduces the offset,
          // while the blocker below removes the signal-dependent rectification it cannot predict.
          shaped = Math.tanh(driven) - Math.tanh(bias * gain)
        } else if (mode === 1) {
          // Tape: arctangent reaches the rail more slowly than tanh and keeps more level in its knee.
          shaped = (2 * Math.atan(driven)) / Math.PI
        } else if (mode === 2) {
          // Fuzz: an exponential approach to the rail, hard around zero and almost square at the top.
          shaped = driven < 0 ? Math.exp(driven) - 1 : 1 - Math.exp(-driven)
        } else {
          // Digital: pre-gain into a hard clip, then 12 bits down to 2 as Amount rises. The `- 1`
          // keeps the positive and negative rails symmetric around zero.
          const clipped = driven < -1 ? -1 : driven > 1 ? 1 : driven
          const bits = 12 - Math.floor(amount * 10)
          const steps = Math.pow(2, bits - 1) - 1
          shaped = Math.round(clipped * steps) / steps
        }

        toneState[channel] += this.toneCoefficient * (shaped - toneState[channel])
        const blocked =
          toneState[channel] - blockerIn[channel] + this.blockerPole * blockerOut[channel]
        blockerIn[channel] = toneState[channel]
        blockerOut[channel] = blocked
        let output = blocked * level

        if (!Number.isFinite(output)) {
          toneState[channel] = 0
          blockerIn[channel] = 0
          blockerOut[channel] = 0
          output = 0
        }

        if (channel === 0) outLeft[i] = output
        else outRight[i] = output
      }
    }
  }
}

export const DISTORTION_MODULE: ModuleDef = {
  type: 'distortion',
  version: 1,
  name: 'Distortion',
  group: 'Shaping',
  blurb:
    'Tube, tape, fuzz and digital are different curves. Tone shapes the harmonics after the hit.',
  logo: {
    paths: [
      'M5 20h9l4-11 7 23 7-23 7 23 7-23 4 11h9',
      'M10 37h44',
      'M17 34v6M47 34v6',
    ],
  },
  inlets: [
    { id: 'in', name: 'In', stereo: true },
    { id: 'amount', name: 'Amount' },
  ],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    {
      id: 'mode',
      name: 'Mode',
      min: 0,
      max: 3,
      default: 0,
      stepped: true,
      labels: ['Tube', 'Tape', 'Fuzz', 'Digital'],
    },
    { id: 'amount', name: 'Amount', min: 0, max: 1, default: 0.25 },
    { id: 'tone', name: 'Tone Hz', min: 200, max: 18000, default: 8000 },
    { id: 'bias', name: 'Bias', min: -0.5, max: 0.5, default: 0 },
    { id: 'level', name: 'Level', min: 0, max: 1.5, default: 0.8 },
  ],
  processor: DistortionProcessor,
  poly: false,
}
