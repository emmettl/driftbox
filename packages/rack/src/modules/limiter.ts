import type { ModuleDef, Processor } from '../types.js'

// A stereo-linked look-ahead limiter with an explicit ceiling.
//
// **Not the Graph's safety net.** The rack terminal has a fixed limiter and soft ceiling so a hostile
// patch cannot throw ±4 at the host. It is deliberately not a device: no knob, no cable, no way to use
// its gain reduction elsewhere. This module is the mastering decision that belongs in the patch — input
// gain, ceiling, release, and a GR outlet — while the terminal remains an invariant underneath it.
//
// **Five milliseconds of real look-ahead.** Audio waits in a ring while a monotonic peak queue tracks the
// whole window from the sample about to leave through the newest sample. The queue makes finding that
// maximum O(1) amortised rather than scanning roughly 240 samples for every output sample at 48kHz.
// When a peak enters the far end of the window, gain has the entire delay to move towards its target.
//
// **Stereo linked.** One peak queue sees the larger absolute value of L and R, and one gain is applied to
// both delayed channels. Independent limiters would turn a loud event on one side into a pan movement.
// The final ceiling comparison catches the last fraction of overshoot left by the attack ramp; unlike the
// Graph's soft clip, this device promises that the number on its ceiling is the number it emits.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class LimiterProcessor implements Processor {
  private readonly sampleRate: number
  private readonly lookahead: number
  private readonly attackCoefficient: number
  private readonly delayLeft: Float32Array
  private readonly delayRight: Float32Array
  private readonly peakValues: Float32Array
  private readonly peakFrames: Float64Array
  private write = 0
  private queueHead = 0
  private queueTail = 0
  private queueCount = 0
  private frame = 0
  private gain = 1
  private lastRelease = Number.NaN
  private releaseCoefficient = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.lookahead = Math.max(1, Math.round(this.sampleRate * 0.005))
    this.attackCoefficient = Math.pow(0.01, 1 / this.lookahead)
    const length = this.lookahead + 1
    this.delayLeft = new Float32Array(length)
    this.delayRight = new Float32Array(length)
    // One more than the window because head and tail are independent and a strictly descending window
    // can keep every peak until the oldest expires.
    this.peakValues = new Float32Array(length + 1)
    this.peakFrames = new Float64Array(length + 1)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const inLeft = inlets[0]
    const inRight = inlets[1]
    const outLeft = outlets[0]
    const outRight = outlets[1]
    const gainReduction = outlets[2]
    const inputGainParam = params[0]
    const ceilingParam = params[1]
    const releaseParam = params[2]

    const delayLeft = this.delayLeft
    const delayRight = this.delayRight
    const peakValues = this.peakValues
    const peakFrames = this.peakFrames
    const delayLength = delayLeft.length
    const queueLength = peakValues.length
    let write = this.write
    let queueHead = this.queueHead
    let queueTail = this.queueTail
    let queueCount = this.queueCount
    let frame = this.frame
    let gain = this.gain

    for (let i = 0; i < frames; i++) {
      let inputGainDb = inputGainParam[i]
      if (!(inputGainDb > 0)) inputGainDb = 0
      else if (inputGainDb > 24) inputGainDb = 24
      const inputGain = Math.pow(10, inputGainDb / 20)
      let left = inLeft[i] * inputGain
      let right = inRight[i] * inputGain
      if (!Number.isFinite(left)) left = 0
      if (!Number.isFinite(right)) right = 0

      delayLeft[write] = left
      delayRight[write] = right

      const leftPeak = left < 0 ? -left : left
      const rightPeak = right < 0 ? -right : right
      const peak = leftPeak > rightPeak ? leftPeak : rightPeak

      // Remove smaller peaks from the tail: while this one remains in the window they can never be the
      // maximum, so keeping them would only turn a constant-time maximum into a scan later.
      while (queueCount > 0) {
        const last = queueTail === 0 ? queueLength - 1 : queueTail - 1
        if (peakValues[last] > peak) break
        queueTail = last
        queueCount--
      }
      peakValues[queueTail] = peak
      peakFrames[queueTail] = frame
      queueTail++
      if (queueTail >= queueLength) queueTail = 0
      queueCount++

      const oldest = frame - this.lookahead
      while (queueCount > 0 && peakFrames[queueHead] < oldest) {
        queueHead++
        if (queueHead >= queueLength) queueHead = 0
        queueCount--
      }

      let ceilingDb = ceilingParam[i]
      if (!(ceilingDb > -12)) ceilingDb = -12
      else if (ceilingDb > 0) ceilingDb = 0
      const ceiling = Math.pow(10, ceilingDb / 20)
      const windowPeak = queueCount > 0 ? peakValues[queueHead] : 0
      const wanted = windowPeak > ceiling ? ceiling / windowPeak : 1

      let release = releaseParam[i]
      if (!(release > 0.01)) release = 0.01
      else if (release > 1) release = 1
      if (release !== this.lastRelease) {
        this.lastRelease = release
        this.releaseCoefficient = Math.pow(0.01, 1 / Math.max(1, release * this.sampleRate))
      }

      if (wanted < gain) {
        // Ninety-nine percent of the way to the target by the time the peak reaches the output.
        gain = wanted + (gain - wanted) * this.attackCoefficient
      } else {
        gain = wanted + (gain - wanted) * this.releaseCoefficient
      }

      let read = write + 1
      if (read >= delayLength) read = 0
      let limitedLeft = delayLeft[read] * gain
      let limitedRight = delayRight[read] * gain
      if (limitedLeft > ceiling) limitedLeft = ceiling
      else if (limitedLeft < -ceiling) limitedLeft = -ceiling
      if (limitedRight > ceiling) limitedRight = ceiling
      else if (limitedRight < -ceiling) limitedRight = -ceiling

      outLeft[i] = limitedLeft
      outRight[i] = limitedRight
      gainReduction[i] = 1 - gain

      write = read
      frame++
    }

    this.write = write
    this.queueHead = queueHead
    this.queueTail = queueTail
    this.queueCount = queueCount
    this.frame = frame
    this.gain = gain
  }
}

export const LIMITER_MODULE: ModuleDef = {
  type: 'limiter',
  version: 1,
  name: 'Limiter',
  group: 'Shaping',
  blurb:
    'Five milliseconds of stereo-linked look-ahead hold peaks under a real ceiling. GR makes the limiting patchable.',
  logo: {
    paths: [
      'M6 32h12c7 0 5-20 12-20s5 20 12 20h16',
      'M8 8h48',
      'M20 5v6M44 5v6',
    ],
  },
  inlets: [{ id: 'in', name: 'In', stereo: true }],
  outlets: [
    { id: 'out', name: 'Out', stereo: true },
    { id: 'gain', name: 'GR' },
  ],
  params: [
    { id: 'inputGain', name: 'Input dB', min: 0, max: 24, default: 0 },
    { id: 'ceiling', name: 'Ceiling dB', min: -12, max: 0, default: -0.5 },
    { id: 'release', name: 'Release', min: 0.01, max: 1, default: 0.12 },
  ],
  processor: LimiterProcessor,
  poly: false,
}
