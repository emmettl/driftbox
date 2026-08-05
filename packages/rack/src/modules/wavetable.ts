import { Wavetable } from '../dsp/wavetable.js'
import type { ModuleDef, Processor } from '../types.js'

// A morphing wavetable oscillator. Reason's Malström, as a rack module.
//
// **This is the module that answers "everything in here starts from the same oscillator".** The VCO and
// both of the Voice's oscillators are one PolyBLEP saw, pulse and triangle — a good one, measured in
// `vco.test.ts`, and the only raw sound this rack could make. `docs/REASON-GAP.md` names the comparison:
// Reason did not ship a second subtractive synth, it shipped a second *way of making the sound*, and
// nothing a filter does afterwards substitutes for that.
//
// The oscillator itself is in `dsp/wavetable.ts` and arrives through `deps`, shared rather than copied for
// the reason that file and `dsp/osc.ts` both give at length. It is band-limited by construction rather than
// by correction, which makes it the cleaner of the two families and not merely the different one.
//
// **Position is a knob and a cable, not a selector.** A stepped waveform chooser would have been the
// obvious shape and would have thrown away the only thing a table bank can do that a shape switch cannot:
// the sweep between two waveforms is itself a sound, and it is the one people reach for this device for.
// So it is continuous, read per sample, and has an inlet of its own — an envelope at Position is a filter
// sweep that no filter could make, because it changes which harmonics *exist* rather than attenuating the
// ones that do.
//
// **Two modulation inlets, because they are two different effects.** FM moves the frequency and is the
// VCO's, in the same units and with the same behaviour, so swapping one device for the other in a patch
// keeps its cables meaning what they meant. PM offsets the phase instead: no frequency to integrate, so no
// drift, and it is what every digital FM synth since the DX7 has actually done under that name. Together
// with a table bank it is a second family inside the second family — a sine at Position 0 with something
// audio-rate at PM is two-operator FM.
//
// **The PM index is a front-panel knob rather than the rear input trim.** Every inlet already has a
// bipolar pot and the VCO leans on it for FM, which is right for a calibration you set once. Index is not
// that: it is the single most performed parameter in FM synthesis, it wants to be automated, routed to a
// Combinator rotary and swept by hand, and none of those reach a trim.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

/** What this module needs of the shared oscillator. Structural rather than the class itself, because the
 *  serialised processor may never name it — see the constructor. */
interface TableLike {
  next(dt: number, position: number, offset: number): number
}

export class WavetableProcessor implements Processor {
  private readonly sampleRate: number
  private readonly osc: TableLike
  /** The last exponent handed to Math.pow, and its result. The VCO's optimisation, for the same reason:
   *  a held note asks the same question 128 times a block. */
  private lastExponent = Number.NaN
  private lastRatio = 1

  constructor(sampleRate: number, deps: Record<string, unknown>) {
    this.sampleRate = sampleRate
    // Through `deps` and by string key, never by identifier — see the long note in `worklet.ts` about what
    // a minifier does to a class name.
    const Table = deps.Wavetable as new () => TableLike
    this.osc = new Table()
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const pitch = inlets[0]
    const fm = inlets[1]
    const pm = inlets[2]
    const positionIn = inlets[3]
    const out = outlets[0]
    const tune = params[0]
    const position = params[1]
    const index = params[2]

    for (let i = 0; i < frames; i++) {
      // 0 V is C2 and one unit of pitch CV is an octave, exactly as the VCO reads it. `tune` is in
      // semitones so the knob is marked in something a musician recognises.
      const exponent = tune[i] / 12 + pitch[i]
      if (exponent !== this.lastExponent) {
        this.lastExponent = exponent
        this.lastRatio = Math.pow(2, exponent)
      }
      const carrier = 65.40639132514966 * this.lastRatio

      // Linear FM with the index in units of the carrier, so an FM input of 1.0 is one carrier frequency
      // of deviation whatever note is playing and the timbre holds still up the keyboard. The VCO's
      // arithmetic, unchanged.
      let frequency = carrier + carrier * fm[i]
      if (!(frequency > 0)) frequency = 0

      // Half the sample rate rather than the VCO's 0.45: there is no two-sample correction here to
      // overlap, and the table bank's dullest level is a single harmonic, which is exactly what an
      // oscillator approaching Nyquist should be.
      let dt = frequency / this.sampleRate
      if (dt > 0.5) dt = 0.5

      out[i] = this.osc.next(dt, position[i] + positionIn[i], pm[i] * index[i])
    }
  }
}

export const WAVETABLE_MODULE: ModuleDef = {
  type: 'wavetable',
  version: 1,
  name: 'Wavetable',
  group: 'Sources',
  blurb:
    'Eight band-limited waveforms in one bank, morphed by a knob you can sweep at audio rate, plus phase modulation for FM tones. The rack’s second oscillator family.',
  logo: {
    paths: [
      'M4 10c4-6 8-6 12 0s8 6 12 0 8-6 12 0 8 6 12 0',
      'M4 24v-7h8v7h8v-7h8v7h8v-7h8v7h4',
      'M4 34l8-8v8l8-8v8l8-8v8l8-8v8l8-8v8l8-8v8',
    ],
  },
  guide: {
    overview:
      'A bank of eight waveforms, each built from a spectrum that stops below Nyquist rather than corrected after the fact. Position sweeps between neighbouring waveforms and is a signal, not a switch, so an envelope or an LFO at its inlet changes which harmonics exist instead of filtering the ones that do.',
    concepts: [
      {
        title: 'Position is the instrument',
        body: 'The bank runs sine, triangle, organ, square, saw, vocal, 25% pulse, 12% pulse, and the knob crossfades between whichever two it lands between. Sweeping it is the sound this device is for; parking it is merely a waveform selector with extra steps.',
      },
      {
        title: 'FM and PM are different jacks on purpose',
        body: 'FM moves the frequency and matches the VCO exactly, so a cable means the same thing on both devices. PM offsets the phase instead and cannot drift, which is what digital FM synthesis has always actually done — patch an oscillator there, turn Index up, and a sine at Position 0 becomes a two-operator FM voice.',
      },
      {
        title: 'It is band-limited by construction',
        body: 'Nothing here aliases at any pitch, because the harmonics that would fold were never synthesised. The cost is that the very top of the keyboard genuinely loses harmonics — a note near Nyquist has almost nothing left to lose — where the VCO instead keeps them and suppresses the images imperfectly.',
      },
    ],
    firstPatch: [
      'Patch a MIDI or Seq pitch to V/Oct and the Out to a Ladder, then to the Out module.',
      'Sweep Position by hand while a note holds. That range is the device.',
      'Patch an LFO or an ADSR to the Position inlet and set its rear trim to taste for a moving timbre.',
      'For FM: leave Position at 0 for a sine, patch a second oscillator to PM, and bring Index up from zero.',
    ],
    watchFor: [
      'Index does nothing until something is patched at PM — it scales that inlet rather than generating anything.',
      'Level varies a little across the bank. A 12% pulse really is quieter than a square at the same peak, and correcting for it would make the morph a volume control.',
    ],
  },
  inlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'fm', name: 'FM' },
    { id: 'pm', name: 'PM' },
    { id: 'pos', name: 'Position' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    { id: 'tune', name: 'Tune', min: -24, max: 24, default: 0 },
    // Continuous rather than stepped, which is the whole point of the device — see the note above. The
    // default lands between square and saw, which is a usable oscillator the moment it arrives rather
    // than the sine that position 0 would have given.
    { id: 'position', name: 'Position', min: 0, max: 1, default: 0.5 },
    // In cycles. Four is well past the useful range — classic FM tops out near 1.6 cycles of deviation —
    // and the top end is there because a phase input driven that hard is a noise source, which is a
    // legitimate thing to want out of an oscillator.
    { id: 'index', name: 'Index', min: 0, max: 4, default: 0 },
  ],
  processor: WavetableProcessor,
  deps: { Wavetable },
}
