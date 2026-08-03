import type { MeterReading, ModuleDef, Processor } from '../types.js'

// A stereo performance looper: record, play, overdub, stop and clear.
//
// **The capture is session state, not patch data.** A rack document can say there is a looper, how it mixes
// and which transport state its panel was left in; it cannot put eleven megabytes of somebody's performance
// in a share URL. Reopening a patch therefore reopens an empty pedal, exactly like powering on hardware.
//
// Thirty seconds are allocated once when the processor is constructed. Allocation while recording would be
// a glitch on the audio thread, and growing a typed array is a copy of everything already played. At 48 kHz,
// two channels cost about 11 MB only when this device exists. Reaching the limit holds the first thirty
// seconds until Record is released rather than wrapping underneath the player and changing where beat one is.
//
// Record always monitors dry. Play adds the captured loop; Dub writes input plus the old loop scaled by
// Feedback while monitoring both. Starting Dub on an empty pedal makes a first pass, so every performance
// button does something without a ritual ordering. Clear is an alternating hidden param rather than a saved
// boolean command: every click changes its value, and every change is one clear.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class LooperProcessor implements Processor {
  private readonly sampleRate: number
  private readonly maximum: number
  private readonly left: Float32Array
  private readonly right: Float32Array
  private position = 0
  private length = 0
  private lastMode = -1
  private captureMode = 0
  private lastClear = Number.NaN
  private level = 0
  private peak = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.maximum = Math.max(1, Math.round(this.sampleRate * 30))
    this.left = new Float32Array(this.maximum)
    this.right = new Float32Array(this.maximum)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const inputLeft = inlets[0]
    const inputRight = inlets[1]
    const outputLeft = outlets[0]
    const outputRight = outlets[1]
    let mode = Math.round(params[0][0])
    if (!(mode > 0)) mode = 0
    else if (mode > 3) mode = 3

    const clear = params[4][0] >= 0.5 ? 1 : 0
    if (Number.isNaN(this.lastClear)) this.lastClear = clear
    else if (clear !== this.lastClear) {
      this.lastClear = clear
      this.position = 0
      this.length = 0
      this.captureMode = 0
      // A clear while Record remains selected begins a fresh first pass in this block.
      this.lastMode = -1
    }

    if (this.captureMode !== 0 && mode !== this.captureMode) {
      this.length = Math.max(1, Math.min(this.maximum, this.position))
      this.position = 0
      this.captureMode = 0
    }
    if (mode !== this.lastMode) {
      if (mode === 1) {
        this.position = 0
        this.length = 0
        this.captureMode = 1
      } else if (mode === 3 && this.length === 0) {
        this.position = 0
        this.captureMode = 3
      } else if (mode === 0 || this.lastMode === 0) {
        this.position = 0
      }
      this.lastMode = mode
    }

    let squares = 0
    let peak = 0
    for (let i = 0; i < frames; i++) {
      const inL = Number.isFinite(inputLeft[i]) ? inputLeft[i] : 0
      const inR = Number.isFinite(inputRight[i]) ? inputRight[i] : 0
      const dry = params[2][i]
      const loop = params[3][i]
      let outL = inL * dry
      let outR = inR * dry

      if (this.captureMode === mode) {
        if (this.position < this.maximum) {
          this.left[this.position] = inL
          this.right[this.position] = inR
          this.position++
          this.length = this.position
        }
      } else if ((mode === 2 || mode === 3) && this.length > 0) {
        const oldL = this.left[this.position]
        const oldR = this.right[this.position]
        outL += oldL * loop
        outR += oldR * loop
        if (mode === 3) {
          const feedback = params[1][i]
          this.left[this.position] = oldL * feedback + inL
          this.right[this.position] = oldR * feedback + inR
        }
        this.position++
        if (this.position >= this.length) this.position = 0
      }

      outputLeft[i] = Number.isFinite(outL) ? outL : 0
      outputRight[i] = Number.isFinite(outR) ? outR : 0
      const magnitudeL = outL < 0 ? -outL : outL
      const magnitudeR = outR < 0 ? -outR : outR
      squares += (outL * outL + outR * outR) * 0.5
      if (magnitudeL > peak) peak = magnitudeL
      if (magnitudeR > peak) peak = magnitudeR
    }
    this.level = frames > 0 ? Math.sqrt(squares / frames) : 0
    this.peak = peak
  }

  meter(): Omit<MeterReading, 'id'> {
    const waveform = new Float32Array(48)
    if (this.length > 0) {
      for (let point = 0; point < waveform.length; point++) {
        const index = Math.min(this.length - 1, Math.floor((point * this.length) / waveform.length))
        let sample = (this.left[index] + this.right[index]) * 0.5
        if (sample < -1) sample = -1
        else if (sample > 1) sample = 1
        waveform[point] = sample
      }
    }
    return {
      level: this.level,
      peak: this.peak,
      envelope: this.level,
      waveform,
      loopPosition: this.length > 0 ? this.position / this.length : 0,
      loopSeconds: this.length / this.sampleRate,
    }
  }
}

export const LOOPER_MODULE: ModuleDef = {
  type: 'looper',
  version: 1,
  name: 'Loop Station',
  group: 'Effects',
  blurb:
    'Captures up to thirty stereo seconds, then plays or overdubs them. The take lives for this session only.',
  guide: {
    overview:
      'Loop Station records a performance into a stereo buffer, closes the loop when you leave Record, and can then play or overdub against that exact captured length.',
    concepts: [
      {
        title: 'The first take sets the length',
        body: 'Record starts an empty loop. Switching to Play or Dub closes it; later overdubs wrap around that duration instead of making the loop longer.',
      },
      {
        title: 'Dry, Loop and Feedback are different',
        body: 'Dry monitors the live input. Loop sets playback level. Feedback controls how much already-recorded audio survives each overdub pass.',
      },
    ],
    firstPatch: [
      'Patch a stereo source into In and Out to a mixer or terminal output.',
      'Choose Rec, perform one phrase, then choose Play exactly at the loop boundary.',
      'Choose Dub to add a layer; lower Feedback if old layers should fade on every pass.',
    ],
    watchFor: [
      'The recorded take is session-only and is not embedded in a shared patch.',
      'Clear erases the buffer. Stop preserves it and only halts playback.',
    ],
  },
  logo: {
    paths: [
      'M15 31a17 17 0 1 1 7 7',
      'M15 31l-7-1 3 7',
      'M25 22h14v12H25z',
    ],
  },
  inlets: [{ id: 'in', name: 'In', stereo: true }],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    { id: 'mode', name: 'Transport', min: 0, max: 3, default: 0, stepped: true, labels: ['Stop', 'Rec', 'Play', 'Dub'] },
    { id: 'feedback', name: 'Feedback', min: 0, max: 1, default: 0.85 },
    { id: 'dry', name: 'Dry', min: 0, max: 1, default: 1 },
    { id: 'loop', name: 'Loop', min: 0, max: 1, default: 1 },
    // Alternated by the dedicated Clear button. Hidden keeps the generic fallback from presenting an
    // on/off switch whose meaning is an action rather than a state.
    { id: 'clear', name: 'Clear', min: 0, max: 1, default: 0, stepped: true, hidden: true },
  ],
  processor: LooperProcessor,
  poly: false,
}
