import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { Graph } from '../graph.js'
import { MODULES } from './index.js'
import { VOICE_MODULE, VoiceProcessor } from './voice.js'
import { Osc } from '../dsp/osc.js'
import { Ladder } from '@driftbox/engine'
import type { ModuleDef, Patch } from '../types.js'

// The claim the module exists for is not "it filters correctly" — the Ladder is already measured in the
// engine and the oscillator in `vco.test.ts`. It is that **this is one device you can play**: a gate makes
// a note on its own, and eight of them are eight different notes. Everything here is one of those two.

const SR = 44100
const FRAMES = 128

const deps = { Osc, Ladder }
const param = (id: string) => VOICE_MODULE.params.findIndex((p) => p.id === id)

/** Run the voice with `gate` held as given, and hand back its output. */
function play(
  frames: number,
  gate: (i: number) => number,
  overrides: Record<string, number> = {},
  pitch = 0,
): Float64Array {
  const voice = new VoiceProcessor(SR, deps)
  const pitchIn = new Float32Array(frames).fill(pitch)
  const gateIn = Float32Array.from({ length: frames }, (_, i) => gate(i))
  const cv = new Float32Array(frames)
  const params = VOICE_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
  for (const [id, value] of Object.entries(overrides)) params[param(id)].fill(value)

  const out = [new Float32Array(frames), new Float32Array(frames)]
  voice.process([pitchIn, gateIn, cv], out, params, frames)
  return Float64Array.from(out[0])
}

const rms = (data: ArrayLike<number>): number => {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

/** Zero crossings per second, which is a good enough pitch estimate for a saw. */
function crossings(data: ArrayLike<number>): number {
  let count = 0
  for (let i = 1; i < data.length; i++) if (data[i - 1] < 0 && data[i] >= 0) count++
  return (count * SR) / data.length
}

describe('a voice on its own', () => {
  it('is silent until it is played', () => {
    // A voice that idled audibly would make every patch containing one unusable, and it is the state
    // eight of them are in for most of a piece of music.
    expect(rms(play(SR, () => 0))).toBe(0)
  })

  it('makes a note from a gate, with nothing patched but the gate', () => {
    // The whole point of the module. No VCA, no envelope, no filter, no cables.
    expect(rms(play(SR, () => 1))).toBeGreaterThan(0.01)
  })

  it('plays the pitch it was given', () => {
    // 0 V is C2 at 65.41Hz, one unit is an octave — the convention every other module here uses. A voice
    // that disagreed would be out of tune with the VCO beside it.
    //
    // **One oscillator, no resonance.** Counting zero crossings on the default patch gives 145 rather
    // than 65, and neither number is a bug: two saws seven cents apart summed together cross zero about
    // twice per cycle, and a resonant filter rings across some of the rest. The measurement has to
    // isolate what it is measuring, or it reports the mix rather than the pitch.
    const clean = { attack: 0, envAmount: 0, cutoff: 18000, resonance: 0, mix: 0 }
    const low = crossings(play(SR, () => 1, clean, 0))
    const high = crossings(play(SR, () => 1, clean, 1))
    expect(low).toBeGreaterThan(55)
    expect(low).toBeLessThan(80)
    expect(high / low).toBeGreaterThan(1.8)
    expect(high / low).toBeLessThan(2.2)
  })

  it('lets go when the gate does', () => {
    // Held for a quarter of a second, then released with a short release. What is left at the end has to
    // be quieter than what was there while the key was down, or the voice never stops.
    const frames = SR
    const audio = play(frames, (i) => (i < frames / 4 ? 1 : 0), { release: 0.05 })
    expect(rms(audio.subarray(0, frames / 4))).toBeGreaterThan(0.01)
    expect(rms(audio.subarray(frames / 2))).toBeLessThan(0.001)
  })

  it('holds at the sustain level rather than dying while the key is down', () => {
    // The difference between an envelope and a decay. A voice that could not hold a note would be a
    // percussion module.
    const audio = play(SR, () => 1, { decay: 0.05, sustain: 0.8 })
    const late = rms(audio.subarray(SR / 2))
    expect(late).toBeGreaterThan(0.01)
  })

  it('is a pluck when sustain is zero', () => {
    const audio = play(SR, () => 1, { decay: 0.05, sustain: 0 })
    expect(rms(audio.subarray(0, 4000))).toBeGreaterThan(rms(audio.subarray(SR / 2)) * 4)
  })

  it('starts every note from the same place', () => {
    // Both oscillators reset on the gate, so two notes of the same pitch are identical. Without it a
    // detuned pair starts wherever the last note left it, and a voice that sounded slightly different
    // every time reads as a bug rather than as character.
    //
    // **On one processor across two notes.** The first version of this played two notes on two fresh
    // processors, whose phase is zero either way — so it passed with the reset deleted and was testing
    // nothing at all. Getting a second note out of the *same* voice is the whole measurement.
    //
    // Close rather than identical, and the difference is the honest part: only the *oscillators* restart.
    // The filter keeps its history across a note and the amplifier envelope retriggers from wherever the
    // release left it, both of which are wanted — a filter that reset would click and a legato retrigger
    // from zero would too. So this measures the waveform's shape at the top of the note, with the filter
    // opened out of the way, which is exactly the claim `reset()` makes and no more.
    const voice = new VoiceProcessor(SR, deps)
    const note = (gate: number, frames: number) => {
      const params = VOICE_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
      params[param('attack')].fill(0)
      params[param('cutoff')].fill(18000)
      params[param('resonance')].fill(0)
      params[param('envAmount')].fill(0)
      params[param('release')].fill(0.001)
      const out = [new Float32Array(frames), new Float32Array(frames)]
      voice.process(
        [new Float32Array(frames), new Float32Array(frames).fill(gate), new Float32Array(frames)],
        out,
        params,
        frames,
      )
      return [...out[0]]
    }
    const first = note(1, 4096)
    note(0, SR / 4)
    const second = note(1, 4096)

    let difference = 0
    for (let i = 0; i < 512; i++) difference += Math.abs(second[i] - first[i])
    difference /= 512
    // A tenth of the signal's own size. Delete the resets and the two notes start at unrelated phases,
    // which puts this an order of magnitude higher.
    expect(difference).toBeLessThan(rms(first.slice(0, 512)) * 0.1)
  })

  it('takes a cutoff CV in octaves, like every other cutoff here', () => {
    // Nothing covered the inlet at all until a mutation showed it could be deleted silently. Octaves
    // rather than Hz is what makes the same envelope depth sound the same at both ends of the knob, and
    // it is the convention the Ladder module's own inlet already uses.
    const voice = (cv: number) => {
      const frames = SR
      const params = VOICE_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
      params[param('cutoff')].fill(300)
      params[param('envAmount')].fill(0)
      params[param('resonance')].fill(0)
      params[param('attack')].fill(0)
      const processor = new VoiceProcessor(SR, deps)
      const out = [new Float32Array(frames), new Float32Array(frames)]
      processor.process(
        [new Float32Array(frames), new Float32Array(frames).fill(1), new Float32Array(frames).fill(cv)],
        out,
        params,
        frames,
      )
      return rms(out[0])
    }
    // Four octaves up from 300Hz lets a great deal more of a saw through.
    expect(voice(4)).toBeGreaterThan(voice(0) * 1.2)
  })

  it('opens the filter with its own envelope', () => {
    // A filter envelope is what makes a pluck a pluck, and it is the one thing a bare VCO plus ADSR does
    // not give you without a second envelope and another cable.
    const closed = play(SR, () => 1, { cutoff: 200, envAmount: 0, resonance: 0 })
    const swept = play(SR, () => 1, { cutoff: 200, envAmount: 6, resonance: 0 })
    // More energy overall, because the sweep lets harmonics through that the closed filter removes.
    expect(rms(swept.subarray(0, 8000))).toBeGreaterThan(rms(closed.subarray(0, 8000)) * 1.2)
  })

  it('tracks the keyboard, so a filter setting survives going up an octave', () => {
    // The single most common reason a hand-patched voice feels wrong up the keyboard: a fixed cutoff that
    // sings at the bottom sounds closed two octaves later.
    const settings = { cutoff: 400, envAmount: 0, resonance: 0, attack: 0 }
    const tracked = play(SR, () => 1, { ...settings, keyTrack: 1 }, 2)
    const fixed = play(SR, () => 1, { ...settings, keyTrack: 0 }, 2)
    expect(rms(tracked)).toBeGreaterThan(rms(fixed))
  })

  it('stays finite with every knob at both ends', () => {
    // The contract suite covers defaults and hostile inlets; this covers the combinations, because a
    // voice has seventeen params and a resonant filter fed a full-scale saw is where an infinity would
    // come from if one were going to.
    for (const extreme of [0, 1]) {
      const voice = new VoiceProcessor(SR, deps)
      const params = VOICE_MODULE.params.map((p) =>
        new Float32Array(FRAMES).fill(extreme === 0 ? p.min : p.max),
      )
      const out = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
      for (let block = 0; block < 40; block++) {
        voice.process(
          [new Float32Array(FRAMES).fill(2), new Float32Array(FRAMES).fill(1), new Float32Array(FRAMES).fill(1)],
          out,
          params,
          FRAMES,
        )
        for (const sample of out[0]) expect(Number.isFinite(sample)).toBe(true)
      }
    }
  })

  it('reports its envelope, so the rest of the patch can move with the note', () => {
    const voice = new VoiceProcessor(SR, deps)
    const params = VOICE_MODULE.params.map((p) => new Float32Array(FRAMES).fill(p.default))
    params[param('attack')].fill(0)
    const out = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    voice.process(
      [new Float32Array(FRAMES), new Float32Array(FRAMES).fill(1), new Float32Array(FRAMES)],
      out,
      params,
      FRAMES,
    )
    expect(out[1][FRAMES - 1]).toBeGreaterThan(0.5)
  })
})

describe('eight voices are eight notes', () => {
  // The reason this is a module rather than a chunk. A chunk of five modules is still five modules per
  // voice; only `poly: true` makes a chord cost one cable.

  it('is polyphonic', () => {
    expect(VOICE_MODULE.poly).toBe(true)
  })

  it('holds a different note per voice through a real graph', () => {
    // Compiled for four voices, each given its own pitch the way a MIDI module does — a per-voice
    // `setParam`, which is the only thing polyphony added to the message ABI.
    //
    // Asserted against the *unison*, not against silence. "Four voices are audible" is true of one note
    // played four times, so it says nothing about the claim; two renders that differ only in whether the
    // voices were given the same pitch or different ones is the whole of it.
    const chord = render([0, 4, 7, 12])
    const unison = render([0, 0, 0, 0])
    expect(chord.peak).toBeGreaterThan(0.05)
    expect(unison.peak).toBeGreaterThan(0.05)
    expect(chord.audio).not.toEqual(unison.audio)
  })
})

/** Four voices, one semitone offset each, played through a real graph for a fifth of a second. */
function render(semitones: number[]): { peak: number; audio: number[] } {
  const patch: Patch = {
    voices: 4,
    modules: [
      { id: 'v', type: 'voice', params: { attack: 0, envAmount: 0, cutoff: 18000, level: 0.2 } },
      // The gate is an inlet rather than a param — a MIDI module's gate outlet is what patches into it —
      // so it is held high here by an Offset, which is a DC source with nothing patched in.
      { id: 'g', type: 'offset', params: { offset: 1 } },
      { id: 'out', type: 'out', params: { level: 1 } },
    ],
    cables: [
      { from: ['g', 'out'], to: ['v', 'gate'] },
      { from: ['v', 'out'], to: ['out', 'in'] },
    ],
  }

  const modules: Record<string, ModuleDef['processor']> = {}
  const built: Record<string, unknown> = {}
  for (const def of Object.values(MODULES)) {
    modules[def.type] = def.processor
    for (const [key, dep] of Object.entries(def.deps ?? {})) built[key] = dep
  }
  const graph = new Graph(SR, FRAMES, modules, built)
  const plan = compile(patch, MODULES)
  graph.setPlan(plan)
  for (let voice = 0; voice < semitones.length; voice++) {
    graph.setParam(plan.slots.v.tune, semitones[voice], voice)
  }

  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  const audio: number[] = []
  let peak = 0
  for (let block = 0; block < 70; block++) {
    graph.process(channels)
    for (const sample of channels[0]) {
      peak = Math.max(peak, Math.abs(sample))
      audio.push(sample)
    }
  }
  return { peak, audio }
}
