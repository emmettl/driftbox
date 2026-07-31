import type { ModuleDef, Processor } from '../types.js'

// An envelope. Attack, decay, sustain, release, driven by a gate.
//
// The shape of each stage is a decision, and the one that matters is what a *time* knob means for
// a curve that is asymptotic. An exponential decay never actually arrives, so "decay: 200ms" has
// to be defined against something. Here it is the standard convention: the stage covers 99% of the
// distance to its target in the time on the knob. That makes every time knob measurable —
// `adsr.test.ts` checks all three against a stopwatch — and it is close enough to how an RC
// network behaves that it sounds like an envelope rather than like a ramp.
//
// The attack is LINEAR, and that is not the same choice. An exponential attack that only gets 99%
// of the way to full scale never reaches the peak, so a percussive patch loses its transient and
// a short attack sounds soft. Linear arrives exactly on time, at exactly 1.0, and an analogue
// attack driven by a current source is close to linear anyway.
//
// A rising gate starts the attack **from wherever the envelope currently is** rather than from
// zero. Retriggering during a release therefore ramps up from the level it had got to, which is
// what stops a fast repeated note from clicking on every repeat.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class AdsrProcessor implements Processor {
  private readonly sampleRate: number

  /** 0 idle, 1 attack, 2 decay, 3 sustain, 4 release. */
  private stage = 0
  private value = 0
  private lastGate = 0
  private lastTrig = 0

  private lastAttack = Number.NaN
  private attackStep = 1
  private lastDecay = Number.NaN
  private decayCoef = 0
  private lastRelease = Number.NaN
  private releaseCoef = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const gateIn = inlets[0]
    const trigIn = inlets[1]
    const out = outlets[0]
    const attack = params[0]
    const decay = params[1]
    const sustain = params[2]
    const release = params[3]

    for (let i = 0; i < frames; i++) {
      // 0.5 rather than 0, so an audio-rate signal patched to a gate inlet does not retrigger on
      // its own noise floor.
      const gate = gateIn[i] >= 0.5 ? 1 : 0
      const trig = trigIn[i] >= 0.5 ? 1 : 0

      if ((gate === 1 && this.lastGate === 0) || (trig === 1 && this.lastTrig === 0)) {
        this.stage = 1
      } else if (gate === 0 && this.lastGate === 1) {
        this.stage = 4
      }
      this.lastGate = gate
      this.lastTrig = trig

      if (this.stage === 1) {
        if (attack[i] !== this.lastAttack) {
          this.lastAttack = attack[i]
          // Never zero samples: a divide by zero here is an Infinity that becomes the envelope.
          this.attackStep = 1 / Math.max(1, attack[i] * this.sampleRate)
        }
        this.value += this.attackStep
        if (this.value >= 1) {
          this.value = 1
          this.stage = 2
        }
      } else if (this.stage === 2) {
        if (decay[i] !== this.lastDecay) {
          this.lastDecay = decay[i]
          this.decayCoef = Math.pow(0.01, 1 / Math.max(1, decay[i] * this.sampleRate))
        }
        const target = sustain[i]
        this.value = target + (this.value - target) * this.decayCoef
        // Close enough to sustain that nothing downstream could tell, and staying in the decay
        // branch forever would mean the sustain knob stopped taking effect once a note settled.
        if (Math.abs(this.value - target) < 1e-5) {
          this.value = target
          this.stage = 3
        }
      } else if (this.stage === 3) {
        this.value = sustain[i]
      } else if (this.stage === 4) {
        if (release[i] !== this.lastRelease) {
          this.lastRelease = release[i]
          this.releaseCoef = Math.pow(0.01, 1 / Math.max(1, release[i] * this.sampleRate))
        }
        this.value *= this.releaseCoef
        if (this.value < 1e-5) {
          this.value = 0
          this.stage = 0
        }
      } else {
        this.value = 0
      }

      out[i] = this.value
    }
  }
}

export const ADSR_MODULE: ModuleDef = {
  type: 'adsr',
  version: 1,
  name: 'ADSR',
  group: 'Modulation',
  blurb:
    'Attack, decay, sustain and release from a gate. The shape a note has — into a VCA it is what makes the note at all.',
  logo: {
    paths: [
      'M4 33L16 7l12 12h17l15 14',
      'M4 36h56',
      'M16 7v29M28 19v17M45 19v17',
    ],
  },
  inlets: [
    { id: 'gate', name: 'Gate' },
    // A separate trigger, so a sequencer can re-strike a note without the gate having to fall —
    // which is the difference between a tie and two notes at the same pitch.
    { id: 'trig', name: 'Trig' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    // Half a millisecond at the bottom: fast enough to be a click, which is sometimes the point.
    { id: 'attack', name: 'A', min: 0.0005, max: 10, default: 0.005 },
    { id: 'decay', name: 'D', min: 0.0005, max: 10, default: 0.2 },
    { id: 'sustain', name: 'S', min: 0, max: 1, default: 0.6 },
    { id: 'release', name: 'R', min: 0.0005, max: 10, default: 0.3 },
  ],
  processor: AdsrProcessor,
}
