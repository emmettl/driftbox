import { DEFAULT_FX, type FxParams } from './effects.js'
import { configureMixCompressor } from './master.js'

// The authored master inserts shared by live playback and mastered export.
//
// ReBirth's effects are part of the song, not an accident of the host around it. This
// chain therefore sits before the momentary Kaoss filter and travels with FxParams:
// distortion, a pattern-controlled low-pass, then the bus compressor.

const CURVE_SAMPLES = 2048

export function pcfFrequency(knob: number): number {
  const value = Math.max(0, Math.min(1, knob))
  return 60 * Math.pow(200, value)
}

export function pcfDecaySeconds(knob: number): number {
  return 0.025 + Math.max(0, Math.min(1, knob)) * 0.775
}

export function driveCurve(amount: number): Float32Array<ArrayBuffer> | null {
  const value = Math.max(0, Math.min(1, amount))
  if (value === 0) return null
  const drive = 0.1 + value * 19.9
  const scale = 1 / Math.tanh(drive)
  const curve = new Float32Array(CURVE_SAMPLES)
  for (let index = 0; index < curve.length; index++) {
    const input = (index / (curve.length - 1)) * 2 - 1
    curve[index] = Math.tanh(input * drive) * scale
  }
  return curve
}

export class MasterEffects {
  readonly input: GainNode
  readonly output: GainNode

  private readonly ctx: BaseAudioContext
  private readonly drive: WaveShaperNode
  private readonly dry: GainNode
  private readonly filter: BiquadFilterNode
  private readonly wet: GainNode
  private readonly sum: GainNode
  private readonly compressor: DynamicsCompressorNode
  private curveShape = -1

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.drive = ctx.createWaveShaper()
    this.drive.oversample = '2x'
    this.dry = ctx.createGain()
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.wet = ctx.createGain()
    this.sum = ctx.createGain()
    this.compressor = ctx.createDynamicsCompressor()
    this.dry.gain.value = 1
    this.wet.gain.value = 0
    this.filter.frequency.value = pcfFrequency(DEFAULT_FX.pcfCutoff)
    this.filter.Q.value = DEFAULT_FX.pcfResonance * 24
    configureMixCompressor(this.compressor)

    this.input.connect(this.drive)
    this.drive.connect(this.dry)
    this.dry.connect(this.sum)
    this.drive.connect(this.filter)
    this.filter.connect(this.wet)
    this.wet.connect(this.sum)
    this.sum.connect(this.compressor)
    this.compressor.connect(this.output)

    this.update(DEFAULT_FX)
  }

  /** Apply authored insert settings and optionally strike the PCF envelope for this step. */
  update(fx: FxParams, at = this.ctx.currentTime, pcf: 0 | 1 | 2 = 0): void {
    const time = Math.max(this.ctx.currentTime, at)

    // Quantised because WaveShaper.curve is not an AudioParam. Sixty-five shapes are
    // finer than a knob can distinguish and avoid allocating a curve every scheduler tick.
    const shape = Math.round(Math.max(0, Math.min(1, fx.drive)) * 64)
    if (shape !== this.curveShape) {
      this.curveShape = shape
      this.drive.curve = driveCurve(shape / 64)
    }

    const amount = Math.max(0, Math.min(1, fx.pcfAmount))
    this.dry.gain.setTargetAtTime(1 - amount, time, 0.005)
    this.wet.gain.setTargetAtTime(amount, time, 0.005)
    this.filter.Q.setTargetAtTime(Math.max(0, Math.min(1, fx.pcfResonance)) * 24, time, 0.01)

    const base = pcfFrequency(fx.pcfCutoff)
    this.filter.frequency.cancelScheduledValues(time)
    this.filter.frequency.setValueAtTime(base, time)
    if (pcf > 0 && amount > 0) {
      const accent = pcf === 2 ? 1.25 : 1
      const octaves = Math.max(0, Math.min(1, fx.pcfEnv)) * 5 * accent
      const peak = Math.min(this.ctx.sampleRate * 0.45, base * Math.pow(2, octaves))
      this.filter.frequency.exponentialRampToValueAtTime(Math.max(base, peak), time + 0.008)
      this.filter.frequency.exponentialRampToValueAtTime(base, time + pcfDecaySeconds(fx.pcfDecay))
    }

    // 0.5 reproduces the original fixed bus compressor exactly. The ends range from
    // transparent to assertive without introducing a second makeup-gain loudness knob.
    const compression = Math.max(0, Math.min(1, fx.compressor))
    this.compressor.threshold.setTargetAtTime(-28 * compression, time, 0.01)
    this.compressor.ratio.setTargetAtTime(1 + compression * 6, time, 0.01)
    this.compressor.knee.setTargetAtTime(8, time, 0.01)
    this.compressor.attack.setTargetAtTime(0.004, time, 0.01)
    this.compressor.release.setTargetAtTime(0.18, time, 0.01)
  }

  dispose(): void {
    this.input.disconnect()
    this.drive.disconnect()
    this.dry.disconnect()
    this.filter.disconnect()
    this.wet.disconnect()
    this.sum.disconnect()
    this.compressor.disconnect()
    this.output.disconnect()
  }
}
