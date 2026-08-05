import type { ModuleDef } from '../types.js'

// A bank of settings for one device, and the factory contents of it.
//
// **Reason's third kind of saved thing, and the one this rack did not have.** A `PatchPreset` is a whole
// rack; a `Chunk` is a pre-wired group of devices. Both are about *what exists and how it is wired*. A
// device patch is about none of that: it is one device's knobs, and the browser strip in the corner of
// every faceplate is how you audition twenty filters without patching anything. `docs/REASON-GAP.md`
// listed it as "patch-level" — the library saved whole racks and nothing smaller.
//
// **Knobs only. No modules, no cables, no pattern data, and the omission of the last is deliberate.**
// A device patch is a *sound*. `data` is a Tracker's lanes and an Arranger's sections, which is a
// composition — it belongs to the song, and it already travels as a chunk or as a whole-rack patch.
// Stepping through filter presets should not be able to overwrite the bar you just wrote. There is a
// mechanical reason too, and it points the same way: the host pushes params and data at the audio thread
// by *diffing the patch*, so a slot that disappears from `data` is never sent — nothing tells the
// processor to forget it. Params dodge that only because of `completeParams` below.
//
// **Every device has a bank, even one nobody has written a patch for**, because Init is synthesised from
// the def rather than authored. Same principle as the sparse faceplate registry: adding a module stays a
// class, a def and a test, and it arrives with a working browser and a way back to its defaults.
//
// In this package rather than in the app for the reason `patches/index.ts` gives: this is data about the
// rack, not about the page showing it.

export interface DevicePatch {
  /**
   * Unique **within its module type**, not globally. Two devices may both have a `warm`, because a
   * device patch is only ever offered against the device it belongs to.
   */
  id: string
  /** The module type this belongs to. `init` is the one patch that answers for every type. */
  type: string
  name: string
  /**
   * The knobs. Sparse — only what differs from the def's defaults is worth writing down, because
   * `completeParams` fills the rest in and a patch that restated every default would go stale the
   * moment a default moved.
   */
  params: Record<string, number>
}

/**
 * A device patch's params, completed against the def.
 *
 * **Complete, and that is not a nicety.** The host pushes a param change by diffing the patch and
 * sending what it finds, so a param the patch does not mention is a param the audio thread is never told
 * about — it keeps whatever the last patch left there. Loading Init after a screaming resonant filter
 * would leave the resonance up while the panel drew it back at its default, which is the worst kind of
 * wrong: the picture and the sound disagree. So applying a device patch always states every knob.
 *
 * **Hidden params are excluded.** Those are written by the host rather than turned by anybody — the MIDI
 * module's note, gate and velocity. They are performance, not settings: baking the last note played into
 * a preset and re-sounding it on load is not what the browser is for.
 */
export function completeParams(
  def: ModuleDef,
  params: Record<string, number> = {},
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const param of def.params) {
    if (param.hidden) continue
    const wanted = params[param.id]
    out[param.id] = Number.isFinite(wanted) ? wanted : param.default
  }
  return out
}

/**
 * The way back to a device's defaults, derived rather than written.
 *
 * Reason called it Init Patch and every device had one. Deriving it means it cannot go stale when a
 * default moves, and it means a module that arrives from somewhere else gets one for nothing.
 */
export function initDevicePatch(def: ModuleDef): DevicePatch {
  return { id: 'init', type: def.type, name: 'Init', params: completeParams(def) }
}

/** Every factory patch for one device, Init first. */
export function devicePatchesFor(def: ModuleDef): readonly DevicePatch[] {
  return [
    initDevicePatch(def),
    ...DEVICE_PATCHES.filter((patch) => patch.type === def.type),
  ]
}

/**
 * The factory bank.
 *
 * Written for the devices where a preset is worth having — the ones with enough knobs that finding a
 * usable setting is work. A module with two knobs and an obvious pair of them is served perfectly well by
 * Init, and padding the bank with `Offset (Gain 1)` would make the browser look full rather than useful.
 *
 * Sparse params throughout: what a patch does not say, it does not care about.
 */
export const DEVICE_PATCHES: readonly DevicePatch[] = [
  // ---- Ladder -----------------------------------------------------------------------------------
  { id: 'open', type: 'ladder', name: 'Wide Open', params: { cutoff: 9000, resonance: 0.1 } },
  // The one everybody reaches for, and the reason the ladder is here rather than only the SVF: a 24 dB
  // slope at high resonance is the 303 sound, and the SVF's 12 dB is not.
  { id: 'acid', type: 'ladder', name: 'Acid', params: { cutoff: 500, resonance: 0.92 } },
  { id: 'squelch', type: 'ladder', name: 'Squelch', params: { cutoff: 1600, resonance: 0.78 } },
  { id: 'sub', type: 'ladder', name: 'Sub Shelf', params: { cutoff: 120, resonance: 0.15 } },

  // ---- State variable filter --------------------------------------------------------------------
  { id: 'air', type: 'svf', name: 'Air', params: { cutoff: 9000, resonance: 0.15 } },
  { id: 'telephone', type: 'svf', name: 'Telephone', params: { cutoff: 1400, resonance: 0.5 } },
  // Patched from the high-pass outlet this is the one that makes room for a kick.
  { id: 'rumble', type: 'svf', name: 'Rumble Cut', params: { cutoff: 90, resonance: 0.1 } },

  // ---- Voice ------------------------------------------------------------------------------------
  //
  // The bank that justifies the feature. A Voice has sixteen knobs, which is exactly the count at which
  // "find a good setting" stops being twiddling and starts being work.
  {
    id: 'reese',
    type: 'voice',
    name: 'Reese',
    params: {
      shapeA: 0,
      shapeB: 0,
      detune: 32,
      mix: 0.5,
      cutoff: 700,
      resonance: 0.35,
      envAmount: 1,
      attack: 0.01,
      decay: 1.2,
      sustain: 0.9,
      release: 0.4,
      fDecay: 0.8,
      glide: 0.05,
      level: 0.7,
    },
  },
  {
    id: 'sub',
    type: 'voice',
    name: 'Sub',
    params: {
      tune: -12,
      shapeA: 2,
      shapeB: 2,
      detune: 0,
      cutoff: 400,
      resonance: 0,
      envAmount: 0.5,
      attack: 0.005,
      decay: 0.3,
      sustain: 1,
      release: 0.15,
      level: 0.8,
    },
  },
  {
    id: 'pluck',
    type: 'voice',
    name: 'Pluck',
    params: {
      detune: 5,
      cutoff: 3000,
      resonance: 0.4,
      envAmount: 3,
      attack: 0.001,
      decay: 0.18,
      sustain: 0,
      release: 0.12,
      fDecay: 0.12,
    },
  },
  {
    id: 'pad',
    type: 'voice',
    name: 'Pad',
    params: {
      shapeB: 2,
      detune: 14,
      cutoff: 900,
      resonance: 0.25,
      envAmount: 1.5,
      attack: 1.2,
      decay: 2,
      sustain: 0.8,
      release: 2.5,
      fDecay: 1.5,
      level: 0.55,
    },
  },
  {
    id: 'acid',
    type: 'voice',
    name: 'Acid Lead',
    params: {
      shapeA: 1,
      shapeB: 1,
      width: 0.35,
      detune: 0,
      mix: 0.35,
      cutoff: 600,
      resonance: 0.85,
      envAmount: 4,
      attack: 0.002,
      decay: 0.25,
      sustain: 0.2,
      release: 0.1,
      fDecay: 0.2,
      glide: 0.08,
    },
  },

  // ---- VCO --------------------------------------------------------------------------------------
  //
  // Three knobs, so this bank is short on purpose: Init is already the saw.
  { id: 'square', type: 'vco', name: 'Square', params: { shape: 1, width: 0.5 } },
  { id: 'reed', type: 'vco', name: 'Narrow Pulse', params: { shape: 1, width: 0.12 } },
  { id: 'sub', type: 'vco', name: 'Sub Triangle', params: { shape: 2, tune: -12 } },

  // ---- Wavetable --------------------------------------------------------------------------------
  //
  // Longer than the VCO's bank despite having the same number of knobs, because here the knob positions
  // are not obvious: Position is continuous across eight waveforms, so "the square one" is 3/7 rather
  // than a step somebody can find by turning. These are the eight landmarks, minus the ones Init and the
  // neighbouring entries already cover.
  { id: 'sine', type: 'wavetable', name: 'Sine', params: { position: 0 } },
  { id: 'sub', type: 'wavetable', name: 'Sub Triangle', params: { position: 1 / 7, tune: -12 } },
  { id: 'drawbar', type: 'wavetable', name: 'Drawbar', params: { position: 2 / 7 } },
  { id: 'saw', type: 'wavetable', name: 'Saw', params: { position: 4 / 7 } },
  { id: 'vowel', type: 'wavetable', name: 'Vowel', params: { position: 5 / 7 } },
  { id: 'thin', type: 'wavetable', name: 'Thin Pulse', params: { position: 1 } },
  // The two that are about Index rather than Position, and both want a cable at PM to do anything — a
  // device patch is knobs, so it can set up an FM voice but cannot patch one. Sine carrier, because that
  // is what every FM operator has been since the DX7 and what the sidebands are predictable from.
  { id: 'fm-bell', type: 'wavetable', name: 'FM Bell', params: { position: 0, index: 2.2 } },
  { id: 'fm-growl', type: 'wavetable', name: 'FM Growl', params: { position: 0, index: 4 } },

  // ---- Drive ------------------------------------------------------------------------------------
  { id: 'edge', type: 'drive', name: 'Edge', params: { drive: 1.4 } },
  { id: 'warm', type: 'drive', name: 'Warm', params: { drive: 3 } },
  // Bias is the asymmetry, which is what puts even harmonics in and stops hard drive sounding like a
  // fuzz pedal with a flat battery.
  { id: 'crunch', type: 'drive', name: 'Crunch', params: { drive: 12, bias: 0.1 } },
  { id: 'fuzz', type: 'drive', name: 'Fuzz', params: { drive: 34, bias: 0.35 } },

  // ---- Multi-mode distortion -------------------------------------------------------------------
  { id: 'tube', type: 'distortion', name: 'Tube Warmth', params: { amount: 0.38, tone: 6000, bias: 0.08 } },
  { id: 'tape', type: 'distortion', name: 'Tape Glue', params: { mode: 1, amount: 0.5, tone: 9000 } },
  { id: 'fuzz', type: 'distortion', name: 'Fuzz Wall', params: { mode: 2, amount: 0.82, tone: 3500, level: 0.65 } },
  {
    id: 'digital',
    type: 'distortion',
    name: 'Digital Broken',
    params: { mode: 3, amount: 0.78, tone: 12000, level: 0.7 },
  },

  // ---- Amp / cabinet ----------------------------------------------------------------------------
  { id: 'clean', type: 'cabinet', name: 'Clean Combo', params: { drive: 1.1, treble: 2 } },
  { id: 'crunch', type: 'cabinet', name: 'Combo Crunch', params: { drive: 5, bass: 1, mid: 2, treble: -1 } },
  {
    id: 'stack',
    type: 'cabinet',
    name: 'Big Stack',
    params: { cabinet: 1, drive: 8, bass: 3, mid: 1, treble: -2, level: 0.65 },
  },
  { id: 'bright', type: 'cabinet', name: 'Bright Bite', params: { cabinet: 2, drive: 3, mid: -1, treble: 3 } },

  // ---- Delay ------------------------------------------------------------------------------------
  { id: 'slap', type: 'delay', name: 'Slap', params: { time: 0.09, feedback: 0.15 } },
  { id: 'eighth', type: 'delay', name: 'Eighth', params: { time: 0.25, feedback: 0.4 } },
  { id: 'dub', type: 'delay', name: 'Dub', params: { time: 0.375, feedback: 0.72 } },
  // A delay this short is a comb filter; patch an LFO at the time inlet and it is the chorus and flanger
  // `delay.ts` says are patchable rather than modules of their own.
  { id: 'flange', type: 'delay', name: 'Flange Base', params: { time: 0.005, feedback: 0.55 } },

  // ---- Ping-pong delay --------------------------------------------------------------------------
  { id: 'slap', type: 'ping-pong', name: 'Stereo Slap', params: { time: 0.09, feedback: 0.25 } },
  { id: 'eighth', type: 'ping-pong', name: 'Eighth Bounce', params: { time: 0.25, feedback: 0.6 } },
  { id: 'dub', type: 'ping-pong', name: 'Dub Bounce', params: { time: 0.375, feedback: 0.78 } },

  // ---- Phaser -----------------------------------------------------------------------------------
  { id: 'slow', type: 'phaser', name: 'Slow Swirl', params: { rate: 0.12, depth: 0.8, feedback: 0.3 } },
  { id: 'jet', type: 'phaser', name: 'Jet', params: { rate: 0.55, center: 1200, depth: 0.9, feedback: 0.72, mix: 0.62 } },
  { id: 'shimmer', type: 'phaser', name: 'Stereo Shimmer', params: { rate: 1.4, center: 1800, depth: 0.45, feedback: -0.2, mix: 0.4 } },

  // ---- Stereo imager ----------------------------------------------------------------------------
  { id: 'mono-bass', type: 'imager', name: 'Mono Bass', params: { lowWidth: 0, crossover: 180 } },
  { id: 'wide-top', type: 'imager', name: 'Wide Top', params: { lowWidth: 0.6, highWidth: 1.55 } },
  { id: 'narrow', type: 'imager', name: 'Narrow', params: { lowWidth: 0.65, highWidth: 0.75 } },

  // ---- Reverb -----------------------------------------------------------------------------------
  // **Plate and Hall used to be approximations of themselves**, built out of Size, Decay and Damp because
  // there was one network and those were the only knobs that could suggest a different room. There are now
  // algorithms with those names, so these say so. This is the same staleness the gap ledger is kept against:
  // a preset called Plate that is not the plate algorithm is a worse answer than no preset at all.
  { id: 'room', type: 'reverb', name: 'Room', params: { size: 0.35, decay: 0.5, damp: 0.55, mix: 0.18 } },
  {
    id: 'plate',
    type: 'reverb',
    name: 'Plate',
    params: { algorithm: 2, size: 0.7, decay: 0.8, damp: 0.12, mix: 0.35 },
  },
  {
    id: 'hall',
    type: 'reverb',
    name: 'Hall',
    params: { algorithm: 1, size: 0.85, decay: 0.9, damp: 0.35, mix: 0.3 },
  },
  {
    id: 'cavern',
    type: 'reverb',
    name: 'Cavern',
    params: { algorithm: 1, size: 1, decay: 0.96, damp: 0.6, mix: 0.45 },
  },
  // The one the Guitar Pedalboard was always reaching for. Bright, because a spring tank has no absorption
  // in it worth speaking of, and the chirp is in the top end.
  {
    id: 'spring',
    type: 'reverb',
    name: 'Spring',
    params: { algorithm: 3, size: 0.8, decay: 0.85, damp: 0.1, mix: 0.3 },
  },
  // The eighties snare, which is a plate and a gate and nothing else.
  {
    id: 'gated',
    type: 'reverb',
    name: 'Gated',
    params: {
      algorithm: 2,
      size: 0.8,
      decay: 0.92,
      damp: 0.2,
      mix: 0.6,
      gate: 1,
      gateThresh: 0.05,
      gateHold: 0.12,
      gateRelease: 0.012,
    },
  },
  // What the EQ section is for: a long tail that stays out of the way of everything else in the mix.
  {
    id: 'tucked',
    type: 'reverb',
    name: 'Tucked Away',
    params: { algorithm: 1, size: 0.9, decay: 0.93, damp: 0.45, mix: 0.4, lowCut: 420, highCut: 5200 },
  },

  // ---- Compressor -------------------------------------------------------------------------------
  {
    id: 'glue',
    type: 'compressor',
    name: 'Glue',
    params: { threshold: -18, ratio: 2.5, attack: 0.02, release: 0.25, makeup: 2, knee: 8 },
  },
  // Fast attack, short release: the setting that makes a break sound like it is being played harder
  // rather than like it is being turned down.
  {
    id: 'drums',
    type: 'compressor',
    name: 'Drums',
    params: { threshold: -14, ratio: 6, attack: 0.001, release: 0.08, makeup: 4, knee: 2 },
  },
  {
    id: 'pump',
    type: 'compressor',
    name: 'Pump',
    params: { threshold: -22, ratio: 8, attack: 0.03, release: 0.35, makeup: 5, knee: 1 },
  },

  // ---- Limiter ----------------------------------------------------------------------------------
  { id: 'transparent', type: 'limiter', name: 'Transparent', params: { release: 0.18 } },
  { id: 'loud', type: 'limiter', name: 'Loud', params: { inputGain: 6, ceiling: -1, release: 0.1 } },
  { id: 'punch', type: 'limiter', name: 'Punch', params: { inputGain: 3, ceiling: -0.3, release: 0.05 } },
  // Not a limiter — `REASON-GAP.md` still wants one of those — but it is what this device can do in that
  // direction, and a hard knee is the part that matters.
  {
    id: 'ceiling',
    type: 'compressor',
    name: 'Ceiling',
    params: { threshold: -6, ratio: 20, attack: 0.0002, release: 0.05, makeup: 0, knee: 0 },
  },

  // ---- EQ ---------------------------------------------------------------------------------------
  { id: 'sub-lift', type: 'eq', name: 'Sub Lift', params: { low: 4, lowFreq: 70 } },
  { id: 'air', type: 'eq', name: 'Air', params: { high: 5, highFreq: 9000 } },
  {
    id: 'scoop',
    type: 'eq',
    name: 'Scoop',
    params: { low: 2, mid: -6, midFreq: 600, q: 1.2, high: 3 },
  },
  {
    id: 'telephone',
    type: 'eq',
    name: 'Telephone',
    params: { low: -18, lowFreq: 400, mid: 6, midFreq: 1800, q: 2, high: -18, highFreq: 3000 },
  },

  // ---- Envelope ---------------------------------------------------------------------------------
  { id: 'pluck', type: 'adsr', name: 'Pluck', params: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 } },
  { id: 'organ', type: 'adsr', name: 'Organ', params: { attack: 0.002, decay: 0.05, sustain: 1, release: 0.02 } },
  { id: 'perc', type: 'adsr', name: 'Percussive', params: { attack: 0.0005, decay: 0.35, sustain: 0, release: 0.25 } },
  { id: 'swell', type: 'adsr', name: 'Swell', params: { attack: 1.5, decay: 1, sustain: 0.9, release: 2 } },

  // ---- LFO --------------------------------------------------------------------------------------
  { id: 'vibrato', type: 'lfo', name: 'Vibrato', params: { rate: 5.5, shape: 0 } },
  { id: 'sweep', type: 'lfo', name: 'Slow Sweep', params: { rate: 0.15, shape: 1 } },
  { id: 'gate', type: 'lfo', name: 'Gate', params: { rate: 4, shape: 3 } },
  { id: 'stepped', type: 'lfo', name: 'Stepped', params: { rate: 8, shape: 4 } },

  // ---- Arp --------------------------------------------------------------------------------------
  { id: 'rising', type: 'arp', name: 'Rising Minor', params: { chord: 3, octaves: 2, mode: 0, gate: 0.4 } },
  { id: 'roll', type: 'arp', name: 'Sus Roll', params: { chord: 6, octaves: 3, mode: 2, gate: 0.25 } },
  { id: 'wander', type: 'arp', name: 'Min7 Wander', params: { chord: 5, octaves: 2, mode: 4, gate: 0.6 } },
  // Nearly legato and only octaves: the one that is a bassline rather than a figure.
  { id: 'octaves', type: 'arp', name: 'Octave Bass', params: { chord: 0, octaves: 2, mode: 0, gate: 0.9 } },
  { id: 'played-up', type: 'arp', name: 'Played Chord Up', params: { source: 1, octaves: 1, mode: 0, gate: 0.55 } },
  { id: 'manual-hold', type: 'arp', name: 'Manual Hold', params: { source: 1, octaves: 2, mode: 5, hold: 1, gate: 0.7 } },
  { id: 'tempo-minor', type: 'arp', name: 'Tempo Minor', params: { timing: 1, division: 4, chord: 3, octaves: 2, gate: 0.42 } },
  { id: 'free-scatter', type: 'arp', name: 'Free Scatter', params: { timing: 2, rate: 6.4, chord: 5, octaves: 3, mode: 4, gate: 0.32 } },

  // ---- Scale Player -----------------------------------------------------------------------------
  { id: 'g-major', type: 'scale-player', name: 'G Major', params: { key: 7, scale: 0, filter: 0 } },
  { id: 'a-minor', type: 'scale-player', name: 'A Minor', params: { key: 9, scale: 1, filter: 0 } },
  { id: 'd-dorian', type: 'scale-player', name: 'D Dorian', params: { key: 2, scale: 5, filter: 0 } },
  { id: 'filter-c-major', type: 'scale-player', name: 'C Major Filter', params: { key: 0, scale: 0, filter: 1 } },

  // ---- Chord Player -----------------------------------------------------------------------------
  { id: 'g-major-triad', type: 'chord-player', name: 'G Major Triad', params: { key: 7, scale: 0, notes: 3 } },
  { id: 'minor-seventh', type: 'chord-player', name: 'Minor Seventh', params: { key: 0, scale: 1, notes: 4 } },
  { id: 'open-ninth', type: 'chord-player', name: 'Open Ninth', params: { key: 0, scale: 0, notes: 3, open: 1, color: 1 } },
  {
    id: 'wide-thirteenth',
    type: 'chord-player',
    name: 'Wide Thirteenth',
    params: { key: 0, scale: 0, notes: 5, open: 1, octDown: 1, octUp: 1, color: 1 },
  },

  // ---- Alligator --------------------------------------------------------------------------------
  {
    id: 'tight',
    type: 'alligator',
    name: 'Tight',
    params: { decay1: 0.12, decay2: 0.06, decay3: 0.03 },
  },
  {
    id: 'tails',
    type: 'alligator',
    name: 'Long Tails',
    params: { decay1: 0.9, decay2: 0.5, decay3: 0.25, res2: 0.7 },
  },

  // ---- Vocoder ----------------------------------------------------------------------------------
  {
    id: 'robot',
    type: 'vocoder',
    name: 'Robot',
    params: { bands: 2, attack: 0.002, release: 0.03, dry: 0 },
  },
  {
    id: 'whisper',
    type: 'vocoder',
    name: 'Whisper',
    params: { bands: 1, attack: 0.01, release: 0.12, shift: 5, dry: 0.15 },
  },

  // ---- Follower ---------------------------------------------------------------------------------
  { id: 'fast', type: 'follower', name: 'Fast', params: { attack: 0.001, release: 0.04, gain: 2 } },
  { id: 'smooth', type: 'follower', name: 'Smooth', params: { attack: 0.05, release: 0.6, gain: 1.5 } },

  // ---- Seq --------------------------------------------------------------------------------------
  //
  // The odd one in the bank, and the most useful. Everywhere else a device patch is a *sound*; here the
  // knobs are the notes, so a patch is a line — the Seq's whole design is that its sequence lives in
  // eighteen ordinary params rather than in `data`, and the rule against putting composition in a device
  // patch does not reach it. Four lines you can step through while a clock runs is the shortest route
  // this rack has to somebody hearing a change they did not have to author.
  //
  // Semitones from whatever the oscillator is tuned to, so every one of these works at any pitch.
  {
    id: 'fifths',
    type: 'seq',
    name: 'Rising Fifths',
    params: { length: 8, pitch1: 0, pitch2: 7, pitch3: 12, pitch4: 19, pitch5: 24, pitch6: 19, pitch7: 12, pitch8: 7 },
  },
  {
    id: 'acid',
    type: 'seq',
    name: 'Acid Line',
    // The rests are the line. Every step on is a scale; a third of them off is a riff.
    params: {
      length: 8,
      pitch1: 0, pitch2: 0, pitch3: 12, pitch4: 0, pitch5: 3, pitch6: 0, pitch7: 10, pitch8: 12,
      gate2: 0, gate4: 0, gate6: 0,
    },
  },
  {
    id: 'pulse',
    type: 'seq',
    name: 'Bass Pulse',
    // Four steps, all root, one octave jump: the pattern that sits under everything and asks for nothing.
    params: { length: 4, pitch1: -12, pitch2: -12, pitch3: -12, pitch4: 0, glide: 0.12 },
  },
  {
    id: 'drift',
    type: 'seq',
    name: 'Slow Drift',
    // Long glide and wide intervals — the same eight knobs used as a modulation source rather than a
    // melody, which is what a Seq patched into a filter cutoff instead of a pitch inlet becomes.
    params: {
      length: 6,
      pitch1: 0, pitch2: 5, pitch3: -7, pitch4: 12, pitch5: -3, pitch6: 7,
      glide: 0.62,
    },
  },

  // ---- Note Echo --------------------------------------------------------------------------------
  { id: 'fade', type: 'note-echo', name: 'Fading Sixteenths', params: { repeats: 5, division: 3, velocity: 0.7, gate: 0.35 } },
  // Repeats that climb. Pitch accumulates, so five repeats at +7 is two and a half octaves of stack.
  { id: 'rising', type: 'note-echo', name: 'Rising Fifths', params: { repeats: 4, division: 4, pitch: 7, velocity: 0.8, gate: 0.4 } },
  { id: 'octave-drop', type: 'note-echo', name: 'Octave Drop', params: { repeats: 2, division: 5, pitch: -12, velocity: 0.9, gate: 0.7 } },
  // Only the echoes. A second instrument answering the one you are playing, rather than thickening it.
  { id: 'answer', type: 'note-echo', name: 'Answer Only', params: { repeats: 3, division: 4, pitch: 5, dry: 0, gate: 0.45 } },

  // ---- Sampler ----------------------------------------------------------------------------------
  //
  // Slice counts rather than sounds, because that is the setting a loaded break is wrong at: a bar cut
  // into sixteen and a bar cut into eight are different instruments made of the same audio.
  { id: 'thirty-two', type: 'sampler', name: '32 Slices', params: { slices: 32 } },
  { id: 'eighths', type: 'sampler', name: '8 Slices', params: { slices: 8 } },
  { id: 'reverse', type: 'sampler', name: 'Reverse Slices', params: { slices: 16, reverse: 1 } },
  // No slicing at all: one looping sample, which is how a sampler becomes a drone or a bed.
  { id: 'whole-loop', type: 'sampler', name: 'Whole Loop', params: { slices: 1, loop: 1 } },
]
