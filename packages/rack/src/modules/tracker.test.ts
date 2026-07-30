import { describe, expect, it } from 'vitest'
import { TRACKER_LANES, TRACKER_MODULE, TrackerProcessor } from './tracker.js'

// The tracker, and mostly the one decision it rests on: a step is a VALUE, not a switch. Zero is a rest,
// anything else opens the gate and comes out as a CV. That is what lets the same module drive drums, a
// bassline and a chopped break, so most of what is worth testing here is the consequences of it.
//
// The other thing worth pinning is the param ORDER, because the processor reads params positionally —
// `params[1 + lane]` for a mute and `params[1 + lanes + lane]` for a unit. Inserting a param at the front
// would silently mute a lane or transpose a pattern, and a test that names the order fails loudly instead.

const SR = 44100
const LANES = TRACKER_LANES

/**
 * Samples per step in the test clock, and it has to be well over the trigger width.
 *
 * The trigger is a millisecond, which is 45 samples at this rate. The first version of this file clocked
 * every 8 samples — faster than the module's own trigger — so every trigger ran into the next one and came
 * back as a single continuous high. That was the test being unphysical, not the module: a sixteenth at
 * 174bpm is about 3800 samples, and no real clock is anywhere near this fast.
 */
const STEP = 128

interface Options {
  /** Per lane, one value per step. Lane 1 is index 0. */
  lanes?: (number[] | undefined)[]
  length?: number
  mute?: number[]
  unit?: number[]
  /** Which samples the clock is high for. Default: half-duty at `STEP`. */
  clock?: (i: number) => boolean
  reset?: (i: number) => boolean
}

/** Run the tracker for `frames` samples and hand back every outlet. */
function run(frames: number, options: Options = {}) {
  const store = new Map<string, Float32Array>()
  for (const [lane, values] of (options.lanes ?? []).entries()) {
    if (values) store.set(`lane${lane + 1}`, Float32Array.from(values))
  }
  const processor = new TrackerProcessor(SR, {}, 't', { get: (slot) => store.get(slot) })

  const high = options.clock ?? ((i: number) => i % STEP < STEP / 2)
  const clock = Float32Array.from({ length: frames }, (_, i) => (high(i) ? 1 : 0))
  const reset = Float32Array.from({ length: frames }, (_, i) => (options.reset?.(i) ? 1 : 0))

  const params = TRACKER_MODULE.params.map((def) => new Float32Array(frames).fill(def.default))
  if (options.length !== undefined) params[0].fill(options.length)
  for (const [lane, value] of (options.mute ?? []).entries()) params[1 + lane].fill(value)
  for (const [lane, value] of (options.unit ?? []).entries()) params[1 + LANES + lane].fill(value)

  const outlets = TRACKER_MODULE.outlets.map(() => new Float32Array(frames))
  processor.process([clock, reset], outlets, params, frames)

  const lane = (n: number) => ({
    cv: outlets[n * 3],
    gate: outlets[n * 3 + 1],
    trig: outlets[n * 3 + 2],
  })
  return { lane, outlets, store, processor, params }
}

/**
 * Rising edges in a signal — how many times it struck, rather than how long it was high.
 *
 * Counts an edge at index 0, which matters: the processor starts with `lastClock` at zero, so a clock that
 * is already high on the first sample of the block IS a rising edge and plays step one there. Scanning from
 * index 1 quietly dropped the downbeat out of half of these assertions.
 */
const pulses = (signal: Float32Array) => {
  let count = 0
  for (let i = 0; i < signal.length; i++) {
    if (signal[i] >= 0.5 && (i === 0 || signal[i - 1] < 0.5)) count++
  }
  return count
}

/** Every gate edge on a lane, with the CV that was standing at it — the pattern as it was played back. */
const played = (lane: { cv: Float32Array; gate: Float32Array }, scale = 12) => {
  const hits: { at: number; value: number }[] = []
  for (let i = 0; i < lane.gate.length; i++) {
    if (lane.gate[i] >= 0.5 && (i === 0 || lane.gate[i - 1] < 0.5)) {
      hits.push({ at: i, value: Math.round(lane.cv[i] * scale) })
    }
  }
  return hits
}

describe('the tracker', () => {
  it('plays step one on the first clock rather than step two', () => {
    // The step counter starts at −1 for exactly this. Starting at 0 and incrementing would skip the
    // downbeat of every pattern, which is the sort of off-by-one that sounds like the pattern is written
    // wrong rather than like the sequencer is.
    const { lane } = run(16, { lanes: [[7, 0, 0, 0]], clock: (i) => i >= 1 })
    expect(lane(0).cv[0]).toBe(0)
    expect(lane(0).cv[2]).toBeCloseTo(7 / 12, 6)
  })

  it('is silent before the first clock', () => {
    const { lane } = run(STEP, { lanes: [[5, 5, 5, 5]], clock: () => false })
    expect([...lane(0).gate]).toEqual(Array(STEP).fill(0))
    expect([...lane(0).cv]).toEqual(Array(STEP).fill(0))
  })

  it('walks one step per clock edge, not per sample', () => {
    // Four steps of distinct values over four clocks, read back as semitones.
    const { lane } = run(STEP * 4, { lanes: [[1, 2, 3, 4]], length: 4 })
    expect(played(lane(0)).map((hit) => hit.value)).toEqual([1, 2, 3, 4])
  })

  it('treats zero as a rest and everything else as a note', () => {
    // The whole design in one assertion. No separate gate lane, no on/off switches — the value is both.
    const { lane } = run(STEP * 4, { lanes: [[5, 0, 5, 0]], length: 4 })
    expect(pulses(lane(0).gate)).toBe(2)
    expect(pulses(lane(0).trig)).toBe(2)
  })

  it('holds the CV across a rest instead of dropping to zero', () => {
    // A sequencer that fell to zero on every rest would end every phrase on the same wrong note, and
    // anything tracking the CV — a filter, a sampler's slice — would lurch on every gap in the rhythm.
    const { lane } = run(STEP * 4, { lanes: [[9, 0, 0, 0]], length: 4 })
    // Step 1 sets it; steps 2-4 are rests and it stays put for the rest of the bar.
    for (let i = 1; i < STEP * 4; i++) expect(lane(0).cv[i]).toBeCloseTo(9 / 12, 6)
  })

  it('runs four lanes independently off one clock', () => {
    // The reason it is a tracker and not four sequencers: one clock, four things happening at once.
    const { lane } = run(STEP, { lanes: [[1], [0], [3], [4]], length: 1 })
    expect(pulses(lane(0).gate)).toBeGreaterThan(0)
    expect(pulses(lane(1).gate)).toBe(0)
    expect(Math.round(lane(2).cv[STEP - 1] * 12)).toBe(3)
    expect(Math.round(lane(3).cv[STEP - 1] * 12)).toBe(4)
  })

  it('scales as semitones by default and as sixteenths in unit mode', () => {
    // Semitones because that is what every other pitch-shaped signal in the rack is. `Unit` divides by
    // sixteen instead — a bar of sixteenths, and the sampler's default slice count — so a lane written
    // 0-15 sweeps exactly one pass through a chopped break. Both wirings have to be natural or the D&B
    // patch needs a scaler module in between.
    const semi = run(STEP, { lanes: [[12]], length: 1 })
    expect(semi.lane(0).cv[STEP - 1]).toBeCloseTo(1, 6)

    const unit = run(STEP, { lanes: [[8]], length: 1, unit: [1] })
    expect(unit.lane(0).cv[STEP - 1]).toBeCloseTo(0.5, 6)
  })

  it('lines a unit lane up with the sampler it is meant to drive', () => {
    // The claim above, checked against the number the sampler actually uses: slice = round(cv * slices).
    const slices = 16
    for (const step of [1, 5, 15]) {
      const { lane } = run(STEP, { lanes: [[step]], length: 1, unit: [1] })
      expect(Math.round(lane(0).cv[STEP - 1] * slices)).toBe(step)
    }
  })

  it('wraps at its own length rather than at the pattern length', () => {
    // Shortening the length knob has to shorten the loop without rewriting the data, because that is how
    // anybody auditions half a bar of a four-bar pattern.
    const { lane } = run(STEP * 7, { lanes: [[1, 2, 3, 4, 5, 6, 7, 8]], length: 3 })
    expect(played(lane(0)).map((hit) => hit.value)).toEqual([1, 2, 3, 1, 2, 3, 1])
  })

  it('rests on steps past the end of the data', () => {
    // A length of sixteen over four written steps is twelve rests, not twelve reads of undefined. This is
    // the state a freshly dropped tracker is in, so it has to be silence rather than NaN.
    const { lane } = run(STEP * 8, { lanes: [[3, 3]], length: 8 })
    expect(pulses(lane(0).gate)).toBe(2)
    for (const x of lane(0).cv) expect(Number.isFinite(x)).toBe(true)
  })

  it('is silent on a lane with no data at all', () => {
    const { lane } = run(STEP * 2)
    for (let n = 0; n < LANES; n++) {
      expect([...lane(n).gate]).toEqual(Array(STEP * 2).fill(0))
      expect([...lane(n).trig]).toEqual(Array(STEP * 2).fill(0))
    }
  })

  it('mutes a lane without stopping the others or losing its place', () => {
    // Muting is a performance control, so the pattern has to keep running underneath — unmuting mid-bar
    // should drop back in on the beat rather than restart.
    const muted = run(STEP * 4, { lanes: [[1, 2, 3, 4], [1, 2, 3, 4]], length: 4, mute: [1] })
    expect(pulses(muted.lane(0).gate)).toBe(0)
    expect(pulses(muted.lane(1).gate)).toBeGreaterThan(0)
  })

  it('winds back to before step one on a reset', () => {
    // Matching `seq` and unlike the Clock, whose reset fires immediately: a sequencer's job is to be
    // somewhere when the beat arrives, not to play a step the moment it is told to go back to the top.
    // Reset lands during step three, so without it the next hit would be step four.
    const at = STEP * 2 + 10
    const { lane } = run(STEP * 6, {
      lanes: [[1, 2, 3, 4, 5, 6, 7, 8]],
      length: 8,
      reset: (i) => i >= at && i < at + 4,
    })
    const before = played(lane(0)).filter((hit) => hit.at < at)
    expect(before.map((hit) => hit.value)).toEqual([1, 2, 3])
    const after = played(lane(0)).filter((hit) => hit.at > at)
    // Back to the top, and it waited for the beat to do it.
    expect(after[0].value).toBe(1)
    expect(after[0].at).toBeGreaterThanOrEqual(STEP * 3)
  })

  it('follows the clock width for its gate and fires a short trigger regardless', () => {
    // Two different jobs. The gate holds an envelope open for as long as the step lasts, so one knob on
    // the Clock shortens every step at once; the trigger is a blip that strikes something, and a drum
    // does not want a gate the length of a sixteenth.
    const frames = STEP * 4
    const wide = run(frames, { lanes: [[1, 1, 1, 1]], length: 4, clock: (i) => i % STEP < STEP * 0.75 })
    let held = 0
    for (const x of wide.lane(0).gate) if (x >= 0.5) held++
    // Three quarters of every step, following the clock and nothing else.
    expect(held).toBe(frames * 0.75)

    let struck = 0
    for (const x of wide.lane(0).trig) if (x >= 0.5) struck++
    // A millisecond at 44.1kHz is 45 samples, over four hits: 180, well short of the 384 the gate held.
    expect(struck).toBe(4 * Math.ceil(SR * 0.001))
    expect(struck).toBeLessThan(held)

    // Narrowing the clock narrows the gate and leaves the trigger alone, which is the whole distinction.
    const narrow = run(frames, { lanes: [[1, 1, 1, 1]], length: 4, clock: (i) => i % STEP < STEP * 0.25 })
    let short = 0
    for (const x of narrow.lane(0).gate) if (x >= 0.5) short++
    expect(short).toBe(frames * 0.25)
    let same = 0
    for (const x of narrow.lane(0).trig) if (x >= 0.5) same++
    expect(same).toBe(struck)
  })

  it('reads its pattern on the clock edge only', () => {
    // Editing a lane while it plays must not retrigger the step that is already sounding, or dragging a
    // value in the editor would machine-gun the voice.
    const store = new Map<string, Float32Array>()
    store.set('lane1', Float32Array.from([5, 5, 5, 5]))
    const processor = new TrackerProcessor(SR, {}, 't', { get: (slot) => store.get(slot) })
    const frames = STEP * 2
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < 8 ? 1 : 0))
    const params = TRACKER_MODULE.params.map((def) => new Float32Array(frames).fill(def.default))
    params[0].fill(4)
    const outlets = TRACKER_MODULE.outlets.map(() => new Float32Array(frames))

    processor.process([clock, new Float32Array(frames)], outlets, params, frames)
    // Two clock edges in this block, so two hits — not one per sample the data was readable.
    expect(pulses(outlets[2])).toBe(2)
  })

  it('picks up new data on the next step without a subscription', () => {
    // Same protocol as the sampler: the module reads through `data.get` and the host just swaps the array.
    const store = new Map<string, Float32Array>()
    store.set('lane1', Float32Array.from([1]))
    const processor = new TrackerProcessor(SR, {}, 't', { get: (slot) => store.get(slot) })
    const frames = STEP
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < 8 ? 1 : 0))
    const params = TRACKER_MODULE.params.map((def) => new Float32Array(frames).fill(def.default))
    params[0].fill(1)
    const first = TRACKER_MODULE.outlets.map(() => new Float32Array(frames))
    processor.process([clock, new Float32Array(frames)], first, params, frames)
    expect(Math.round(first[0][frames - 1] * 12)).toBe(1)

    store.set('lane1', Float32Array.from([11]))
    const second = TRACKER_MODULE.outlets.map(() => new Float32Array(frames))
    processor.process([clock, new Float32Array(frames)], second, params, frames)
    expect(Math.round(second[0][frames - 1] * 12)).toBe(11)
  })

  it('clamps a length outside its range instead of running off the pattern', () => {
    for (const length of [-5, 0, 1000]) {
      const { lane } = run(STEP * 2, { lanes: [[1, 2, 3, 4]], length })
      for (const x of lane(0).cv) expect(Number.isFinite(x)).toBe(true)
      for (const x of lane(0).gate) expect(x === 0 || x === 1).toBe(true)
    }
  })
})

describe('the tracker’s shape', () => {
  it('reads its params in the order they are declared', () => {
    // Load-bearing: the processor reads params[0] for length, then a mute per lane, then a unit per lane.
    // Inserting one at the front would silently mute a lane or transpose a pattern.
    expect(TRACKER_MODULE.params.map((p) => p.id)).toEqual([
      'length',
      'mute1',
      'mute2',
      'mute3',
      'mute4',
      'unit1',
      'unit2',
      'unit3',
      'unit4',
    ])
  })

  it('has three outlets per lane, grouped by lane', () => {
    // The processor indexes them as `lane * 3 + n`, so the grouping is not cosmetic.
    expect(TRACKER_MODULE.outlets.length).toBe(LANES * 3)
    expect(TRACKER_MODULE.outlets.map((o) => o.id).slice(0, 6)).toEqual([
      'cv1',
      'gate1',
      'trig1',
      'cv2',
      'gate2',
      'trig2',
    ])
  })

  it('derives its lane count from its outlets rather than from a constant it cannot see', () => {
    // The processor is serialised into an AudioWorkletGlobalScope, where nothing at this module's scope
    // exists. The first version read a `LANES` const inside `process` and would have thrown a
    // ReferenceError on the audio thread the first time a patch with a tracker loaded — the contract
    // suite in `modules.test.ts` caught it. This checks the fix directly: hand it three lanes' worth of
    // outlets and it uses three, without being told.
    const store = new Map<string, Float32Array>()
    store.set('lane1', Float32Array.from([4]))
    store.set('lane3', Float32Array.from([6]))
    const processor = new TrackerProcessor(SR, {}, 't', { get: (slot) => store.get(slot) })
    const frames = 8
    const clock = Float32Array.from({ length: frames }, (_, i) => (i > 0 ? 1 : 0))
    // Three lanes: nine outlets, one length param plus three mutes plus three units.
    const params = [
      new Float32Array(frames).fill(1),
      ...Array.from({ length: 6 }, () => new Float32Array(frames)),
    ]
    const outlets = Array.from({ length: 9 }, () => new Float32Array(frames))
    processor.process([clock, new Float32Array(frames)], outlets, params, frames)
    expect(Math.round(outlets[0][7] * 12)).toBe(4)
    expect(Math.round(outlets[6][7] * 12)).toBe(6)
  })

  it('is mono, because eight copies would all play the same step', () => {
    expect(TRACKER_MODULE.poly).toBe(false)
  })

  it('agrees with the sampler about what sixteen means', () => {
    // Unit mode divides by 16 and the sampler defaults to 16 slices. If either moved on its own, a lane
    // of slice indices would stop lining up with the break it was written against.
    expect(TRACKER_MODULE.params.find((p) => p.id === 'length')!.default).toBe(16)
  })
})
