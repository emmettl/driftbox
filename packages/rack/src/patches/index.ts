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
  /** Editorial context for the visual preset browser. */
  kicker: string
  features: readonly string[]
  accent: 'mint' | 'pink' | 'amber' | 'violet'
  featured?: boolean
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
    { id: 'meter-break', type: 'meter', params: { mode: 1, gain: 1.3, release: 0.22 } },
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
    { from: ['reverb-1', 'out'], to: ['meter-break', 'in'] },
    { from: ['meter-break', 'thru'], to: ['out-1', 'in'] },

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
    { id: 'drive-1', type: 'drive', params: { drive: 2.8, bias: 0.04 } },
    { id: 'reverb-1', type: 'reverb', params: { size: 0.34, decay: 0.45, damp: 0.74, mix: 0.11 } },
    { id: 'meter-1', type: 'meter', params: { mode: 2, gain: 1.4, release: 0.16 } },
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
    { from: ['vca-1', 'out'], to: ['drive-1', 'in'] },
    { from: ['drive-1', 'out'], to: ['reverb-1', 'in'] },
    { from: ['reverb-1', 'out'], to: ['meter-1', 'in'] },
    { from: ['meter-1', 'thru'], to: ['out-1', 'in'] },
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
    { id: 'meter-1', type: 'meter', params: { mode: 0, gain: 1.2, release: 0.5 } },
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
    { from: ['mix-1', 'out'], to: ['meter-1', 'in'] },
    { from: ['meter-1', 'thru'], to: ['out-1', 'in'] },
  ],
})

/**
 * A monitor doing musical work: every noise pulse is visible on the first VU, and the same ballistic
 * envelope leaves its Env jack to open the drone filter. The second monitor shows the combined result.
 * It turns what can look like a decorative analyser into an obvious, patchable source of control voltage.
 */
const signalRelay = (): Patch => ({
  modules: [
    { id: 'clock-1', type: 'clock', params: { rate: 3, width: 0.12 } },
    { id: 'noise-1', type: 'noise' },
    { id: 'pulse-env', type: 'adsr', params: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.12 } },
    { id: 'pulse-vca', type: 'vca', params: { gain: 0, curve: 1 } },
    { id: 'meter-pulse', type: 'meter', params: { mode: 0, gain: 2.2, release: 0.28 } },
    { id: 'env-shape', type: 'offset', params: { gain: 1.7, offset: 0.06 } },
    { id: 'vco-1', type: 'vco', params: { tune: -17, shape: 1, width: 0.42 } },
    { id: 'ladder-1', type: 'ladder', params: { cutoff: 240, resonance: 0.68 } },
    { id: 'drive-1', type: 'drive', params: { drive: 2.4, bias: 0.03 } },
    { id: 'mix-1', type: 'mixer', params: { level1: 0.64, level2: 0.22, level3: 0, level4: 0 } },
    { id: 'reverb-1', type: 'reverb', params: { size: 0.58, decay: 0.68, damp: 0.7, mix: 0.16 } },
    { id: 'meter-main', type: 'meter', params: { mode: 2, gain: 1.25, release: 0.32 } },
    { id: 'out-1', type: 'out', params: { level: 0.58 } },
  ],
  cables: [
    { from: ['clock-1', 'trig'], to: ['pulse-env', 'trig'] },
    { from: ['noise-1', 'pink'], to: ['pulse-vca', 'in'] },
    { from: ['pulse-env', 'out'], to: ['pulse-vca', 'cv'] },
    { from: ['pulse-vca', 'out'], to: ['meter-pulse', 'in'] },
    { from: ['meter-pulse', 'env'], to: ['env-shape', 'in'] },
    { from: ['env-shape', 'out'], to: ['ladder-1', 'cutoff'] },
    { from: ['vco-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['ladder-1', 'out'], to: ['drive-1', 'in'] },
    { from: ['drive-1', 'out'], to: ['mix-1', 'in1'] },
    { from: ['meter-pulse', 'thru'], to: ['mix-1', 'in2'] },
    { from: ['mix-1', 'out'], to: ['reverb-1', 'in'] },
    { from: ['reverb-1', 'out'], to: ['meter-main', 'in'] },
    { from: ['meter-main', 'thru'], to: ['out-1', 'in'] },
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
    { id: 'meter-break', type: 'meter', params: { mode: 2, gain: 1.25, release: 0.14 } },
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
    { id: 'meter-left', type: 'meter', params: { mode: 1, gain: 1.4, release: 0.2 } },
    { id: 'meter-right', type: 'meter', params: { mode: 1, gain: 1.4, release: 0.2 } },
    { id: 'out-1', type: 'out', params: { level: 0.8 } },
    { id: 'out-2', type: 'out', params: { level: 0.5, pan: -1 } },
    { id: 'out-3', type: 'out', params: { level: 0.5, pan: 1 } },
  ],
  cables: [
    { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
    { from: ['tracker-1', 'trig1'], to: ['sampler-1', 'trig'] },
    { from: ['tracker-1', 'cv1'], to: ['sampler-1', 'slice'] },
    { from: ['sampler-1', 'out'], to: ['meter-break', 'in'] },
    { from: ['meter-break', 'thru'], to: ['out-1', 'in'] },

    { from: ['tracker-1', 'cv2'], to: ['vco-1', 'pitch'] },
    { from: ['tracker-1', 'cv2'], to: ['vco-2', 'pitch'] },
    { from: ['tracker-1', 'gate2'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['vco-2', 'out'], to: ['ladder-2', 'in'] },
    { from: ['ladder-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['ladder-2', 'out'], to: ['vca-2', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['adsr-1', 'out'], to: ['vca-2', 'cv'] },
    { from: ['vca-1', 'out'], to: ['meter-left', 'in'] },
    { from: ['meter-left', 'thru'], to: ['out-2', 'in'] },
    { from: ['vca-2', 'out'], to: ['meter-right', 'in'] },
    { from: ['meter-right', 'thru'], to: ['out-3', 'in'] },
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
    { id: 'meter-key', type: 'meter', params: { mode: 0, gain: 1.35, release: 0.18 } },
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
    { id: 'meter-duck', type: 'meter', params: { mode: 1, gain: 1.2, release: 0.36 } },
    { id: 'out-1', type: 'out', params: { level: 0.75 } },
    { id: 'out-2', type: 'out', params: { level: 0.6 } },
  ],
  cables: [
    { from: ['transport-1', 'sixteenth'], to: ['tracker-1', 'clock'] },
    { from: ['tracker-1', 'trig1'], to: ['sampler-1', 'trig'] },
    { from: ['tracker-1', 'cv1'], to: ['sampler-1', 'slice'] },
    { from: ['sampler-1', 'out'], to: ['meter-key', 'in'] },
    { from: ['meter-key', 'thru'], to: ['reverb-1', 'in'] },
    { from: ['reverb-1', 'out'], to: ['out-1', 'in'] },

    { from: ['tracker-1', 'cv2'], to: ['vco-1', 'pitch'] },
    { from: ['tracker-1', 'cv2'], to: ['vco-2', 'pitch'] },
    { from: ['tracker-1', 'gate2'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['ladder-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['vca-1', 'out'], to: ['compressor-1', 'in'] },
    // The whole point of the patch.
    { from: ['meter-key', 'thru'], to: ['compressor-1', 'key'] },
    { from: ['compressor-1', 'out'], to: ['meter-duck', 'in'] },
    { from: ['meter-duck', 'thru'], to: ['out-2', 'in'] },
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
    { id: 'meter-bass', type: 'meter', params: { mode: 2, gain: 1.15, release: 0.2 } },
    { id: 'meter-hat', type: 'meter', params: { mode: 1, gain: 1.8, release: 0.09 } },
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
    { from: ['vca-1', 'out'], to: ['meter-bass', 'in'] },
    { from: ['meter-bass', 'thru'], to: ['out-1', 'in'] },

    { from: ['tracker-1', 'trig2'], to: ['adsr-2', 'trig'] },
    { from: ['noise-1', 'white'], to: ['vca-2', 'in'] },
    { from: ['adsr-2', 'out'], to: ['vca-2', 'cv'] },
    { from: ['vca-2', 'out'], to: ['meter-hat', 'in'] },
    { from: ['meter-hat', 'thru'], to: ['out-2', 'in'] },
  ],
})

/**
 * A practical live guitar chain, rather than a synth patch waiting for a note.
 *
 * The SVF removes subsonic handling noise before the Drive; Amp / Cab supplies the
 * driven preamp and speaker rolloff the direct interface cannot, then EQ shapes the
 * recorded tone. Delay is wet-only by design, so the Mixer makes its dry/wet path
 * visible before the small room.
 */
const guitarPedalboard = (): Patch => ({
  modules: [
    { id: 'input-1', type: 'audio-input', params: { level: 1, channel: 0 } },
    { id: 'tuner-1', type: 'tuner', params: { reference: 440, mute: 0 } },
    { id: 'meter-input', type: 'meter', params: { mode: 0, gain: 1.5, release: 0.34 } },
    { id: 'highpass-1', type: 'svf', params: { cutoff: 70, resonance: 0 } },
    { id: 'drive-1', type: 'drive', params: { drive: 4.5, bias: 0.04 } },
    {
      id: 'cabinet-1',
      type: 'cabinet',
      params: { cabinet: 0, drive: 1.4, bass: 1, mid: 0.5, treble: -1.5, level: 0.9 },
    },
    {
      id: 'eq-1',
      type: 'eq',
      params: {
        low: 1.5,
        lowFreq: 120,
        mid: -2.5,
        midFreq: 800,
        q: 1.2,
        high: -7,
        highFreq: 5000,
      },
    },
    {
      id: 'compressor-1',
      type: 'compressor',
      params: { threshold: -20, ratio: 3, attack: 0.006, release: 0.14, makeup: 3, knee: 6 },
    },
    { id: 'delay-1', type: 'delay', params: { time: 0.32, feedback: 0.24 } },
    { id: 'wet-dry-1', type: 'mixer', params: { level1: 1, level2: 0.2 } },
    { id: 'reverb-1', type: 'reverb', params: { size: 0.5, decay: 0.62, damp: 0.66, mix: 0.14 } },
    { id: 'looper-1', type: 'looper', params: { mode: 0, feedback: 0.85, dry: 1, loop: 1 } },
    { id: 'meter-output', type: 'meter', params: { mode: 1, gain: 1.2, release: 0.24 } },
    { id: 'out-1', type: 'out', params: { level: 0.75 } },
  ],
  cables: [
    { from: ['input-1', 'out'], to: ['tuner-1', 'in'] },
    { from: ['tuner-1', 'thru'], to: ['meter-input', 'in'] },
    { from: ['meter-input', 'thru'], to: ['highpass-1', 'in'] },
    { from: ['highpass-1', 'hp'], to: ['drive-1', 'in'] },
    { from: ['drive-1', 'out'], to: ['cabinet-1', 'in'] },
    { from: ['cabinet-1', 'out'], to: ['eq-1', 'in'] },
    { from: ['eq-1', 'out'], to: ['compressor-1', 'in'] },
    { from: ['compressor-1', 'out'], to: ['wet-dry-1', 'in1'] },
    { from: ['compressor-1', 'out'], to: ['delay-1', 'in'] },
    { from: ['delay-1', 'out'], to: ['wet-dry-1', 'in2'] },
    { from: ['wet-dry-1', 'out'], to: ['reverb-1', 'in'] },
    { from: ['reverb-1', 'out'], to: ['looper-1', 'in'] },
    { from: ['looper-1', 'out'], to: ['meter-output', 'in'] },
    { from: ['meter-output', 'thru'], to: ['out-1', 'in'] },
  ],
})

/**
 * Stable type ids for devices the guitar factory must adopt when they land.
 *
 * `patches.test.ts` turns this note into an obligation: once one of these module types is
 * registered, the test fails until the factory chain actually uses it. That keeps this
 * list from becoming the usual roadmap paragraph that survives after the gap is fixed.
 */
export const GUITAR_PEDALBOARD_GAPS = [
  { type: 'cabinet', name: 'amp/cabinet voicing' },
  { type: 'tuner', name: 'chromatic tuner' },
  { type: 'looper', name: 'performance looper' },
] as const

export const PATCHES: readonly PatchPreset[] = [
  {
    id: 'pressure-system',
    name: 'Pressure System',
    blurb: 'A focused D&B roller: break, sub and restrained Reese',
    kicker: 'Featured performance',
    features: ['arranged song', '4 macro controls', 'LED monitoring'],
    accent: 'mint',
    featured: true,
    needsBreak: 'roller',
    build: pressureSystem,
  },
  {
    id: 'signal-relay',
    name: 'Signal Relay',
    blurb: 'A beat becomes CV and animates its own harmonic drone',
    kicker: 'Monitoring as an instrument',
    features: ['VU envelope CV', 'self-running', 'wave monitor'],
    accent: 'amber',
    featured: true,
    build: signalRelay,
  },
  {
    id: 'acid',
    name: 'Neon Acid',
    blurb: 'A driven sequenced line with space and a live scope',
    kicker: 'Classic signal path',
    features: ['step sequencer', '303 filter', 'wave monitor'],
    accent: 'pink',
    build: acid,
  },
  {
    id: 'generative',
    name: 'Chance Garden',
    blurb: 'Noise sampled and quantized into an endless melody',
    kicker: 'Generative system',
    features: ['sample & hold', 'quantizer', 'VU monitoring'],
    accent: 'violet',
    build: generative,
  },
  // Named apart from the BREAKS deliberately. The breaks are already called Jungle, Chopper and Roller, and
  // the two pickers sit next to each other in the same UI — a patch called Chopper that loads a break called
  // Chopper reads as one thing with two names until it very much does not.
  {
    id: 'cutup',
    name: 'Cut Up',
    blurb: 'A chopped break and a Reese split hard across stereo',
    kicker: 'Sampler workout',
    features: ['sliced break', 'stereo Reese', '3 live monitors'],
    accent: 'pink',
    needsBreak: 'amenish',
    build: cutUp,
  },
  {
    id: 'ducked',
    name: 'Sidechain Pressure',
    blurb: 'Watch the break push a sustained bass out of its way',
    kicker: 'Dynamics study',
    features: ['sidechain key', 'before / after VU', 'rolling break'],
    accent: 'mint',
    needsBreak: 'roller',
    build: ducked,
  },
  {
    id: 'wobbler',
    name: 'Substation',
    blurb: 'A snarling three-oscillator bass with synthetic hats',
    kicker: 'No samples required',
    features: ['modulated bass', 'synth drums', 'dual monitors'],
    accent: 'amber',
    build: wobbler,
  },
  {
    id: 'guitar-pedalboard',
    name: 'Live Wire',
    blurb: 'Live guitar through drive, dynamics, echo and room',
    kicker: 'External input chain',
    features: ['input / output VU', 'parallel delay', 'tone shaping'],
    accent: 'violet',
    build: guitarPedalboard,
  },
]

export const patchPresetById = (id: string): PatchPreset | undefined =>
  PATCHES.find((preset) => preset.id === id)
