import type { ModuleDef, Processor } from '../types.js'

// A compressor, and in this rack it is a genre requirement rather than a utility.
//
// Drum and bass is glued together by compression. A chopped break and a bass playing the same octave fight
// for the same space, and what stops them is one of them ducking out of the way — which is also where the
// pumping that defines the sound comes from. Without this, `docs/DNB.md`'s phase C is a mix of two things
// that happen to be playing at once.
//
// **The sidechain inlet is the important one.** Fed from a kick, this is the duck that makes a bassline
// breathe; left unpatched it reads its own input and is an ordinary compressor. That is one inlet and a
// three-line branch, and it is the difference between a dynamics processor and an instrument.
//
// Peak detection rather than RMS. RMS is smoother and more like a real bus compressor, and it is the wrong
// choice here: the thing being tamed is a drum transient, and an RMS detector with a window long enough to
// be smooth is long enough to miss it entirely.
//
// The gain is computed in decibels and applied linearly, which is the only part with any real arithmetic in
// it. Doing the knee in dB is what makes a ratio knob mean the thing written on it.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class CompressorProcessor implements Processor {
  private readonly sampleRate: number
  /** The detector's follower, in linear amplitude. Persists across blocks or it retriggers every 2.9ms. */
  private envelope = 0
  /** Gain reduction in dB, smoothed. Positive means "reducing by this much". */
  private reduction = 0

  private lastAttack = Number.NaN
  private lastRelease = Number.NaN
  private attackCoefficient = 0
  private releaseCoefficient = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const sidechain = inlets[1]
    const out = outlets[0]
    // Gain reduction as a signal, so it can be seen and, more usefully, patched. A compressor's own ducking
    // driving a filter is a trick worth having, and it costs one outlet.
    const gainOut = outlets[1]

    const thresholdParam = params[0]
    const ratioParam = params[1]
    const attackParam = params[2]
    const releaseParam = params[3]
    const makeupParam = params[4]
    const kneeParam = params[5]

    // Whether anything is patched into the sidechain, decided once per block. A zero buffer is exactly what
    // an unconnected inlet reads — see the note on the zero buffer in `compile.ts` — so "is it all zero" is
    // the honest question, and asking it per sample would let a silent gap in a kick track flip the source
    // mid-block.
    let keyed = false
    for (let i = 0; i < frames; i++) {
      if (sidechain[i] !== 0) {
        keyed = true
        break
      }
    }

    for (let i = 0; i < frames; i++) {
      const attack = attackParam[i]
      const release = releaseParam[i]
      if (attack !== this.lastAttack) {
        this.lastAttack = attack
        // The same 99%-of-the-way-in-the-stated-time convention the envelope, the sequencer and the MIDI
        // module's glide use, so a knob marked in seconds means the same thing everywhere in the rack.
        this.attackCoefficient =
          attack <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, attack * this.sampleRate))
      }
      if (release !== this.lastRelease) {
        this.lastRelease = release
        this.releaseCoefficient =
          release <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, release * this.sampleRate))
      }

      const key = keyed ? sidechain[i] : input[i]
      const peak = key < 0 ? -key : key
      // Attack when the signal is rising, release when it is falling. A single coefficient would make a fast
      // compressor also a fast releaser, which is the sound of everything breathing in and out at once.
      const coefficient = peak > this.envelope ? this.attackCoefficient : this.releaseCoefficient
      this.envelope = peak + (this.envelope - peak) * coefficient

      // −100dB rather than −Infinity for silence: the arithmetic below stays finite, and nothing audible
      // lives down there anyway.
      const level = this.envelope > 1e-5 ? 20 * Math.log10(this.envelope) : -100
      const threshold = thresholdParam[i]
      const knee = kneeParam[i]
      let ratio = ratioParam[i]
      if (ratio < 1) ratio = 1

      const over = level - threshold
      let wanted = 0
      if (knee > 0 && over > -knee / 2 && over < knee / 2) {
        // A soft knee: the ratio comes in gradually across a band centred on the threshold, so a signal
        // hovering there does not switch the compressor on and off. Quadratic, which is the standard shape
        // and is continuous in both value and slope at the two edges.
        const into = over + knee / 2
        wanted = ((1 - 1 / ratio) * into * into) / (2 * knee)
      } else if (over > 0) {
        wanted = over * (1 - 1 / ratio)
      }

      // The reduction is smoothed rather than the envelope alone, so the knee's own movement is smooth too.
      // Downward immediately and upward eased: taking the larger value straight away is what makes the
      // attack the attack, and easing the recovery is what stops the release pumping at the block rate.
      this.reduction =
        wanted > this.reduction
          ? wanted
          : wanted + (this.reduction - wanted) * this.releaseCoefficient

      const gain = Math.pow(10, (makeupParam[i] - this.reduction) / 20)
      out[i] = input[i] * gain
      // Positive volts for positive reduction, scaled so a typical few dB is a usable CV rather than a
      // twitch: 20dB of reduction reads as 1.
      gainOut[i] = this.reduction / 20
    }
  }
}

export const COMPRESSOR_MODULE: ModuleDef = {
  type: 'compressor',
  version: 1,
  name: 'Comp',
  group: 'Shaping',
  blurb:
    'Ducks the loud parts so everything sits together. In drum and bass it is also where the pumping comes from.',
  inlets: [
    { id: 'in', name: 'In' },
    // Unpatched, the detector reads the input. Patched, this is the duck that makes a bassline breathe.
    { id: 'key', name: 'Key' },
  ],
  outlets: [
    { id: 'out', name: 'Out' },
    { id: 'gain', name: 'GR' },
  ],
  params: [
    // In dBFS, and a rack whose signals sit around ±1 has 0dB at unity — so −18 is a threshold that a
    // drum bus actually crosses rather than one that never fires.
    { id: 'threshold', name: 'Thresh', min: -60, max: 0, default: -18 },
    // 4:1 by default. Gentle enough to be usable on anything, firm enough to hear.
    { id: 'ratio', name: 'Ratio', min: 1, max: 20, default: 4 },
    // 5ms lets a kick's click through and catches the body, which is the classic starting point.
    { id: 'attack', name: 'Attack', min: 0.0001, max: 0.2, default: 0.005 },
    // 120ms is roughly a sixteenth at 174bpm, so a duck recovers just in time for the next one.
    { id: 'release', name: 'Release', min: 0.005, max: 1, default: 0.12 },
    { id: 'makeup', name: 'Makeup', min: 0, max: 24, default: 0 },
    { id: 'knee', name: 'Knee', min: 0, max: 24, default: 6 },
  ],
  processor: CompressorProcessor,
}
