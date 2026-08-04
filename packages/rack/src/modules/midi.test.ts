import { describe, expect, it } from 'vitest'
import { MIDI_INPUTS, MIDI_MODULE, MidiProcessor } from './midi.js'

const SR = 44100

const ORDER = [
  'note', 'gate', 'velocity', 'mod', 'transpose', 'glide', 'channel',
  'bend', 'aftertouch', 'expression', 'breath', 'sustain',
] as const

function run(
  values: Partial<Record<(typeof ORDER)[number], number>>,
  frames = 128,
  processor = new MidiProcessor(SR),
) {
  const params = ORDER.map((id) => {
    const def = MIDI_MODULE.params.find((p) => p.id === id)!
    return new Float32Array(frames).fill(values[id] ?? def.default)
  })
  const outs = Array.from({ length: MIDI_MODULE.outlets.length }, () => new Float32Array(frames))
  processor.process([], outs, params, frames)
  return {
    pitch: outs[0], gate: outs[1], vel: outs[2], mod: outs[3], bend: outs[4],
    aftertouch: outs[5], expression: outs[6], breath: outs[7], sustain: outs[8], processor,
  }
}

describe('the MIDI module', () => {
  it('puts middle C where every other pitch inlet expects it', () => {
    // 0 V is C2 throughout this rack, and C2 is MIDI 36. Any other mapping would mean a C on the keyboard
    // played something else on the VCO, which is the sort of small lie that costs an hour to find.
    expect(run({ note: 36 }).pitch[0]).toBeCloseTo(0, 6)
    expect(run({ note: 48 }).pitch[0]).toBeCloseTo(1, 6)
    expect(run({ note: 24 }).pitch[0]).toBeCloseTo(-1, 6)
    expect(run({ note: 43 }).pitch[0]).toBeCloseTo(7 / 12, 6)
  })

  it('transposes by semitones', () => {
    expect(run({ note: 36, transpose: 12 }).pitch[0]).toBeCloseTo(1, 6)
    expect(run({ note: 36, transpose: -5 }).pitch[0]).toBeCloseTo(-5 / 12, 6)
  })

  it('steps the gate rather than sliding it', () => {
    // `stepped` on the def is what makes this true on the audio thread; here it only has to not smooth what
    // it was given. A gate that slid from 0 to 1 across a block would open slowly and retrigger nothing.
    expect([...run({ gate: 1 }).gate]).toEqual(Array(128).fill(1))
    expect([...run({ gate: 0 }).gate]).toEqual(Array(128).fill(0))
    // Anything below half is off, so a partly-ramped value cannot half-open a note.
    expect(run({ gate: 0.49 }).gate[0]).toBe(0)
    expect(run({ gate: 0.5 }).gate[0]).toBe(1)
  })

  it('passes velocity and mod through untouched', () => {
    const { vel, mod } = run({ velocity: 0.42, mod: 0.7 })
    expect(vel[0]).toBeCloseTo(0.42, 6)
    expect(mod[0]).toBeCloseTo(0.7, 6)
  })

  it('publishes the remaining performance controllers as CV', () => {
    const out = run({ bend: -0.75, aftertouch: 0.2, expression: 0.3, breath: 0.4, sustain: 1 })
    expect(out.bend[0]).toBeCloseTo(-0.75)
    expect(out.aftertouch[0]).toBeCloseTo(0.2)
    expect(out.expression[0]).toBeCloseTo(0.3)
    expect(out.breath[0]).toBeCloseTo(0.4)
    expect(out.sustain[0]).toBe(1)
  })

  it('arrives at a new note immediately with no glide', () => {
    const processor = new MidiProcessor(SR)
    run({ note: 36 }, 128, processor)
    expect(run({ note: 48 }, 128, processor).pitch[0]).toBeCloseTo(1, 6)
  })

  it('slides to a new note over the glide time', () => {
    // The same 99%-in-the-stated-time convention as the envelope and the sequencer, so a knob marked in
    // seconds means one thing across the whole rack.
    const processor = new MidiProcessor(SR)
    const glide = 0.05
    run({ note: 36, glide }, 128, processor)

    const blocks = Math.ceil((glide * SR) / 128)
    let last = 0
    for (let i = 0; i < blocks; i++) {
      last = run({ note: 48, glide }, 128, processor).pitch[127]
    }
    // Within 1% of an octave after the stated time, and demonstrably on the way there before it.
    expect(last).toBeGreaterThan(0.99)
    expect(last).toBeLessThanOrEqual(1)

    const fresh = new MidiProcessor(SR)
    run({ note: 36, glide }, 128, fresh)
    expect(run({ note: 48, glide }, 128, fresh).pitch[127]).toBeLessThan(0.4)
  })
})

describe('the MIDI module’s def', () => {
  it('hides the params the host writes and shows the ones a knob turns', () => {
    // A visible knob on the same slot as incoming MIDI would fight it: the knob would read 0 while the
    // audio thread held 3, and nudging it would snap the note back.
    const hidden = MIDI_MODULE.params.filter((p) => p.hidden).map((p) => p.id)
    const shown = MIDI_MODULE.params.filter((p) => !p.hidden).map((p) => p.id)

    expect(hidden).toEqual([
      'note', 'gate', 'velocity', 'mod', 'bend', 'aftertouch', 'expression', 'breath', 'sustain',
    ])
    expect(shown).toEqual(['transpose', 'glide', 'channel'])
  })

  it('names the slots the host drives, so nothing has to hardcode them', () => {
    for (const id of MIDI_INPUTS) {
      const param = MIDI_MODULE.params.find((p) => p.id === id)
      expect(param, id).toBeDefined()
      expect(param!.hidden, id).toBe(true)
    }
  })

  it('keeps the param order its processor reads by index', () => {
    expect(MIDI_MODULE.params.map((p) => p.id)).toEqual([...ORDER])
  })

  it('defaults to a silent gate, so a patch does not open with a note stuck on', () => {
    expect(MIDI_MODULE.params.find((p) => p.id === 'gate')!.default).toBe(0)
  })

  it('has no inlets, because a keyboard is not something you patch into it', () => {
    expect(MIDI_MODULE.inlets).toEqual([])
  })

  it('appends performance outlets without moving the original note and mod ids', () => {
    expect(MIDI_MODULE.outlets.map((port) => port.id)).toEqual([
      'pitch', 'gate', 'vel', 'mod', 'bend', 'aftertouch', 'expression', 'breath', 'sustain',
    ])
  })
})
