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
// Four, and they deliberately share almost nothing — because the point of a modular is that it is not one
// instrument, and four patches that were all sequenced acid lines would demonstrate the opposite. There is
// one with no sequencer in it at all and one with no oscillator.

export interface PatchPreset {
  id: string
  name: string
  /** One line, for the picker. */
  blurb: string
  build(): Patch
}

/** A sequenced acid line: clock into sequencer into envelope, oscillator through the ladder into a VCA.
 *  The shortest description of what the rack can do, and what an empty rack is opened with. */
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

export const PATCHES: readonly PatchPreset[] = [
  { id: 'acid', name: 'Acid', blurb: 'A sequenced line through the 303 filter', build: acid },
  { id: 'generative', name: 'Generative', blurb: 'Noise, sampled and quantized into a melody', build: generative },
  { id: 'drone', name: 'Drone', blurb: 'Two oscillators breathing, no sequencer', build: drone },
  { id: 'percussion', name: 'Percussion', blurb: 'A hat and a snare, and no oscillator', build: percussion },
]

export const patchPresetById = (id: string): PatchPreset | undefined =>
  PATCHES.find((preset) => preset.id === id)
