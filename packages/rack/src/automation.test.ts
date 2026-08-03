import { describe, expect, it } from 'vitest'
import {
  automationLength,
  clearLane,
  laneFor,
  pointsIn,
  setPoint,
  STEPS_PER_BAR,
  stepOf,
  valueAt,
} from './automation.js'
import { decodePatch, encodePatch } from './patch-io.js'
import type { AutoLane, ParamRef, Patch } from './types.js'

// What a knob did, over the arrangement.
//
// The interesting behaviour is all at the edges — before the first point, after the last, on the seam
// between two scheduler windows — because those are where a lane either quietly takes ownership of a knob
// nobody meant it to, or drops a move somebody recorded.

const CUTOFF: ParamRef = ['ladder-1', 'cutoff']
const RES: ParamRef = ['ladder-1', 'resonance']

describe('recording a move', () => {
  it('starts a lane for a parameter that had none', () => {
    const lanes = setPoint(undefined, CUTOFF, 16, 800)
    expect(lanes).toHaveLength(1)
    expect(laneFor(lanes, CUTOFF)?.points).toEqual([{ at: 16, value: 800 }])
  })

  it('keeps points in order however they were recorded', () => {
    // Somebody scrubbing backwards records out of order, and every reader downstream walks the lane
    // assuming it ascends.
    let lanes = setPoint(undefined, CUTOFF, 32, 900)
    lanes = setPoint(lanes, CUTOFF, 0, 100)
    lanes = setPoint(lanes, CUTOFF, 16, 500)
    expect(laneFor(lanes, CUTOFF)?.points.map((p) => p.at)).toEqual([0, 16, 32])
  })

  it('replaces a point rather than stacking one on the same instant', () => {
    // Two values at one position is not a thing a lane can mean, and a knob somebody wiggles while armed
    // would otherwise grow the lane without limit.
    let lanes = setPoint(undefined, CUTOFF, 16, 500)
    lanes = setPoint(lanes, CUTOFF, 16, 900)
    expect(laneFor(lanes, CUTOFF)?.points).toEqual([{ at: 16, value: 900 }])
  })

  it('keeps one lane per parameter', () => {
    let lanes = setPoint(undefined, CUTOFF, 0, 500)
    lanes = setPoint(lanes, RES, 0, 0.5)
    expect(lanes).toHaveLength(2)
    expect(laneFor(lanes, RES)?.points[0].value).toBe(0.5)
  })

  it('does not mutate what it was given', () => {
    // The store is immutable throughout, and undo holds onto the version before — a shared array would be
    // a hole in both at once.
    const before = setPoint(undefined, CUTOFF, 0, 500)
    const after = setPoint(before, CUTOFF, 16, 900)
    expect(before).not.toBe(after)
    expect(laneFor(before, CUTOFF)?.points).toHaveLength(1)
  })

  it('ignores a value that is not a number rather than poisoning the lane', () => {
    // `JSON.stringify(NaN)` is `null`, so one of these reaching a lane makes the patch unloadable later —
    // a long way from where it was recorded.
    const lanes = setPoint(undefined, CUTOFF, 0, Number.NaN)
    expect(lanes).toEqual([])
  })

  it('forgets a lane entirely when it is cleared', () => {
    // Dropped rather than left empty, so clearing leaves the patch exactly as it was before recording.
    const lanes = clearLane(setPoint(undefined, CUTOFF, 0, 500), CUTOFF)
    expect(lanes).toEqual([])
  })
})

describe('reading a lane', () => {
  const lane = (): AutoLane =>
    laneFor(setPoint(setPoint(undefined, CUTOFF, 0, 100), CUTOFF, 16, 900), CUTOFF)!

  it('says nothing before its first point', () => {
    // The single most important behaviour here. A lane that answered from step zero would take ownership
    // of a knob the moment anybody recorded one move late in the arrangement — so the knob would snap to a
    // value nobody set, at the top of the song, and stay there.
    const late = laneFor(setPoint(undefined, CUTOFF, 64, 900), CUTOFF)
    expect(valueAt(late, 0)).toBeUndefined()
    expect(valueAt(late, 63)).toBeUndefined()
    expect(valueAt(late, 64)).toBe(900)
  })

  it('holds the last value after its last point', () => {
    expect(valueAt(lane(), 999)).toBe(900)
  })

  it('interpolates between two points', () => {
    expect(valueAt(lane(), 8)).toBeCloseTo(500, 5)
  })

  it('steps rather than interpolates when the lane says hold', () => {
    // A waveform selector two thirds of the way between saw and pulse is not a sound.
    const held: AutoLane = { target: CUTOFF, curve: 'hold', points: [
      { at: 0, value: 0 },
      { at: 16, value: 2 },
    ] }
    expect(valueAt(held, 8)).toBe(0)
    expect(valueAt(held, 16)).toBe(2)
  })

  it('says nothing at all for a lane that does not exist', () => {
    expect(valueAt(undefined, 0)).toBeUndefined()
  })
})

describe('a scheduler looking ahead', () => {
  const lane = (): AutoLane =>
    laneFor(
      setPoint(setPoint(setPoint(undefined, CUTOFF, 0, 1), CUTOFF, 4, 2), CUTOFF, 8, 3),
      CUTOFF,
    )!

  it('takes a window open at the start and closed at the end', () => {
    // A scheduler advances by setting `from` to the previous `to`, so a point exactly on the seam is
    // either scheduled twice or never depending on which way the comparison falls. Twice is a knob that
    // jumps and jumps back; never is a move that silently did not happen.
    expect(pointsIn(lane(), -1, 4).map((p) => p.at)).toEqual([0, 4])
    expect(pointsIn(lane(), 4, 8).map((p) => p.at)).toEqual([8])
  })

  it('covers every point exactly once across consecutive windows', () => {
    const seen: number[] = []
    for (let from = -1; from < 12; from += 3) {
      for (const point of pointsIn(lane(), from, from + 3)) seen.push(point.at)
    }
    expect(seen).toEqual([0, 4, 8])
  })

  it('is empty for a window with nothing in it', () => {
    expect(pointsIn(lane(), 100, 200)).toEqual([])
  })
})

describe('positions', () => {
  it('counts sixteenths from the top of the arrangement', () => {
    expect(stepOf(0, 0)).toBe(0)
    expect(stepOf(1, 0)).toBe(STEPS_PER_BAR)
    expect(stepOf(2, 3)).toBe(STEPS_PER_BAR * 2 + 3)
  })

  it('never goes negative, whatever it is handed', () => {
    expect(stepOf(-4, 0)).toBe(0)
  })

  it('reports how far the automation runs', () => {
    let lanes = setPoint(undefined, CUTOFF, 16, 1)
    lanes = setPoint(lanes, RES, 64, 1)
    expect(automationLength(lanes)).toBe(64)
    expect(automationLength(undefined)).toBe(0)
  })
})

describe('automation in a saved patch', () => {
  const withLane = (): Patch => ({
    modules: [{ id: 'ladder-1', type: 'ladder' }],
    cables: [],
    automation: setPoint(setPoint(undefined, CUTOFF, 0, 200), CUTOFF, 16, 900),
  })

  it('survives a round trip', () => {
    const back = decodePatch(encodePatch(withLane()))
    expect(back?.automation).toEqual(withLane().automation)
  })

  it('is absent rather than empty on a patch that has none', () => {
    // So a patch written before automation existed round-trips byte-identically, which is the standard
    // every optional field here holds itself to.
    const plain: Patch = { modules: [{ id: 'ladder-1', type: 'ladder' }], cables: [] }
    expect(decodePatch(encodePatch(plain))).toEqual(plain)
    expect(encodePatch(decodePatch(encodePatch(plain))!)).toBe(encodePatch(plain))
  })

  it('drops a lane naming a module the file does not contain', () => {
    // The same rule a cable and a Combinator routing follow: an endpoint naming an id nothing here has is
    // corruption with no repair, and keeping it would mean it accumulated across every save from here on.
    const orphan = JSON.stringify({
      v: 1,
      patch: {
        modules: [{ id: 'ladder-1', type: 'ladder' }],
        cables: [],
        automation: [{ target: ['gone-9', 'cutoff'], points: [{ at: 0, value: 1 }] }],
      },
    })
    expect(decodePatch(orphan)?.automation).toBeUndefined()
  })

  it('keeps a lane naming a param this build has never heard of', () => {
    // Not the same case. That param may belong to a newer version of the module, and the scheduler skips
    // what it cannot resolve rather than deleting somebody's recording.
    const future = JSON.stringify({
      v: 1,
      patch: {
        modules: [{ id: 'ladder-1', type: 'ladder' }],
        cables: [],
        automation: [{ target: ['ladder-1', 'wobble'], points: [{ at: 0, value: 1 }] }],
      },
    })
    expect(decodePatch(future)?.automation).toHaveLength(1)
  })

  it('repairs a lane that arrives out of order or full of nonsense', () => {
    // A patch arrives from outside the program — localStorage from an older build, a hand-edited file, a
    // URL somebody sent. Every reader downstream assumes ascending order and finite values.
    const messy = JSON.stringify({
      v: 1,
      patch: {
        modules: [{ id: 'ladder-1', type: 'ladder' }],
        cables: [],
        automation: [
          {
            target: ['ladder-1', 'cutoff'],
            points: [
              { at: 32, value: 3 },
              { at: 'soon', value: 4 },
              { at: 0, value: 1 },
              { at: 16, value: null },
              { at: -5, value: 9 },
            ],
          },
          { target: ['ladder-1', 'resonance'], points: [] },
        ],
      },
    })
    const lanes = decodePatch(messy)?.automation
    expect(lanes).toHaveLength(1)
    expect(lanes?.[0].points).toEqual([
      { at: 0, value: 1 },
      { at: 32, value: 3 },
    ])
  })
})
