// A morphing wavetable oscillator, shared.
//
// **The second oscillator family.** Everything pitched in this rack came out of `dsp/osc.ts` until now —
// the VCO and both of the Voice's oscillators are the same PolyBLEP saw, pulse and triangle — so every
// patch's timbre started in the same place, and the only way to leave it was a filter. `docs/REASON-GAP.md`
// records the comparison this answers: Reason shipped Subtractor *and* Malström, and the second one was not
// a better subtractive synth, it was a different way of making the raw sound.
//
// The method here is a **band-limited wavetable, generated rather than sampled**, and each half of that is
// a decision.
//
// **Generated**, because a sampled table is audio, and audio does not fit through the front door this
// project is built around. `patch-io.ts` and the Sampler both settle the same argument the same way: a
// patch travels in a URL, so it stores *which* break rather than several hundred kilobytes of one. A
// wavetable read from a file would have made this the first oscillator whose sound could not be shared,
// and a wavetable *baked into the bundle* would have been the same kilobytes with fewer options. Eight
// harmonic recipes are about forty lines of arithmetic and reproduce byte for byte on every machine.
//
// **Band-limited by construction, which is strictly better than the VCO.** PolyBLEP is an approximation
// and `vco.ts` is honest about its price — 25 to 52dB of alias suppression, and a third harmonic 3dB shy
// at 5kHz. A table built from a spectrum that stops below Nyquist has no aliasing to suppress: the
// harmonics that would fold simply were never synthesised. What it costs instead is memory and a lookup,
// which is the trade the whole technique is.
//
// Three things that are easy to get wrong and are why this file is longer than the recipes:
//
//   1. **One table cannot serve the keyboard.** A table holding 1024 harmonics is correct at 20Hz and
//      aliases catastrophically at 2kHz. So each waveform is built at eleven harmonic limits, halving each
//      time, and the oscillator picks by frequency. This is mipmapping, and it is not optional.
//
//   2. **Stepping between those levels is audible**, as a small lurch in brightness exactly where a swept
//      pitch crosses an octave. So adjacent levels are crossfaded — over the top half-octave of the
//      sharper one's *safe* range, never outside it. The naive crossfade blends in the sharper table as
//      the pitch rises, which is precisely backwards: it fades in the table that has started aliasing.
//      See `next` for the arithmetic and why the fade completes before the limit rather than at it.
//
//   3. **The bank is built once and shared**, because eight polyphonic voices building 262KB of tables
//      each is both the memory and the 27ms multiplied by eight. It is cached as an ordinary
//      property assigned to the constructor at run time rather than as a `static` field, which looks like
//      the same thing and is not: a static field is syntax a transpiler may lower to an assignment
//      *outside* the class body, and `worklet.ts` ships this class by `toString()` — anything the
//      transpiler moves out is anything that does not arrive. An assignment made inside the constructor
//      cannot be moved anywhere.
//
// This class is SELF-CONTAINED — no imports, no references to anything at module scope, and it never names
// itself. That last one is the rule from `worklet.ts` about minified class names, and it is the reason the
// cache is reached through `this.constructor` rather than through the identifier at the top of this file.

/** The shape of the cache hung on the constructor. A type, so it is erased and cannot be referenced. */
interface Owner {
  /** `[slot][level]` — eight waveforms, eleven harmonic limits each. */
  bank?: Float32Array[][]
  build(): Float32Array[][]
}

export class Wavetable {
  private phase = 0
  private readonly tables: Float32Array[][]

  /** The last phase increment and the mip level it resolved to. A held note asks the same question every
   *  sample, and this turns a `log2` per sample into a compare. Same trick as the VCO's `lastExponent`. */
  private lastStep = Number.NaN
  private lastLevel = 0
  private lastBlend = 0

  constructor() {
    const owner = this.constructor as unknown as Owner
    if (!owner.bank) owner.bank = owner.build()
    this.tables = owner.bank
  }

  /** Wind back to the top, so a retriggered note starts where the last one did. */
  reset(): void {
    this.phase = 0
  }

  /**
   * One sample.
   *
   * `dt` is the phase increment — frequency over sample rate — and is clamped by the caller exactly as the
   * VCO's is. `position` is 0 through 1 across the eight waveforms, crossfading between neighbours, and is
   * read per sample so a cable can sweep it at audio rate. `offset` is a phase offset in *cycles*: zero for
   * an ordinary oscillator, and the input to phase modulation when something is patched at it.
   */
  next(dt: number, position: number, offset: number): number {
    let step = dt
    if (!(step > 0)) step = 0
    else if (step > 0.5) step = 0.5

    this.phase += step
    if (this.phase >= 1) this.phase -= 1

    // Where in the bank, and between which two neighbours. Seven gaps between eight waveforms.
    let pos = position
    if (!(pos > 0)) pos = 0
    else if (pos > 1) pos = 1
    const scaled = pos * 7
    let slot = scaled | 0
    if (slot > 6) slot = 6
    const morph = scaled - slot

    // Which harmonic limit, and how far into the fade toward the next one down.
    //
    // Level k holds 1024 >> k harmonics, so its topmost harmonic sits exactly at Nyquist when
    // dt = 2^k / 2048 — that is, when log2(2048·dt) = k. Call that number the level's *limit* and the
    // whole selection falls out of it: level k is safe while log2(2048·dt) is at or below k.
    //
    // The fade therefore runs from k toward k+1 as the pitch approaches k's limit, and is complete when it
    // arrives. Doing it the other way — blending in level k as the pitch *falls* past the limit — reads as
    // the obvious direction and blends in a table that is aliasing at the moment it becomes audible.
    if (step !== this.lastStep) {
      this.lastStep = step
      // Clamping the LEVEL rather than the limit, and the difference is a real bug rather than a detail.
      // Below level 0's limit there is nothing sharper to reach for, and a limit clamped up to zero reads
      // as "level 0 is exactly at Nyquist, fade to level 1" — which would quietly halve the harmonics of
      // every bass note in the rack.
      let limit = step > 0 ? Math.log2(2048 * step) : -20
      if (limit > 10) limit = 10
      let sharp = Math.ceil(limit)
      if (sharp < 0) sharp = 0
      let blend = (limit - (sharp - 0.5)) * 2
      if (blend < 0) blend = 0
      else if (blend > 1) blend = 1
      this.lastLevel = sharp
      this.lastBlend = blend
    }
    const sharp = this.lastLevel
    const blend = this.lastBlend
    let dull = sharp + 1
    if (dull > 10) dull = 10

    // The phase to read at. `offset` is whatever a patch cable brought, so it can be enormous or negative
    // and the wrap has to survive both; a non-finite one is the only case worth spending a branch on,
    // because it would otherwise turn into an out-of-range index and read `undefined`.
    let t = this.phase + offset
    t -= Math.floor(t)
    if (!(t >= 0 && t < 1)) t = 0

    const lowSlot = this.tables[slot]
    const highSlot = this.tables[slot + 1]
    const low =
      this.read(lowSlot[sharp], t) * (1 - blend) + this.read(lowSlot[dull], t) * blend
    const high =
      this.read(highSlot[sharp], t) * (1 - blend) + this.read(highSlot[dull], t) * blend
    return low + (high - low) * morph
  }

  /** One linearly interpolated table read. Tables are four times longer than their harmonic count, which
   *  keeps interpolation error on the topmost harmonic — the quietest one — around a tenth of its own
   *  amplitude rather than half of it. */
  private read(table: Float32Array, t: number): number {
    const length = table.length
    const x = t * length
    let i = x | 0
    if (i >= length) i = length - 1
    let j = i + 1
    if (j >= length) j = 0
    const frac = x - i
    return table[i] + (table[j] - table[i]) * frac
  }

  /**
   * Build the whole bank: eight waveforms at eleven harmonic limits.
   *
   * **262KB, and 27ms the first time** — measured, and the second figure is the one that matters, because
   * the first call is the only call. Warm it settles to about 6ms, which is what a benchmark would report
   * and what nobody experiences. Twenty-seven milliseconds is roughly ten render quanta, so adding the
   * first Wavetable to a running patch costs a click. That is once per rack rather than once per voice —
   * eight polyphonic voices building their own would be eight times both numbers — and it is the same
   * trade the Looper already makes by preallocating thirty seconds of capture in its constructor.
   *
   * Static so the constructor can cache the result on the class; `this` inside a static method is the
   * class itself, which is how this reaches its siblings without naming them.
   */
  static build(): Float32Array[][] {
    const bank: Float32Array[][] = []
    for (let slot = 0; slot < 8; slot++) {
      // Sine and cosine amplitude for every harmonic up to the richest level's limit. Both, because a
      // pulse is a sawtooth minus a delayed sawtooth and the delay lands as a cosine term — a sine-only
      // series with the same magnitudes has the timbre and not the shape, and the shape is what the peak
      // normalisation below is measuring.
      const sine = new Float64Array(1025)
      const cosine = new Float64Array(1025)
      for (let n = 1; n <= 1024; n++) {
        const pair = this.harmonic(slot, n)
        sine[n] = pair[0]
        cosine[n] = pair[1]
      }

      const tables: Float32Array[] = []
      for (let level = 0; level <= 10; level++) {
        const harmonics = 1024 >> level
        let length = harmonics * 4
        if (length < 64) length = 64
        tables.push(this.synth(sine, cosine, harmonics, length))
      }

      // One normalisation for the whole waveform, taken from its fullest table, so that changing octave
      // does not change level. Normalising each level to its own peak would do exactly that: a table that
      // has lost its top harmonics has a lower peak, and correcting for it would make the same note louder
      // the higher you played it.
      let peak = 0
      const richest = tables[0]
      for (let i = 0; i < richest.length; i++) {
        const magnitude = Math.abs(richest[i])
        if (magnitude > peak) peak = magnitude
      }
      if (peak > 0) {
        for (const table of tables) {
          for (let i = 0; i < table.length; i++) table[i] /= peak
        }
      }

      bank.push(tables)
    }
    return bank
  }

  /**
   * One waveform's spectrum, as `[sine, cosine]` amplitude for harmonic `n`.
   *
   * The order is the morph, and it is meant to be swept rather than indexed: sine at one end, a thin pulse
   * at the other, and the useful middle where a patch actually lives.
   *
   *   0 Sine · 1 Triangle · 2 Organ · 3 Square · 4 Saw · 5 Vocal · 6 Pulse 25% · 7 Pulse 12%
   *
   * Every recipe rolls off at least as fast as 1/n. That is a constraint rather than a coincidence: a
   * brighter spectrum than that peaks far above its own fundamental, so peak normalisation would leave it
   * dramatically quieter than its neighbours and the morph knob would double as a volume control.
   */
  static harmonic(slot: number, n: number): [number, number] {
    if (slot === 0) return [n === 1 ? 1 : 0, 0]

    if (slot === 1) {
      // Triangle: odd harmonics at 1/n², alternating in sign. The 1/n² is what makes it the dark end of
      // the useful range rather than merely a quieter square.
      if ((n & 1) === 0) return [0, 0]
      const sign = ((n - 1) / 2) % 2 === 0 ? 1 : -1
      return [sign / (n * n), 0]
    }

    if (slot === 2) {
      // Organ: a drawbar stack — the fundamental and its octaves and nothing between them. Sparse, so it
      // stays hollow rather than bright, and it is the one waveform here that no analogue oscillator makes.
      if ((n & (n - 1)) !== 0) return [0, 0]
      return [1 / Math.sqrt(n), 0]
    }

    if (slot === 3) return [(n & 1) === 1 ? 1 / n : 0, 0]

    if (slot === 4) return [1 / n, 0]

    if (slot === 5) {
      // Vocal: a sawtooth with two resonant peaks where a vowel's formants sit. Still 1/n underneath, so
      // it obeys the rolloff rule while sounding nothing like the saw it is built from.
      const first = Math.exp(-(((n - 7) / 2.5) * ((n - 7) / 2.5)))
      const second = Math.exp(-(((n - 14) / 4) * ((n - 14) / 4)))
      return [(1 + 3 * first + 2 * second) / n, 0]
    }

    // The two pulses, as a sawtooth minus the same sawtooth delayed by the duty cycle. Deriving them this
    // way rather than writing the magnitudes down is what makes the duty exact and the DC term absent —
    // there is no n = 0 in the difference, so neither pulse carries an offset into the patch.
    const duty = slot === 6 ? 0.25 : 0.12
    const angle = 2 * Math.PI * n * duty
    return [(1 - Math.cos(angle)) / n, Math.sin(angle) / n]
  }

  /** One table: the first `harmonics` of a spectrum, rendered into `length` samples by an inverse FFT. */
  static synth(
    sine: Float64Array,
    cosine: Float64Array,
    harmonics: number,
    length: number,
  ): Float32Array {
    const re = new Float64Array(length)
    const im = new Float64Array(length)
    const top = Math.min(harmonics, (length >> 1) - 1)

    // A real signal's spectrum is conjugate-symmetric, so each harmonic writes two bins. With the unscaled
    // transform below, a sine of amplitude a is `im[n] = -a/2, im[N-n] = +a/2` and a cosine is
    // `re[n] = re[N-n] = c/2`.
    for (let n = 1; n <= top; n++) {
      const s = sine[n]
      const c = cosine[n]
      if (s === 0 && c === 0) continue
      re[n] += c / 2
      re[length - n] += c / 2
      im[n] -= s / 2
      im[length - n] += s / 2
    }

    this.transform(re, im)

    const table = new Float32Array(length)
    for (let i = 0; i < length; i++) table[i] = re[i]
    return table
  }

  /**
   * An in-place radix-2 inverse FFT, unscaled: `x[i] = Σ X[k]·e^{+j2πki/N}`.
   *
   * Here rather than a direct sum over harmonics because the direct sum is quadratic and this is not: the
   * richest table is 4096 samples of 1024 harmonics, which is four million multiply-adds one way and about
   * fifty thousand the other. That is the difference between a device you can add mid-performance and a
   * device that drops twenty blocks when you do.
   *
   * The twiddle loop is ordered with `k` outermost so that each cosine and sine is computed once per stage
   * rather than once per butterfly, and computed rather than accumulated — a recurrence would drift over
   * twelve stages, and this table is what every harmonic-accuracy number in the tests is measured against.
   */
  static transform(re: Float64Array, im: Float64Array): void {
    const n = re.length

    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) {
        let swap = re[i]
        re[i] = re[j]
        re[j] = swap
        swap = im[i]
        im[i] = im[j]
        im[j] = swap
      }
    }

    for (let span = 2; span <= n; span <<= 1) {
      const half = span >> 1
      const step = (2 * Math.PI) / span
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k)
        const wi = Math.sin(step * k)
        for (let base = 0; base < n; base += span) {
          const a = base + k
          const b = a + half
          const vr = re[b] * wr - im[b] * wi
          const vi = re[b] * wi + im[b] * wr
          re[b] = re[a] - vr
          im[b] = im[a] - vi
          re[a] += vr
          im[a] += vi
        }
      }
    }
  }
}
