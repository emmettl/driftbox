import { describe, expect, it } from 'vitest'
import { Random } from '../dsp/random.js'
import { ClockProcessor } from './clock.js'
import { LfoProcessor } from './lfo.js'
import { QuantizerProcessor } from './quantizer.js'
import { SampleHoldProcessor } from './sample-hold.js'
import { SEQ_MODULE, SeqProcessor } from './seq.js'

// The modules that make things happen in time, plus the quantizer that decides what note they land
// on. Most of what could be wrong here is an edge condition — a trigger counted twice, a step
// advanced once too early, an octave boundary rounded the wrong way — and none of it is visible by
// reading.

const SR = 44100
const fill = (value: number, n: number) => new Float32Array(n).fill(value)

/** Count rising edges. */
function edges(data: Float32Array): number {
  let count = 0
  for (let i = 1; i < data.length; i++) if (data[i - 1] < 0.5 && data[i] >= 0.5) count++
  return count
}

/** Count pulses, including one that is already high at sample zero — which the clock's first tick
 *  is, since it is armed at construction so that patching one in makes a sound immediately. */
function pulses(data: Float32Array): number {
  let count = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= 0.5 && (i === 0 || data[i - 1] < 0.5)) count++
  }
  return count
}

/** Where each pulse begins. */
function pulseStarts(data: Float32Array): number[] {
  const starts: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= 0.5 && (i === 0 || data[i - 1] < 0.5)) starts.push(i)
  }
  return starts
}

/** The first index where `ok` fails, or −1. One assertion per array rather than one per sample —
 *  see the comment on the same helper in `modules/svf.test.ts`. */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

describe('the LFO', () => {
  const run = (rate: number, shape: number, samples: number, reset?: Float32Array) => {
    const bi = new Float32Array(samples)
    const uni = new Float32Array(samples)
    new LfoProcessor(SR, { Random }, 'lfo1').process(
      [new Float32Array(samples), reset ?? new Float32Array(samples)],
      [bi, uni],
      [fill(rate, samples), fill(shape, samples)],
      samples,
    )
    return { bi, uni }
  }

  it('runs at the rate on the knob', () => {
    for (const rate of [2, 5, 20]) {
      const { bi } = run(rate, 2, SR)
      // A saw crosses upward exactly once a cycle.
      expect(edges(Float32Array.from(bi, (x) => (x > 0 ? 1 : 0)))).toBeCloseTo(rate, 0)
    }
  })

  it('puts the unipolar outlet exactly half way up the bipolar one', () => {
    // The conversion is one multiply and one add, which is why both outlets exist instead of a knob
    // to choose between them — and why the most common piece of patch furniture in a modular, an
    // offset module turning ±1 into 0..1, is not needed here.
    const { bi, uni } = run(3, 0, 4096)
    let worst = 0
    for (let i = 0; i < 4096; i++) worst = Math.max(worst, Math.abs(uni[i] - (bi[i] * 0.5 + 0.5)))
    expect(worst).toBeLessThan(1e-6)
  })

  it('makes each shape the shape it says', () => {
    const spread = (shape: number) => {
      const { bi } = run(5, shape, SR)
      const values = [...bi]
      return { low: Math.min(...values), high: Math.max(...values) }
    }
    for (const shape of [0, 1, 2, 3, 4]) {
      const { low, high } = spread(shape)
      expect(high).toBeLessThanOrEqual(1.0001)
      expect(low).toBeGreaterThanOrEqual(-1.0001)
    }
    // A square only ever takes two values; a triangle takes many. Over a whole second, because at
    // 5Hz a 4096-sample window is less than half a cycle and a square would look like a constant.
    expect(new Set([...run(5, 3, SR).bi]).size).toBe(2)
    expect(new Set([...run(5, 1, SR).bi]).size).toBeGreaterThan(100)
  })

  it('restarts the cycle on a rising reset', () => {
    const samples = SR
    const reset = new Float32Array(samples)
    // Nine tenths of the way through a 1Hz cycle, where the saw is near the top. Half way through is
    // where it crosses ZERO, which is a poor place to look for a discontinuity.
    const at = Math.floor(samples * 0.9)
    for (let i = at; i < at + 32; i++) reset[i] = 1
    const { bi } = run(1, 2, samples, reset)

    expect(bi[at - 1]).toBeGreaterThan(0.7)
    expect(bi[at + 1]).toBeLessThan(-0.9)
  })

  it('holds the random shape steady within a cycle', () => {
    const { bi } = run(4, 4, SR)
    // Four cycles a second means four values a second, not 44100 of them.
    expect(new Set([...bi]).size).toBeLessThanOrEqual(6)
    expect(new Set([...bi]).size).toBeGreaterThan(1)
  })
})

describe('the clock', () => {
  const run = (rate: number, width: number, samples: number, reset?: Float32Array) => {
    const gate = new Float32Array(samples)
    const trig = new Float32Array(samples)
    const phase = new Float32Array(samples)
    new ClockProcessor(SR).process(
      [new Float32Array(samples), reset ?? new Float32Array(samples)],
      [gate, trig, phase],
      [fill(rate, samples), fill(width, samples)],
      samples,
    )
    return { gate, trig, phase }
  }

  it('ticks at the rate on the knob', () => {
    // Measured as the GAP between ticks rather than as a count per second. A 1Hz clock run for
    // exactly one second ticks twice — once at zero and once at one — and whether the second one
    // lands inside the buffer is a property of the window rather than of the clock.
    for (const rate of [1, 4, 10]) {
      const starts = pulseStarts(run(rate, 0.5, Math.ceil(SR * 2.5)).trig)
      expect(starts.length).toBeGreaterThan(1)
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i] - starts[i - 1]).toBeCloseTo(SR / rate, -1)
      }
    }
  })

  it('ticks the moment it starts', () => {
    expect(run(0.05, 0.5, 128).trig[0]).toBe(1)
  })

  it('makes the gate as wide as the width knob says', () => {
    for (const width of [0.25, 0.5, 0.75]) {
      const { gate } = run(4, width, SR)
      let high = 0
      for (const x of gate) if (x > 0.5) high++
      expect(high / SR).toBeCloseTo(width, 1)
    }
  })

  it('makes the trigger a millisecond whatever the rate', () => {
    // The point of having a trigger outlet as well as a gate: a sequencer wants an edge, and a width
    // knob set for an envelope would make that edge either miss or double.
    //
    // The FIRST complete pulse, rather than the total high time divided by the tick count — at 1Hz
    // the only tick lands at the very end of a one-second buffer and most of its pulse falls off the
    // end, which made the average meaningless.
    for (const rate of [1, 20]) {
      const { trig } = run(rate, 0.9, Math.ceil(SR * 1.5))
      let start = -1
      for (let i = 1; i < trig.length; i++) {
        if (trig[i - 1] < 0.5 && trig[i] >= 0.5) {
          start = i
          break
        }
      }
      expect(start).toBeGreaterThan(0)
      let width = 0
      while (trig[start + width] >= 0.5) width++
      expect(width).toBe(Math.ceil(SR * 0.001))
    }
  })

  it('fires the beat when it is reset', () => {
    // Unlike the sequencer's reset, which does not. A clock's job is to start the beat; a
    // sequencer's is to be in the right place when the beat arrives.
    const samples = SR
    const reset = new Float32Array(samples)
    const at = Math.floor(samples * 0.5)
    for (let i = at; i < at + 32; i++) reset[i] = 1
    const { trig, phase } = run(1, 0.5, samples, reset)

    // A fresh pulse begins exactly at the reset.
    expect(trig[at - 1]).toBe(0)
    expect(trig[at]).toBe(1)
    // Not exactly zero: the reset lands and then the phase advances, both in the same sample. What
    // matters is that it went back to the start rather than that it stayed there for an instant.
    expect(phase[at]).toBeLessThan(0.001)
    expect(phase[at]).toBeLessThan(phase[at - 1])
  })
})

describe('the sequencer', () => {
  const PITCH = 2
  const GATE = 10

  function run(
    clockHz: number,
    seconds: number,
    settings: { length?: number; glide?: number; pitches?: number[]; gates?: number[] } = {},
    reset?: (i: number) => number,
  ) {
    const samples = Math.ceil(seconds * SR)
    const { length = 8, glide = 0, pitches = [0, 1, 2, 3, 4, 5, 6, 7], gates = [1, 1, 1, 1, 1, 1, 1, 1] } =
      settings

    // A real clock drives it, because that is the only way it is ever used.
    const clock = new Float32Array(samples)
    const trig = new Float32Array(samples)
    const phase = new Float32Array(samples)
    new ClockProcessor(SR).process(
      [new Float32Array(samples), new Float32Array(samples)],
      [clock, trig, phase],
      [fill(clockHz, samples), fill(0.5, samples)],
      samples,
    )

    const params = SEQ_MODULE.params.map((p) => fill(p.default, samples))
    params[0] = fill(length, samples)
    params[1] = fill(glide, samples)
    pitches.forEach((v, n) => (params[PITCH + n] = fill(v, samples)))
    gates.forEach((v, n) => (params[GATE + n] = fill(v, samples)))

    const resetIn = new Float32Array(samples)
    if (reset) for (let i = 0; i < samples; i++) resetIn[i] = reset(i)

    const pitchOut = new Float32Array(samples)
    const gateOut = new Float32Array(samples)
    const trigOut = new Float32Array(samples)
    new SeqProcessor(SR).process([clock, resetIn], [pitchOut, gateOut, trigOut], params, samples)
    return { pitchOut, gateOut, trigOut, clock }
  }

  it('advances one step per clock', () => {
    // Against the clock that actually drove it, not against a count of how many ticks a second ought
    // to contain — the last tick of a one-second window lands right on the boundary and whether it
    // falls inside is a property of the window rather than of the sequencer.
    const { trigOut, clock } = run(8, 1)
    expect(pulses(trigOut)).toBe(pulses(clock))
    expect(pulses(clock)).toBeGreaterThan(6)
  })

  it('plays the pitch of the step it is on', () => {
    // Semitones on the knob, octaves out of the socket — the V/Oct convention every pitch inlet in
    // the rack uses.
    const { pitchOut } = run(8, 1, { pitches: [0, 12, -12, 7, 0, 0, 0, 0] })
    const at = (step: number) => pitchOut[Math.floor((step + 0.5) * (SR / 8))]
    expect(at(0)).toBeCloseTo(0, 5)
    expect(at(1)).toBeCloseTo(1, 5)
    expect(at(2)).toBeCloseTo(-1, 5)
    expect(at(3)).toBeCloseTo(7 / 12, 5)
  })

  it('wraps at the length rather than at eight', () => {
    const { pitchOut } = run(8, 1, { length: 3, pitches: [0, 12, 24, 36, 0, 0, 0, 0] })
    const at = (step: number) => pitchOut[Math.floor((step + 0.5) * (SR / 8))]
    expect(at(3)).toBeCloseTo(at(0), 5)
    expect(at(4)).toBeCloseTo(at(1), 5)
    // And never reaches the fourth knob at all.
    for (let step = 0; step < 8; step++) expect(at(step)).toBeLessThan(2.5)
  })

  it('takes its gate length from the clock', () => {
    // The gate is the clock's gate AND'd with the step being on, so one knob — on the module that
    // already owns the shape of the pulse — shortens every step at once.
    const { gateOut } = run(4, 1)
    let high = 0
    for (const x of gateOut) if (x > 0.5) high++
    expect(high / SR).toBeCloseTo(0.5, 1)
  })

  it('stays silent on a step that is switched off', () => {
    // Against the same sequence with every step on, rather than against a tick count — the sequencer
    // starts on step one, so switching off every other step has to halve the pulses exactly.
    const all = run(8, 1)
    const half = run(8, 1, { gates: [1, 0, 1, 0, 1, 0, 1, 0] })
    expect(pulses(half.trigOut)).toBe(Math.ceil(pulses(all.trigOut) / 2))
    expect(pulses(half.gateOut)).toBe(Math.ceil(pulses(all.gateOut) / 2))
  })

  it('winds back to before the first step on a reset', () => {
    // Deliberately unlike the clock's reset: this one does not fire. A reset that jumped straight to
    // step one AND fired would double-trigger every time it arrived alongside a clock edge.
    const samples = Math.ceil(1 * SR)
    const at = Math.floor(samples * 0.5)
    const { pitchOut, trigOut } = run(
      4,
      1,
      { pitches: [0, 12, 24, 36, 0, 0, 0, 0] },
      (i) => (i >= at && i < at + 32 ? 1 : 0),
    )
    // Nothing fires at the reset itself.
    expect(trigOut[at]).toBe(0)
    // And the next clock plays step one again.
    const afterward = pitchOut[Math.floor(samples * 0.63)]
    expect(afterward).toBeCloseTo(0, 5)
  })

  it('glides between steps when the knob is up', () => {
    const stepped = run(4, 1, { pitches: [0, 12, 0, 12, 0, 12, 0, 12] })
    const glided = run(4, 1, { glide: 0.1, pitches: [0, 12, 0, 12, 0, 12, 0, 12] })

    // Just after a step change the stepped one has already arrived and the glided one has not.
    const justAfter = Math.floor(SR / 4) + 200
    expect(stepped.pitchOut[justAfter]).toBeCloseTo(1, 3)
    expect(glided.pitchOut[justAfter]).toBeLessThan(0.5)
    // And it gets there in the end.
    expect(glided.pitchOut[Math.floor(SR / 2) - 10]).toBeCloseTo(1, 1)
  })
})

describe('sample and hold', () => {
  const run = (input: (i: number) => number, trigger: (i: number) => number, samples: number) => {
    const signal = new Float32Array(samples)
    const trig = new Float32Array(samples)
    for (let i = 0; i < samples; i++) {
      signal[i] = input(i)
      trig[i] = trigger(i)
    }
    const out = new Float32Array(samples)
    new SampleHoldProcessor().process([signal, trig], [out], [], samples)
    return out
  }

  it('holds what it sampled until the next trigger', () => {
    const ramp = (i: number) => i / 1000
    const out = run(ramp, (i) => (i === 100 || i === 500 ? 1 : 0), 1000)
    expect(out[99]).toBe(0)
    expect(out[100]).toBeCloseTo(0.1, 5)
    expect(out[499]).toBeCloseTo(0.1, 5)
    expect(out[500]).toBeCloseTo(0.5, 5)
    expect(out[999]).toBeCloseTo(0.5, 5)
  })

  it('samples on the edge and not for the duration of the gate', () => {
    // Sampling while the trigger is high would make it follow the input rather than hold it, which
    // is a different module and not this one.
    const ramp = (i: number) => i / 1000
    const out = run(ramp, (i) => (i >= 100 && i < 400 ? 1 : 0), 1000)
    expect(firstBad(out.slice(100, 400), (x) => Math.abs(x - 0.1) < 1e-5)).toBe(-1)
  })
})

describe('the quantizer', () => {
  const run = (values: number[], scale: number, root: number) => {
    const input = Float32Array.from(values)
    const out = new Float32Array(values.length)
    const trig = new Float32Array(values.length)
    new QuantizerProcessor(SR).process(
      [input],
      [out, trig],
      [fill(scale, values.length), fill(root, values.length)],
      values.length,
    )
    return { out, trig }
  }

  /** Semitones, for readability — the module works in octaves. */
  const semitones = (values: number[], scale: number, root = 0) =>
    [...run(values.map((v) => v / 12), scale, root).out].map((v) => Math.round(v * 12))

  // Inputs are deliberately off the half-way point between two degrees. A value exactly between them
  // is a tie, and which way a tie falls is not a specified behaviour of this module — it also cannot
  // be tested reliably, because the input is a Float32Array and 1/12 of an octave comes back as
  // 1.0000000298 semitones rather than 1, which turns an intended tie into a near miss.
  it('snaps to the scale it was given', () => {
    // Major: no sharpened fourth, no flattened third.
    expect(semitones([0, 0.8, 2, 3.4, 4, 5.4, 6.4], 1)).toEqual([0, 0, 2, 4, 4, 5, 7])
    // Minor pentatonic: five notes, so the gaps are wide and obvious.
    expect(semitones([0, 0.8, 2.2, 3, 4.4, 5.4, 6.4], 3)).toEqual([0, 0, 3, 3, 5, 5, 7])
  })

  it('passes everything through on the chromatic scale', () => {
    expect(semitones([0, 1, 2, 3, 4, 5, 6, 7, 11, 12], 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 11, 12])
  })

  it('transposes with the root', () => {
    // D minor: 2, 4, 5, 7, 9, 10, 12. An F natural where D major would have an F sharp.
    expect(semitones([2, 3.4, 4, 5], 2, 2)).toEqual([2, 4, 4, 5])
    // The same scale rooted on C has none of those notes in the same places.
    expect(semitones([2, 3.4, 3.6, 5], 2, 0)).toEqual([2, 3, 3, 5])
  })

  it('has no dead zone at the top of an octave', () => {
    // 11.5 semitones in a major scale is nearer to 12 than to 11, so it has to snap UP into the next
    // octave. A quantizer that only searches within one octave snaps down instead, and every scale
    // acquires a note that is impossible to reach.
    expect(semitones([11.4, 11.6, 12], 1)).toEqual([11, 12, 12])
    expect(semitones([-0.4, -0.6], 1)).toEqual([0, -1])
  })

  it('works below zero as well as above it', () => {
    // `Math.floor` on a negative octave is where an off-by-one would hide.
    expect(semitones([-12, -11.4, -10, -8.6], 1)).toEqual([-12, -12, -10, -8])
  })

  it('fires a trigger when the note changes and not when it does not', () => {
    // What makes this more than a filter: an envelope can be struck on each new note rather than on
    // each clock. A quantizer without it makes a sequence of pitches; with it, a sequence of notes.
    //
    // The buffer has to be longer than the 1ms pulse, or the whole output is one unbroken trigger
    // and there is nothing to count.
    const glide = Array.from({ length: 8192 }, (_, i) => (i / 8192) * (7 / 12))
    const { out, trig } = run(glide, 1, 0)

    // A slow rise through a fifth in C major passes C, D, E, F and G — five notes, five triggers.
    expect(pulses(trig)).toBe(5)
    expect(new Set([...out].map((v) => Math.round(v * 12)))).toEqual(new Set([0, 2, 4, 5, 7]))

    // And nothing at all while the input sits still.
    const steady = run(Array.from({ length: 8192 }, () => 0.25), 1, 0)
    expect(pulses(steady.trig)).toBe(1)
  })
})
