import { ratioRange } from './voices/common.js'

// The performance filter — a Kaoss-pad-style XY insert across the whole mix.
//
// Across is cutoff, up is resonance, which is the layout every one of these has had since
// the KP1 and the only one anybody's hands already know.
//
// It filters EVERYTHING, not just the 303s. The obvious reading of "messing with a 303's
// filter" is to wire this to the 303s' own cutoff, and it is the wrong one: the fun of a
// Kaoss pad is that the whole record ducks away and comes back, drums included. A 303
// already has a cutoff knob on its channel strip for the other job.
//
// It is an insert rather than a send, and sits after the bus compressor — so the
// compressor is not reacting to a signal the filter is about to throw away, and a
// resonant peak cannot be pumped by it.

/**
 * One filter that morphs between lowpass and highpass across its range, because a single
 * BiquadFilterNode cannot change type without a click.
 *
 * Left of centre sweeps a lowpass down; right of centre sweeps a highpass up; the middle
 * leaves both wide open, which is a true bypass — no need for an enable switch, and no
 * discontinuity when the pad is released.
 */
const NEUTRAL_X = 0.5

/** Lowest the lowpass goes. Below about 80Hz there is nothing left to hear and the pad's
 *  bottom corner is dead travel. */
const LOW_FLOOR = 90
const LOW_CEILING = 20000

/** Highest the highpass goes. Past about 6kHz only cymbals survive, which is the point,
 *  but further is just silence. */
const HIGH_FLOOR = 20
const HIGH_CEILING = 6000

/** Q at the top of the pad. High enough to whistle on a sweep, short of self-oscillation
 *  — a biquad at very high Q gains enough to clip the master on its own. */
const MAX_Q = 12

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** A tiny floor rather than zero, so the idle filter is damped rather than undefined. */
const MIN_Q = 0.0001

/** Vertical position to filter Q. Shared by the filter and the readout deliberately: if
 *  they were computed separately the panel could drift from the sound it is labelling. */
function resonanceQ(y: number): number {
  return MIN_Q + clamp01(y) * (MAX_Q - MIN_Q)
}

/** Where a horizontal position puts each filter. Also shared, for the same reason. */
function cutoffs(x: number): { low: number; high: number } {
  const px = clamp01(x)
  return {
    low: px < NEUTRAL_X ? ratioRange(px / NEUTRAL_X, LOW_FLOOR, LOW_CEILING) : LOW_CEILING,
    high:
      px > NEUTRAL_X
        ? ratioRange((px - NEUTRAL_X) / (1 - NEUTRAL_X), HIGH_FLOOR, HIGH_CEILING)
        : HIGH_FLOOR,
  }
}

export class Kaoss {
  readonly input: GainNode
  readonly output: GainNode

  private readonly ctx: BaseAudioContext
  private readonly lowpass: BiquadFilterNode
  private readonly highpass: BiquadFilterNode

  /** Whether the pad is being held. The UI wants to know, to draw itself. */
  active = false

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx

    this.input = ctx.createGain()
    this.output = ctx.createGain()

    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.highpass = ctx.createBiquadFilter()
    this.highpass.type = 'highpass'

    this.input.connect(this.lowpass)
    this.lowpass.connect(this.highpass)
    this.highpass.connect(this.output)

    this.reset()
  }

  /** Put both filters out of the way. Called on construction and by `release`. */
  private reset(): void {
    const now = this.ctx.currentTime
    this.lowpass.frequency.setValueAtTime(LOW_CEILING, now)
    this.highpass.frequency.setValueAtTime(HIGH_FLOOR, now)
    this.lowpass.Q.setValueAtTime(MIN_Q, now)
    this.highpass.Q.setValueAtTime(MIN_Q, now)
  }

  /**
   * Move the filter. `x` and `y` are 0..1 from the pad's bottom-left.
   *
   * Every parameter is ramped rather than set. A pointer only reports every frame or so,
   * and stepping a resonant filter's cutoff sixty times a second is audible as a zipper —
   * the one artefact that would make this feel cheap rather than expensive.
   */
  set(x: number, y: number, glide = 0.02): void {
    const now = this.ctx.currentTime
    const px = clamp01(x)

    // Exponential either side of centre: cutoff is heard as a ratio, so a linear sweep
    // spends most of its travel doing nothing audible.
    const { low, high } = cutoffs(px)
    this.lowpass.frequency.setTargetAtTime(low, now, glide)
    this.highpass.frequency.setTargetAtTime(high, now, glide)

    // Resonance only on whichever filter is actually doing something. Applied to both,
    // the idle one rings at the edge of the audible band and adds a permanent whistle.
    const q = resonanceQ(y)
    this.lowpass.Q.setTargetAtTime(px < NEUTRAL_X ? q : MIN_Q, now, glide)
    this.highpass.Q.setTargetAtTime(px > NEUTRAL_X ? q : MIN_Q, now, glide)

    this.active = true
  }

  /**
   * Let go. Glides back to neutral rather than snapping.
   *
   * Momentary rather than latching, deliberately: a filter left half-shut after you lift
   * your finger sounds like something is broken, and every time anybody has shipped a
   * latching version of this control somebody has ended up recording a whole take through
   * it by accident.
   */
  release(glide = 0.12): void {
    const now = this.ctx.currentTime
    this.lowpass.frequency.setTargetAtTime(LOW_CEILING, now, glide)
    this.highpass.frequency.setTargetAtTime(HIGH_FLOOR, now, glide)
    this.lowpass.Q.setTargetAtTime(MIN_Q, now, glide)
    this.highpass.Q.setTargetAtTime(MIN_Q, now, glide)
    this.active = false
  }

  dispose(): void {
    this.input.disconnect()
    this.lowpass.disconnect()
    this.highpass.disconnect()
    this.output.disconnect()
  }
}

/**
 * Where a pad position puts the filter, as numbers — for a UI that wants to label itself
 * without duplicating the mapping, and for tests.
 */
export function kaossReadout(x: number, y: number): { mode: 'low' | 'high' | 'open'; hz: number; q: number } {
  const px = clamp01(x)
  const q = resonanceQ(y)
  if (Math.abs(px - NEUTRAL_X) < 0.02) return { mode: 'open', hz: 0, q }
  const { low, high } = cutoffs(px)
  return px < NEUTRAL_X ? { mode: 'low', hz: low, q } : { mode: 'high', hz: high, q }
}
