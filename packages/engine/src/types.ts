// A drum voice, described as data rather than as code that pokes at an AudioContext.
//
// This split is the load-bearing idea of the whole engine. Every voice is a pure
// function from its knob positions to a VoiceSpec — a list of oscillators, noise
// sources, envelopes and filters — and a separate renderer turns that spec into Web
// Audio nodes. Nothing about the spec knows an AudioContext exists.
//
// It buys three things. The synthesis is unit-testable without an audio device, which
// matters because "does the kick have a pitch envelope" is otherwise only answerable
// by ear. A patch can be serialised, diffed and shipped as data. And the same spec can
// be rendered into a live context or an OfflineAudioContext, which is how the voices
// are actually verified: render one, then measure the samples that come out.

/** How a value travels to its next breakpoint. Exponential is the analogue-sounding
 *  one and what almost every drum envelope wants; linear is for the rare case where a
 *  value must legitimately pass through or reach zero. */
export type CurveKind = 'exp' | 'lin'

/** One envelope breakpoint: reach `to` at `at` seconds after the hit begins. The
 *  starting value is implicit — the source's own frequency or gain — so an envelope is
 *  a list of destinations rather than a list of segments. */
export interface Breakpoint {
  to: number
  at: number
  curve?: CurveKind
}

export interface FilterSpec {
  type: BiquadFilterType
  frequency: number
  /** Resonance. The 808's hats and cowbell lean on this hard. */
  Q?: number
  /** Optional sweep, starting from `frequency`. */
  envelope?: Breakpoint[]
}

interface SourceCommon {
  /** Peak level of this source before the voice's own output gain. */
  gain: number
  /** Amplitude envelope, starting from silence. The first breakpoint is the attack. */
  amp: Breakpoint[]
  /** Per-source filter, applied before the voice filter. */
  filter?: FilterSpec
  /** Seconds to wait before this source starts — the 808 clap's retriggers are this. */
  delay?: number
}

export interface OscSource extends SourceCommon {
  kind: 'osc'
  type: OscillatorType
  frequency: number
  /** Pitch envelope, starting from `frequency`. The drop that makes a kick a kick. */
  pitch?: Breakpoint[]
}

export interface NoiseSource extends SourceCommon {
  kind: 'noise'
  /**
   * Optional PCM character for a noise source.
   *
   * The 909's hats and cymbals came from low-resolution ROM rather than an analogue
   * noise circuit. Giving their procedural waveform the ROM's sample rate and bit depth
   * reproduces that bandwidth and grain without embedding somebody else's recording.
   */
  sampleRate?: number
  bitDepth?: number
  /** A seed makes repeated hits read the same generated waveform, like a sample ROM. */
  seed?: number
  /** Playback speed, used by the tune control on generated PCM voices. */
  playbackRate?: number
}

export type Source = OscSource | NoiseSource

export interface VoiceSpec {
  /** How long the whole voice lasts, including tail. Used to stop and release nodes;
   *  a voice that outlives this is simply cut off, so it must be honest. */
  duration: number
  sources: Source[]
  /** Filter across the summed sources. */
  filter?: FilterSpec
  /** Waveshaper amount, 0 = clean. The 909's kick and clap want a little grit. */
  drive?: number
  /** Final level for the whole voice. */
  gain: number
  /** -1 hard left to 1 hard right. */
  pan?: number
  /**
   * Output normalisation, applied at the very end of the chain — see Voice.trim.
   *
   * It has to be last, after the waveshaper. A soft-clipping curve maps ±1 to ±1 and
   * lifts everything quieter towards it, so trimming the signal going IN to the drive
   * stage barely changes the level coming out; it just saturates less. Measured on the
   * 909 kick: trimming pre-drive moved its peak from 1.42 to 1.42.
   */
  trim?: number
}

/** The knobs a voice exposes, normalised 0..1 so the UI and any automation can treat
 *  every voice identically. Each voice maps these onto its own real ranges. */
export interface VoiceParams {
  level: number
  tune: number
  decay: number
  tone: number
  /** Extra per-voice character: snappy on a snare, drive on a kick. */
  colour: number
  pan: number
}

export const DEFAULT_PARAMS: VoiceParams = {
  level: 0.8,
  tune: 0.5,
  decay: 0.5,
  tone: 0.5,
  colour: 0.5,
  pan: 0.5,
}

/** A voice is a name, a machine, and the pure function from knobs to sound. */
export interface Voice {
  id: string
  name: string
  machine: MachineId
  /** Whether this voice cuts another off — closed and open hats share a channel on the
   *  real machines, and an open hat must be choked by the next closed one. */
  choke?: string
  /**
   * Output normalisation, applied on top of whatever the voice builds.
   *
   * Every voice sums a different number of sources with different gains, so their
   * natural peaks land all over the place — measured across the kit, an 808 snare came
   * out at 2.27 while its clap and closed hat sat at 0.25. That is a nine-to-one
   * mismatch, which means the clap is inaudible under the kick and the snare is
   * clipping before it reaches the bus.
   *
   * These trims bring every voice to roughly the same peak, so the synthesis is
   * neutral and the MUSICAL balance is set by the level knobs and the kit defaults,
   * which is where it belongs. They are measured, not guessed: render each voice
   * offline at default knobs, take the peak, divide.
   */
  trim?: number
  /**
   * The fundamental this voice covers, in Hz, across its tune knob — for voices where
   * that knob is a pitch rather than a character.
   *
   * Declared here because the mapping lives inside the builder, where nothing outside can
   * see it. With it, a caller can go the other way: work out the tune value that lands a
   * given note, and play a tom from a keyboard.
   *
   * These ranges are a little under an octave. That is deliberate rather than an
   * oversight: a real 808's tom tuning is limited, and reaching further means playing a
   * different tom — which is why the machine has three of them. It is a soft limit
   * though, not a hard one, so do not narrow these to prove a point.
   */
  pitched?: { low: number; high: number }
  build: (params: VoiceParams, accent: number) => VoiceSpec
}

/**
 * The tune knob position that puts a pitched voice at `hz`, clamped to what it can do.
 *
 * Returns null for a voice with no declared range, rather than guessing — a cowbell's
 * tune knob moves its pitch too, but not in a way anybody plays tunes on.
 */
export function tuneForPitch(voice: Voice, hz: number): number | null {
  if (!voice.pitched) return null
  const { low, high } = voice.pitched
  return Math.max(0, Math.min(1, (hz - low) / (high - low)))
}

export type MachineId = 'tr808' | 'tr909'
