import { secondsPerStep } from './timing.js'

// Two send effects: one delay, one reverb.
//
// Sends rather than inserts, and that is the whole design. An insert per voice would be
// eleven reverbs running at once for eleven drums, which is both wasteful and wrong —
// what makes a kit sound like it is in a room is that every voice is in the SAME room.
// One reverb fed from eleven knobs gives you that; eleven reverbs give you eleven rooms
// that happen to have similar settings.
//
// The reverb's impulse response is generated rather than recorded, for the same reason
// nothing here is sampled: a knob that changes the size of the room is worth more than a
// fixed recording of one room, and it keeps the whole thing to a few lines of code.

/** Global settings for both effects. Everything 0..1, like every other knob. */
export interface FxParams {
  /** Delay length, snapped to musical divisions — see `DELAY_DIVISIONS`. */
  delayTime: number
  delayFeedback: number
  /** How dark the repeats get. Down is darker. */
  delayTone: number
  reverbSize: number
  /** How fast the tail loses its high end. Up is damper, and more like a real room. */
  reverbDamping: number
}

export const DEFAULT_FX: FxParams = {
  // 0.25 lands on 3 — the dotted eighth. See DELAY_DIVISIONS.
  delayTime: 0.25,
  delayFeedback: 0.42,
  delayTone: 0.5,
  reverbSize: 0.45,
  reverbDamping: 0.55,
}

/** How much of one voice goes to each effect. */
export interface SendLevels {
  delay: number
  reverb: number
}

export const DEFAULT_SENDS: SendLevels = { delay: 0, reverb: 0 }

/**
 * Delay lengths, in sixteenth-note steps.
 *
 * Snapped, not continuous. A delay whose length is not a division of the bar smears the
 * groove instead of reinforcing it, and finding the right value by ear on a continuous
 * knob is a job nobody wants. 3 — the dotted eighth — is the default because it lands
 * its repeats between the beats rather than on them, which is why it is the one every
 * record uses.
 */
export const DELAY_DIVISIONS = [2, 3, 4, 6, 8] as const

export function delayDivision(knob: number): number {
  const index = Math.round(Math.max(0, Math.min(1, knob)) * (DELAY_DIVISIONS.length - 1))
  return DELAY_DIVISIONS[index]
}

/**
 * A generated impulse response: noise under a decaying envelope, with the high end
 * rolled off progressively along the tail.
 *
 * That last part is what makes it sound like a room rather than like noise fading out.
 * In anything physical the high frequencies are absorbed first — by the air, by every
 * surface they bounce off — so the tail gets darker as it decays. A tail with a flat
 * spectrum reads as an effect; one that darkens reads as a space.
 */
export function impulseResponse(
  ctx: BaseAudioContext,
  seconds: number,
  damping: number,
): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    // Independent noise per channel, which is what makes the result wide. Copying one
    // channel to the other would give a reverb that collapses to mono.
    let filtered = 0
    for (let i = 0; i < length; i++) {
      const t = i / length
      // A one-pole lowpass whose corner closes as the tail decays.
      const coefficient = Math.max(0.015, (1 - damping) * (1 - t) + 0.015)
      filtered += coefficient * (Math.random() * 2 - 1 - filtered)
      // Exponential-ish decay. The power is what makes the tail taper rather than stop.
      data[i] = filtered * Math.pow(1 - t, 2.2)
    }
  }

  return buffer
}

/**
 * The two send buses, and everything that feeds them.
 *
 * Owns audio nodes, so it lives on the same side of the line as `render.ts` — no
 * musical decisions in here beyond the ranges the knobs map onto.
 */
/** How long the wet path takes to fade out before its nodes are replaced, and to come
 *  back afterwards. Long enough not to click, short enough to be gone before the first
 *  hit of the new song — the transport starts with more headroom than this. */
const FLUSH_SECONDS = 0.05

export class Sends {
  /** Where a voice's send gain connects. */
  readonly delayInput: GainNode
  readonly reverbInput: GainNode

  private readonly ctx: BaseAudioContext
  /** Everything wet passes through here, so the tails can be faded as a pair. */
  private readonly tail: GainNode
  private delay: DelayNode
  private feedback: GainNode
  private damp: BiquadFilterNode
  private convolver: ConvolverNode
  private fx: FxParams = DEFAULT_FX
  private bpm = 120

  /** What the impulse response was last built for. Regenerating it means allocating and
   *  filling seconds of stereo audio, which is not something to do on every frame of a
   *  knob drag. */
  private builtFor = -1

  constructor(ctx: BaseAudioContext, output: AudioNode) {
    this.ctx = ctx

    this.delayInput = ctx.createGain()
    this.reverbInput = ctx.createGain()

    this.tail = ctx.createGain()
    this.tail.connect(output)

    // Maximum delay is generous — 2 seconds covers eight steps at any tempo the
    // transport allows. It costs a buffer, not CPU.
    this.delay = ctx.createDelay(2)
    this.feedback = ctx.createGain()
    this.damp = ctx.createBiquadFilter()
    this.damp.type = 'lowpass'

    // The filter is INSIDE the feedback loop, so each repeat is darker than the one
    // before it. Outside the loop it would darken every repeat by the same amount,
    // which sounds like a tone control rather than like distance.
    this.delayInput.connect(this.delay)
    this.delay.connect(this.damp)
    this.damp.connect(this.feedback)
    this.feedback.connect(this.delay)
    this.delay.connect(this.tail)

    this.convolver = ctx.createConvolver()
    this.reverbInput.connect(this.convolver)
    this.convolver.connect(this.tail)

    this.update(DEFAULT_FX, 120)
  }

  /**
   * Throw away everything still ringing.
   *
   * For changing song, where the previous track's reverb hanging over the first bar of the
   * next one is just wrong — and increasingly wrong the bigger the room, which is why it
   * only became obvious once a song with a three-second tail was added.
   *
   * Gating the wet path is not enough and this is the part worth knowing: a convolver goes
   * on emitting its impulse for the full length of the room however quiet you make its
   * output, so unmuting a moment later brings the old tail straight back where it left
   * off. A delay is worse — the line still holds whatever went into it and the feedback
   * loop keeps handing it round. The only way to genuinely have nothing left is to fade
   * the pair out and then replace the nodes.
   *
   * Not called on stop. A record that stops should be allowed to ring out.
   */
  silence(): void {
    const now = this.ctx.currentTime
    // Fade rather than cut. A reverb tail chopped mid-flight clicks, and the click is
    // louder than the tail it was removing.
    this.tail.gain.cancelScheduledValues(now)
    this.tail.gain.setValueAtTime(this.tail.gain.value, now)
    this.tail.gain.linearRampToValueAtTime(0, now + FLUSH_SECONDS)

    const swap = () => {
      this.delayInput.disconnect()
      this.reverbInput.disconnect()
      this.delay.disconnect()
      this.damp.disconnect()
      this.feedback.disconnect()
      this.convolver.disconnect()

      this.delay = this.ctx.createDelay(2)
      this.feedback = this.ctx.createGain()
      this.damp = this.ctx.createBiquadFilter()
      this.damp.type = 'lowpass'
      this.delayInput.connect(this.delay)
      this.delay.connect(this.damp)
      this.damp.connect(this.feedback)
      this.feedback.connect(this.delay)
      this.delay.connect(this.tail)

      this.convolver = this.ctx.createConvolver()
      this.reverbInput.connect(this.convolver)
      this.convolver.connect(this.tail)

      // The new nodes come up with no settings at all, so the song's own reverb size and
      // delay time have to be put back — and `builtFor` reset, or the impulse response is
      // skipped as already-current and the room is silent.
      this.builtFor = -1
      this.update(this.fx, this.bpm)

      const at = this.ctx.currentTime
      this.tail.gain.cancelScheduledValues(at)
      this.tail.gain.setValueAtTime(0, at)
      this.tail.gain.linearRampToValueAtTime(1, at + FLUSH_SECONDS)
    }

    // After the fade, not during it. An offline render has no timers worth waiting on and
    // never needs this anyway, so it swaps straight away.
    if (typeof setTimeout === 'function') setTimeout(swap, FLUSH_SECONDS * 1000 + 10)
    else swap()
  }

  /** Apply the global settings. Safe to call as often as a knob moves. */
  update(fx: FxParams, bpm: number): void {
    // Kept, so the replacement nodes built by `silence` can be given the same settings.
    this.fx = fx
    this.bpm = bpm
    const now = this.ctx.currentTime

    const seconds = secondsPerStep(bpm) * delayDivision(fx.delayTime)
    // Ramped rather than set. Jumping a delay line's length re-reads the buffer from a
    // different place and clicks; a short ramp pitch-bends the tail instead, which is
    // the sound a tape delay makes and nobody minds.
    this.delay.delayTime.setTargetAtTime(Math.min(2, seconds), now, 0.05)

    // Stops well short of 1. At unity the loop never decays and the send bus climbs
    // until it clips — a runaway that is only obvious once it is far too loud.
    //
    // 0.85 rather than something closer, because the cap has to hold up under the worst
    // case rather than a reasonable one. Measured with every voice sending at full and
    // the feedback knob at maximum: at 0.92 the output peaked at 1.109 with 33 clipped
    // samples and was still over full scale a second after the last hit. At 0.85 the
    // same test peaks under 1 and decays. A knob that can be turned all the way up
    // should not be able to break the output.
    this.feedback.gain.setTargetAtTime(Math.min(0.85, fx.delayFeedback * 0.85), now, 0.02)
    this.damp.frequency.setTargetAtTime(600 * Math.pow(16, fx.delayTone), now, 0.02)

    // Only rebuild the room when its shape actually changed, and only at a resolution a
    // knob can distinguish — otherwise a drag allocates a new impulse response per frame.
    const shape = Math.round(fx.reverbSize * 24) * 32 + Math.round(fx.reverbDamping * 24)
    if (shape !== this.builtFor) {
      this.builtFor = shape
      this.convolver.buffer = impulseResponse(
        this.ctx,
        0.3 + fx.reverbSize * 3.5,
        fx.reverbDamping,
      )
    }
  }

  dispose(): void {
    this.tail.disconnect()
    this.delayInput.disconnect()
    this.reverbInput.disconnect()
    this.delay.disconnect()
    this.damp.disconnect()
    this.feedback.disconnect()
    this.convolver.disconnect()
  }
}
