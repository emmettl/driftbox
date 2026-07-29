// A 4-pole transistor ladder filter — the thing a TB-303 actually is.
//
// The roadmap said a BiquadFilter will not do this, and it will not. A biquad is two
// poles with a tame, linear resonance: you can sweep it and get a filter sweep, but you
// cannot get the squelch. The squelch comes from three things a biquad does not have:
//
//   1. FOUR poles, so 24dB/octave and a much steeper corner.
//   2. A feedback path around all four, strong enough to self-oscillate. At full
//      resonance the filter is a sine oscillator at the cutoff frequency, and a 303 line
//      lives right on the edge of that.
//   3. SATURATION inside the loop. Each ladder stage is a transistor pair, and the
//      resonant peak drives them into their nonlinear region. That is what keeps a
//      self-oscillating filter from exploding, and it is why the resonance sounds thick
//      rather than like a whistle sitting on top of the sound.
//
// This is Huovilainen's model: four one-pole stages with a tanh at each, 2x oversampled,
// with the feedback taken from a half-sample-delayed average of the last stage. The
// polynomials in `coefficients` are his tuning fit — without them the cutoff tracks the
// requested frequency badly at the top of the range and the resonance drains away
// exactly where a 303 needs it most.
//
// This class is deliberately SELF-CONTAINED: no imports, no references to anything at
// module scope. It has to be, because `worklet.ts` serialises it with toString() and
// evaluates it inside an AudioWorkletGlobalScope, which shares no scope with this
// module. See the comment there. It is also why it is testable — it is arithmetic on
// numbers, so `ladder.test.ts` can measure what it does without an audio device.

export class Ladder {
  /** The four one-pole stages. */
  private s0 = 0
  private s1 = 0
  private s2 = 0
  private s3 = 0
  /** Stage 3's previous output, and the half-sample-delayed average fed back. */
  private prev3 = 0
  private feedback = 0
  /** tanh of each stage output, carried over so it is computed once per stage. */
  private t0 = 0
  private t1 = 0
  private t2 = 0
  private t3 = 0

  private readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  reset(): void {
    this.s0 = this.s1 = this.s2 = this.s3 = 0
    this.t0 = this.t1 = this.t2 = this.t3 = 0
    this.prev3 = this.feedback = 0
  }

  /**
   * One sample through the filter.
   *
   * `cutoff` is in Hz and `resonance` runs 0..1, where 1 is a little past the point of
   * self-oscillation. Both are read per sample rather than cached, because on a 303 the
   * cutoff is being swept by an envelope on every single note — a filter whose
   * coefficients only update per block is audibly steppy on a fast decay.
   */
  process(input: number, cutoff: number, resonance: number): number {
    // Oversampling by 2 halves the normalised cutoff, which is most of why the tuning
    // holds together at the top of the range. Two passes of the same input sample; no
    // interpolation, because the tanh stages are the only thing generating harmonics
    // above Nyquist and they are gentle.
    const nyquist = this.sampleRate * 0.5
    const clamped = cutoff < 20 ? 20 : cutoff > nyquist * 0.92 ? nyquist * 0.92 : cutoff
    const f = clamped / this.sampleRate / 2

    const f2 = f * f
    const f3 = f2 * f
    // Huovilainen's fits: `fcr` corrects the cutoff tuning, `acr` corrects the feedback
    // amount so resonance stays constant as the cutoff moves.
    const fcr = 1.873 * f3 + 0.4955 * f2 - 0.649 * f + 0.9988
    const acr = -3.9364 * f2 + 1.8409 * f + 0.9968
    const tune = 1 - Math.exp(-2 * Math.PI * f * fcr)

    // 4.8, not the textbook 4. Four poles give exactly 180 degrees at the corner in
    // theory, but the tanh stages compress the loop gain, so 4 lands just shy of
    // self-oscillation. This was swept rather than guessed: at 4.4 the ring is weak
    // (RMS 0.10), at 5.5 it is louder but the oscillation pitch has drifted 4% flat of
    // the requested cutoff. 4.8 rings at RMS 0.13 and tracks within 3% from 300Hz to
    // 2.4kHz, and resonance 0.5 still decays to nothing. See `ladder.test.ts`.
    const k = 4.8 * (resonance < 0 ? 0 : resonance > 1 ? 1 : resonance) * acr

    for (let pass = 0; pass < 2; pass++) {
      // Gain compensation. A ladder's feedback is subtracted from its input, so the
      // passband quietly drains away as resonance rises — at full resonance the DC gain
      // of the raw topology is 1/(1+k), about a fifth, and a bassline with the knob up
      // would have no bass left in it. Feeding half the input back in alongside the
      // feedback restores most of that without flattening the resonant peak, which is
      // the effect you actually want to keep.
      const x = input - k * (this.feedback - 0.5 * input)

      // Each stage is a one-pole lowpass whose input and output are both squashed. The
      // difference of two tanhs, rather than a tanh of the difference, is the point:
      // it saturates the stage's own state, so the nonlinearity is inside the feedback
      // loop where it can limit the resonance rather than merely clipping the output.
      const tx = Math.tanh(x)
      this.s0 += tune * (tx - this.t0)
      this.t0 = Math.tanh(this.s0)
      this.s1 += tune * (this.t0 - this.t1)
      this.t1 = Math.tanh(this.s1)
      this.s2 += tune * (this.t1 - this.t2)
      this.t2 = Math.tanh(this.s2)
      this.s3 += tune * (this.t2 - this.t3)

      // Half-sample delay compensation. The feedback is the average of this stage-3
      // output and the previous one, which cancels the extra half sample the loop
      // introduces. Without it the resonant peak sits noticeably flat of the cutoff.
      this.feedback = (this.s3 + this.prev3) * 0.5
      this.prev3 = this.s3
      this.t3 = Math.tanh(this.s3)
    }

    return this.s3
  }
}
