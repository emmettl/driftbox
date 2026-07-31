import type { Patch } from '../types.js'

// The patches the rack ships with.
//
// Same shape and the same reasoning as the engine's `SONGS`: **built rather than stored**, so each is a
// function returning a fresh Patch and loading one twice cannot hand back an object somebody has already
// edited. Same reason `clonePatterns` exists over there.
//
// They live in this package rather than in the app for the same reason the songs live in the engine: they
// are data about the rack, not about the page showing it, and a headless consumer gets them too.
//
// They deliberately share almost nothing — because the point of a modular is that it is not one instrument,
// and a library of sequenced acid lines would demonstrate the opposite. There is one with no sequencer in it
// at all, one with no oscillator, three small D&B studies, and one complete arranged song.

export interface PatchPreset {
  id: string
  name: string
  /** One line, for the picker. */
  blurb: string
  /**
   * The break this patch was written around, by id, for a host that can render one.
   *
   * A Sampler with no data is silent, so a shipped patch built on a break would be a patch that arrives
   * broken — which is exactly the "silent no-op" failure the Stop button and the breaks picker both had.
   * The break itself cannot live here: `docs/DNB.md` puts the whole argument for synthesising it on load
   * rather than shipping audio, and a rendered bar is about 700kB against a patch's few hundred bytes.
   *
   * So the catalogue names one and the patch carries the same id in `break`; the host resolves it in either
   * case. This package deliberately does not know what the string means — the breaks live in the app, next
   * to the engine that renders them.
   */
  needsBreak?: string
  build(): Patch
}

/** Eight one-bar patterns, stored end to end the way the Tracker reads its bank. */
const bank = (...bars: number[][]): number[] => bars.flat()

/** The exact target value a 0..127 Combinator rotary produces, so a factory opens already settled. */
const routed = (min: number, max: number, rotary: number): number =>
  min + (max - min) * (rotary / 127)

/**
 * The record in the box.
 *
 * The earlier drum-and-bass patches are deliberately small: each proves one wiring and repeats one bar.
 * This one uses those same instruments as a song. One Arranger moves one Tracker through an intro, two drops,
 * a breakdown and an outro. The first version made every interesting rack device speak at once and sounded
 * like a capability demo; this version leaves room around a straight break, a sub and one restrained Reese.
 *
 * The Combinator still reaches over the whole mix, but the movement is optional and playable rather than
 * permanently arranged. This is why the starter is this patch rather than another useful little preset:
 * it aims to sound like a record the rack made, not a test of how many cables work.
 */
const pressureSystem = (): Patch => ({
  tempo: 174,
  break: 'roller',
  modules: [
    {
      id: 'combi-1',
      type: 'combi',
      params: { rotary1: 40, rotary2: 24, rotary3: 72, rotary4: 62 },
    },
    {
      id: 'arranger-1',
      type: 'arranger',
      params: { length: 8 },
      data: {
        // Four-bar phrases give each idea time to become the groove before the next one arrives.
        patterns: [0, 1, 2, 3, 4, 5, 6, 7],
        repeats: [4, 4, 8, 1, 4, 8, 8, 4],
      },
    },
    { id: 'transport-1', type: 'transport' },
    {
      id: 'tracker-1',
      type: 'tracker',
      params: { length: 16, unit1: 1 },
      data: {
        // The middle patterns mostly play the Roller in order. One reversed tail is enough to announce a fill;
        // constant re-chopping was the largest source of the original patch's nervousness.
        lane1: bank(
          [1, 0, 0, 0, 5, 0, 0, 0, 9, 0, 0, 0, 13, 0, 0, 0],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 15, 14, 13],
          [1, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 13, 0, 0, 0],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15],
          [1, 0, 0, 0, 5, 0, 0, 0, 9, 0, 0, 0, 13, 0, 0, 0],
        ),
        // Two notes and real rests. The old line changed pitch almost every other step and fought the break.
        lane2: bank(
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [12, 12, 12, 12, 0, 0, 0, 0, 10, 10, 10, 10, 0, 0, 0, 0],
          [12, 12, 0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [12, 12, 12, 12, 0, 0, 0, 0, 10, 10, 10, 10, 0, 0, 0, 0],
          [12, 12, 12, 12, 0, 0, 0, 0, 15, 15, 15, 15, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ),
        // The Reese is punctuation, not a second full-time bassline.
        lane3: bank(
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [12, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [12, 12, 12, 12, 0, 0, 0, 0, 10, 10, 10, 10, 0, 0, 0, 0],
          [12, 12, 12, 12, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ),
      },
    },

    // The break channel.
    { id: 'sampler-1', type: 'sampler', params: { slices: 16 } },
    {
      id: 'compressor-1',
      type: 'compressor',
      params: { threshold: -14, ratio: 3, attack: 0.004, release: 0.1, makeup: 1, knee: 4 },
    },
    {
      id: 'reverb-1',
      type: 'reverb',
      params: { size: 0.42, decay: 0.5, damp: 0.72, mix: routed(0.01, 0.12, 24) },
    },
    { id: 'out-1', type: 'out', params: { level: 0.56 } },

    // A clean triangle sub, separately ducked by the break.
    { id: 'vco-1', type: 'vco', params: { tune: -24, shape: 2 } },
    { id: 'adsr-1', type: 'adsr', params: { attack: 0.006, decay: 0.3, sustain: 0.88, release: 0.18 } },
    { id: 'vca-1', type: 'vca', params: { gain: 0 } },
    {
      id: 'compressor-2',
      type: 'compressor',
      params: { threshold: -20, ratio: 5, attack: 0.002, release: 0.13, makeup: 1.2, knee: 3 },
    },
    { id: 'out-2', type: 'out', params: { level: routed(0.15, 0.48, 62) } },

    // One dark Reese, used in short answers to the sub rather than as another constant rhythm.
    { id: 'vco-2', type: 'vco', params: { tune: -12 } },
    { id: 'vco-3', type: 'vco', params: { tune: -11.83 } },
    { id: 'mixer-1', type: 'mixer', params: { level1: 0.42, level2: 0.42 } },
    {
      id: 'ladder-1',
      type: 'ladder',
      params: { cutoff: routed(180, 1800, 40), resonance: routed(0.25, 0.62, 40) },
    },
    { id: 'drive-1', type: 'drive', params: { drive: routed(1.2, 4.5, 40), bias: 0.02 } },
    { id: 'adsr-2', type: 'adsr', params: { attack: 0.012, decay: 0.28, sustain: 0.62, release: 0.18 } },
    { id: 'vca-2', type: 'vca', params: { gain: 0 } },
    {
      id: 'compressor-3',
      type: 'compressor',
      params: { threshold: -18, ratio: 4, attack: 0.003, release: 0.14, makeup: 1, knee: 3 },
    },
    {
      id: 'delay-1',
      type: 'delay',
      params: { time: routed(0.004, 0.016, 72), feedback: routed(0.01, 0.18, 24) },
    },
    {
      id: 'out-3',
      type: 'out',
      params: { level: routed(0.06, 0.26, 62), pan: routed(-0.1, -0.65, 72) },
    },
    {
      id: 'out-4',
      type: 'out',
      params: { level: routed(0.05, 0.24, 62), pan: routed(0.1, 0.65, 72) },
    },
  ],
  cables: [
    { from: ['transport-1', 'bar'], to: ['arranger-1', 'clock'] },
    { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
    { from: ['arranger-1', 'pattern'], to: ['tracker-1', 'pattern'] },
    { from: ['arranger-1', 'trig'], to: ['tracker-1', 'reset'] },

    { from: ['tracker-1', 'trig1'], to: ['sampler-1', 'trig'] },
    { from: ['tracker-1', 'cv1'], to: ['sampler-1', 'slice'] },
    { from: ['sampler-1', 'out'], to: ['compressor-1', 'in'] },
    { from: ['compressor-1', 'out'], to: ['reverb-1', 'in'] },
    { from: ['reverb-1', 'out'], to: ['out-1', 'in'] },

    { from: ['tracker-1', 'cv2'], to: ['vco-1', 'pitch'] },
    { from: ['tracker-1', 'gate2'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['vca-1', 'out'], to: ['compressor-2', 'in'] },
    { from: ['sampler-1', 'out'], to: ['compressor-2', 'key'] },
    { from: ['compressor-2', 'out'], to: ['out-2', 'in'] },

    { from: ['tracker-1', 'cv3'], to: ['vco-2', 'pitch'] },
    { from: ['tracker-1', 'cv3'], to: ['vco-3', 'pitch'] },
    { from: ['tracker-1', 'gate3'], to: ['adsr-2', 'gate'] },
    { from: ['vco-2', 'out'], to: ['mixer-1', 'in1'] },
    { from: ['vco-3', 'out'], to: ['mixer-1', 'in2'] },
    { from: ['mixer-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['ladder-1', 'out'], to: ['drive-1', 'in'] },
    { from: ['drive-1', 'out'], to: ['vca-2', 'in'] },
    { from: ['adsr-2', 'out'], to: ['vca-2', 'cv'] },
    { from: ['vca-2', 'out'], to: ['compressor-3', 'in'] },
    { from: ['sampler-1', 'out'], to: ['compressor-3', 'key'] },
    { from: ['compressor-3', 'out'], to: ['out-3', 'in'] },
    { from: ['compressor-3', 'out'], to: ['delay-1', 'in'] },
    { from: ['delay-1', 'out'], to: ['out-4', 'in'] },
  ],
  modulation: [
    // Tone, air, width and weight: four useful dimensions, none of them adds another arranged part.
    { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 180, max: 1800 },
    { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'resonance'], min: 0.25, max: 0.62 },
    { from: ['combi-1', 'rotary1'], to: ['drive-1', 'drive'], min: 1.2, max: 4.5 },
    { from: ['combi-1', 'rotary2'], to: ['reverb-1', 'mix'], min: 0.01, max: 0.12 },
    { from: ['combi-1', 'rotary2'], to: ['delay-1', 'feedback'], min: 0.01, max: 0.18 },
    { from: ['combi-1', 'rotary3'], to: ['out-3', 'pan'], min: -0.1, max: -0.65 },
    { from: ['combi-1', 'rotary3'], to: ['out-4', 'pan'], min: 0.1, max: 0.65 },
    { from: ['combi-1', 'rotary3'], to: ['delay-1', 'time'], min: 0.004, max: 0.016 },
    { from: ['combi-1', 'rotary4'], to: ['out-2', 'level'], min: 0.15, max: 0.48 },
    { from: ['combi-1', 'rotary4'], to: ['out-3', 'level'], min: 0.06, max: 0.26 },
    { from: ['combi-1', 'rotary4'], to: ['out-4', 'level'], min: 0.05, max: 0.24 },
    // Buttons remove layers or deliberately roughen the sound; the arrangement itself stays restrained.
    { from: ['combi-1', 'button1'], to: ['out-3', 'mute'], min: 0, max: 1 },
    { from: ['combi-1', 'button1'], to: ['out-4', 'mute'], min: 0, max: 1 },
    { from: ['combi-1', 'button2'], to: ['out-2', 'mute'], min: 0, max: 1 },
    { from: ['combi-1', 'button3'], to: ['vco-3', 'shape'], min: 0, max: 1 },
    { from: ['combi-1', 'button4'], to: ['sampler-1', 'reverse'], min: 0, max: 1 },
  ],
})

/** A sequenced acid line: clock into sequencer into envelope, oscillator through the ladder into a VCA.
 *  The shortest description of what the rack can do. */
const acid = (): Patch => ({
  modules: [
    { id: 'clock-1', type: 'clock', params: { rate: 4, width: 0.35 } },
    { id: 'seq-1', type: 'seq', params: { pitch1: 0, pitch2: 7, pitch3: 12, pitch4: 3, length: 4 } },
    { id: 'vco-1', type: 'vco', params: { tune: -12 } },
    { id: 'adsr-1', type: 'adsr', params: { attack: 0.003, decay: 0.12, sustain: 0.15, release: 0.1 } },
    { id: 'ladder-1', type: 'ladder', params: { cutoff: 700, resonance: 0.72 } },
    { id: 'vca-1', type: 'vca', params: { gain: 0 } },
    { id: 'out-1', type: 'out', params: { level: 0.7 } },
  ],
  cables: [
    { from: ['clock-1', 'gate'], to: ['seq-1', 'clock'] },
    { from: ['seq-1', 'pitch'], to: ['vco-1', 'pitch'] },
    { from: ['seq-1', 'gate'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['ladder-1', 'cutoff'] },
    { from: ['ladder-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['vca-1', 'out'], to: ['out-1', 'in'] },
  ],
})

/**
 * A melody out of noise, from four modules none of which is a sequencer.
 *
 * Noise sampled on a clock is a random voltage; a random voltage through the quantizer is a note in A
 * minor. It is the clearest demonstration in the rack of why there is only one signal type: what gets
 * sampled is audio and what it becomes is pitch, and nothing had to be told about the change.
 */
const generative = (): Patch => ({
  modules: [
    { id: 'noise-1', type: 'noise' },
    { id: 'clock-1', type: 'clock', params: { rate: 5, width: 0.2 } },
    { id: 'sh-1', type: 'sample-hold' },
    { id: 'quant-1', type: 'quantizer', params: { scale: 3, root: 9 } },
    { id: 'vco-1', type: 'vco', params: { tune: -5, shape: 1, width: 0.35 } },
    { id: 'adsr-1', type: 'adsr', params: { attack: 0.004, decay: 0.22, sustain: 0, release: 0.15 } },
    { id: 'svf-1', type: 'svf', params: { cutoff: 1600, resonance: 0.55 } },
    { id: 'vca-1', type: 'vca', params: { gain: 0, curve: 1 } },
    { id: 'delay-1', type: 'delay', params: { time: 0.3, feedback: 0.45 } },
    { id: 'mix-1', type: 'mixer', params: { level1: 0.9, level2: 0.5, level3: 0, level4: 0 } },
    { id: 'out-1', type: 'out', params: { level: 0.6 } },
  ],
  cables: [
    { from: ['noise-1', 'white'], to: ['sh-1', 'in'] },
    { from: ['clock-1', 'trig'], to: ['sh-1', 'trig'] },
    { from: ['sh-1', 'out'], to: ['quant-1', 'in'] },
    { from: ['quant-1', 'out'], to: ['vco-1', 'pitch'] },
    // The quantizer's trigger, not the clock's: an envelope struck on each new NOTE rather than on each
    // tick, so a repeated pitch is held instead of restruck.
    { from: ['quant-1', 'trig'], to: ['adsr-1', 'trig'] },
    { from: ['vco-1', 'out'], to: ['svf-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['svf-1', 'cutoff'] },
    { from: ['svf-1', 'lp'], to: ['vca-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['vca-1', 'out'], to: ['delay-1', 'in'] },
    { from: ['vca-1', 'out'], to: ['mix-1', 'in1'] },
    { from: ['delay-1', 'out'], to: ['mix-1', 'in2'] },
    { from: ['mix-1', 'out'], to: ['out-1', 'in'] },
  ],
})

/**
 * Two oscillators, detuned, under a slowly breathing filter. No sequencer, no envelope, no gate.
 *
 * Here to make a point about what the rack is: nothing about a modular says the sound has to be a note.
 * The oscillators run continuously and the only thing that changes is the filter, driven by an LFO through
 * an attenuverter — which is also the smallest useful demonstration of why the Offset module earns a slot.
 */
const drone = (): Patch => ({
  modules: [
    { id: 'vco-1', type: 'vco', params: { tune: -24 } },
    { id: 'vco-2', type: 'vco', params: { tune: -23.88, shape: 2 } },
    { id: 'lfo-1', type: 'lfo', params: { rate: 0.08, shape: 0 } },
    { id: 'off-1', type: 'offset', params: { gain: 1.4, offset: 0.2 } },
    { id: 'mix-1', type: 'mixer', params: { level1: 0.5, level2: 0.5, level3: 0, level4: 0 } },
    { id: 'svf-1', type: 'svf', params: { cutoff: 320, resonance: 0.7 } },
    { id: 'drive-1', type: 'drive', params: { drive: 4, bias: 0.12 } },
    { id: 'out-1', type: 'out', params: { level: 0.55 } },
  ],
  cables: [
    { from: ['vco-1', 'out'], to: ['mix-1', 'in1'] },
    { from: ['vco-2', 'out'], to: ['mix-1', 'in2'] },
    { from: ['mix-1', 'out'], to: ['svf-1', 'in'] },
    { from: ['lfo-1', 'bi'], to: ['off-1', 'in'] },
    { from: ['off-1', 'out'], to: ['svf-1', 'cutoff'] },
    { from: ['svf-1', 'lp'], to: ['drive-1', 'in'] },
    { from: ['drive-1', 'out'], to: ['out-1', 'in'] },
  ],
})

/**
 * A hi-hat and a snare out of noise and two filters. No oscillator at all.
 *
 * The other half of the point the drone makes. It is also the patch that most resembles what the rest of
 * this repo does — the drum machines in `@driftbox/engine` are this idea with the knobs welded down.
 */
const percussion = (): Patch => ({
  modules: [
    { id: 'clock-1', type: 'clock', params: { rate: 8, width: 0.1 } },
    { id: 'noise-1', type: 'noise' },
    { id: 'hat-env', type: 'adsr', params: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.02 } },
    { id: 'hat-filter', type: 'svf', params: { cutoff: 7000, resonance: 0.35 } },
    { id: 'hat-vca', type: 'vca', params: { gain: 0, curve: 1 } },
    { id: 'snare-env', type: 'adsr', params: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.06 } },
    { id: 'snare-filter', type: 'ladder', params: { cutoff: 1300, resonance: 0.5 } },
    { id: 'snare-vca', type: 'vca', params: { gain: 0, curve: 1 } },
    { id: 'div-1', type: 'seq', params: { length: 4, gate1: 1, gate2: 0, gate3: 0, gate4: 0 } },
    { id: 'mix-1', type: 'mixer', params: { level1: 0.35, level2: 0.8, level3: 0, level4: 0 } },
    { id: 'out-1', type: 'out', params: { level: 0.65 } },
  ],
  cables: [
    // The hat on every tick.
    { from: ['clock-1', 'trig'], to: ['hat-env', 'trig'] },
    { from: ['noise-1', 'white'], to: ['hat-filter', 'in'] },
    { from: ['hat-filter', 'hp'], to: ['hat-vca', 'in'] },
    { from: ['hat-env', 'out'], to: ['hat-vca', 'cv'] },
    { from: ['hat-vca', 'out'], to: ['mix-1', 'in1'] },
    // The snare on one tick in four — a sequencer used as a clock divider, which is what it is when you
    // switch every step but one off.
    { from: ['clock-1', 'gate'], to: ['div-1', 'clock'] },
    { from: ['div-1', 'trig'], to: ['snare-env', 'trig'] },
    { from: ['noise-1', 'pink'], to: ['snare-filter', 'in'] },
    { from: ['snare-env', 'out'], to: ['snare-filter', 'cutoff'] },
    { from: ['snare-filter', 'out'], to: ['snare-vca', 'in'] },
    { from: ['snare-env', 'out'], to: ['snare-vca', 'cv'] },
    { from: ['snare-vca', 'out'], to: ['mix-1', 'in2'] },
    { from: ['mix-1', 'out'], to: ['out-1', 'in'] },
  ],
})

/**
 * A chopped break and a Reese, which between them is most of what drum and bass is.
 *
 * Two things here are the point of phases B and C rather than decoration:
 *
 * **The Tracker drives the Sampler's slice directly.** Lane 1 is in `Unit` mode, so it divides by 16, and
 * the Sampler multiplies by its own slice count of 16 — the two cancel and a lane value IS a slice number,
 * with no scaler module in between. That is what the Unit switch exists for.
 *
 * One wrinkle worth knowing: a lane value of **zero is a rest**, so slice 0 cannot be written directly.
 * The Sampler wraps its selection, so 16 means slice 0 — which is why this lane counts 1 to 16 rather than
 * 0 to 15. It is a real edge of the design and it costs one sentence to work around.
 *
 * **The Reese is two chains hard apart.** Two saws a fraction of a semitone apart, each through its own
 * filter to its own Out, panned fully left and right. Summed to mono it is still a Reese — the beating is
 * between the oscillators — but split across the field it moves, and that is the phase C pan earning its
 * place.
 */
const cutUp = (): Patch => ({
  tempo: 174,
  break: 'amenish',
  modules: [
    { id: 'transport-1', type: 'transport' },
    {
      id: 'tracker-1',
      type: 'tracker',
      // Lane 1 chops the break, lane 2 plays the bass. Unit mode on lane 1 only: the bass is in semitones
      // like every other pitch in the rack.
      params: { length: 16, unit1: 1 },
      data: {
        // Slices, 1-16. Rests where the break should be left alone.
        lane1: [1, 0, 5, 3, 9, 0, 5, 0, 1, 11, 5, 3, 9, 13, 5, 15],
        // Semitones above the VCO's own tuning, so 12 is the root. Sparse, because a Reese wants room.
        lane2: [12, 0, 0, 0, 12, 0, 15, 0, 0, 0, 10, 0, 12, 0, 0, 0],
      },
    },
    { id: 'sampler-1', type: 'sampler', params: { slices: 16 } },
    // A third of a semitone apart. Far enough to beat, close enough to still be one note.
    //
    // −12 and not lower: 0V on this VCO is C2 at 65.4Hz, and a lane value of 12 is another octave on top,
    // so the root lands back at C2. The tune knob only goes to −24, which the patch test caught.
    { id: 'vco-1', type: 'vco', params: { tune: -12 } },
    { id: 'vco-2', type: 'vco', params: { tune: -11.7 } },
    { id: 'ladder-1', type: 'ladder', params: { cutoff: 420, resonance: 0.45 } },
    { id: 'ladder-2', type: 'ladder', params: { cutoff: 380, resonance: 0.45 } },
    { id: 'adsr-1', type: 'adsr', params: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.15 } },
    { id: 'vca-1', type: 'vca', params: { gain: 0 } },
    { id: 'vca-2', type: 'vca', params: { gain: 0 } },
    { id: 'out-1', type: 'out', params: { level: 0.8 } },
    { id: 'out-2', type: 'out', params: { level: 0.5, pan: -1 } },
    { id: 'out-3', type: 'out', params: { level: 0.5, pan: 1 } },
  ],
  cables: [
    { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
    { from: ['tracker-1', 'trig1'], to: ['sampler-1', 'trig'] },
    { from: ['tracker-1', 'cv1'], to: ['sampler-1', 'slice'] },
    { from: ['sampler-1', 'out'], to: ['out-1', 'in'] },

    { from: ['tracker-1', 'cv2'], to: ['vco-1', 'pitch'] },
    { from: ['tracker-1', 'cv2'], to: ['vco-2', 'pitch'] },
    { from: ['tracker-1', 'gate2'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['vco-2', 'out'], to: ['ladder-2', 'in'] },
    { from: ['ladder-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['ladder-2', 'out'], to: ['vca-2', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['adsr-1', 'out'], to: ['vca-2', 'cv'] },
    { from: ['vca-1', 'out'], to: ['out-2', 'in'] },
    { from: ['vca-2', 'out'], to: ['out-3', 'in'] },
  ],
})

/**
 * A roller: the break straight, the bass ducking under it, a little room on top.
 *
 * The one that exists to show the **sidechain**. The Compressor's key comes from the Sampler rather than
 * from its own input, so every hit of the break pushes the bass down and it climbs back between them. That
 * duck is the pump the genre is built on, and it is one cable.
 *
 * The Reverb sits on the break and not on the bass, at a low mix — the usual arrangement, because reverb on
 * a sub is mud and reverb on a break is space.
 */
const ducked = (): Patch => ({
  tempo: 174,
  break: 'roller',
  modules: [
    { id: 'transport-1', type: 'transport' },
    {
      id: 'tracker-1',
      type: 'tracker',
      params: { length: 16, unit1: 1 },
      data: {
        // Straight and relentless: every other sixteenth, in order, so the break plays as written.
        lane1: [1, 0, 3, 0, 5, 0, 7, 0, 9, 0, 11, 0, 13, 0, 15, 0],
        // Long notes. The bass is doing the work, so it holds rather than skipping about.
        lane2: [12, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 15, 0],
      },
    },
    { id: 'sampler-1', type: 'sampler', params: { slices: 16 } },
    { id: 'reverb-1', type: 'reverb', params: { size: 0.6, decay: 0.75, damp: 0.6, mix: 0.14 } },
    { id: 'vco-1', type: 'vco', params: { tune: -12 } },
    { id: 'vco-2', type: 'vco', params: { tune: -11.85, shape: 1 } },
    { id: 'ladder-1', type: 'ladder', params: { cutoff: 300, resonance: 0.3 } },
    { id: 'adsr-1', type: 'adsr', params: { attack: 0.02, decay: 0.4, sustain: 0.9, release: 0.4 } },
    { id: 'vca-1', type: 'vca', params: { gain: 0 } },
    // Keyed from the break, so it ducks on the beat rather than on itself.
    {
      id: 'compressor-1',
      type: 'compressor',
      params: { threshold: -26, ratio: 8, attack: 0.002, release: 0.11, makeup: 4, knee: 3 },
    },
    { id: 'out-1', type: 'out', params: { level: 0.75 } },
    { id: 'out-2', type: 'out', params: { level: 0.6 } },
  ],
  cables: [
    { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
    { from: ['tracker-1', 'trig1'], to: ['sampler-1', 'trig'] },
    { from: ['tracker-1', 'cv1'], to: ['sampler-1', 'slice'] },
    { from: ['sampler-1', 'out'], to: ['reverb-1', 'in'] },
    { from: ['reverb-1', 'out'], to: ['out-1', 'in'] },

    { from: ['tracker-1', 'cv2'], to: ['vco-1', 'pitch'] },
    { from: ['tracker-1', 'cv2'], to: ['vco-2', 'pitch'] },
    { from: ['tracker-1', 'gate2'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['ladder-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['vca-1', 'out'], to: ['compressor-1', 'in'] },
    // The whole point of the patch.
    { from: ['sampler-1', 'out'], to: ['compressor-1', 'key'] },
    { from: ['compressor-1', 'out'], to: ['out-2', 'in'] },
  ],
})

/**
 * No break at all: the bass does the work.
 *
 * Proof that the genre is not the sample. A sub playing the root, two detuned saws above it through a filter
 * that an LFO opens and closes, and a Drive to make it snarl. The Tracker's third lane triggers a noise hat
 * so there is something keeping time without a sampler anywhere in the patch.
 */
const wobbler = (): Patch => ({
  tempo: 174,
  modules: [
    { id: 'transport-1', type: 'transport' },
    {
      id: 'tracker-1',
      type: 'tracker',
      params: { length: 16 },
      data: {
        // The bassline, in semitones. Long notes with a couple of moves.
        lane1: [12, 0, 0, 0, 12, 0, 0, 0, 15, 0, 0, 10, 0, 0, 12, 0],
        // A hat, on the offbeats. Any non-zero value opens the gate; the value itself is unused here.
        lane2: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
      },
    },
    // The sub an octave below the saws: −24 puts it at C1 once the lane's 12 semitones are added.
    { id: 'vco-1', type: 'vco', params: { tune: -24, shape: 2 } },
    { id: 'vco-2', type: 'vco', params: { tune: -12 } },
    { id: 'vco-3', type: 'vco', params: { tune: -11.8 } },
    { id: 'mixer-1', type: 'mixer', params: { level1: 0.9, level2: 0.5, level3: 0.5, level4: 0.35 } },
    { id: 'lfo-1', type: 'lfo', params: { rate: 1.45, shape: 0 } },
    { id: 'ladder-1', type: 'ladder', params: { cutoff: 260, resonance: 0.62 } },
    { id: 'drive-1', type: 'drive', params: { drive: 3.5 } },
    { id: 'adsr-1', type: 'adsr', params: { attack: 0.015, decay: 0.5, sustain: 0.95, release: 0.3 } },
    { id: 'vca-1', type: 'vca', params: { gain: 0 } },
    // The hat: noise through its own fast envelope, so it needs no sampler and no oscillator.
    { id: 'noise-1', type: 'noise' },
    { id: 'adsr-2', type: 'adsr', params: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.03 } },
    { id: 'vca-2', type: 'vca', params: { gain: 0 } },
    { id: 'out-1', type: 'out', params: { level: 0.7 } },
    { id: 'out-2', type: 'out', params: { level: 0.28, pan: 0.4 } },
  ],
  cables: [
    { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },

    { from: ['tracker-1', 'cv1'], to: ['vco-1', 'pitch'] },
    { from: ['tracker-1', 'cv1'], to: ['vco-2', 'pitch'] },
    { from: ['tracker-1', 'cv1'], to: ['vco-3', 'pitch'] },
    { from: ['tracker-1', 'gate1'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['mixer-1', 'in1'] },
    { from: ['vco-2', 'out'], to: ['mixer-1', 'in2'] },
    { from: ['vco-3', 'out'], to: ['mixer-1', 'in3'] },
    { from: ['mixer-1', 'out'], to: ['ladder-1', 'in'] },
    // The wobble: an LFO on the cutoff, which is the one cable this patch is named for.
    { from: ['lfo-1', 'uni'], to: ['ladder-1', 'cutoff'] },
    { from: ['ladder-1', 'out'], to: ['drive-1', 'in'] },
    { from: ['drive-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['vca-1', 'out'], to: ['out-1', 'in'] },

    { from: ['tracker-1', 'trig2'], to: ['adsr-2', 'trig'] },
    { from: ['noise-1', 'white'], to: ['vca-2', 'in'] },
    { from: ['adsr-2', 'out'], to: ['vca-2', 'cv'] },
    { from: ['vca-2', 'out'], to: ['out-2', 'in'] },
  ],
})

export const PATCHES: readonly PatchPreset[] = [
  {
    id: 'pressure-system',
    name: 'Pressure System',
    blurb: 'A focused D&B roller: break, sub and restrained Reese',
    needsBreak: 'roller',
    build: pressureSystem,
  },
  { id: 'acid', name: 'Acid', blurb: 'A sequenced line through the 303 filter', build: acid },
  { id: 'generative', name: 'Generative', blurb: 'Noise, sampled and quantized into a melody', build: generative },
  { id: 'drone', name: 'Drone', blurb: 'Two oscillators breathing, no sequencer', build: drone },
  { id: 'percussion', name: 'Percussion', blurb: 'A hat and a snare, and no oscillator', build: percussion },
  // Named apart from the BREAKS deliberately. The breaks are already called Jungle, Chopper and Roller, and
  // the two pickers sit next to each other in the same UI — a patch called Chopper that loads a break called
  // Chopper reads as one thing with two names until it very much does not.
  {
    id: 'cutup',
    name: 'Cut Up',
    blurb: 'A chopped break and a Reese, hard apart',
    needsBreak: 'amenish',
    build: cutUp,
  },
  {
    id: 'ducked',
    name: 'Ducked',
    blurb: 'The break straight, the bass ducking under it',
    needsBreak: 'roller',
    build: ducked,
  },
  { id: 'wobbler', name: 'Wobbler', blurb: 'No break at all: the bass does the work', build: wobbler },
]

export const patchPresetById = (id: string): PatchPreset | undefined =>
  PATCHES.find((preset) => preset.id === id)
