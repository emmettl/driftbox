import { Random } from '../dsp/random.js'
import type { ModuleDef, Processor } from '../types.js'

// One note in, a line out. Reason's RPG-8, as much of it as this rack can honestly hold.
//
// **Nothing sat between a note source and a voice.** `docs/REASON-GAP.md` lists that as a gap in three
// parts — no arpeggiator, no note echo, no scale-and-chord generator — and notes that the Quantizer is
// not one of them: it locks a CV to a scale at audio rate and cannot *add* a note that was not played.
// This adds notes.
//
// **It builds its chord rather than listening to one, and that limitation is worth reading.** The obvious
// arpeggiator takes the notes you are holding and plays them in turn. This one cannot, and the reason is
// structural rather than an oversight: a chord lives in a *polyphonic* pitch signal, one note per voice,
// and a module that runs once sees a polyphonic inlet **summed** — `poly.test.ts` calls that the collapse,
// and it is the right rule for a Delay fed by four voices. A mono arpeggiator patched to a polyphonic
// keyboard would therefore read the sum of the notes, which is not a note at all. Handing a mono module
// the per-voice buffers is a change to the compiler and the Graph, and it is what a *held-chord*
// arpeggiator would need first.
//
// What it does instead is the other half of the same gap and needs no such change: a root note and a
// chord knob, so **one finger becomes a progression**. Play C with Min7 selected and you get C E♭ G B♭
// arpeggiated across as many octaves as you asked for. That is the mode of the RPG-8 people actually
// leave switched on, and it suits a rack whose appeal is one held note doing a lot.
//
// Clocked rather than free-running, like everything else here with a rhythm — the Transport's `sixteenth`
// is the usual cable, and any edge will do.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

interface RandomLike {
  next(): number
}

export class ArpProcessor implements Processor {
  private readonly rng: RandomLike
  private readonly trigSamples: number
  /**
   * Chord shapes as semitone offsets, in the order the `chord` param's labels declare them.
   *
   * A field rather than a module constant: this class is serialised into a scope of its own, so anything
   * at module scope would be a ReferenceError at the moment the first patch played.
   */
  private readonly chords = [
    [0],
    [0, 7],
    [0, 4, 7],
    [0, 3, 7],
    [0, 4, 7, 11],
    [0, 3, 7, 10],
    [0, 5, 7],
    [0, 3, 6],
  ]

  private step = 0
  /**
   * Whether a first note has been struck since the last reset.
   *
   * **The first note of a figure is where it starts, not one past it.** Advancing on the opening edge like
   * every later one opens an upward arpeggio on the second note of the chord, so the root is never heard
   * until it comes round again — the same off-by-one the Tracker sidesteps by starting its step counter at
   * −1. A flag rather than a sentinel here because the start differs per mode: the bottom going up, the
   * top going down.
   */
  private started = false
  /** Which way an up-down pass is currently going. Its own state, because the direction has to survive
   *  between edges and cannot be worked out from the step alone at the turning points. */
  private rising = true
  private lastClock = 0
  private lastReset = 0
  private held = 0
  private gateLeft = 0
  private trigLeft = 0
  /** Samples since the last edge, and the length of the last complete step — the only way a clocked
   *  module can know how long a gate should be without being told the tempo. */
  private since = 0
  private interval = 0

  constructor(sampleRate: number, deps: Record<string, unknown>, id: string) {
    const Rng = deps.Random as new (seed: string | number) => RandomLike
    // Seeded from the module id, so two Arps set to Random do not walk in step — the same reasoning the
    // Noise gives, one level up.
    this.rng = new Rng(id)
    this.trigSamples = Math.max(1, Math.round(sampleRate * 0.001))
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const pitchIn = inlets[0]
    const clockIn = inlets[1]
    const resetIn = inlets[2]
    const pitchOut = outlets[0]
    const gateOut = outlets[1]
    const trigOut = outlets[2]

    const chordParam = params[0]
    const octavesParam = params[1]
    const modeParam = params[2]
    const gateParam = params[3]

    for (let i = 0; i < frames; i++) {
      let which = Math.round(chordParam[i])
      if (which < 0) which = 0
      else if (which >= this.chords.length) which = this.chords.length - 1
      const chord = this.chords[which]

      let octaves = Math.round(octavesParam[i])
      if (octaves < 1) octaves = 1
      else if (octaves > 4) octaves = 4
      const length = chord.length * octaves

      const reset = resetIn[i] >= 0.5 ? 1 : 0
      if (reset === 1 && this.lastReset === 0) {
        // Back to the start of the figure — whichever end that is for the mode, which the next edge
        // decides by seeing `started` cleared rather than being guessed at here.
        this.started = false
      }
      this.lastReset = reset

      this.since++
      const clock = clockIn[i] >= 0.5 ? 1 : 0
      if (clock === 1 && this.lastClock === 0) {
        const mode = Math.round(modeParam[i])
        const opening = !this.started
        this.interval = this.since
        this.since = 0

        if (opening) {
          this.started = true
          this.rising = mode !== 1 && mode !== 3
          this.step = this.rising ? 0 : length - 1
        } else if (mode === 4) {
          // `next()` is **bipolar**, [-1, 1) — it is a noise source before it is a die — so it is folded
          // before it becomes an index. Used raw, half the rolls are negative, and a negative index reads
          // off the front of the chord table and plays a NaN that silences everything downstream.
          //
          // Anywhere in the figure, repeats included. A random arpeggio that never played the same note
          // twice would be a shuffle, which is a different and much less useful thing.
          const roll = (this.rng.next() + 1) * 0.5
          this.step = Math.min(length - 1, Math.max(0, Math.floor(roll * length)))
        } else if (mode === 1) {
          this.step = this.step - 1 < 0 ? length - 1 : this.step - 1
        } else if (mode === 2 || mode === 3) {
          // Up-down and down-up are the same walk started at opposite ends, so one branch does both.
          if (this.rising) {
            if (this.step + 1 >= length) {
              // Turning without repeating the end note, which is what makes a run sound like a run rather
              // than like a stutter at each end.
              this.rising = false
              this.step = length > 1 ? length - 2 : 0
            } else this.step++
          } else {
            if (this.step - 1 < 0) {
              this.rising = true
              this.step = length > 1 ? 1 : 0
            } else this.step--
          }
        } else {
          this.step = this.step + 1 >= length ? 0 : this.step + 1
        }

        const at = this.step < length ? this.step : 0
        const semitone = chord[at % chord.length] + 12 * Math.floor(at / chord.length)
        // The root arrives as V/Oct and leaves as V/Oct, so the offset is semitones over twelve. Read at
        // the edge rather than continuously: an arpeggio whose earlier notes slid when you moved the root
        // would not be an arpeggio.
        this.held = pitchIn[i] + semitone / 12

        const fraction = gateParam[i]
        // The opening note has no previous step to be a fraction of, so it gets the trigger width. A first
        // note that never sounded would look like the module was broken, and it is the first thing heard.
        const span = opening ? this.trigSamples : this.interval
        this.gateLeft = Math.max(1, Math.round(span * (fraction > 0 ? fraction : 0.01)))
        this.trigLeft = this.trigSamples
      }
      this.lastClock = clock

      pitchOut[i] = this.held
      if (this.gateLeft > 0) {
        this.gateLeft--
        gateOut[i] = 1
      } else {
        gateOut[i] = 0
      }
      if (this.trigLeft > 0) {
        this.trigLeft--
        trigOut[i] = 1
      } else {
        trigOut[i] = 0
      }
    }
  }
}

export const ARP_MODULE: ModuleDef = {
  type: 'arp',
  version: 1,
  name: 'Arp',
  group: 'Sequencing',
  blurb:
    'One held note becomes a running line. Pick a chord and a direction; patch a clock and a Voice, and play a progression with one finger.',
  logo: {
    paths: ['M6 30l8-8 8 8 8-8 8 8 8-8 8 8', 'M6 14h8', 'M22 14h8', 'M38 14h8'],
  },
  inlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'clock', name: 'Clock' },
    { id: 'reset', name: 'Reset' },
  ],
  outlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'trig', name: 'Trig' },
  ],
  params: [
    {
      id: 'chord',
      name: 'Chord',
      min: 0,
      max: 7,
      default: 3,
      stepped: true,
      labels: ['Oct', '5th', 'Maj', 'Min', 'Maj7', 'Min7', 'Sus4', 'Dim'],
    },
    { id: 'octaves', name: 'Octaves', min: 1, max: 4, default: 2, stepped: true },
    {
      id: 'mode',
      name: 'Mode',
      min: 0,
      max: 4,
      default: 0,
      stepped: true,
      labels: ['Up', 'Down', 'Up-Dn', 'Dn-Up', 'Rand'],
    },
    // A fraction of the step rather than a time, so the notes stay legato-or-staccato as the tempo moves
    // instead of the feel changing with it.
    { id: 'gate', name: 'Gate', min: 0.05, max: 1, default: 0.5 },
  ],
  processor: ArpProcessor,
  deps: { Random },
  // One arpeggio. Eight copies on one clock would play the same figure, which is the argument the Seq and
  // the Tracker make — and the note source it feeds is where polyphony belongs anyway.
  poly: false,
}
