import { describe, expect, it } from 'vitest'
import { MODULES } from './modules/index.js'
import { Adaptive, adaptiveValue, adaptiveValues, type AdaptiveScore } from './adaptive.js'
import { RackRenderer } from './headless.js'
import type { Patch } from './types.js'

// A score is two claims and everything else is bookkeeping: the curve reads what its author drew, and a
// change lands when the kind of parameter says it may. The first is arithmetic and is tested as arithmetic;
// the second needs a clock, which here is a number the test hands over rather than anything real.

/** Records what it was told, in order, so a test can assert about traffic and not only about values. */
function spy() {
  const calls: [string, string, number][] = []
  return {
    calls,
    setParam(moduleId: string, paramId: string, value: number) {
      calls.push([moduleId, paramId, value])
    },
  }
}

const RAMP: AdaptiveScore = {
  controls: [{ target: ['out', 'level'], points: [{ at: 0, value: 0.2 }, { at: 1, value: 0.9 }] }],
}

describe('adaptiveValue', () => {
  it('interpolates between the points either side', () => {
    const control = { target: ['a', 'b'] as [string, string], points: [{ at: 0, value: 0 }, { at: 1, value: 10 }] }
    expect(adaptiveValue(control, 0)).toBeCloseTo(0)
    expect(adaptiveValue(control, 0.25)).toBeCloseTo(2.5)
    expect(adaptiveValue(control, 1)).toBeCloseTo(10)
  })

  it('holds the end value rather than extrapolating past it', () => {
    // The failure this prevents is a level that keeps rising past the loudest point anybody wrote, in the
    // one situation nobody tested — see the comment on `points`.
    const control = { target: ['a', 'b'] as [string, string], points: [{ at: 0, value: 0 }, { at: 1, value: 10 }] }
    expect(adaptiveValue(control, -5)).toBe(0)
    expect(adaptiveValue(control, 40)).toBe(10)
  })

  it('does not care what order the points are in', () => {
    const sorted = { target: ['a', 'b'] as [string, string], points: [{ at: 0, value: 0 }, { at: 0.5, value: 4 }, { at: 1, value: 6 }] }
    const jumbled = { target: ['a', 'b'] as [string, string], points: [{ at: 1, value: 6 }, { at: 0, value: 0 }, { at: 0.5, value: 4 }] }
    for (const intensity of [0, 0.2, 0.5, 0.75, 1]) {
      expect(adaptiveValue(jumbled, intensity)).toBeCloseTo(adaptiveValue(sorted, intensity))
    }
  })

  it('rounds a stepped control, because there is nothing between two patterns', () => {
    const control = {
      target: ['drums', 'pattern'] as [string, string],
      points: [{ at: 0, value: 0 }, { at: 1, value: 3 }],
      step: true,
    }
    expect(adaptiveValue(control, 0.4)).toBe(1)
    expect(adaptiveValue(control, 0.5)).toBe(2)
    expect(Number.isInteger(adaptiveValue(control, 0.9))).toBe(true)
    // Clamped above the top point, and still a whole number: the held end goes through the same rounding as
    // the interpolated middle, or "has this changed?" would compare against a value nothing ever received.
    const fractional = {
      target: ['drums', 'pattern'] as [string, string],
      points: [{ at: 0, value: 0 }, { at: 1, value: 3.6 }],
      step: true,
    }
    expect(adaptiveValue(fractional, 5)).toBe(4)
  })

  it('says nothing rather than zero for a control with no curve', () => {
    // Zero is a real value — silence on a level, pattern one on a Tracker — so inventing it would rewrite a
    // patch the score never described.
    expect(adaptiveValue({ target: ['a', 'b'], points: [] }, 0.5)).toBeNaN()
    expect(adaptiveValues({ controls: [{ target: ['a', 'b'], points: [] }] }, 0.5)).toEqual([])
  })

  it('survives an intensity that is not a number', () => {
    // A game dividing by a zero-length timer produces one of these, and music going silent is a worse
    // symptom than music not moving.
    expect(adaptiveValue({ target: ['a', 'b'], points: [{ at: 0, value: 1 }] }, Number.NaN)).toBeNaN()
    expect(adaptiveValues(RAMP, Number.NaN)).toEqual([])
  })
})

describe('Adaptive', () => {
  it('sends a continuous control at once', () => {
    const host = spy()
    const score = new Adaptive(host, RAMP)
    score.update(0.5, 0)
    expect(host.calls).toEqual([['out', 'level', 0.55]])
  })

  it('sends nothing while the scene is steady', () => {
    // The reason this is a class rather than a function: a game's update loop runs at frame rate, and every
    // send across a live `Rack` is a postMessage the audio thread drains.
    const host = spy()
    const score = new Adaptive(host, RAMP)
    score.update(0.5, 0)
    for (let frame = 0; frame < 60; frame++) score.update(0.5, frame / 60)
    expect(host.calls).toHaveLength(1)
  })

  it('holds a bar-locked control until the bar line', () => {
    const host = spy()
    const score = new Adaptive(host, {
      controls: [
        {
          target: ['drums', 'pattern'],
          points: [{ at: 0, value: 0 }, { at: 1, value: 4 }],
          onBar: true,
          step: true,
        },
      ],
    })

    // The first update applies at once — otherwise the score arrives a bar late, every time.
    expect(score.update(0, 0)).toEqual([{ target: ['drums', 'pattern'], value: 0 }])

    // Mid-bar: wanted, not sent.
    score.update(1, 2.5)
    expect(host.calls).toHaveLength(1)

    // The bar line.
    score.update(1, 4)
    expect(host.calls).toEqual([
      ['drums', 'pattern', 0],
      ['drums', 'pattern', 4],
    ])
  })

  it('lands the value the game wanted at the bar line, not the one it wanted at the start of it', () => {
    const host = spy()
    const score = new Adaptive(host, {
      controls: [{ target: ['drums', 'pattern'], points: [{ at: 0, value: 0 }, { at: 1, value: 8 }], onBar: true, step: true }],
    })
    score.update(0, 0)
    score.update(1, 1) // panic
    score.update(0.25, 2) // ...over
    score.update(0.25, 4)
    expect(host.calls.at(-1)).toEqual(['drums', 'pattern', 2])
  })

  it('treats a seek backwards as a boundary', () => {
    // A loop or a jump. Waiting for the next forward crossing would strand the pending change for a bar,
    // and a section that loops every four bars would never hear it at all.
    const host = spy()
    const score = new Adaptive(host, {
      controls: [{ target: ['drums', 'pattern'], points: [{ at: 0, value: 0 }, { at: 1, value: 4 }], onBar: true, step: true }],
    })
    score.update(0, 8)
    score.update(1, 9)
    expect(host.calls).toHaveLength(1)
    score.update(1, 0)
    expect(host.calls.at(-1)).toEqual(['drums', 'pattern', 4])
  })

  it('reads a beat per bar from the score', () => {
    const host = spy()
    const score = new Adaptive(host, {
      beatsPerBar: 3,
      controls: [{ target: ['x', 'y'], points: [{ at: 0, value: 0 }, { at: 1, value: 1 }], onBar: true }],
    })
    score.update(0, 0)
    score.update(1, 2) // still bar 0 in three-four
    expect(host.calls).toHaveLength(1)
    score.update(1, 3)
    expect(host.calls).toHaveLength(2)
  })

  it('drives a real patch, headlessly', () => {
    // End to end, because the two halves are only worth anything joined: a number from a game turns into a
    // measurably different piece of audio, with no browser and no context anywhere.
    const patch: Patch = {
      modules: [
        { id: 'osc', type: 'vco', params: { tune: 0 } },
        { id: 'out', type: 'out', params: { level: 0.2 } },
      ],
      cables: [{ from: ['osc', 'out'], to: ['out', 'in'] }],
      tempo: 120,
    }
    const renderer = new RackRenderer(MODULES, { sampleRate: 48000 })
    renderer.patch = patch
    renderer.setTransport(120, true)

    const score = new Adaptive(renderer, RAMP)
    const calm = renderer.render(0.2, ({ beat }) => score.update(0.1, beat))
    const loud = renderer.render(0.2, ({ beat }) => score.update(1, beat))

    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length)
    expect(rms(loud.channels[0])).toBeGreaterThan(rms(calm.channels[0]) * 2)
  })
})
