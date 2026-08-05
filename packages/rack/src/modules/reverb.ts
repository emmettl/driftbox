import type { ModuleDef, Processor } from '../types.js'

// Reverb, as a feedback delay network.
//
// The engine reverbs with a `ConvolverNode` and an impulse response. That is not available here and could
// not be: an `AudioWorkletGlobalScope` has no Web Audio nodes in it, and a convolution long enough to be a
// room is tens of thousands of taps per sample. An FDN is the standard answer — a handful of delay lines
// fed back through a mixing matrix — and it is cheap enough to be an ordinary module rather than a special
// case.
//
// **Eight lines through a Householder matrix.** The matrix is what turns separate echoes into a room: every
// line feeds every other, so the echo density multiplies with each pass around the loop instead of staying
// at one repeat per line. Householder is used because at any size it is `subtract a share of the sum` — N
// multiply-adds rather than N² — and it is unitary, which guarantees the feedback path cannot gain energy
// whatever the delay lengths are. A matrix picked by hand would need proving stable.
//
// Eight and not four, and that was measured rather than assumed. With four lines a fifth of a second into
// the tail only 12% of samples were meaningfully non-zero: audibly a handful of discrete echoes rather than
// a room, which is the sparse rattle a small FDN makes. Doubling the lines costs eight delay reads a sample
// and nothing else.
//
// **The delay lengths are coprime.** Lengths sharing a factor put their echoes on top of each other and the
// tail rings at that period, which is the metallic sound of a bad reverb. Primes cannot.
//
// A damping filter sits in each feedback path, because a real room absorbs treble faster than bass, and a
// tail that keeps all its top end sounds like a spring rather than a space.
//
// ---------------------------------------------------------------------------------------------------
// The RV7000 half: algorithms, a wet-path EQ and a gate.
// ---------------------------------------------------------------------------------------------------
//
// `docs/REASON-GAP.md` recorded this device as "a single FDN algorithm with no RV7000-style algorithm
// select, EQ or gate". All three landed here, and the interesting part is **which algorithms did not**,
// because Reason ships nine and most of them are not algorithms.
//
// Small Space and Arena are this network with the Size knob at one end or the other, and shipping them as
// separate entries would have been a preset bank wearing a selector — the mistake the Line Mixer's channel
// EQ was refused for. Echo and Multi Tap are the `Delay` module, which exists and is better at it. Reverse
// needs its tail assembled backwards against an envelope, which is a different structure and therefore a
// different device rather than a setting on this one.
//
// So **four**, and each of them is DSP the others do not run:
//
// | Room | The original network, unchanged | no diffusion, no dispersion |
// | Hall | Long lines, smeared attack | four Schroeder allpasses before the network |
// | Plate | Short dense lines, very smeared | the same diffusion, harder, into a third of the delay |
// | Spring | The chirp | four one-pole allpasses per line, *inside* the feedback path |
//
// Hall and Plate are the closest pair and the distinction is the real one: a plate has no room to have
// early reflections in, so it arrives already dense, where a hall's density builds. That is a delay-length
// set and a diffusion amount, which is exactly what separates the two objects.
//
// Spring is the one that could not be had any other way. A spring reverb chirps because the steel is
// *dispersive* — high frequencies travel along it faster than low ones — so the reflection arrives smeared
// in time by frequency rather than merely repeated. A cascade of one-pole allpasses does that and nothing
// in this rack otherwise does. It is also the algorithm the `Guitar Pedalboard` factory was always
// reaching for; that chain has had an amp and a cabinet since they landed and has been ending in a room.
//
// **Algorithm 0 is bit-identical to the reverb that existed before this**, which is why the selector is
// last in the param list rather than first. Appending leaves the four knobs people have learned exactly
// where they were, and `reverb.test.ts` holds the Room path sample-for-sample against a transcription of
// the old arithmetic — the check that matters, because "sounds about the same" is not a promise.
//
// **The EQ and the gate are on the wet path only.** That is what those sections do on an RV7000 and it is
// what makes them useful: a low cut that also thinned the dry signal would be a filter you could already
// patch, where a low cut on the tail alone is the single most reached-for control in putting a reverb in a
// mix. The gate is **keyed from the input, not from the tail**, because the eighties snare is a gate that
// follows the drum rather than one that chases its own reverb — and a gate keyed from its own output is a
// feedback loop with an opinion.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class ReverbProcessor implements Processor {
  private readonly sampleRate: number
  private readonly lines: Float32Array[]
  /** `[algorithm][line]` — what each line is delayed by, per algorithm. The buffers are allocated once at
   *  the longest of these, so switching algorithm is a change of read offset and not a reallocation. */
  private readonly lengths: number[][]
  private readonly write: number[]
  /** One-pole lowpass state per line, for the damping in the feedback path. */
  private readonly damped: number[]
  /** Scratch for one sample's worth of line outputs. A field, not a local: allocating it per sample would
   *  be 44,100 arrays a second on the audio thread. */
  private readonly taps: number[]

  /** Input diffusion — four Schroeder allpasses in series, for the algorithms that want a smeared attack. */
  private readonly diffusion: Float32Array[]
  private readonly diffusionAt: number[]

  /** Spring dispersion — four one-pole allpasses per line, so eight lines is thirty-two states. */
  private readonly dispersion: Float32Array

  private lastDamp = Number.NaN
  private dampCoefficient = 0

  /** Wet-path EQ. A one-pole pair per channel: the highpass keeps its lowpass state and subtracts it. */
  private lowLeft = 0
  private lowRight = 0
  private highLeft = 0
  private highRight = 0
  private lastLowCut = Number.NaN
  private lowCoefficient = 0
  private lastHighCut = Number.NaN
  private highCoefficient = 1

  /** Gate. `envelope` follows the input, `gain` is what multiplies the wet, `held` counts the hold down. */
  private envelope = 0
  private gain = 1
  private held = 0
  private lastRelease = Number.NaN
  private releaseCoefficient = 1

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate

    // Prime numbers of samples, so no two lines share a factor. Lengths with a common factor stack their
    // echoes and the tail rings at that period, which is the metallic sound of a bad reverb — and rounding
    // milliseconds to samples is exactly how two lines end up sharing one by accident.
    //
    // One set per algorithm, and the ranges are the whole difference between them: Room is 30–74ms, which
    // is a small room; Hall 60–128ms, which is a large one; Plate 10–32ms, which is not a space at all and
    // is why a plate is dense from the first millisecond; Spring 20–45ms, the length of the actual springs.
    const sets = [
      [1327, 1543, 1873, 2053, 2399, 2687, 2927, 3271],
      [2647, 3011, 3457, 3833, 4297, 4721, 5153, 5647],
      [443, 587, 691, 811, 941, 1087, 1213, 1409],
      [887, 1063, 1229, 1381, 1523, 1699, 1871, 2003],
    ]
    // Scaled from the 44.1kHz these were chosen at, then nudged back to odd so the scaling cannot
    // reintroduce a common factor of two.
    const scale = (samples: number): number => {
      const scaled = Math.max(1, Math.round((samples * sampleRate) / 44100))
      return scaled % 2 === 0 ? scaled + 1 : scaled
    }
    this.lengths = sets.map((set) => set.map(scale))

    // One buffer per line, long enough for whichever algorithm asks the most of it. A circular buffer only
    // has to be at least as long as the delay it is asked for, so allocating past the Room lengths leaves
    // the Room algorithm reading exactly the samples it read before.
    const longest = this.lengths[0].map((_, line) =>
      this.lengths.reduce((most, set) => Math.max(most, set[line]), 1),
    )
    this.lines = longest.map((length) => new Float32Array(length))
    this.write = longest.map(() => 0)
    this.damped = longest.map(() => 0)
    this.taps = longest.map(() => 0)

    // Diffusion: short, and prime for the same reason the lines are.
    this.diffusion = [149, 211, 263, 331].map((samples) => new Float32Array(scale(samples)))
    this.diffusionAt = this.diffusion.map(() => 0)

    this.dispersion = new Float32Array(longest.length * 4)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const outLeft = outlets[0]
    const outRight = outlets[1]

    const sizeParam = params[0]
    const decayParam = params[1]
    const dampParam = params[2]
    const mixParam = params[3]
    const algorithmParam = params[4]
    const lowCutParam = params[5]
    const highCutParam = params[6]
    const gateParam = params[7]
    const threshParam = params[8]
    const holdParam = params[9]
    const releaseParam = params[10]

    const lines = this.lines
    const write = this.write
    const damped = this.damped
    const taps = this.taps
    const dispersion = this.dispersion

    for (let i = 0; i < frames; i++) {
      const damp = dampParam[i]
      if (damp !== this.lastDamp) {
        this.lastDamp = damp
        // 0 is no damping and 1 is as dark as this goes. Not a cutoff in Hz: the useful range of a reverb's
        // damping control is one end to the other, and a frequency knob would spend most of its travel in
        // the part nobody uses.
        this.dampCoefficient = damp < 0 ? 0 : damp > 0.99 ? 0.99 : damp
      }

      let algorithm = algorithmParam[i] | 0
      if (algorithm < 0) algorithm = 0
      else if (algorithm > 3) algorithm = 3
      const lengths = this.lengths[algorithm]
      // Hall smears, Plate smears harder, and the other two do not smear at all. Zero is not "a diffusion
      // of none" — an allpass at coefficient zero is a plain delay, not a wire — so this is a branch rather
      // than a multiply, and that is also what keeps Room arithmetically untouched.
      const diffuse = algorithm === 1 ? 0.7 : algorithm === 2 ? 0.75 : 0
      const disperse = algorithm === 3 ? 0.6 : 0

      // Size shortens every line by the same fraction, so their ratios — and therefore their coprimeness in
      // spirit — survive the knob. Read per sample so the room can be swept, which is a good noise.
      let size = sizeParam[i]
      if (size < 0.1) size = 0.1
      else if (size > 1) size = 1

      // Read each line at its own, possibly shortened, length.
      const count = lines.length
      let sum = 0
      for (let line = 0; line < count; line++) {
        const buffer = lines[line]
        let at = write[line] - Math.max(1, Math.round(lengths[line] * size))
        if (at < 0) at += buffer.length
        const tap = buffer[at]
        taps[line] = tap
        sum += tap
      }

      let decay = decayParam[i]
      if (decay < 0) decay = 0
      // 0.98 and not 1: a unitary matrix with unity feedback sustains for ever, and a reverb that never
      // stops is an oscillator with extra steps.
      else if (decay > 0.98) decay = 0.98

      // The Householder reflection: subtract 2/N of the sum from each. Unitary, so the loop can never gain
      // energy, and it is N operations rather than an N-squared matrix multiply.
      const share = (2 * sum) / count
      const raw = input[i]

      // What actually enters the network. The DRY signal stays `raw` throughout: diffusing the dry half
      // would make the mix knob fade between a signal and a smeared copy of itself rather than between a
      // signal and a room.
      let driven = raw
      if (diffuse > 0) {
        for (let stage = 0; stage < 4; stage++) {
          const buffer = this.diffusion[stage]
          const at = this.diffusionAt[stage]
          const stored = buffer[at]
          const held = driven + diffuse * stored
          driven = stored - diffuse * held
          buffer[at] = held
          this.diffusionAt[stage] = at + 1 >= buffer.length ? 0 : at + 1
        }
      }

      let wet = 0
      // The right channel's tail is the same taps under an alternating sign. **Two output mixing vectors
      // over one network** is how an FDN is made stereo, and this pair is chosen so that the left channel
      // is arithmetically what it was before this module had two: a patch that folds this back to mono, or
      // one written before stereo existed, is unchanged sample for sample.
      //
      // Alternating signs rather than splitting the lines four and four. Both decorrelate, but a split
      // gives each side half the lines and therefore half the echo density — audibly sparser on both sides
      // than the mono version was. Signed, every line is in both channels at full density and the two are
      // still uncorrelated, because the tap sequence has no reason to favour one parity.
      let wetRight = 0
      for (let line = 0; line < count; line++) {
        const mixed = taps[line] - share
        // Damping in the feedback path, not on the output: it has to compound with each pass around the
        // loop, which is what makes the tail get darker as it decays rather than merely being dark.
        damped[line] = mixed + (damped[line] - mixed) * this.dampCoefficient

        // Dispersion, also in the feedback path and for the same reason: a spring's chirp is the *result*
        // of the signal going round again, so a single pass at the input would be an effect rather than a
        // spring. Four one-pole allpasses per line, which is flat in magnitude and only moves phase.
        let fed = damped[line]
        if (disperse > 0) {
          const base = line * 4
          for (let stage = 0; stage < 4; stage++) {
            const state = dispersion[base + stage]
            const out = state - disperse * fed
            dispersion[base + stage] = fed + disperse * out
            fed = out
          }
        }

        const buffer = lines[line]
        buffer[write[line]] = driven + fed * decay
        write[line]++
        if (write[line] >= buffer.length) write[line] = 0
        wet += taps[line]
        wetRight += line % 2 === 0 ? taps[line] : -taps[line]
      }

      // Divided by the line count, because N lines summed at full level is N times the input before the tail
      // has even started. This is the level that makes the mix knob mean what it says.
      wet /= count
      wetRight /= count

      // The EQ section, wet only. Both halves are off at the ends of their own travel and are branched past
      // rather than run flat, because a one-pole at 20Hz is not a wire and Room has to stay exact.
      const lowCut = lowCutParam[i]
      if (lowCut > 20) {
        if (lowCut !== this.lastLowCut) {
          this.lastLowCut = lowCut
          this.lowCoefficient = 1 - Math.exp((-2 * Math.PI * lowCut) / this.sampleRate)
        }
        this.lowLeft += (wet - this.lowLeft) * this.lowCoefficient
        wet -= this.lowLeft
        this.lowRight += (wetRight - this.lowRight) * this.lowCoefficient
        wetRight -= this.lowRight
      }
      const highCut = highCutParam[i]
      if (highCut < 18000) {
        if (highCut !== this.lastHighCut) {
          this.lastHighCut = highCut
          this.highCoefficient = 1 - Math.exp((-2 * Math.PI * highCut) / this.sampleRate)
        }
        this.highLeft += (wet - this.highLeft) * this.highCoefficient
        wet = this.highLeft
        this.highRight += (wetRight - this.highRight) * this.highCoefficient
        wetRight = this.highRight
      }

      // The gate, last, so that the EQ cannot ring across the edge the gate just made.
      if (gateParam[i] >= 0.5) {
        const magnitude = raw < 0 ? -raw : raw
        // A peak follower on the INPUT: instant attack so a transient opens the gate on the sample it
        // arrives, and a fixed 20ms fall so that the detector rides the drum rather than chattering on
        // every zero crossing. Fixed because it is a detector, not a control — the musical times are the
        // hold and the release below.
        if (magnitude > this.envelope) this.envelope = magnitude
        else this.envelope += (magnitude - this.envelope) * (1 - Math.exp(-50 / this.sampleRate))

        if (this.envelope >= threshParam[i]) {
          let hold = holdParam[i]
          if (!(hold > 0)) hold = 0
          this.held = hold * this.sampleRate
          this.gain = 1
        } else if (this.held > 0) {
          this.held--
          this.gain = 1
        } else {
          const release = releaseParam[i]
          if (release !== this.lastRelease) {
            this.lastRelease = release
            // The same 99%-in-the-time-written-on-it convention as every other envelope here.
            this.releaseCoefficient =
              release > 0 ? 1 - Math.exp(-4.605170185988091 / (release * this.sampleRate)) : 1
          }
          this.gain += (0 - this.gain) * this.releaseCoefficient
        }
        wet *= this.gain
        wetRight *= this.gain
      } else {
        // Left open, so that switching the gate on mid-tail does not start from wherever it closed.
        this.gain = 1
      }

      let mix = mixParam[i]
      if (mix < 0) mix = 0
      else if (mix > 1) mix = 1
      // The dry half is the same mono input on both sides, so a dry reverb is centred rather than wide —
      // and at mix 0 the two channels are identical, which is what "no effect" has to mean.
      const dry = raw * (1 - mix)
      outLeft[i] = dry + wet * mix
      outRight[i] = dry + wetRight * mix
    }
  }
}

export const REVERB_MODULE: ModuleDef = {
  type: 'reverb',
  version: 1,
  name: 'Reverb',
  group: 'Space',
  blurb:
    'Four rooms built from feedback delay lines — room, hall, plate and a dispersive spring — with an EQ on the tail and a gate for the eighties snare.',
  logo: {
    paths: [
      'M8 31V9h48v22',
      'M15 25c6-10 12-10 18 0',
      'M11 29c10-17 21-17 31 0',
      'M7 34c15-24 31-24 48 0',
    ],
  },
  guide: {
    overview:
      'Eight delay lines fed back through a unitary matrix, with four algorithms over the same network. Room is the plain one; Hall and Plate add input diffusion so the tail arrives smeared rather than as distinct echoes; Spring puts allpass dispersion inside the feedback path, which is what makes a real spring chirp. An EQ and a gate sit on the wet signal only, and the dry half passes through untouched.',
    concepts: [
      {
        title: 'The algorithms differ in structure, not in preset',
        body: 'Room and Hall are not the same network at two sizes — Hall runs longer lines through four Schroeder allpasses first. Plate is short and dense because a plate has no room to have early reflections in. Spring is the only one you could not approximate with the other knobs: its allpasses are inside the loop, so the smearing compounds every pass, which is the chirp.',
      },
      {
        title: 'The EQ is on the tail, and that is the point',
        body: 'Low Cut and High Cut shape the wet signal only, leaving the dry exactly as it arrived. A low cut on the tail is the most reached-for control in fitting a reverb into a mix, because it keeps the room out of the bass without thinning the source. Both are off at the ends of their own travel rather than needing a switch.',
      },
      {
        title: 'The gate is keyed from the input',
        body: 'It watches what you put in, not what comes out — so it follows the drum rather than chasing its own tail, which is what the eighties snare actually is and is also the only version that cannot feed back. Threshold decides what opens it, Hold is how long it stays open after the sound passes, and Release is how fast it shuts.',
      },
    ],
    firstPatch: [
      'Patch a source to In and the stereo Out onward, then bring Mix up from its default quarter.',
      'Step through Algorithm on a held chord. Room and Hall differ in the attack, not only the length.',
      'Bring Low Cut up to around 300Hz on a full mix. That is usually the difference between a reverb that sits and one that muddies.',
      'For a gated snare: Plate, a short Hold near 0.15s, Release fast, and Mix well up.',
    ],
    watchFor: [
      'Changing Algorithm while a tail is ringing steps the read offsets and can click. The knob is stepped, so it lands on a block boundary rather than mid-sample, but it is a switch and not a crossfade.',
      'Threshold, Hold and Release do nothing until Gate is switched on, and Gate itself does nothing to the dry signal at any setting.',
    ],
  },
  inlets: [{ id: 'in', name: 'In' }],
  // Stereo out of a mono in, which is what a room does: one source, two ears, two different arrival
  // patterns. The id is unchanged, so no existing cable moves — and a cable from here into anything mono
  // still carries exactly the signal it carried before.
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    { id: 'size', name: 'Size', min: 0.1, max: 1, default: 0.7 },
    { id: 'decay', name: 'Decay', min: 0, max: 0.98, default: 0.82 },
    { id: 'damp', name: 'Damp', min: 0, max: 0.99, default: 0.4 },
    // Dry by default. A reverb dropped into a patch should not change the sound until it is asked to, and
    // this one is usually wanted on a send rather than across the whole mix.
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.25 },
    // **Appended rather than put first, deliberately.** A patch stores params by id, so the order here is
    // free to change and only the processor's own indexing and the generated faceplate depend on it — which
    // makes putting the selector at the front tempting and wrong. The four knobs above are the ones anybody
    // who has used this device already knows the position of, and Room is what they have been turning all
    // along. A new section belongs after the panel, not in front of it.
    {
      id: 'algorithm',
      name: 'Algorithm',
      min: 0,
      max: 3,
      default: 0,
      stepped: true,
      labels: ['Room', 'Hall', 'Plate', 'Spring'],
    },
    // Off at 20Hz and 18kHz respectively, which is the bottom and top of their own travel — so neither
    // needs a switch beside it and neither is doing arithmetic in a patch that has not asked for it.
    { id: 'lowCut', name: 'Low Cut', min: 20, max: 2000, default: 20 },
    { id: 'highCut', name: 'High Cut', min: 1000, max: 18000, default: 18000 },
    { id: 'gate', name: 'Gate', min: 0, max: 1, default: 0, stepped: true, labels: ['Off', 'On'] },
    { id: 'gateThresh', name: 'Thresh', min: 0, max: 1, default: 0.05 },
    { id: 'gateHold', name: 'Hold', min: 0, max: 2, default: 0.15 },
    { id: 'gateRelease', name: 'Release', min: 0.001, max: 1, default: 0.02 },
  ],
  processor: ReverbProcessor,
  // One room. Eight voices each with their own reverb is eight rooms, which is not what a reverb is and
  // costs eight times the memory — the same reasoning as the Delay.
  poly: false,
}
