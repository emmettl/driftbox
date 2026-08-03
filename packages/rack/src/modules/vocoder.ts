import type { ModuleDef, Processor } from '../types.js'

// One sound wearing another's shape. Reason's BV512.
//
// A vocoder splits two signals into the same set of frequency bands, measures how loud the **modulator**
// is in each one, and applies that to the **carrier**. Speak into a saw wave and the saw talks; run a
// break through it and a pad plays the drum pattern's spectrum. Nothing else in this rack does it, and
// nothing else can be arranged to: it needs a filter bank on two signals at once and an envelope follower
// per band, which is dozens of modules and a patch nobody would ever finish wiring.
//
// **It is the Follower and the Alligator, at N bands.** That is not a coincidence and it is the reason
// this was worth building now rather than first — the Alligator established the filter bank and the
// Follower established the envelope, so this module is those two ideas multiplied rather than a new one.
//
// Three decisions:
//
// **Bands are a stepped choice, not a knob.** 8, 16 and 32 are different instruments — 8 is a robot, 32 is
// close to intelligible — and a vocoder halfway between two band counts is not a sound. Same reasoning as
// every other `stepped` param in the rack.
//
// **The band shift is the control worth having**, and it is the one people actually play. It offsets which
// modulator band drives which carrier band, so the formants move without the pitch: negative sounds
// enormous, positive sounds like helium. Reason put it on the front panel of the BV512 and it is the
// difference between a vocoder and a *usable* vocoder.
//
// **One instance, however many voices.** `poly: false`, so a polyphonic carrier is summed before it gets
// here — which is what you want, because vocoding a chord is a chord wearing the modulator's shape rather
// than eight independent vocoders. It is also the most expensive module in the rack: 32 bands is 64
// filters and 32 followers per sample, and eight copies of that is not a trade anybody would choose.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

/** The most bands the state arrays are sized for. The `bands` param picks how many are used. */
const MAX_BANDS = 32

/** Where the bank starts and stops. Speech lives inside this, and going below 100Hz only smears the
 *  bottom end of the carrier with rumble the modulator was never carrying. */
const LOW_HZ = 110
const HIGH_HZ = 7000

export class VocoderProcessor implements Processor {
  private readonly sampleRate: number

  /** Two integrators per band per signal. Flat arrays rather than nested, because this is the innermost
   *  loop in the program and an extra pointer hop per band per sample is not free. */
  private carrierIc1 = new Float32Array(32)
  private carrierIc2 = new Float32Array(32)
  private modIc1 = new Float32Array(32)
  private modIc2 = new Float32Array(32)
  /** The follower state for each modulator band. */
  private envelope = new Float32Array(32)

  /** Cached filter coefficients, recomputed only when the band count changes. */
  private a1 = new Float32Array(32)
  private a2 = new Float32Array(32)
  private a3 = new Float32Array(32)
  private damping = 0
  private lastBands = 0

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
    const carrierIn = inlets[0]
    const modIn = inlets[1]
    const out = outlets[0]

    // Read once per block, not per sample: these are selectors rather than things you sweep, and
    // rebuilding a 32-band filter bank per sample would be the whole CPU budget.
    //
    // `bands` is the *selector* — 0, 1, 2 — not a count. `8 << selector` gives 8, 16, 32 without an array
    // literal allocated every block, and without a constant at module scope, which would not survive
    // being stringified into the worklet.
    let selector = Math.round(params[0][0])
    if (selector < 0) selector = 0
    else if (selector > 2) selector = 2
    const bands = 8 << selector
    const attack = params[1][0]
    const release = params[2][0]
    const shift = Math.round(params[3][0])
    const dry = params[4][0]

    if (bands !== this.lastBands) {
      this.lastBands = bands
      // Logarithmically spaced, because pitch is. Linear spacing would put twenty bands above 4kHz where
      // there is almost nothing, and three across the whole of speech.
      //
      // Q rises with the band count so the bank always covers the range without gaps or heavy overlap:
      // more bands means each must be narrower. Expressed as damping, like `svf.ts`, and kept short of
      // zero because an undamped resonator is an infinity waiting for a transient.
      this.damping = 2 / Math.sqrt(bands)
      if (this.damping < 0.08) this.damping = 0.08
      const ceiling = this.sampleRate * 0.45
      for (let band = 0; band < bands; band++) {
        // 110 and 7000 inlined: a constant at module scope would not survive being stringified into the
        // worklet, which is the rule at the top of this file.
        const t = bands === 1 ? 0 : band / (bands - 1)
        let frequency = 110 * Math.pow(7000 / 110, t)
        if (frequency > ceiling) frequency = ceiling
        const g = Math.tan((Math.PI * frequency) / this.sampleRate)
        this.a1[band] = 1 / (1 + g * (g + this.damping))
        this.a2[band] = g * this.a1[band]
        this.a3[band] = g * this.a2[band]
      }
      // State from a different band layout is meaningless — those integrators were holding a different
      // frequency. Left alone it is a click at best and a blow-up at worst.
      this.carrierIc1.fill(0)
      this.carrierIc2.fill(0)
      this.modIc1.fill(0)
      this.modIc2.fill(0)
      this.envelope.fill(0)
    }

    if (attack !== this.lastAttack) {
      this.lastAttack = attack
      // The same 99%-in-the-stated-time convention as every other timed knob in the rack.
      this.attackCoefficient =
        attack <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, attack * this.sampleRate))
    }
    if (release !== this.lastRelease) {
      this.lastRelease = release
      this.releaseCoefficient =
        release <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, release * this.sampleRate))
    }

    // Make-up for the bank. Each band passes a slice of the carrier, so summing them is quieter than the
    // carrier was — and more bands means narrower slices. Derived rather than a knob, so changing the band
    // count does not also change the level and send you looking for a fader.
    const makeup = Math.sqrt(bands) * 0.7

    for (let i = 0; i < frames; i++) {
      const carrierSample = carrierIn[i]
      const modSample = modIn[i]
      let sum = 0

      for (let band = 0; band < bands; band++) {
        // The modulator's band, and how loud it is. Same topology-preserving SVF as `svf.ts` and the
        // Alligator; the bandpass output is `v1`.
        const mv3 = modSample - this.modIc2[band]
        const mv1 = this.a1[band] * this.modIc1[band] + this.a2[band] * mv3
        const mv2 = this.modIc2[band] + this.a2[band] * this.modIc1[band] + this.a3[band] * mv3
        this.modIc1[band] = 2 * mv1 - this.modIc1[band]
        this.modIc2[band] = 2 * mv2 - this.modIc2[band]

        const level = mv1 < 0 ? -mv1 : mv1
        const coefficient =
          level > this.envelope[band] ? this.attackCoefficient : this.releaseCoefficient
        this.envelope[band] = level + (this.envelope[band] - level) * coefficient

        // The carrier's band.
        const cv3 = carrierSample - this.carrierIc2[band]
        const cv1 = this.a1[band] * this.carrierIc1[band] + this.a2[band] * cv3
        const cv2 = this.carrierIc2[band] + this.a2[band] * this.carrierIc1[band] + this.a3[band] * cv3
        this.carrierIc1[band] = 2 * cv1 - this.carrierIc1[band]
        this.carrierIc2[band] = 2 * cv2 - this.carrierIc2[band]

        // **The shift.** Band n of the carrier is driven by band n−shift of the modulator, so the formants
        // move while the pitch does not. Bands pushed off either end read as silence rather than wrapping:
        // wrapping would fold the top of the spectrum onto the bottom, which sounds like a fault rather
        // than like a voice moved.
        const source = band - shift
        const gain = source >= 0 && source < bands ? this.envelope[source] : 0
        sum += cv1 * gain
      }

      const wet = sum * makeup
      const value = wet + carrierSample * dry
      // A vocoder is a product of two signals it does not control, so its output range is genuinely
      // unbounded — and the graph's own clamp is the far side of the master limiter. Bounded here so one
      // module cannot dominate a mix on a loud modulator.
      out[i] = value > 4 ? 4 : value < -4 ? -4 : value
    }
  }
}

export const VOCODER_MODULE: ModuleDef = {
  type: 'vocoder',
  version: 1,
  name: 'Vocoder',
  group: 'Filters',
  blurb:
    'One sound wearing another\'s shape. Speak into a saw and the saw talks; run a break into a pad and the pad plays the drums.',
  guide: {
    overview:
      'A vocoder measures the changing frequency shape of the Mod signal and imposes that shape on the Carrier. The carrier supplies the pitch and texture; the modulator supplies the articulation and rhythm.',
    concepts: [
      {
        title: 'Carrier versus Mod',
        body: 'Patch a harmonically rich synth, noise or pad into Carrier. Patch speech, drums or another animated sound into Mod. Swapping them produces a completely different—and often much quieter—result.',
      },
      {
        title: 'Bands trade clarity for character',
        body: 'More bands follow the modulator in finer detail and usually improve intelligibility. Fewer bands sound coarser and more obviously synthetic.',
      },
    ],
    firstPatch: [
      'Patch a held saw chord into Carrier and a spoken or drum signal into Mod.',
      'Patch Out to the mixer, start with 16 bands, fast Attack and a short Release.',
      'Raise Dry briefly if you need to verify that the carrier is sounding, then return it to zero and try Shift.',
    ],
    watchFor: [
      'Silence at either input can make the processed output silent; Dry only passes the carrier.',
      'A pure sine carrier has too little harmonic material for the filters to shape clearly.',
    ],
  },
  logo: {
    paths: [
      'M3 14c4-8 7 8 11 0s7 8 11 0',
      'M28 9v22M34 6v28M40 11v18M46 8v24',
      'M49 26c4-8 7 8 12 0',
    ],
  },
  inlets: [
    // Carrier first, because it is the one you patch a synth into and the one whose level you notice.
    { id: 'carrier', name: 'Carrier' },
    { id: 'mod', name: 'Mod' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    // Stepped and named: 8, 16 and 32 are three different instruments, not three points on a sweep.
    {
      id: 'bands',
      name: 'Bands',
      min: 0,
      max: 2,
      default: 1,
      stepped: true,
      labels: ['8', '16', '32'],
    },
    // Fast attack, slower release. A vocoder that smears its attack loses every consonant, which is most
    // of what makes speech legible — and the same is true of a break used as the modulator.
    { id: 'attack', name: 'Attack', min: 0.0005, max: 0.2, default: 0.004 },
    { id: 'release', name: 'Release', min: 0.001, max: 1, default: 0.05 },
    // The control people actually play. Reason put it on the front panel of the BV512.
    { id: 'shift', name: 'Shift', min: -12, max: 12, default: 0, stepped: true },
    // A little carrier straight through. Useful because a vocoder with a quiet modulator is silence, and
    // hearing the carrier is how you tell that from a broken patch.
    { id: 'dry', name: 'Dry', min: 0, max: 1, default: 0 },
  ],
  processor: VocoderProcessor,
  // See the note above: the most expensive module here, and vocoding a summed chord is what you want
  // anyway rather than eight independent vocoders.
  poly: false,
}

/** So a host does not have to hardcode the band choices. Index into `bands`, matching the labels. */
export const VOCODER_BAND_COUNTS = [8, 16, 32] as const
export const VOCODER_MAX_BANDS = MAX_BANDS
export const VOCODER_RANGE_HZ = [LOW_HZ, HIGH_HZ] as const
