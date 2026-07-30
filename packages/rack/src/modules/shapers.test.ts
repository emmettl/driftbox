import { describe, expect, it } from 'vitest'
import { DriveProcessor } from './drive.js'
import { MixerProcessor } from './mixer.js'
import { OffsetProcessor } from './offset.js'
import { VcaProcessor } from './vca.js'

// The four modules that do arithmetic to a signal rather than generating or filtering one. Small
// enough that most of what could be wrong is a sign or an off-by-one, and both of those are exactly
// what a test catches and a reading does not.

const SR = 44100
const N = 64

const fill = (value: number, n = N) => new Float32Array(n).fill(value)
const zero = (n = N) => new Float32Array(n)

describe('the offset', () => {
  const run = (input: number, gain: number, offset: number) => {
    const out = zero()
    new OffsetProcessor().process([fill(input)], [out], [fill(gain), fill(offset)], N)
    return out[0]
  }

  it('scales and shifts', () => {
    expect(run(0.5, 2, 0)).toBeCloseTo(1, 6)
    expect(run(0.5, 1, 0.25)).toBeCloseTo(0.75, 6)
  })

  it('inverts through zero, which is the "verter" half', () => {
    // What turns a rising envelope into a falling one without a module for it.
    expect(run(0.8, -1, 0)).toBeCloseTo(-0.8, 6)
    expect(run(-0.3, -2, 0)).toBeCloseTo(0.6, 6)
  })

  it('is a constant source with nothing patched to it', () => {
    // An unconnected inlet reads the graph's zero buffer, so `0 * gain + offset` is `offset`. This is
    // how any fixed value gets into any inlet in the rack, which in a graph with one signal type
    // makes it the tuning knob, the bias and the manual gate as well.
    expect(run(0, 1.5, -0.4)).toBeCloseTo(-0.4, 6)
  })
})

describe('the VCA', () => {
  const run = (input: number, cv: number, gain: number, curve: number) => {
    const out = zero()
    new VcaProcessor().process([fill(input), fill(cv)], [out], [fill(gain), fill(curve)], N)
    return out[0]
  }

  it('passes audio with nothing patched to its CV', () => {
    // In Eurorack a VCA with no CV is shut, which is correct and is also the commonest reason a
    // beginner's patch is silent. Here the knob is an offset the CV rides on and it defaults open.
    expect(run(0.5, 0, 1, 0)).toBeCloseTo(0.5, 6)
  })

  it('adds the knob and the CV', () => {
    expect(run(1, 0.25, 0.25, 0)).toBeCloseTo(0.5, 6)
    // Pulling the knob to zero is how control is handed to the envelope — the Eurorack behaviour,
    // one knob-turn away.
    expect(run(1, 0.4, 0, 0)).toBeCloseTo(0.4, 6)
  })

  it('shuts rather than inverting on a negative CV', () => {
    // The clamp has to come before the squaring, or a negative CV would come back as a positive gain
    // and the VCA would open when it was asked to shut.
    expect(run(1, -0.5, 0, 0)).toBe(0)
    expect(run(1, -0.5, 0, 1)).toBe(0)
    expect(run(1, -3, 0.5, 1)).toBe(0)
  })

  it('never opens past unity', () => {
    expect(run(1, 5, 1, 0)).toBeCloseTo(1, 6)
    expect(run(1, 5, 1, 1)).toBeCloseTo(1, 6)
  })

  it('squares the level on the square-law curve', () => {
    // Half the CV is a quarter of the amplitude, about -12dB. Called square-law rather than
    // exponential because that is what it is.
    expect(run(1, 0, 0.5, 1)).toBeCloseTo(0.25, 6)
    expect(run(1, 0, 0.25, 1)).toBeCloseTo(0.0625, 6)
    // And unity is still unity, so switching curves does not change the loud end.
    expect(run(1, 0, 1, 1)).toBeCloseTo(1, 6)
  })
})

describe('the drive', () => {
  const run = (input: (i: number) => number, drive: number, bias = 0, n = N) => {
    const signal = new Float32Array(n)
    for (let i = 0; i < n; i++) signal[i] = input(i)
    const out = new Float32Array(n)
    new DriveProcessor(SR).process([signal, zero(n)], [out], [fill(drive, n), fill(bias, n)], n)
    return Float64Array.from(out)
  }

  it('maps full scale to full scale at every setting', () => {
    // The normalisation, and the reason for it: without dividing by tanh(drive) the knob reads as
    // "louder" rather than "dirtier" and every comparison between two settings is worthless. Same
    // argument the engine makes for applying trim after its waveshaper rather than before.
    //
    // The first sample only, before the DC blocker has had time to act on what is effectively a step
    // — which is the right place to measure a static gain and the wrong place to measure anything
    // else about this module.
    for (const drive of [0.1, 1, 2, 5, 12, 40]) {
      expect(run(() => 1, drive)[0]).toBeCloseTo(1, 5)
      expect(run(() => -1, drive)[0]).toBeCloseTo(-1, 5)
    }
  })

  it('is genuinely clean at the bottom of the knob', () => {
    // At a drive of 1 a full-scale sine picks up about 7% third harmonic, which is not a bypass. The
    // minimum is 0.1 for that reason and this is what checks it stayed there.
    const sine = (i: number) => Math.sin((2 * Math.PI * 200 * i) / SR)
    const data = run(sine, 0.1, 0, SR)
    const magnitude = (frequency: number) => {
      let re = 0
      let im = 0
      for (let i = 0; i < data.length; i++) {
        const phase = (2 * Math.PI * frequency * i) / SR
        re += data[i] * Math.cos(phase)
        im += data[i] * Math.sin(phase)
      }
      return Math.hypot(re, im) / data.length
    }
    expect(magnitude(600) / magnitude(200)).toBeLessThan(0.002)
  })

  it('bends the middle of the range and not the ends', () => {
    // Which is the whole point: the ends are pinned by the normalisation, so all the knob can do is
    // change the shape between them.
    const gentle = run(() => 0.5, 0.1)[0]
    const hard = run(() => 0.5, 20)[0]
    expect(hard).toBeGreaterThan(gentle)
    expect(hard).toBeGreaterThan(0.9)
    expect(gentle).toBeLessThan(0.55)
  })

  it('adds harmonics as it is driven', () => {
    const sine = (i: number) => Math.sin((2 * Math.PI * 200 * i) / SR)
    const thd = (drive: number) => {
      const data = run(sine, drive, 0, SR)
      const magnitude = (frequency: number) => {
        let re = 0
        let im = 0
        for (let i = 0; i < data.length; i++) {
          const phase = (2 * Math.PI * frequency * i) / SR
          re += data[i] * Math.cos(phase)
          im += data[i] * Math.sin(phase)
        }
        return Math.hypot(re, im) / data.length
      }
      return magnitude(600) / magnitude(200)
    }
    // A symmetrical curve makes odd harmonics, so the third is the one to watch.
    expect(thd(0.1)).toBeLessThan(0.002)
    expect(thd(20)).toBeGreaterThan(0.1)
  })

  it('makes even harmonics from bias without emitting DC', () => {
    // Bias is what separates a valve from a fuzz, and it is also what makes the curve rectify. The
    // first version of this module subtracted `tanh(bias * drive)` and believed that was enough;
    // measured, what came out still had an offset of 0.51, because the DC an asymmetric curve
    // produces depends on the signal going through it. Hence the DC blocker.
    const sine = (i: number) => 0.6 * Math.sin((2 * Math.PI * 200 * i) / SR)
    const data = run(sine, 8, 0.4, SR)

    let sum = 0
    // Past the blocker's own settling time, which at 5Hz is about a fifth of a second.
    for (let i = SR / 2; i < data.length; i++) sum += data[i]
    expect(Math.abs(sum / (data.length - SR / 2))).toBeLessThan(0.01)

    const magnitude = (frequency: number) => {
      let re = 0
      let im = 0
      for (let i = 0; i < data.length; i++) {
        const phase = (2 * Math.PI * frequency * i) / SR
        re += data[i] * Math.cos(phase)
        im += data[i] * Math.sin(phase)
      }
      return Math.hypot(re, im) / data.length
    }
    // The second harmonic, which a symmetrical curve cannot produce at all.
    expect(magnitude(400) / magnitude(200)).toBeGreaterThan(0.05)
  })

  it('stays inside its range however hard it is hit', () => {
    for (const level of [1, 4, 40, -40]) {
      for (const x of run(() => level, 40, 1)) expect(Math.abs(x)).toBeLessThanOrEqual(2)
    }
  })
})

describe('the mixer', () => {
  const run = (ins: number[], levels: number[], cvs = [0, 0, 0, 0]) => {
    const out = zero()
    new MixerProcessor().process(
      [...ins.map((v) => fill(v)), ...cvs.map((v) => fill(v))],
      [out],
      levels.map((v) => fill(v)),
      N,
    )
    return out[0]
  }

  it('sums four channels at their levels', () => {
    expect(run([1, 1, 1, 1], [1, 1, 1, 1])).toBeCloseTo(4, 6)
    expect(run([1, 0.5, 0.25, 0], [1, 1, 1, 1])).toBeCloseTo(1.75, 6)
    expect(run([1, 1, 1, 1], [0.5, 0.25, 0, 0])).toBeCloseTo(0.75, 6)
  })

  it('subtracts a channel at a negative level', () => {
    // Which is how a difference, a mid/side trick or a crossfade comes out of this without a module
    // for any of them.
    expect(run([1, 1, 0, 0], [1, -1, 0, 0])).toBeCloseTo(0, 6)
    expect(run([0.8, 0.3, 0, 0], [1, -1, 0, 0])).toBeCloseTo(0.5, 6)
  })

  it('adds each channel CV to its own level and no other', () => {
    // Off-by-one territory: the processor reads inlets[n] for signals and inlets[n + 4] for CVs, so
    // a slip here would cross-wire two channels and only a test would say so.
    expect(run([1, 0, 0, 0], [0, 0, 0, 0], [0.5, 0, 0, 0])).toBeCloseTo(0.5, 6)
    expect(run([1, 0, 0, 0], [0, 0, 0, 0], [0, 0.5, 0, 0])).toBeCloseTo(0, 6)
    expect(run([0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0.75])).toBeCloseTo(0.75, 6)
  })

  it('clamps a runaway level rather than exploding', () => {
    expect(run([1, 0, 0, 0], [2, 0, 0, 0], [50, 0, 0, 0])).toBeCloseTo(2, 6)
    expect(run([1, 0, 0, 0], [-2, 0, 0, 0], [-50, 0, 0, 0])).toBeCloseTo(-2, 6)
  })
})
