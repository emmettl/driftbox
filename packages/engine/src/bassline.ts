import type { BassNote } from './bass.js'
import { LADDER_PROCESSOR, loadLadder } from './dsp/worklet.js'

// One 303's audio graph. The counterpart to `render.ts`: the only other file in the
// engine that touches an AudioContext, and just as deliberately dumb — it reads a
// BassNote and schedules exactly what it says.
//
// It is a different shape from the drum renderer because a 303 is a different kind of
// instrument. A drum hit is a graph built for one sound and thrown away; a 303 is ONE
// oscillator running continuously through ONE filter, with notes scheduled onto it. It
// has to be that way, because slide is a glide between two notes on a single oscillator
// whose envelope never restarted. Build a fresh node per note and slide is impossible —
// the best you can do is a crossfade, which sounds like two notes rather than one note
// moving.

/** Exponential ramps refuse to touch zero. Everything decays to this instead. */
const SILENCE = 1e-4

/** Fixed VCA envelope. On the hardware the DECAY knob is wired to the FILTER envelope
 *  only; the amplitude envelope is a fixed fast attack and release. Keeping that split
 *  is why turning decay down makes a line sound clipped rather than merely quieter. */
const ATTACK = 0.003
const RELEASE = 0.012

export class Bassline {
  readonly output: GainNode

  private readonly ctx: BaseAudioContext
  private readonly osc: OscillatorNode
  private readonly vca: GainNode
  private readonly cutoff: AudioParam
  private readonly resonance: AudioParam

  /** What the oscillator was last told to do, and when. Web Audio has no way to ask a
   *  param what it will be at a future time, and every note here is scheduled ahead of
   *  the clock — so a slide's starting pitch and level have to be remembered rather
   *  than read back. */
  private lastFrequency: number
  private lastGain = 0
  /** When the last scheduled note stops holding. A note that arrives before this one is
   *  a slide landing on a note that is still sounding, so the VCA has to pick up from
   *  the level it is actually at rather than from silence. */
  private heldUntil = 0
  private wave: OscillatorType = 'sawtooth'

  /** What a resonance of 1 means to whichever filter is in the chain: 1 for the ladder,
   *  which takes 0..1 directly, or a biquad's Q. */
  private readonly resonanceScale: number

  private constructor(
    ctx: BaseAudioContext,
    filter: AudioNode,
    cutoff: AudioParam,
    resonance: AudioParam,
    resonanceScale: number,
  ) {
    this.ctx = ctx
    this.cutoff = cutoff
    this.resonance = resonance
    this.resonanceScale = resonanceScale

    this.osc = ctx.createOscillator()
    this.osc.type = this.wave
    this.lastFrequency = 110
    this.osc.frequency.setValueAtTime(this.lastFrequency, 0)

    this.vca = ctx.createGain()
    this.vca.gain.setValueAtTime(0, 0)

    this.output = ctx.createGain()
    this.output.gain.setValueAtTime(1, 0)

    // Oscillator into the ladder, ladder into the VCA. Filter BEFORE amplifier, as on
    // the machine — the other way round and the filter would be sweeping a signal that
    // has already been shaped, so the resonant peak would duck with the envelope
    // instead of ringing through the gaps between notes.
    this.osc.connect(filter)
    filter.connect(this.vca)
    this.vca.connect(this.output)

    this.osc.start()
  }

  /**
   * Build a 303, with a real ladder if this context can run one.
   *
   * The fallback is a single BiquadFilterNode: two poles instead of four, linear, with
   * nothing saturating inside the feedback loop and so no self-oscillation at all. It
   * is a filter sweep rather than a squelch, and it is meant only to keep an old
   * browser or a strict Content-Security-Policy from getting silence. Cascading two
   * biquads would buy the four poles but not the character, and cannot be done cleanly
   * anyway — an AudioParam cannot drive another AudioParam, so the two stages would
   * need their sweeps scheduled twice and kept in step by hand.
   *
   * If a bassline ever sounds tame, check `usingLadder` before blaming the patch.
   */
  static async create(
    ctx: BaseAudioContext,
    options: { useLadder?: boolean } = {},
  ): Promise<{ bassline: Bassline; usingLadder: boolean }> {
    const usingLadder = options.useLadder !== false && await loadLadder(ctx)

    if (usingLadder) {
      const node = new AudioWorkletNode(ctx, LADDER_PROCESSOR)
      return {
        bassline: new Bassline(
          ctx,
          node,
          node.parameters.get('frequency')!,
          node.parameters.get('resonance')!,
          1,
        ),
        usingLadder,
      }
    }

    const biquad = ctx.createBiquadFilter()
    biquad.type = 'lowpass'
    // A Q of 18 is about as far as a biquad goes before the peak alone clips the
    // output, and it is still nowhere near ringing on its own.
    return {
      bassline: new Bassline(ctx, biquad, biquad.frequency, biquad.Q, 18),
      usingLadder,
    }
  }

  /** Schedule one note at `time` on the audio clock. */
  play(note: BassNote, time: number): void {
    if (note.wave !== this.wave) {
      // Not schedulable — an OscillatorNode's type is a plain property. It only changes
      // when somebody turns the knob, and applying that immediately is what you want
      // from a knob anyway, so this is left as an eager change rather than worked
      // around with a second oscillator and a crossfade.
      this.wave = note.wave
      this.osc.type = note.wave
    }

    const frequency = this.osc.frequency
    frequency.cancelScheduledValues(time)
    if (note.glide > 0) {
      // Exponential, not linear: a glide that sounds even has to move by ratio, because
      // that is how pitch is heard. A linear ramp between two notes rushes the bottom
      // of the interval and crawls the top.
      frequency.setValueAtTime(note.glideFrom ?? this.lastFrequency, time)
      frequency.exponentialRampToValueAtTime(note.frequency, time + note.glide)
    } else {
      frequency.setValueAtTime(note.frequency, time)
    }
    this.lastFrequency = note.frequency

    this.resonance.cancelScheduledValues(time)
    this.resonance.setValueAtTime(note.resonance * this.resonanceScale, time)

    if (note.retrigger) {
      // The filter envelope only restarts on a note that was actually struck. A slid-in
      // note inherits whatever the sweep had got to, which is exactly why a run of
      // slides gets progressively duller rather than re-opening on every step.
      this.cutoff.cancelScheduledValues(time)
      this.cutoff.setValueAtTime(note.filter.peak, time)
      this.cutoff.exponentialRampToValueAtTime(note.filter.base, time + note.filter.decay)
    }

    const gain = this.vca.gain
    gain.cancelScheduledValues(time)
    // Where the VCA actually is at `time`: still holding the previous note if that note
    // was sliding, otherwise long since released. Getting this wrong is a click on
    // every note, in one direction or the other.
    gain.setValueAtTime(time < this.heldUntil ? Math.max(this.lastGain, SILENCE) : SILENCE, time)
    // A struck note gets the fixed attack. A slid-in note gets no attack at all — its
    // level moves over the same time as its pitch, so an accented note landing mid-slide
    // swells into place rather than stepping.
    gain.linearRampToValueAtTime(
      note.gain,
      time + (note.retrigger ? ATTACK : Math.min(note.glide, note.gate)),
    )
    gain.setValueAtTime(note.gain, time + note.gate)
    gain.exponentialRampToValueAtTime(SILENCE, time + note.gate + RELEASE)

    this.lastGain = note.gain
    this.heldUntil = time + note.gate
  }

  /** Cut the line off — stopping the transport should not leave a note hanging. */
  silence(time = this.ctx.currentTime): void {
    const gain = this.vca.gain
    gain.cancelScheduledValues(time)
    gain.setValueAtTime(time < this.heldUntil ? Math.max(this.lastGain, SILENCE) : SILENCE, time)
    gain.exponentialRampToValueAtTime(SILENCE, time + 0.02)
    this.lastGain = 0
    this.heldUntil = 0
  }

  dispose(): void {
    try {
      this.osc.stop()
    } catch {
      // Already stopped; disposing twice is not an error worth propagating.
    }
    this.osc.disconnect()
    this.vca.disconnect()
    this.output.disconnect()
  }
}
