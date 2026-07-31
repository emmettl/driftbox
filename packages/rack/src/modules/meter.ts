import type { MeterReading, ModuleDef, Processor } from '../types.js'

// A patchable meter, rather than a decoration hung off the master output.
//
// The signal passes through unchanged, and the same ballistic envelope that drives the needle leaves through
// `env` as CV. That makes the useful act of watching a kick and the useful act of opening a filter from that
// kick one module, without hiding a second detector in the UI. Sensitivity affects the reading and envelope,
// never the Thru signal — putting a meter in a cable must not change what the cable sounds like.
//
// The display mode is a patch param even though DSP does not read it. A patch should reopen with the same
// instrument panel somebody arranged, and a stepped param already has the persistence, sharing and generic
// fallback semantics that needs. The worklet sends one small waveform; the host decides whether it is drawing
// that as a trace, a bank of LEDs or a needle.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class MeterProcessor implements Processor {
  private readonly sampleRate: number
  private envelope = 0
  private level = 0
  private peak = 0
  private waveform = new Float32Array(48)
  private lastRelease = Number.NaN
  private releaseCoefficient = 0
  private readonly attackCoefficient: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    // Ten milliseconds catches a transient without making a VU needle twitch at audio rate.
    this.attackCoefficient = Math.pow(0.01, 1 / Math.max(1, 0.01 * sampleRate))
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const thru = outlets[0]
    const env = outlets[1]
    const gain = params[0]
    const release = params[1]

    let squares = 0
    let blockPeak = 0
    for (let i = 0; i < frames; i++) {
      const sample = input[i]
      thru[i] = sample

      const sensitivity = gain[i]
      const measured = (sample < 0 ? -sample : sample) * sensitivity
      squares += measured * measured
      if (measured > blockPeak) blockPeak = measured

      const seconds = release[i]
      if (seconds !== this.lastRelease) {
        this.lastRelease = seconds
        this.releaseCoefficient =
          seconds <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, seconds * this.sampleRate))
      }
      const coefficient =
        measured > this.envelope ? this.attackCoefficient : this.releaseCoefficient
      this.envelope = measured + (this.envelope - measured) * coefficient
      env[i] = this.envelope > 4 ? 4 : this.envelope
    }

    this.level = frames > 0 ? Math.sqrt(squares / frames) : 0
    this.peak = blockPeak

    // Forty-eight points are enough across a 420px faceplate once SVG joins them. Picking evenly from the
    // latest render block keeps the audio thread allocation-free; the only copy happens when `meter()` is
    // called at animation rate.
    const points = this.waveform.length
    for (let point = 0; point < points; point++) {
      const index = Math.min(frames - 1, Math.floor((point * frames) / points))
      const sensitivity = frames > 0 ? gain[Math.max(0, index)] : 1
      let sample = frames > 0 ? input[Math.max(0, index)] * sensitivity : 0
      if (sample < -1) sample = -1
      else if (sample > 1) sample = 1
      this.waveform[point] = sample
    }
  }

  meter(): Omit<MeterReading, 'id'> {
    return {
      level: this.level,
      peak: this.peak,
      envelope: this.envelope,
      waveform: this.waveform.slice(),
    }
  }
}

export const METER_MODULE: ModuleDef = {
  type: 'meter',
  version: 1,
  name: 'VU Meter',
  group: 'Analysis',
  blurb:
    'Watches any signal as a needle, bank of LEDs or waveform. Thru is untouched; Env follows what you see.',
  logo: {
    paths: [
      'M6 31a26 26 0 0 1 52 0',
      'M13 29l4-4M19 19l3 4M32 12v6M45 19l-3 4M51 29l-4-4',
      'M32 31l13-15',
      'M27 31a5 5 0 1 0 10 0',
    ],
  },
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [
    { id: 'thru', name: 'Thru' },
    { id: 'env', name: 'Env' },
  ],
  params: [
    { id: 'gain', name: 'Sensitivity', min: 0.25, max: 4, default: 1 },
    { id: 'release', name: 'Release', min: 0.05, max: 1.5, default: 0.3 },
    {
      id: 'mode',
      name: 'Display',
      min: 0,
      max: 2,
      default: 0,
      stepped: true,
      labels: ['VU', 'LED', 'Wave'],
    },
  ],
  processor: MeterProcessor,
  // A meter watches the collapsed signal at this point in the cable. Duplicating the panel per voice would
  // produce several readings for one module id, and a faceplate could not honestly show all of them.
  poly: false,
}
