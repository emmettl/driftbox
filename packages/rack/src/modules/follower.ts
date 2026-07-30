import type { ModuleDef, Processor } from '../types.js'

// An envelope follower: audio in, its own shape back out as CV.
//
// Reason put this on the Pulveriser and it is the single most useful CV source that is not an LFO or an
// envelope, because it is the only one that comes from **something you can hear**. An ADSR makes the shape
// you asked for; a follower makes the shape the break is already doing, so a filter opening on a kick is one
// cable rather than a sequencer lane you have to keep in sync with the drums by hand.
//
// **The rack already had this arithmetic and kept it to itself.** `compressor.ts` follows an envelope to
// decide how much to duck by, and nothing else can see it — which meant sidechaining was a Compressor with
// its sidechain patched, and *only* that. Exposing the follower as a module turns one hardcoded routing into
// a signal: duck a reverb, open a filter, drive a VCA, trigger a sequencer.
//
// **Separate attack and release, both in the 99%-in-the-stated-time convention** the ADSR, the Seq and the
// Compressor all use — so a knob marked in seconds means the same thing everywhere in the rack. A single
// coefficient would make a fast follower also a fast releaser, which is the sound of everything breathing in
// and out at once.
//
// **It rectifies rather than squaring.** A peak follower is what you want for triggering and for ducking, and
// it is what the Compressor already uses; an RMS follower reads about 3dB lower on a sine and answers a
// different question (how loud does this *sound*) that nothing here is asking.
//
// **Two outlets, because there are two questions.** `env` is the contour, for anything continuous. `gate` is
// whether it is above a threshold, which is a comparator — and a comparator on a follower is how you get a
// trigger *out of audio*, so a break can clock a sequencer. Both are computed anyway; a mode knob would be
// spending a control to withhold one, which is the argument `svf.ts` and `noise.ts` already make.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class FollowerProcessor implements Processor {
  private readonly sampleRate: number

  private envelope = 0
  /** Held across blocks, or the gate would chatter at the block rate on a signal sitting on the threshold. */
  private open = false

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
    const envOut = outlets[0]
    const gateOut = outlets[1]
    const attackParam = params[0]
    const releaseParam = params[1]
    const gainParam = params[2]
    const thresholdParam = params[3]

    for (let i = 0; i < frames; i++) {
      const attack = attackParam[i]
      if (attack !== this.lastAttack) {
        this.lastAttack = attack
        // 99% of the way there in the stated time — the convention every other timed knob in the rack uses.
        this.attackCoefficient =
          attack <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, attack * this.sampleRate))
      }
      const release = releaseParam[i]
      if (release !== this.lastRelease) {
        this.lastRelease = release
        this.releaseCoefficient =
          release <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, release * this.sampleRate))
      }

      const sample = input[i]
      const peak = sample < 0 ? -sample : sample
      const coefficient = peak > this.envelope ? this.attackCoefficient : this.releaseCoefficient
      this.envelope = peak + (this.envelope - peak) * coefficient

      const value = this.envelope * gainParam[i]
      // Clamped at the outlet, not in the state. Clamping the running envelope would make the release start
      // from the ceiling rather than from where the signal actually was, so a loud transient would take the
      // same time to fall away as a quiet one no matter how much gain was applied.
      envOut[i] = value > 4 ? 4 : value

      // Hysteresis, and it is not a nicety: a follower's output is smooth but a signal parked *on* the
      // threshold still crosses it every few samples, and a gate doing that is not a trigger, it is a buzz at
      // whatever rate the noise happens to have. Closing at four fifths of the opening level gives it
      // somewhere to sit. The ratio rather than a fixed offset, so it behaves the same at any threshold.
      const threshold = thresholdParam[i]
      if (this.open) {
        if (value < threshold * 0.8) this.open = false
      } else if (value >= threshold) {
        this.open = true
      }
      gateOut[i] = this.open ? 1 : 0
    }
  }
}

export const FOLLOWER_MODULE: ModuleDef = {
  type: 'follower',
  version: 1,
  name: 'Follower',
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [
    { id: 'env', name: 'Env' },
    { id: 'gate', name: 'Gate' },
  ],
  params: [
    // Fast by default. A follower is most often reached for to catch a kick, and a slow attack rounds off
    // exactly the transient you were following.
    { id: 'attack', name: 'Attack', min: 0.0005, max: 1, default: 0.005 },
    { id: 'release', name: 'Release', min: 0.0005, max: 2, default: 0.15 },
    // Up to 8, because the thing you most want to drive is a filter's cutoff inlet, which is in octaves —
    // and a break peaking at 0.5 would otherwise only ever open it by half an octave.
    { id: 'gain', name: 'Gain', min: 0, max: 8, default: 1 },
    { id: 'threshold', name: 'Thresh', min: 0, max: 2, default: 0.2 },
  ],
  processor: FollowerProcessor,
}
