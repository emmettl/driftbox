import type { MeterReading, ModuleDef, Processor } from '../types.js'

// A chromatic instrument tuner with a transparent through path.
//
// **Pitch belongs on the meter channel, not in the patch.** Frequency and confidence are observations of
// the signal, just like a VU reading; saving them would make a shared patch claim that yesterday's guitar
// note was still sounding. The processor therefore publishes them through `meter()`, while reference pitch
// and mute remain ordinary saved params.
//
// The detector is normalised autocorrelation over a rolling, downsampled window. Counting zero crossings
// is cheaper but confidently calls a bright guitar's second harmonic the note; correlation asks which delay
// makes the whole waveform repeat. Downsampling to roughly 8 kHz keeps the useful 55–2000 Hz tuner range
// while reducing each analysis from millions of products to roughly a hundred thousand. A one-pole low-pass
// runs before decimation so the discarded top end does not alias back into that decision.
//
// The first strong local peak wins rather than the largest peak anywhere. A periodic signal also matches at
// twice and three times its period; choosing the earliest credible peak names the fundamental instead of a
// subharmonic. Parabolic interpolation around that peak supplies the fraction of a sample needed for a cents
// display without enlarging the window.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class TunerProcessor implements Processor {
  private readonly sampleRate: number
  private readonly decimation: number
  private readonly analysisRate: number
  private readonly history = new Float32Array(2048)
  private readonly analysis = new Float32Array(1024)
  private readonly correlations: Float32Array
  private readonly lowpassCoefficient: number
  private write = 0
  private filled = 0
  private phase = 0
  private lowpass = 0
  private level = 0
  private peak = 0
  private frequency = 0
  private clarity = 0
  private dirty = false
  private waveform = new Float32Array(48)

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.decimation = Math.max(1, Math.floor(this.sampleRate / 8000))
    this.analysisRate = this.sampleRate / this.decimation
    this.correlations = new Float32Array(Math.ceil(this.analysisRate / 45) + 2)
    this.lowpassCoefficient = 1 - Math.exp((-2 * Math.PI * 1800) / this.sampleRate)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const thru = outlets[0]
    const mute = params[1]
    let squares = 0
    let peak = 0

    for (let i = 0; i < frames; i++) {
      const sample = Number.isFinite(input[i]) ? input[i] : 0
      thru[i] = mute[i] >= 0.5 ? 0 : sample
      const magnitude = sample < 0 ? -sample : sample
      squares += sample * sample
      if (magnitude > peak) peak = magnitude

      this.lowpass += this.lowpassCoefficient * (sample - this.lowpass)
      if (this.phase === 0) {
        this.history[this.write] = this.lowpass
        this.write = (this.write + 1) % this.history.length
        if (this.filled < this.history.length) this.filled++
      }
      this.phase++
      if (this.phase >= this.decimation) this.phase = 0
    }

    this.level = frames > 0 ? Math.sqrt(squares / frames) : 0
    this.peak = peak
    this.dirty = true

    const points = this.waveform.length
    for (let point = 0; point < points; point++) {
      const index = Math.min(frames - 1, Math.floor((point * frames) / points))
      let sample = frames > 0 ? input[Math.max(0, index)] : 0
      if (sample < -1) sample = -1
      else if (sample > 1) sample = 1
      this.waveform[point] = sample
    }
  }

  meter(): Omit<MeterReading, 'id'> {
    if (this.dirty) this.detect()
    return {
      level: this.level,
      peak: this.peak,
      envelope: this.level,
      waveform: this.waveform.slice(),
      frequency: this.frequency,
      clarity: this.clarity,
    }
  }

  private detect(): void {
    this.dirty = false
    // A quiet input is more usefully blank than a confident reading from the old tail of the window.
    if (this.level < 0.003 || this.filled < 256) {
      this.frequency = 0
      this.clarity = 0
      return
    }

    const count = Math.min(this.filled, this.analysis.length)
    const start = (this.write - count + this.history.length) % this.history.length
    let mean = 0
    for (let i = 0; i < count; i++) {
      const sample = this.history[(start + i) % this.history.length]
      this.analysis[i] = sample
      mean += sample
    }
    mean /= count
    for (let i = 0; i < count; i++) this.analysis[i] -= mean

    const minimumLag = Math.max(2, Math.floor(this.analysisRate / 2000))
    const maximumLag = Math.min(
      this.correlations.length - 2,
      Math.floor(this.analysisRate / 55),
      Math.floor(count / 3),
    )
    if (maximumLag <= minimumLag + 1) {
      this.frequency = 0
      this.clarity = 0
      return
    }

    let best = 0
    for (let lag = minimumLag; lag <= maximumLag; lag++) {
      let product = 0
      let energyA = 0
      let energyB = 0
      const samples = count - lag
      for (let i = 0; i < samples; i++) {
        const a = this.analysis[i]
        const b = this.analysis[i + lag]
        product += a * b
        energyA += a * a
        energyB += b * b
      }
      const denominator = Math.sqrt(energyA * energyB)
      const correlation = denominator > 1e-12 ? product / denominator : 0
      this.correlations[lag] = Number.isFinite(correlation) ? correlation : 0
      if (this.correlations[lag] > best) best = this.correlations[lag]
    }

    if (best < 0.55) {
      this.frequency = 0
      this.clarity = Math.max(0, best)
      return
    }

    const threshold = Math.max(0.62, best * 0.88)
    let chosen = 0
    for (let lag = minimumLag + 1; lag < maximumLag; lag++) {
      const here = this.correlations[lag]
      if (here >= threshold && here >= this.correlations[lag - 1] && here > this.correlations[lag + 1]) {
        chosen = lag
        break
      }
    }
    if (chosen === 0) {
      for (let lag = minimumLag; lag <= maximumLag; lag++) {
        if (this.correlations[lag] === best) {
          chosen = lag
          break
        }
      }
    }

    const left = this.correlations[Math.max(minimumLag, chosen - 1)]
    const centre = this.correlations[chosen]
    const right = this.correlations[Math.min(maximumLag, chosen + 1)]
    const curvature = left - 2 * centre + right
    let fraction = curvature === 0 ? 0 : (0.5 * (left - right)) / curvature
    if (!Number.isFinite(fraction) || fraction < -0.5 || fraction > 0.5) fraction = 0
    const period = chosen + fraction
    const frequency = period > 0 ? this.analysisRate / period : 0

    this.frequency = frequency >= 55 && frequency <= 2000 ? frequency : 0
    this.clarity = Math.max(0, Math.min(1, centre))
  }
}

export const TUNER_MODULE: ModuleDef = {
  type: 'tuner',
  version: 1,
  name: 'Chromatic Tuner',
  group: 'Analysis',
  blurb:
    'Names the incoming note and its cents error. Thru is transparent unless Mute is on for silent tuning.',
  logo: {
    paths: [
      'M8 29h48M12 29a20 20 0 0 1 40 0',
      'M32 29l9-15M32 10v4M18 16l3 3M46 16l-3 3',
      'M26 34h12',
    ],
  },
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [{ id: 'thru', name: 'Thru' }],
  params: [
    { id: 'reference', name: 'A4', min: 400, max: 480, default: 440 },
    { id: 'mute', name: 'Mute', min: 0, max: 1, default: 0, stepped: true, labels: ['Thru', 'Mute'] },
  ],
  processor: TunerProcessor,
  // One pitch decision for the collapsed instrument signal. Eight tuners would disagree about which voice
  // the faceplate should display and need eight rolling analysis windows to do it.
  poly: false,
}
