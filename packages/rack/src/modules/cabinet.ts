import type { ModuleDef, Processor } from '../types.js'

// A preamp, three-band tone stack and speaker cabinet in one stereo device.
//
// **The cabinet is the device.** Drive can make guitar harmonics and EQ can shape them, but a direct
// distorted pickup still has everything above the range a guitar speaker reproduces. A speaker is a
// steep, coloured band limit: high-pass the handling rumble, then two lowpass poles take the fizz away.
// Combo, Stack and Bright choose three useful upper corners rather than pretending cabinet names are IRs
// this AudioWorklet does not have.
//
// **An amp as well as a filter.** Level-normalised tanh supplies the preamp, then low/mid/high bands split
// by two one-pole crossovers and recombine under dB controls before the speaker. More Drive changes the
// harmonics without making every comparison merely louder; Level remains the explicit output control.
//
// **Stereo because placement wins.** A guitar starts mono, but this device can sit after stereo pedals or
// across a bus. Both channels share knobs and coefficients while keeping every preamp, tone and cabinet
// state independent, so inserting it never folds the width made upstream.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class CabinetProcessor implements Processor {
  private readonly sampleRate: number
  private readonly lowCoefficient: number
  private readonly highCoefficient: number
  private readonly highpassPole: number
  private readonly lowState = [0, 0]
  private readonly highBaseState = [0, 0]
  private readonly highpassIn = [0, 0]
  private readonly highpassOut = [0, 0]
  private readonly cabinetState1 = [0, 0]
  private readonly cabinetState2 = [0, 0]
  private lastCabinet = Number.NaN
  private cabinetCoefficient = 1

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.lowCoefficient = 1 - Math.exp((-2 * Math.PI * 250) / this.sampleRate)
    this.highCoefficient = 1 - Math.exp((-2 * Math.PI * 2500) / this.sampleRate)
    this.highpassPole = Math.exp((-2 * Math.PI * 70) / this.sampleRate)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const inLeft = inlets[0]
    const inRight = inlets[1]
    const driveCv = inlets[2]
    const outLeft = outlets[0]
    const outRight = outlets[1]
    const cabinetParam = params[0]
    const driveParam = params[1]
    const bassParam = params[2]
    const midParam = params[3]
    const trebleParam = params[4]
    const levelParam = params[5]

    const lowState = this.lowState
    const highBaseState = this.highBaseState
    const highpassIn = this.highpassIn
    const highpassOut = this.highpassOut
    const cabinetState1 = this.cabinetState1
    const cabinetState2 = this.cabinetState2

    for (let i = 0; i < frames; i++) {
      let cabinet = Math.round(cabinetParam[i])
      if (!(cabinet > 0)) cabinet = 0
      else if (cabinet > 2) cabinet = 2
      if (cabinet !== this.lastCabinet) {
        this.lastCabinet = cabinet
        const cutoff = cabinet === 0 ? 6500 : cabinet === 1 ? 4200 : 9500
        this.cabinetCoefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / this.sampleRate)
      }

      let drive = driveParam[i] + driveCv[i] * 10
      if (!(drive > 0.5)) drive = 0.5
      else if (drive > 30) drive = 30
      const driveScale = 1 / Math.tanh(drive)

      let bass = bassParam[i]
      if (!(bass > -12)) bass = -12
      else if (bass > 12) bass = 12
      let mid = midParam[i]
      if (!(mid > -12)) mid = -12
      else if (mid > 12) mid = 12
      let treble = trebleParam[i]
      if (!(treble > -12)) treble = -12
      else if (treble > 12) treble = 12
      const bassGain = Math.pow(10, bass / 20)
      const midGain = Math.pow(10, mid / 20)
      const trebleGain = Math.pow(10, treble / 20)

      let level = levelParam[i]
      if (!(level > 0)) level = 0
      else if (level > 1.5) level = 1.5

      for (let channel = 0; channel < 2; channel++) {
        const input = channel === 0 ? inLeft[i] : inRight[i]
        const shaped = Math.tanh(input * drive) * driveScale

        lowState[channel] += this.lowCoefficient * (shaped - lowState[channel])
        highBaseState[channel] +=
          this.highCoefficient * (shaped - highBaseState[channel])
        const low = lowState[channel]
        const high = shaped - highBaseState[channel]
        const middle = highBaseState[channel] - low
        const toned = low * bassGain + middle * midGain + high * trebleGain

        const highpassed =
          toned - highpassIn[channel] + this.highpassPole * highpassOut[channel]
        highpassIn[channel] = toned
        highpassOut[channel] = highpassed

        cabinetState1[channel] +=
          this.cabinetCoefficient * (highpassed - cabinetState1[channel])
        cabinetState2[channel] +=
          this.cabinetCoefficient * (cabinetState1[channel] - cabinetState2[channel])
        let output = cabinetState2[channel] * level

        if (!Number.isFinite(output)) {
          lowState[channel] = 0
          highBaseState[channel] = 0
          highpassIn[channel] = 0
          highpassOut[channel] = 0
          cabinetState1[channel] = 0
          cabinetState2[channel] = 0
          output = 0
        }

        if (channel === 0) outLeft[i] = output
        else outRight[i] = output
      }
    }
  }
}

export const CABINET_MODULE: ModuleDef = {
  type: 'cabinet',
  version: 1,
  name: 'Amp / Cab',
  group: 'Shaping',
  blurb:
    'A driven preamp, tone stack and three speaker voicings. The missing step between a pedal and a recorded guitar.',
  logo: {
    paths: [
      'M8 6h48v31H8z',
      'M16 12h32',
      'M20 25a12 9 0 1024 0 12 9 0 10-24 0',
      'M27 25a5 4 0 1010 0 5 4 0 10-10 0',
    ],
  },
  inlets: [
    { id: 'in', name: 'In', stereo: true },
    { id: 'drive', name: 'Drive' },
  ],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    {
      id: 'cabinet',
      name: 'Cab',
      min: 0,
      max: 2,
      default: 0,
      stepped: true,
      labels: ['Combo', 'Stack', 'Bright'],
    },
    { id: 'drive', name: 'Drive', min: 0.5, max: 30, default: 2 },
    { id: 'bass', name: 'Bass', min: -12, max: 12, default: 0 },
    { id: 'mid', name: 'Mid', min: -12, max: 12, default: 0 },
    { id: 'treble', name: 'Treble', min: -12, max: 12, default: 0 },
    { id: 'level', name: 'Level', min: 0, max: 1.5, default: 0.8 },
  ],
  processor: CabinetProcessor,
  poly: false,
}
