import { Ladder } from '@driftbox/engine'
import { Osc } from '../dsp/osc.js'
import type { ModuleDef, Processor } from '../types.js'

// One device that makes a sound on its own. Reason's Subtractor, as a rack module.
//
// **This is the module the picker most obviously could not offer.** Every other source here is a piece:
// a VCO is not an instrument, and turning one into a playable voice costs a VCO, an ADSR, a VCA, a filter
// and four cables before a single note. `docs/REASON-GAP.md` lists it as a missing *device* rather than a
// missing sound, and gives the reason that matters:
//
// > Polyphony landed at step 5b and nothing yet takes advantage of eight voices being eight *different*
// > notes, because the patching cost is paid per voice-shaped patch rather than once.
//
// That is the whole argument. `poly: true` means the compiler builds eight of these and a MIDI module
// hands each one a different note — so a chord costs one cable, where before it cost eight copies of a
// five-module patch that had to be kept identical by hand.
//
// **It is not a chunk.** A chunk is a recipe — modules and cables inserted as an ordinary patch edit —
// and that is the right shape for a *sound* somebody should be able to take apart. It is the wrong shape
// for this: a chunk of five modules is still five modules per voice, so it does not buy the thing above.
// The patching cost has to disappear rather than be automated.
//
// **Two oscillators, one filter, two envelopes**, which is the smallest thing that is recognisably an
// instrument rather than a demonstration. Detune between the two is what makes it sound like a synth
// rather than like an oscillator; a filter envelope with its own decay is what makes a pluck a pluck.
// Everything past that — a second filter, an LFO, a mod matrix — is a knob somebody can patch instead,
// and every one of them would be paid for by every voice whether it was used or not.
//
// The oscillators come from `dsp/osc.ts` and the filter from the engine, both through `deps`. Neither is
// copied: an instrument whose two oscillators had drifted from the rack's own VCO would be a very
// annoying thing to debug, and `worklet.ts` explains why a serialised class cannot simply import them.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

interface OscLike {
  next(dt: number, shape: number, width: number): number
  reset(): void
}

interface FilterLike {
  process(input: number, cutoff: number, resonance: number): number
}

export class VoiceProcessor implements Processor {
  private readonly sampleRate: number
  private readonly a: OscLike
  private readonly b: OscLike
  private readonly filter: FilterLike

  /** Envelope state. Two of them: one for the amplifier, one for the filter. */
  private ampLevel = 0
  private ampStage = 0
  private filterLevel = 0
  private filterStage = 0
  private lastGate = 0
  /** Where the pitch is now, which is not where it was asked to be while a glide is running. */
  private glided = Number.NaN

  constructor(sampleRate: number, deps: Record<string, unknown>) {
    this.sampleRate = sampleRate
    // By string key and never by identifier — see the long note in `worklet.ts` about what a minifier
    // does to a class name it can see.
    const Oscillator = deps.Osc as new () => OscLike
    const Filter = deps.Ladder as new (sampleRate: number) => FilterLike
    this.a = new Oscillator()
    this.b = new Oscillator()
    this.filter = new Filter(sampleRate)
  }

  /**
   * One stage of an exponential envelope.
   *
   * The convention is the engine's and the ADSR module's: a time knob covers 99% of the distance to its
   * target in the time written on it. That is what makes a time knob measurable rather than decorative —
   * an exponential curve never actually arrives, so "decay: 200ms" has to be defined against something.
   */
  private rate(seconds: number): number {
    if (!(seconds > 0)) return 1
    return 1 - Math.exp(-4.605170185988091 / (seconds * this.sampleRate))
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const pitchIn = inlets[0]
    const gateIn = inlets[1]
    const cutoffIn = inlets[2]
    const out = outlets[0]
    const envOut = outlets[1]

    const tune = params[0]
    const shapeA = params[1]
    const shapeB = params[2]
    const detune = params[3]
    const mix = params[4]
    const width = params[5]
    const cutoffParam = params[6]
    const resonance = params[7]
    const envAmount = params[8]
    const keyTrack = params[9]
    const attack = params[10]
    const decay = params[11]
    const sustain = params[12]
    const release = params[13]
    const filterDecay = params[14]
    const glide = params[15]
    const level = params[16]

    for (let i = 0; i < frames; i++) {
      const gate = gateIn[i] >= 0.5 ? 1 : 0
      if (gate === 1 && this.lastGate === 0) {
        // A new note restarts both oscillators, so two at the same pitch begin in the phase relationship
        // the detune knob implies rather than wherever the last note happened to leave them. Reason's
        // oscillators have a phase-reset switch; here it is unconditional, because a voice that sounded
        // slightly different on every note would read as a bug rather than as analogue character.
        this.a.reset()
        this.b.reset()
        this.ampStage = 1
        this.filterStage = 1
      }
      this.lastGate = gate

      // Pitch, glided. Zero glide is an assignment rather than a filter, so the common case is exact
      // rather than approaching-exact: a one-pole that never quite arrives would leave every note a few
      // cents flat, which is audible against anything else in the patch.
      const wanted = tune[i] / 12 + pitchIn[i]
      if (!(this.glided === this.glided)) this.glided = wanted
      const glideTime = glide[i]
      if (glideTime > 0) this.glided += (wanted - this.glided) * this.rate(glideTime)
      else this.glided = wanted

      const carrier = 65.40639132514966 * Math.pow(2, this.glided)

      // The amplifier envelope. Stage 1 is attack; 0 is release, which is also where a voice starts.
      if (this.ampStage === 1) {
        this.ampLevel += (1 - this.ampLevel) * this.rate(attack[i])
        // Sustain is a level rather than a time, so the decay stage is folded in here: once attack has
        // arrived, the level falls toward sustain at the decay rate. One comparison rather than a third
        // stage flag, and it behaves identically.
        if (this.ampLevel > 0.99) {
          this.ampStage = 2
          this.ampLevel = 1
        }
      } else if (this.ampStage === 2) {
        this.ampLevel += (sustain[i] - this.ampLevel) * this.rate(decay[i])
        if (gate === 0) this.ampStage = 0
      } else {
        this.ampLevel += (0 - this.ampLevel) * this.rate(release[i])
      }
      if (this.ampStage !== 0 && gate === 0) this.ampStage = 0

      // The filter envelope: attack, then straight back to zero at its own decay. No sustain, because a
      // filter envelope that held open is what the cutoff knob already does — the whole point of a second
      // envelope is the shape a plucked note has.
      if (this.filterStage === 1) {
        this.filterLevel += (1 - this.filterLevel) * this.rate(attack[i])
        if (this.filterLevel > 0.99) this.filterStage = 0
      } else {
        this.filterLevel += (0 - this.filterLevel) * this.rate(filterDecay[i])
      }

      // Two oscillators. `detune` is in cents on the second one; `mix` crossfades between them, so the
      // knob at either end is one oscillator alone rather than one oscillator and a quiet ghost.
      let dtA = carrier / this.sampleRate
      if (dtA > 0.45) dtA = 0.45
      let dtB = (carrier * Math.pow(2, detune[i] / 1200)) / this.sampleRate
      if (dtB > 0.45) dtB = 0.45
      const blend = mix[i]
      const sample =
        this.a.next(dtA, shapeA[i] | 0, width[i]) * (1 - blend) +
        this.b.next(dtB, shapeB[i] | 0, width[i]) * blend

      // Cutoff: the knob, plus the envelope, plus key tracking, plus whatever is patched in. Key tracking
      // is what stops a filter setting that sings on a low note sounding closed two octaves up — the
      // single most common reason a patched voice feels wrong up the keyboard.
      let cutoff = cutoffParam[i]
      cutoff *= Math.pow(2, this.filterLevel * envAmount[i])
      cutoff *= Math.pow(2, this.glided * keyTrack[i])
      // In octaves, like the Ladder module's own cutoff inlet and like the VCO's pitch — so an envelope
      // patched here sweeps by a musical interval and the same depth sounds the same at both ends of the
      // knob. Hz would make one setting useless at the bottom of the range and inaudible at the top.
      if (cutoffIn[i] !== 0) cutoff *= Math.pow(2, cutoffIn[i])
      if (cutoff < 20) cutoff = 20
      else if (cutoff > 18000) cutoff = 18000

      const filtered = this.filter.process(sample, cutoff, resonance[i])
      out[i] = filtered * this.ampLevel * level[i]
      // The amplifier envelope, out. What makes the voice usable as more than a voice: patch it at a
      // delay send or another module's CV and the whole patch moves with the note.
      envOut[i] = this.ampLevel
    }
  }
}

export const VOICE_MODULE: ModuleDef = {
  type: 'voice',
  version: 1,
  name: 'Voice',
  group: 'Sources',
  blurb:
    'A whole synth in one module: two oscillators, a ladder filter and two envelopes. Patch a keyboard to it and play chords.',
  logo: {
    paths: ['M4 27l10-14v14l10-14v14', 'M28 20h10', 'M42 27c6 0 6-14 12-14', 'M4 32h52'],
  },
  inlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'cutoff', name: 'Cutoff' },
  ],
  outlets: [
    { id: 'out', name: 'Out' },
    { id: 'env', name: 'Env' },
  ],
  params: [
    { id: 'tune', name: 'Tune', min: -24, max: 24, default: 0 },
    { id: 'shapeA', name: 'Osc 1', min: 0, max: 2, default: 0, stepped: true, labels: ['Saw', 'Pulse', 'Tri'] },
    { id: 'shapeB', name: 'Osc 2', min: 0, max: 2, default: 0, stepped: true, labels: ['Saw', 'Pulse', 'Tri'] },
    // Cents, and ±50 rather than ±1200: this is a detune for thickness, not a second tuning knob. Seven
    // cents is the classic supersaw spread and sits comfortably inside it.
    { id: 'detune', name: 'Detune', min: -50, max: 50, default: 7 },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.5 },
    { id: 'width', name: 'Width', min: 0.05, max: 0.95, default: 0.5 },
    { id: 'cutoff', name: 'Cutoff', min: 20, max: 18000, default: 1200 },
    { id: 'resonance', name: 'Res', min: 0, max: 1, default: 0.2 },
    // Octaves the filter envelope opens the cutoff by, so the knob is in a musical unit rather than in
    // whatever the filter's internal scale happens to be.
    { id: 'envAmount', name: 'Env', min: 0, max: 6, default: 2 },
    { id: 'keyTrack', name: 'Key', min: 0, max: 1, default: 0.35 },
    { id: 'attack', name: 'Attack', min: 0, max: 4, default: 0.005 },
    { id: 'decay', name: 'Decay', min: 0.001, max: 8, default: 0.4 },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.7 },
    { id: 'release', name: 'Release', min: 0.001, max: 8, default: 0.25 },
    { id: 'fDecay', name: 'F.Decay', min: 0.001, max: 8, default: 0.35 },
    { id: 'glide', name: 'Glide', min: 0, max: 1, default: 0 },
    { id: 'level', name: 'Level', min: 0, max: 1, default: 0.7 },
  ],
  processor: VoiceProcessor,
  deps: { Osc, Ladder },
  // The point of the module. Eight of these are eight different notes, which is what polyphony was for.
  poly: true,
}
