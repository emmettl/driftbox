import type { ModuleDef, Processor } from '../types.js'

// A mono-in, stereo-out delay whose repeats alternate left and right.
//
// **A new module rather than new semantics for `delay`.** Changing the existing Delay's ports to
// stereo would preserve the cable endpoints but change the sound of every patch using it: a mono
// source would suddenly feed two delay lines, and folding the result back would no longer equal the
// old wet signal. `ping-pong` is a new stable type, so the old delay stays sample-for-sample itself.
//
// **One input is the point.** A stereo inlet centred from mono would present the same signal to both
// channels and the two lines would remain identical forever — a dual-mono delay with a wide cable.
// Feeding only the left line breaks that symmetry: the first repeat appears left, its feedback enters
// the right line, the next appears right, and so on. For stereo-in/stereo-out independent echoes, two
// ordinary Delays remain the visible and more flexible patch.
//
// Like Delay, this is wet only. The dry path and balance belong in a Mixer where the cable picture says
// what they are, and the time inlet is in octaves so +1 halves the delay. Both lines share one write
// cursor and fractional read position, which keeps their alternation exact while the time is modulated.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class PingPongProcessor implements Processor {
  private readonly sampleRate: number
  private readonly left: Float32Array
  private readonly right: Float32Array
  private write = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    const length = Math.ceil(this.sampleRate * 2) + 4
    this.left = new Float32Array(length)
    this.right = new Float32Array(length)
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
    const outLeft = outlets[0]
    const outRight = outlets[1]
    const time = params[0]
    const feedback = params[1]

    const left = this.left
    const right = this.right
    const length = left.length
    const longest = length - 3

    for (let i = 0; i < frames; i++) {
      let seconds = time[i]
      const octaves = timeCv[i]
      if (octaves !== 0) seconds /= Math.pow(2, octaves)

      let samples = seconds * this.sampleRate
      if (samples < 1) samples = 1
      else if (samples > longest) samples = longest

      let read = this.write - samples
      if (read < 0) read += length
      const index = Math.floor(read)
      const fraction = read - index
      const next = index + 1 < length ? index + 1 : 0
      const delayedLeft = left[index] + (left[next] - left[index]) * fraction
      const delayedRight = right[index] + (right[next] - right[index]) * fraction

      outLeft[i] = delayedLeft
      outRight[i] = delayedRight

      let fb = feedback[i] + feedbackCv[i]
      if (fb < 0) fb = 0
      else if (fb > 0.98) fb = 0.98

      // Cross feedback is the whole topology: input enters left, then each line writes only what the
      // other one just read. A new input can begin another bounce while an older one is still crossing.
      let writtenLeft = input[i] + delayedRight * fb
      let writtenRight = delayedLeft * fb
      if (!(writtenLeft > -8 && writtenLeft < 8)) {
        writtenLeft = writtenLeft > 0 ? 8 : writtenLeft < 0 ? -8 : 0
      }
      if (!(writtenRight > -8 && writtenRight < 8)) {
        writtenRight = writtenRight > 0 ? 8 : writtenRight < 0 ? -8 : 0
      }
      left[this.write] = writtenLeft
      right[this.write] = writtenRight

      this.write++
      if (this.write >= length) this.write = 0
    }
  }
}

export const PING_PONG_MODULE: ModuleDef = {
  type: 'ping-pong',
  version: 1,
  name: 'Ping-Pong Delay',
  group: 'Space',
  blurb:
    'Wet echoes bounce left then right. Cross-feedback makes one mono line fill a stereo cable over time.',
  logo: {
    paths: [
      'M8 12h15l-5-5M23 12l-5 5',
      'M56 22H33l5-5M33 22l5 5',
      'M8 32h15l-5-5M23 32l-5 5',
    ],
  },
  inlets: [
    { id: 'in', name: 'In' },
    { id: 'time', name: 'Time' },
    { id: 'fb', name: 'FB' },
  ],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    { id: 'time', name: 'Time', min: 0.0003, max: 2, default: 0.25 },
    { id: 'feedback', name: 'FB', min: 0, max: 0.98, default: 0.55 },
  ],
  processor: PingPongProcessor,
  poly: false,
}
