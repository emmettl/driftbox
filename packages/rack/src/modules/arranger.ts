import type { ModuleData, ModuleDef, Processor } from '../types.js'

// The song: which pattern plays, and for how many bars.
//
// The last of the three pieces an arrangement needs. The Tracker can hold eight patterns and be told which
// to play by a cable; this is the thing that does the telling, over time. Intro for four bars, main for
// eight, break for two, drop for eight — a list of sections, each a pattern and a repeat count.
//
// **A module rather than a layer over the patch**, and that is the decision worth defending. A pattern
// index over time *is* a signal, so making it one buys three things a host-side arrangement would not:
//
//   - **One Arranger drives several Trackers.** Drums and bass follow the same song structure from one
//     cable each, which is exactly what you want and is free here.
//   - **It needs no change to the patch format.** `Patch` gained `modulation` for the Combinator because
//     a routing genuinely is not a signal. This genuinely is, so it stays a module and the format stays put.
//   - **It composes.** Its output is CV, so it can be offset, quantised, sampled-and-held, or driven by
//     something else entirely. A song that is a signal can be played with.
//
// The cost is that a song lives in a module rather than somewhere obviously "above" the patch, which is
// only a problem if you expect a DAW. This is a rack.
//
// **Clocked by the bar, not the step.** Its clock inlet expects one edge per bar — the Transport's `bar`
// outlet — because a section is measured in bars and counting sixteenths to find them would put the same
// arithmetic in two modules. It will run off anything that makes an edge, which is the same freedom every
// other clocked module here has.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

/** The most sections a song can have. Sixteen is long enough for an intro, four eights and an outro, and
 *  short enough that the faceplate can show all of them at once — which is the point of the module. */
const SECTIONS = 16

export class ArrangerProcessor implements Processor {
  private readonly data: ModuleData
  private readonly trigSamples: number

  /** Which section is playing, and how many bars of it have gone by. */
  private section = 0
  private elapsed = 0
  private lastClock = 0
  private lastReset = 0
  private trigLeft = 0
  /** The pattern index currently being announced. Held between clocks. */
  private held = 0

  constructor(sampleRate: number, _deps: Record<string, unknown>, _id: string, data: ModuleData) {
    this.data = data
    // A millisecond, matching the Clock's fixed trigger width — long enough for anything downstream to
    // catch an edge, short enough never to be mistaken for a gate.
    this.trigSamples = Math.max(1, Math.round(sampleRate * 0.001))
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const clockIn = inlets[0]
    const resetIn = inlets[1]
    const patternOut = outlets[0]
    const trigOut = outlets[1]
    const lengthParam = params[0]

    const patterns = this.data.get('patterns')
    const repeats = this.data.get('repeats')

    for (let i = 0; i < frames; i++) {
      let length = Math.round(lengthParam[i])
      if (length < 1) length = 1
      else if (length > 16) length = 16

      const reset = resetIn[i] >= 0.5 ? 1 : 0
      if (reset === 1 && this.lastReset === 0) {
        // Back to the top of the song, and to the start of that section. Unlike the Tracker's reset, which
        // winds back to *before* its first step so the next clock plays step one, a section is a place
        // rather than an event — the song is at section zero from this instant, and the next bar is its
        // first bar rather than its second.
        this.section = 0
        this.elapsed = 0
        this.trigLeft = this.trigSamples
      }
      this.lastReset = reset

      const clock = clockIn[i] >= 0.5 ? 1 : 0
      if (clock === 1 && this.lastClock === 0) {
        // `elapsed` counts bars *started* in this section, so the first edge is the start of bar one
        // rather than the end of it. Getting that backwards makes every section one bar short — the first
        // clock immediately banks a bar that has not been played yet — which is the same off-by-one the
        // Tracker avoids by starting its step counter at −1.
        this.elapsed++
        // How many bars this section lasts. Zero or missing means one, because a section that lasts no
        // bars is a section you cannot hear and almost certainly a mistake in the data rather than an
        // intention — and skipping it silently would make the song shorter than it reads.
        let bars = repeats && this.section < repeats.length ? Math.round(repeats[this.section]) : 1
        if (bars < 1) bars = 1
        if (this.elapsed > bars) {
          // This edge starts the new section's first bar, so the count resets to one rather than zero.
          this.elapsed = 1
          this.section = this.section + 1 >= length ? 0 : this.section + 1
          this.trigLeft = this.trigSamples
        }
      }
      this.lastClock = clock

      // Read every sample rather than only on the edge, so editing the section you are *in* is heard
      // immediately. That is the opposite of the Tracker, which reads on the edge precisely so that
      // editing a step does not retrigger it — the difference is that a pattern index is a level and a
      // step is an event.
      const at = this.section < length ? this.section : 0
      const pattern = patterns && at < patterns.length ? Math.round(patterns[at]) : 0
      this.held = pattern < 0 ? 0 : pattern > 7 ? 7 : pattern

      // Scaled by sixteen to match what a Tracker's pattern inlet expects, which is the same scaling a
      // Unit lane uses. One cable from here to there selects the pattern, with nothing in between.
      patternOut[i] = this.held / 16

      if (this.trigLeft > 0) {
        this.trigLeft--
        trigOut[i] = 1
      } else {
        trigOut[i] = 0
      }
    }
  }
}

export const ARRANGER_MODULE: ModuleDef = {
  type: 'arranger',
  version: 1,
  name: 'Arranger',
  group: 'Sequencing',
  blurb:
    'A list of sections, each a pattern and a count of bars. Intro, main, break, drop — a song, driving a Tracker.',
  logo: {
    paths: [
      'M5 8h14v9H5zM25 8h24v9H25zM5 23h30v9H5zM41 23h18v9H41z',
      'M19 12h6M49 12h8v15M35 27h6',
      'M54 24l3 3-3 3',
    ],
  },
  inlets: [
    { id: 'clock', name: 'Bar' },
    { id: 'reset', name: 'Reset' },
  ],
  outlets: [
    { id: 'pattern', name: 'Pattern' },
    // Fires when the song moves on. Worth having: it is what you reset a Tracker with so a new section
    // starts at its first step rather than wherever the last one happened to leave the playhead.
    { id: 'trig', name: 'Trig' },
  ],
  params: [
    { id: 'length', name: 'Sections', min: 1, max: 16, default: 4, stepped: true },
  ],
  processor: ArrangerProcessor,
  // One song. Eight copies advanced by the same clock would agree with each other — the same reasoning as
  // the Seq and the Tracker.
  poly: false,
}

/** So a host does not have to hardcode how long a song can be. */
export const ARRANGER_SECTIONS = SECTIONS
