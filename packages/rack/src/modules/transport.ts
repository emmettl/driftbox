import type { ModuleDef, Processor, Transport } from '../types.js'

// The only module that knows what a bar is, and the only one that reads the transport.
//
// **This is why the contract widened once instead of eighteen times.** Everything else in the rack syncs by
// patching to these outlets — which is how a real rack does it, and is a better answer than teaching every
// module about tempo. A Clock patched to `sixteenth` is a sixteenth; a sequencer patched to `bar` knows where
// it is; an envelope patched to `run` opens when the transport does.
//
// The divisions are separate outlets rather than a division knob, for the reason the SVF gives about its four
// responses: they are all computed anyway, and a knob would be spent withholding three of them. A patch that
// wants a triplet feel patches `eighth` through a divider; a patch that wants swing gets it from the sequencer.
//
// Nothing here is a *clock*, exactly — the Clock module is still the thing you reach for when you want a free
// rate. This is the thing you reach for when you want to be in time with the music, which for drum and bass is
// most of the time. See `docs/DNB.md`.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class TransportProcessor implements Processor {
  /** How many samples a trigger lasts. 1ms, matching the Clock, so the two are interchangeable downstream. */
  private readonly trigSamples: number

  /** Beats left in each division's pulse. Index 0 quarter, 1 eighth, 2 sixteenth. */
  private left = [0, 0, 0]
  /** The last beat position seen, so a division boundary can be detected by crossing rather than by counting. */
  private previous = -1
  /** Whether it was running last sample, so pressing play can fire the downbeat. */
  private wasRunning = false

  constructor(sampleRate: number) {
    this.trigSamples = Math.max(1, Math.ceil(sampleRate * 0.001))
  }

  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
    transport?: Transport,
  ): void {
    const runOut = outlets[0]
    const barOut = outlets[1]
    const beatOut = outlets[2]
    const quarter = outlets[3]
    const eighth = outlets[4]
    const sixteenth = outlets[5]
    const perBar = params[0]

    // Without a transport this module is silent rather than guessing. That happens in a test that constructs a
    // processor directly, and it must not be a crash.
    if (!transport) {
      runOut.fill(0)
      barOut.fill(0)
      beatOut.fill(0)
      quarter.fill(0)
      eighth.fill(0)
      sixteenth.fill(0)
      return
    }

    const perSample = transport.beatsPerBlock / frames
    const run = transport.running ? 1 : 0

    for (let i = 0; i < frames; i++) {
      // Interpolated across the block from the block's start position, which is what makes a division land on
      // the right sample rather than on the nearest 2.9ms boundary. It is the same reasoning as reading a param
      // per sample rather than per block.
      const beat = transport.beat + perSample * i
      const beatsPerBar = Math.max(1, Math.round(perBar[i]))

      if (transport.running && !this.wasRunning) {
        // Pressing play fires the downbeat. The same decision the Clock makes by arming itself at construction,
        // and for the same reason: a transport that stays silent until one full beat has gone by reads as
        // broken, and at 60bpm that is a whole second of nothing.
        this.left[0] = this.trigSamples
        this.left[1] = this.trigSamples
        this.left[2] = this.trigSamples
      } else if (this.previous >= 0 && transport.running) {
        // A division fires when the beat position crosses a multiple of its length. Crossing rather than
        // counting, so a tempo change cannot drop or double a beat.
        if (Math.floor(beat) > Math.floor(this.previous)) this.left[0] = this.trigSamples
        if (Math.floor(beat * 2) > Math.floor(this.previous * 2)) this.left[1] = this.trigSamples
        if (Math.floor(beat * 4) > Math.floor(this.previous * 4)) this.left[2] = this.trigSamples
      }
      this.previous = beat
      this.wasRunning = transport.running

      runOut[i] = run
      // Ramps, so a patch can see *where* in the bar it is rather than only that a boundary went past. The bar
      // ramp is what a sequencer follows and what a filter sweep across four bars rides on.
      barOut[i] = ((beat / beatsPerBar) % 1 + 1) % 1
      beatOut[i] = ((beat % 1) + 1) % 1

      for (let d = 0; d < 3; d++) {
        if (this.left[d] > 0) this.left[d]--
      }
      quarter[i] = this.left[0] > 0 ? 1 : 0
      eighth[i] = this.left[1] > 0 ? 1 : 0
      sixteenth[i] = this.left[2] > 0 ? 1 : 0
    }
  }
}

export const TRANSPORT_MODULE: ModuleDef = {
  type: 'transport',
  version: 1,
  name: 'Transport',
  group: 'Sequencing',
  blurb:
    'The only module that knows the tempo. Bars, beats and sixteenths for everything else to sync to.',
  inlets: [],
  outlets: [
    { id: 'run', name: 'Run' },
    { id: 'bar', name: 'Bar' },
    { id: 'beat', name: 'Beat' },
    { id: 'quarter', name: '1/4' },
    { id: 'eighth', name: '1/8' },
    { id: 'sixteenth', name: '1/16' },
  ],
  params: [
    // Four is a bar in almost everything, and drum and bass is emphatically in four. Three is here so a waltz
    // is possible and seven so somebody can be difficult.
    { id: 'beatsPerBar', name: 'Beats', min: 1, max: 16, default: 4, stepped: true },
  ],
  processor: TransportProcessor,
  // One transport. Eight copies would agree with each other and cost eight times as much to do it.
  poly: false,
}
