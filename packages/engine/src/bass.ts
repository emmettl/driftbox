import { range, ratioRange } from './voices/common.js'

// The TB-303, as data. Same split as the drum voices: this file is a pure function from
// knobs and a step to a description of one note, and `bassline.ts` is the only thing
// that turns that into audio nodes.
//
// A 303 is a simpler synth than any of the drum voices — one oscillator, one filter,
// one envelope each. Everything that makes a 303 line sound like a 303 line rather than
// a synth playing sixteenths is in how the notes RELATE to each other, which is why
// this takes the previous step as an argument:
//
//   SLIDE  a step marked slide does not end. The next note glides into it on the same
//          envelope, so two notes share one attack. This is the sound of an acid line
//          leaning rather than stepping.
//   ACCENT louder, brighter, and more resonant — one flag driving three things at once,
//          because on the hardware the accent voltage feeds the VCA, the filter
//          envelope and the resonance circuit together.
//
// Take either away and you have a monosynth playing a pattern.

/** Off, or a note. `note` is semitones above the synth's root. */
export interface BassStep {
  /** Semitones above the root, or null for a rest. */
  note: number | null
  accent: boolean
  /** Hold through the next step and glide into it, rather than stopping. */
  slide: boolean
}

export const REST: BassStep = { note: null, accent: false, slide: false }

export interface BassParams {
  /** Root pitch, two octaves centred on A1. */
  tune: number
  /** Oscillator shape. Under 0.5 is the sawtooth, over it the square — a knob standing
   *  in for the hardware's switch, so the panel can treat it like every other control. */
  wave: number
  /** Where the filter sits with the envelope at rest. */
  cutoff: number
  /** 1 is past the point of self-oscillation. Most of the character lives up here. */
  resonance: number
  /** How far the envelope pushes the cutoff above where the knob left it. */
  envMod: number
  /** Filter envelope decay. On the real machine this knob does NOT touch the amplitude
   *  envelope, and it is worth keeping that way: it is why turning it down makes a line
   *  more clipped and percussive rather than merely shorter. */
  decay: number
  /** How much an accented step differs from an unaccented one. */
  accent: number
  level: number
}

export const DEFAULT_BASS_PARAMS: BassParams = {
  tune: 0.5,
  wave: 0,
  cutoff: 0.32,
  resonance: 0.72,
  envMod: 0.6,
  decay: 0.42,
  accent: 0.6,
  level: 0.7,
}

export interface BassVoice {
  id: string
  name: string
}

/** Two of them, as on ReBirth. Two lines an octave or a bar apart is most of the genre. */
export const BASS_VOICES: BassVoice[] = [
  { id: '303.a', name: '303 A' },
  { id: '303.b', name: '303 B' },
]

const BASS_BY_ID = new Map(BASS_VOICES.map((v) => [v.id, v]))

export function bassVoiceById(id: string): BassVoice | undefined {
  return BASS_BY_ID.get(id)
}

/** One note, ready to be scheduled. Frequencies in Hz, times in seconds. */
export interface BassNote {
  frequency: number
  /** Seconds to glide from the previous note. 0 means this note starts on pitch. */
  glide: number
  /** Whether the envelopes start again. False when sliding out of the previous note —
   *  that shared envelope is the whole point of a slide. */
  retrigger: boolean
  /** How long the note is held before its release. A sliding note runs past the next
   *  step so there is something for the next note to glide out of. */
  gate: number
  wave: OscillatorType
  gain: number
  resonance: number
  filter: {
    /** Where the sweep starts. */
    peak: number
    /** Where it settles, and where it sits with the envelope at rest. */
    base: number
    decay: number
  }
}

/** The 303's slide time. Fixed on the hardware, and short enough that it reads as a
 *  lean into the next note rather than as a portamento effect. */
export const SLIDE_SECONDS = 0.055

/** Root of the note numbering, at tune 0.5. A1 — a 303 lives an octave or so around it. */
const ROOT_HZ = 55

/** Nothing above this, however far the envelope is pushed. A resonant peak up near
 *  Nyquist is not brightness, it is aliasing. */
const CUTOFF_CEILING = 11000

/**
 * Build the note for `step`, given what came before it.
 *
 * `previous` decides whether this note glides in; pass the step before this one in the
 * pattern, wrapping at the bar, or `REST` if there is nothing before it. `stepSeconds`
 * sets the gate length, so the same pattern holds its notes correctly at any tempo.
 */
export function bassNote(
  params: BassParams,
  step: BassStep,
  previous: BassStep,
  stepSeconds: number,
): BassNote | null {
  if (step.note === null) return null

  const root = ratioRange(params.tune, ROOT_HZ / 2, ROOT_HZ * 2)
  const frequency = root * Math.pow(2, step.note / 12)

  // Sliding in: the previous step said hold, and it had a note to hold.
  const slidingIn = previous.slide && previous.note !== null
  const accent = step.accent ? range(params.accent, 0.15, 1) : 0

  const base = ratioRange(params.cutoff, 90, 4200)
  // The envelope multiplies the cutoff rather than adding to it, so the sweep covers the
  // same musical distance wherever the knob is sitting. An accent opens it further —
  // that extra brightness on accented notes is more of what people hear as "acid" than
  // the extra volume is.
  const peak = Math.min(CUTOFF_CEILING, base * (1 + range(params.envMod, 0, 1) * 7 + accent * 5))

  return {
    frequency,
    glide: slidingIn ? SLIDE_SECONDS : 0,
    retrigger: !slidingIn,
    // A sliding note has to outlast its own step or there is nothing left sounding for
    // the next note to glide out of. An ordinary one stops short, leaving the gap that
    // makes a line articulate rather than a drone.
    gate: stepSeconds * (step.slide ? 1.05 : 0.52),
    wave: params.wave < 0.5 ? 'sawtooth' : 'square',
    gain: range(params.level, 0, 1) * (0.62 + 0.38 * accent),
    // Accent leans on the resonance circuit too, which is why an accented note squelches
    // harder and not just louder.
    resonance: Math.min(1, range(params.resonance, 0, 1) + accent * 0.12),
    filter: {
      peak,
      base,
      decay: ratioRange(params.decay, 0.05, 1.4),
    },
  }
}

/** The step before `index`, wrapping at the bar — a line's first note slides out of its
 *  last one when it loops, which is how a one-bar acid pattern keeps moving. */
export function previousStep(steps: BassStep[], index: number, length: number): BassStep {
  if (length <= 0) return REST
  return steps[((index - 1) % length + length) % length] ?? REST
}

export function emptyBassLine(length = 16): BassStep[] {
  return Array.from({ length }, () => ({ ...REST }))
}
