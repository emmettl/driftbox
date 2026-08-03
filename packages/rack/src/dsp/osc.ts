// A band-limited oscillator, shared.
//
// Lifted out of `modules/vco.ts` unchanged when the Voice needed one too. **Shared rather than copied**,
// which is the whole reason it is a file: a processor class is serialised into a scope of its own and can
// reference nothing outside itself, so a second module wanting an oscillator has exactly two options —
// paste the arithmetic, or take it through `deps`. Pasting it is how two oscillators in one instrument
// end up sounding subtly different a year later, and nothing would catch it: `vco.test.ts` measures alias
// suppression against an additive reference and would go on passing while the copy drifted.
//
// `Random` is already shared between the LFO and the Noise for the same reason. This is the same move.
//
// The method is PolyBLEP: at each discontinuity, subtract a two-sample polynomial approximating the
// difference between the naive step and a band-limited one. `vco.ts` has the long note on why it is that
// and not a wavetable, what it costs (25 to 52dB of suppression, and 3dB of third harmonic at 5kHz), and
// why the triangle is deliberately left naive.

export class Osc {
  private phase = 0

  /** Wind back to the top. A voice restarts its oscillators on a note so two of them at the same pitch
   *  stay in the phase relationship the detune knob implies rather than wherever they happened to be. */
  reset(): void {
    this.phase = 0
  }

  /**
   * One sample.
   *
   * `dt` is the phase increment — frequency over sample rate — and is clamped by the caller, because past
   * about 0.45 the two discontinuities of a pulse start to overlap and the correction stops meaning
   * anything. `shape` is 0 saw, 1 pulse, 2 triangle; `width` is the pulse width.
   */
  next(dt: number, shape: number, width: number): number {
    this.phase += dt
    if (this.phase >= 1) this.phase -= 1
    const t = this.phase

    if (shape === 1) {
      let pw = width
      if (pw < 0.05) pw = 0.05
      else if (pw > 0.95) pw = 0.95
      // Two discontinuities, in opposite directions: up at the top of the cycle, down at the pulse width.
      let value = t < pw ? 1 : -1
      value += this.blep(t, dt)
      let fall = t - pw
      if (fall < 0) fall += 1
      return value - this.blep(fall, dt)
    }
    if (shape === 2) return 1 - 4 * Math.abs(t - 0.5)
    return 2 * t - 1 - this.blep(t, dt)
  }

  /**
   * The PolyBLEP residual, scaled for a jump of 2 — which is what all of these are, since every shape
   * here runs ±1.
   *
   * Away from a discontinuity it is exactly zero, which is what makes this cheap: the branch is false for
   * all but two samples a cycle.
   */
  private blep(t: number, dt: number): number {
    if (t < dt) {
      const x = t / dt
      return x + x - x * x - 1
    }
    if (t > 1 - dt) {
      const x = (t - 1) / dt
      return x * x + x + x + 1
    }
    return 0
  }
}
