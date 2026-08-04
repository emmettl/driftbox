import { describe, expect, it } from 'vitest'
import { ARP_MODULE, ARP_PATTERN_STEPS, ArpProcessor } from './arp.js'
import { Random } from '../dsp/random.js'

// One note in, a line out.
//
// The claims worth pinning are musical rather than numeric: the notes are the chord you asked for, in the
// direction you asked for, and an up-down run turns without stuttering at the ends. The last one is the
// only piece of arithmetic here anybody would get wrong, and it is the difference between a run and a
// limp.

const SR = 44100
const deps = { Random }
const param = (id: string) => ARP_MODULE.params.findIndex((p) => p.id === id)
/** Samples per clock step. Short — nothing here depends on a step being musically long. */
const STEP = 64

interface Options {
  chord?: number
  octaves?: number
  mode?: number
  gate?: number
  root?: number
  reset?: (i: number) => boolean
  timing?: number
  division?: number
  rate?: number
  insert?: number
  singleRepeat?: number
  shuffle?: number
  enable?: number
}

/** Clock the arp for `steps` steps and report the pitch it held during each one, in semitones. */
function run(steps: number, options: Options = {}) {
  const arp = new ArpProcessor(SR, deps, 'arp-1')
  const frames = steps * STEP
  const pitch = new Float32Array(frames).fill(options.root ?? 0)
  const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
  const reset = Float32Array.from({ length: frames }, (_, i) => (options.reset?.(i) ? 1 : 0))

  const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
  for (const [id, value] of Object.entries(options)) {
    const at = param(id)
    if (at >= 0 && typeof value === 'number') params[at].fill(value)
  }

  const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
  arp.process(
    [pitch, new Float32Array(frames), new Float32Array(frames).fill(1), clock, reset],
    out,
    params,
    frames,
  )

  /** The note held in the middle of each step, in semitones above the root. */
  const notes: number[] = []
  for (let s = 0; s < steps; s++) notes.push(Math.round(out[0][s * STEP + STEP / 2] * 12))
  return { notes, out }
}

interface PlayedOptions {
  mode?: number
  octaves?: number
  hold?: number
  shift?: number
  velocityMode?: number
  velocity?: number
  releaseAt?: number
  insert?: number
}

/** Feed independent pitch/gate/velocity lanes through the same collector view the Graph supplies. */
function runPlayed(steps: number, semitones: number[], options: PlayedOptions = {}) {
  const arp = new ArpProcessor(SR, deps, 'arp-played')
  const frames = steps * STEP
  const pitch = semitones.map((note) => new Float32Array(frames).fill(note / 12))
  const gate = semitones.map(() => Float32Array.from(
    { length: frames },
    (_, i) => i < (options.releaseAt ?? frames) ? 1 : 0,
  ))
  const velocity = semitones.map((_, voice) => new Float32Array(frames).fill(0.25 + voice * 0.2))
  const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
  const zero = new Float32Array(frames)
  const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
  params[param('source')].fill(1)
  for (const [id, value] of Object.entries(options)) {
    const at = param(id)
    if (at >= 0 && typeof value === 'number') params[at].fill(value)
  }
  const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
  arp.process(
    [zero, zero, zero, clock, zero],
    out,
    params,
    frames,
    undefined,
    undefined,
    [pitch, gate, velocity, [clock], [zero]],
  )
  return {
    notes: Array.from({ length: steps }, (_, step) => Math.round(out[0][step * STEP + STEP / 2] * 12)),
    velocities: Array.from({ length: steps }, (_, step) => out[2][step * STEP + STEP / 2]),
    out,
  }
}

describe('converter bypass', () => {
  it('defaults on so every older Driftbox figure remains enabled', () => {
    expect(ARP_MODULE.params[param('enable')].default).toBe(1)
  })

  it('mirrors Root pitch, gate and velocity without a clock or figure processing', () => {
    const arp = new ArpProcessor(SR, deps, 'arp-root-bypass')
    const frames = 128
    const pitch = Float32Array.from({ length: frames }, (_, i) => i / frames)
    const gate = Float32Array.from({ length: frames }, (_, i) => i >= 16 && i < 96 ? 1 : 0)
    const velocity = new Float32Array(frames).fill(0.42)
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('enable')].fill(0)
    params[param('shift')].fill(3)
    params[param('velocityMode')].fill(1)
    params[param('velocity')].fill(0.9)
    params[param('timing')].fill(2)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [pitch, gate, velocity, new Float32Array(frames), new Float32Array(frames)],
      out,
      params,
      frames,
    )

    expect(out[0]).toEqual(pitch)
    expect(out[1]).toEqual(gate)
    expect(out[2].every((value) => Math.abs(value - 0.42) < 1e-5)).toBe(true)
    expect([...out[3]].flatMap((value, index) => value >= 0.5 && (index === 0 || out[3][index - 1] < 0.5) ? [index] : []))
      .toEqual([16])
  })

  it('uses last-note priority in Played mode and falls back without dropping Gate', () => {
    const arp = new ArpProcessor(SR, deps, 'arp-played-bypass')
    const frames = 192
    const pitch = [new Float32Array(frames), new Float32Array(frames).fill(7 / 12)]
    const gate = [
      Float32Array.from({ length: frames }, (_, i) => i < 160 ? 1 : 0),
      Float32Array.from({ length: frames }, (_, i) => i < 64 ? 1 : 0),
    ]
    const velocity = [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(0.8)]
    const zero = new Float32Array(frames)
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('enable')].fill(0)
    params[param('source')].fill(1)
    params[param('hold')].fill(1)
    params[param('shift')].fill(-3)
    params[param('velocityMode')].fill(1)
    params[param('velocity')].fill(0.99)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [zero, zero, zero, zero, zero],
      out,
      params,
      frames,
      undefined,
      undefined,
      [pitch, gate, velocity, [zero], [zero]],
    )

    expect(Math.round(out[0][32] * 12)).toBe(7)
    expect(out[2][32]).toBeCloseTo(0.8)
    expect(Math.round(out[0][96] * 12)).toBe(0)
    expect(out[2][96]).toBeCloseTo(0.25)
    expect(out[1].slice(0, 160).every((value) => value === 1)).toBe(true)
    expect(out[1].slice(160).every((value) => value === 0)).toBe(true)
    expect([...out[3]].flatMap((value, index) => value >= 0.5 && (index === 0 || out[3][index - 1] < 0.5) ? [index] : []))
      .toEqual([0, 64])
  })
})

describe('start of arpeggio', () => {
  it('keeps an armed figure silent until Start rises, then restarts it from step one', () => {
    const arp = new ArpProcessor(SR, deps, 'arp-start')
    const frames = STEP * 6
    const pitch = new Float32Array(frames)
    const clock = Float32Array.from({ length: frames }, (_, i) => i % STEP < STEP / 2 ? 1 : 0)
    const start = Float32Array.from({ length: frames }, (_, i) =>
      (i >= STEP + 8 && i < STEP + 16) || (i >= STEP * 3 + 8 && i < STEP * 3 + 16) ? 1 : 0,
    )
    const zero = new Float32Array(frames)
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('chord')].fill(2)
    params[param('octaves')].fill(1)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))

    arp.process(
      [pitch, zero, zero, clock, zero, start],
      out,
      params,
      frames,
      undefined,
      undefined,
      undefined,
      [false, false, false, true, false, true],
    )

    expect(out[1].slice(0, STEP * 2).every((value) => value === 0)).toBe(true)
    expect(Math.round(out[0][STEP * 2 + 8] * 12)).toBe(0)
    expect(Math.round(out[0][STEP * 3 + 8] * 12)).toBe(4)
    expect(Math.round(out[0][STEP * 4 + 8] * 12)).toBe(0)
    expect([...out[4]].flatMap((value, index) =>
      value >= 0.5 && (index === 0 || out[4][index - 1] < 0.5) ? [index] : [],
    )).toEqual([STEP * 2, STEP * 4])
  })

  it('keeps the legacy immediate start when the Start jack is unplugged', () => {
    const { notes, out } = run(4, { chord: 2, octaves: 1 })
    expect(notes).toEqual([0, 4, 7, 0])
    expect([...out[4]].flatMap((value, index) =>
      value >= 0.5 && (index === 0 || out[4][index - 1] < 0.5) ? [index] : [],
    )).toEqual([0, STEP * 3])
  })

  it('holds Start Out for the opening note instead of emitting a fixed trigger', () => {
    const { out } = run(4, { chord: 2, octaves: 1, gate: 0.5 })
    const runs = (data: Float32Array) => {
      const found: [number, number][] = []
      let start = -1
      for (let i = 0; i <= data.length; i++) {
        const high = i < data.length && data[i] >= 0.5
        if (high && start < 0) start = i
        else if (!high && start >= 0) {
          found.push([start, i - start])
          start = -1
        }
      }
      return found
    }

    expect(runs(out[4])).toEqual([[0, 22], [STEP * 3, STEP / 2]])
    expect(runs(out[1]).filter(([start]) => start === 0 || start === STEP * 3)).toEqual(runs(out[4]))
  })

  it('carries the Gate Length endpoints to Start Out', () => {
    expect(run(3, { chord: 2, octaves: 1, gate: 0 }).out[4].every((value) => value === 0)).toBe(true)
    expect(run(3, { chord: 2, octaves: 1, gate: 1 }).out[4].every((value) => value === 1)).toBe(true)
  })

  it('appends stable Start ports without moving the existing cable ids', () => {
    expect(ARP_MODULE.inlets.map((port) => port.id)).toEqual(['pitch', 'gate', 'velocity', 'clock', 'reset', 'start'])
    expect(ARP_MODULE.outlets.map((port) => port.id)).toEqual(['pitch', 'gate', 'velocity', 'trig', 'start'])
  })
})

describe('what it plays', () => {
  it('walks up the chord you chose', () => {
    // Minor triad over two octaves: root, minor third, fifth, then the same an octave up.
    const { notes } = run(6, { chord: 3, octaves: 2, mode: 0 })
    expect(notes).toEqual([0, 3, 7, 12, 15, 19])
  })

  it('plays a different chord when you say so', () => {
    const { notes } = run(4, { chord: 5, octaves: 1, mode: 0 })
    expect(notes).toEqual([0, 3, 7, 10])
  })

  it('transposes with the root, because the root is a V/Oct inlet', () => {
    // One unit is an octave, so a root of 1 puts the whole figure twelve semitones up. A module that read
    // the root in semitones would be out of tune with every other pitch inlet in the rack.
    const { notes } = run(3, { chord: 2, octaves: 1, mode: 0, root: 1 })
    expect(notes).toEqual([12, 16, 19])
  })

  it('goes down when told to', () => {
    // The opening edge plays where the figure *starts*, and for a downward run that is the top — G, E, C,
    // then round again. An arp that advanced on its first edge like it does on every later one would open
    // on the second note and never sound the note you asked for until the figure came round.
    const { notes } = run(4, { chord: 2, octaves: 1, mode: 1 })
    expect(notes).toEqual([7, 4, 0, 7])
  })

  it('turns an up-down run without repeating the end notes', () => {
    // The one piece of arithmetic worth reading twice. Turning by simply reversing plays the end note
    // twice, which sounds like a stutter at each end rather than like a run — every arpeggiator that has
    // ever felt wrong has felt wrong here. C E G, then back down through E to C, and out through E again:
    // each end is struck once.
    const { notes } = run(8, { chord: 2, octaves: 1, mode: 2 })
    expect(notes).toEqual([0, 4, 7, 4, 0, 4, 7, 4])
  })

  it('holds a note for the whole step rather than only at its edge', () => {
    // A pitch that fell back between edges would slide every voice it fed.
    const { out } = run(2, { chord: 2, octaves: 1, mode: 0 })
    const during = out[0].slice(STEP + 4, STEP * 2 - 4)
    expect(new Set(during)).toHaveLength(1)
  })

  it('does not slide the notes already played when the root moves', () => {
    // Read on the edge rather than continuously. An arpeggio whose earlier notes moved when you changed
    // the root would not be an arpeggio.
    const arp = new ArpProcessor(SR, deps, 'arp-1')
    const frames = STEP * 2
    const pitch = Float32Array.from({ length: frames }, (_, i) => (i > STEP + 8 ? 1 : 0))
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('mode')].fill(0)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [pitch, new Float32Array(frames), new Float32Array(frames).fill(1), clock, new Float32Array(frames)],
      out,
      params,
      frames,
    )
    // The second step was struck before the root moved, so it keeps the pitch it was struck with.
    expect(out[0][frames - 1]).toBeCloseTo(out[0][STEP + 4], 6)
  })
})

describe('played chords', () => {
  it('arpeggiates held input voices from lowest to highest instead of summing their pitches', () => {
    const { notes } = runPlayed(4, [7, 0, 4], { octaves: 1, mode: 0 })
    expect(notes).toEqual([0, 4, 7, 0])
  })

  it('keeps note-on order in Manual mode', () => {
    const { notes } = runPlayed(4, [7, 0, 4], { octaves: 1, mode: 5 })
    expect(notes).toEqual([7, 0, 4, 7])
  })

  it('extends the performed chord over the selected octaves and applies octave shift', () => {
    const { notes } = runPlayed(5, [0, 7], { octaves: 2, shift: -1 })
    expect(notes).toEqual([-12, -5, 0, 7, -12])
  })

  it('latches the last played chord only when Hold is on', () => {
    const held = runPlayed(4, [0, 4, 7], { octaves: 1, hold: 1, releaseAt: STEP }).out
    const released = runPlayed(4, [0, 4, 7], { octaves: 1, hold: 0, releaseAt: STEP }).out
    expect(held[1][STEP * 2]).toBe(1)
    expect(released[1].slice(STEP).every((gate) => gate === 0)).toBe(true)
  })

  it('passes the selected note velocity or replaces it with a fixed value', () => {
    const played = runPlayed(3, [0, 4, 7], { octaves: 1 }).velocities
    expect(played[0]).toBeCloseTo(0.25, 5)
    expect(played[1]).toBeCloseTo(0.45, 5)
    expect(played[2]).toBeCloseTo(0.65, 5)
    const fixed = runPlayed(3, [0, 4, 7], {
      octaves: 1,
      velocityMode: 1,
      velocity: 0.72,
    }).velocities
    expect(fixed.every((value) => Math.abs(value - 0.72) < 1e-5)).toBe(true)
  })
})

describe('note insertion', () => {
  it('keeps Off as the exact figure that shipped before Insert', () => {
    expect(ARP_MODULE.params[param('insert')].default).toBe(0)
    expect(run(6, { chord: 2, octaves: 2, insert: 0 }).notes).toEqual([0, 4, 7, 12, 16, 19])
  })

  it('alternates the low or high anchor with the ordinary walk', () => {
    expect(run(7, { chord: 2, octaves: 1, insert: 1 }).notes).toEqual([0, 0, 4, 0, 7, 0, 0])
    expect(run(7, { chord: 2, octaves: 1, insert: 2 }).notes).toEqual([0, 7, 4, 7, 7, 7, 0])
  })

  it('plays three forward and one back, or four forward and two back', () => {
    expect(run(8, { chord: 2, octaves: 2, insert: 3 }).notes).toEqual([0, 4, 7, 4, 7, 12, 7, 12])
    expect(run(9, { chord: 2, octaves: 2, insert: 4 }).notes).toEqual([0, 4, 7, 12, 4, 7, 12, 16, 7])
  })

  it('finds the actual low note in Manual order instead of assuming lane one', () => {
    const { notes } = runPlayed(5, [7, 0, 4], { octaves: 1, mode: 5, insert: 1 })
    expect(notes).toEqual([7, 0, 0, 0, 4])
  })

  it('does not consume an insert note during a rhythm rest', () => {
    const pattern = new Float32Array(ARP_PATTERN_STEPS).fill(1)
    pattern[1] = 0
    const arp = new ArpProcessor(SR, deps, 'arp-insert-rest', {
      get: (slot) => slot === 'pattern' ? pattern : undefined,
    })
    const frames = STEP * 4
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('chord')].fill(2)
    params[param('octaves')].fill(1)
    params[param('insert')].fill(1)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames).fill(1), clock, new Float32Array(frames)],
      out,
      params,
      frames,
    )
    const sounded = Array.from({ length: 4 }, (_, step) => out[3][step * STEP] >= 0.5)
    const notes = Array.from({ length: 4 }, (_, step) => Math.round(out[0][step * STEP] * 12))
    expect(sounded).toEqual([true, false, true, true])
    expect(notes).toEqual([0, 0, 0, 4])
  })
})

describe('single-note repeat', () => {
  it('defaults on so the original Driftbox one-note figure still retriggers', () => {
    expect(ARP_MODULE.params[param('singleRepeat')].default).toBe(1)
    const { out } = run(4, { chord: 0, octaves: 1 })
    expect(Array.from({ length: 4 }, (_, step) => out[3][step * STEP] >= 0.5)).toEqual([
      true, true, true, true,
    ])
  })

  it('sounds a single-note figure once when repeat is off', () => {
    const { out } = run(4, { chord: 0, octaves: 1, singleRepeat: 0 })
    expect(Array.from({ length: 4 }, (_, step) => out[3][step * STEP] >= 0.5)).toEqual([
      true, false, false, false,
    ])
  })

  it('starts the single note again after Reset', () => {
    const { out } = run(5, {
      chord: 0,
      octaves: 1,
      singleRepeat: 0,
      reset: (i) => i >= STEP * 3 - 4 && i < STEP * 3 - 2,
    })
    expect(Array.from({ length: 5 }, (_, step) => out[3][step * STEP] >= 0.5)).toEqual([
      true, false, false, true, false,
    ])
  })

  it('sounds again when the one-note figure changes pitch', () => {
    const arp = new ArpProcessor(SR, deps, 'arp-single-change')
    const frames = STEP * 4
    const pitch = Float32Array.from({ length: frames }, (_, i) => i >= STEP * 2 ? 1 : 0)
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('chord')].fill(0)
    params[param('octaves')].fill(1)
    params[param('singleRepeat')].fill(0)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [pitch, new Float32Array(frames), new Float32Array(frames).fill(1), clock, new Float32Array(frames)],
      out,
      params,
      frames,
    )
    expect(Array.from({ length: 4 }, (_, step) => out[3][step * STEP] >= 0.5)).toEqual([
      true, false, true, false,
    ])
    expect(Math.round(out[0][STEP * 2] * 12)).toBe(12)
  })

  it('still arpeggiates a chord when single-note repeat is off', () => {
    expect(run(5, { chord: 2, octaves: 1, singleRepeat: 0 }).notes).toEqual([0, 4, 7, 0, 4])
  })
})

describe('how it is clocked', () => {
  const internalEdges = (
    division: number,
    shuffle: number,
    globalShuffle: number,
    timing = 1,
    rate = 10,
  ) => {
    const sampleRate = 1200
    const frames = 1001
    const arp = new ArpProcessor(sampleRate, deps, `arp-shuffle-${division}-${shuffle}-${globalShuffle}`)
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('timing')].fill(timing)
    params[param('division')].fill(division)
    params[param('rate')].fill(rate)
    params[param('shuffle')].fill(shuffle)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      Array.from({ length: 5 }, (_, inlet) => new Float32Array(frames).fill(inlet === 2 ? 1 : 0)),
      out,
      params,
      frames,
      { tempo: 120, running: false, beat: 0, beatsPerBlock: 0, shuffle: globalShuffle },
    )
    return [...out[3]].flatMap((value, index) => value >= 0.5 ? [index] : [])
  }

  it('keeps explicit Clock as the default timing source', () => {
    expect(ARP_MODULE.params[param('timing')].default).toBe(0)
    expect(ARP_MODULE.params[param('timing')].labels?.[0]).toBe('External')
  })

  it('can run from the rack tempo without a Clock cable', () => {
    const arp = new ArpProcessor(SR, deps, 'arp-tempo')
    const frames = SR + 1
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('timing')].fill(1)
    params[param('division')].fill(4) // 1/16: a quarter beat, or 5512.5 samples at 120 BPM.
    params[param('chord')].fill(2)
    params[param('octaves')].fill(1)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [
        new Float32Array(frames),
        new Float32Array(frames),
        new Float32Array(frames).fill(1),
        new Float32Array(frames),
        new Float32Array(frames),
      ],
      out,
      params,
      frames,
      { tempo: 120, running: false, beat: 0, beatsPerBlock: 0 },
    )
    const edges = [...out[3]].reduce(
      (count, value, index) => count + (value >= 0.5 && (index === 0 || out[3][index - 1] < 0.5) ? 1 : 0),
      0,
    )
    expect(edges).toBe(8)
  })

  it('offers a free-running rate independent of the transport tempo', () => {
    const pitchesAt = (tempo: number) => {
      const arp = new ArpProcessor(1000, deps, `arp-free-${tempo}`)
      const frames = 1001
      const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
      params[param('timing')].fill(2)
      params[param('rate')].fill(10)
      params[param('chord')].fill(2)
      params[param('octaves')].fill(1)
      const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
      arp.process(
        Array.from({ length: 5 }, (_, inlet) => new Float32Array(frames).fill(inlet === 2 ? 1 : 0)),
        out,
        params,
        frames,
        { tempo, running: true, beat: 0, beatsPerBlock: tempo / 60 },
      )
      return [...out[3]].filter((value, index) => value >= 0.5 && (index === 0 || out[3][index - 1] < 0.5)).length
    }
    expect(pitchesAt(60)).toBe(11)
    expect(pitchesAt(180)).toBe(11)
  })

  it('delays odd sixteenths without moving their surrounding eighth-note anchors', () => {
    // At this sample rate and tempo a sixteenth is 150 samples. 80% shuffle delays the odd one by 60,
    // so the intervals become 210/90 while the even positions remain exactly 300 samples apart.
    expect(internalEdges(4, 1, 0.8).slice(0, 7)).toEqual([0, 210, 300, 510, 600, 810, 900])
  })

  it('keeps Shuffle off by default and ignores a missing global amount', () => {
    expect(ARP_MODULE.params[param('shuffle')].default).toBe(0)
    expect(internalEdges(4, 0, 1).slice(0, 5)).toEqual([0, 150, 300, 450, 600])
    expect(internalEdges(4, 1, 0).slice(0, 5)).toEqual([0, 150, 300, 450, 600])
  })

  it('leaves eighth, triplet and free-rate timing straight', () => {
    expect(internalEdges(2, 1, 0.8).slice(0, 4)).toEqual([0, 300, 600, 900])
    expect(internalEdges(3, 1, 0.8).slice(0, 5)).toEqual([0, 200, 400, 600, 800])
    expect(internalEdges(4, 1, 0.8, 2, 10).slice(0, 5)).toEqual([0, 120, 240, 360, 480])
  })

  it('completes the dotted and triplet tempo values without moving shipped division indices', () => {
    expect(ARP_MODULE.params[param('division')].labels?.slice(0, 10)).toEqual([
      '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32', '1/32T', '1/64', '1/128',
    ])
    const additions = [
      { division: 10, label: '1/2D', interval: 1800 },
      { division: 11, label: '1/2T', interval: 800 },
      { division: 12, label: '1/4D', interval: 900 },
      { division: 13, label: '1/4T', interval: 400 },
      { division: 14, label: '1/8D', interval: 450 },
      { division: 15, label: '1/16D', interval: 225 },
    ]
    for (const addition of additions) {
      expect(ARP_MODULE.params[param('division')].labels?.[addition.division]).toBe(addition.label)
      const sampleRate = 1200
      const frames = addition.interval + 2
      const arp = new ArpProcessor(sampleRate, deps, `arp-${addition.label}`)
      const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
      params[param('timing')].fill(1)
      params[param('division')].fill(addition.division)
      const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
      arp.process(
        Array.from({ length: 5 }, (_, inlet) => new Float32Array(frames).fill(inlet === 2 ? 1 : 0)),
        out,
        params,
        frames,
        { tempo: 120, running: false, beat: 0, beatsPerBlock: 0 },
      )
      expect(out[3][0], `${addition.label} starts immediately`).toBe(1)
      expect(out[3][addition.interval], `${addition.label} interval`).toBe(1)
    }
  })

  it('gates for a fraction of the step, so the feel survives a tempo change', () => {
    // A gate in seconds would turn legato into staccato as the tempo rose. Measured across one step, with
    // the first skipped because it has no previous interval to be a fraction of.
    const held = (fraction: number) => {
      const { out } = run(4, { chord: 0, octaves: 1, gate: fraction })
      let on = 0
      for (let i = STEP * 2; i < STEP * 3; i++) if (out[1][i] >= 0.5) on++
      return on
    }
    expect(held(0.25)).toBeLessThan(held(0.9))
    expect(held(0.9)).toBeGreaterThan(STEP / 2)
  })

  it('closes Gate completely at zero while keeping Trig available', () => {
    expect(ARP_MODULE.params[param('gate')].min).toBe(0)
    const { out } = run(4, { chord: 2, octaves: 1, gate: 0 })
    expect(out[1].every((value) => value === 0)).toBe(true)
    expect(Array.from({ length: 4 }, (_, step) => out[3][step * STEP] >= 0.5)).toEqual([
      true, true, true, true,
    ])
  })

  it('keeps Tie open from the first note without gaps between steps', () => {
    const { out } = run(4, { chord: 2, octaves: 1, gate: 1 })
    expect(out[1].every((value) => value === 1)).toBe(true)
  })

  it('still closes a tied gate for a rhythm rest', () => {
    const pattern = new Float32Array(ARP_PATTERN_STEPS).fill(1)
    pattern[1] = 0
    const arp = new ArpProcessor(SR, deps, 'arp-tied-rest', {
      get: (slot) => slot === 'pattern' ? pattern : undefined,
    })
    const frames = STEP * 3
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('gate')].fill(1)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames).fill(1), clock, new Float32Array(frames)],
      out,
      params,
      frames,
    )
    expect(out[1].slice(0, STEP).every((value) => value === 1)).toBe(true)
    expect(out[1].slice(STEP, STEP * 2).every((value) => value === 0)).toBe(true)
    expect(out[1].slice(STEP * 2).every((value) => value === 1)).toBe(true)
  })

  it('sounds its first note even though there is no previous step to measure', () => {
    // The gate falls back to the **trigger width**, not to the measured interval — which on the opening
    // edge is one sample, because the module has been running for one. A one-sample gate is not silence,
    // but it is an envelope that attacks and releases inside the same buffer, so the first note anybody
    // hears is a click or nothing. Hence a floor rather than merely "greater than zero": the loose form of
    // this assertion passes with the fallback deleted.
    const { out } = run(2, { chord: 0, octaves: 1 })
    let on = 0
    for (let i = 0; i < STEP; i++) if (out[1][i] >= 0.5) on++
    expect(on).toBeGreaterThan(4)
  })

  it('fires a trigger on every step', () => {
    const { out } = run(4, { chord: 2, octaves: 1 })
    let edges = 0
    // From zero, with the sample before the buffer taken as silence: the first trigger *begins* at index
    // 0, so a loop starting at 1 misses it and reports one step fewer than were played.
    for (let i = 0; i < out[2].length; i++) {
      if (out[3][i] >= 0.5 && (i === 0 || out[3][i - 1] < 0.5)) edges++
    }
    expect(edges).toBe(4)
  })

  it('turns disabled pattern steps into rests without changing the note cycle', () => {
    const pattern = new Float32Array(ARP_PATTERN_STEPS).fill(1)
    pattern[1] = 0
    pattern[3] = 0
    const arp = new ArpProcessor(SR, deps, 'arp-pattern', {
      get: (slot) => slot === 'pattern' ? pattern : undefined,
    })
    const frames = STEP * 5
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('chord')].fill(2)
    params[param('octaves')].fill(1)
    params[param('patternLength')].fill(4)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [
        new Float32Array(frames),
        new Float32Array(frames),
        new Float32Array(frames).fill(1),
        clock,
        new Float32Array(frames),
      ],
      out,
      params,
      frames,
    )

    const sounded = Array.from({ length: 5 }, (_, step) => out[3][step * STEP] >= 0.5)
    const notes = Array.from({ length: 5 }, (_, step) => Math.round(out[0][step * STEP] * 12))
    expect(sounded).toEqual([true, false, true, false, true])
    expect(notes).toEqual([0, 0, 4, 4, 7])
    expect(notes.filter((_, step) => sounded[step])).toEqual([0, 4, 7])
  })

  it('reaches the first note after a leading rest instead of waiting forever on pattern step one', () => {
    const pattern = new Float32Array(ARP_PATTERN_STEPS).fill(1)
    pattern[0] = 0
    const arp = new ArpProcessor(SR, deps, 'arp-leading-rest', {
      get: (slot) => slot === 'pattern' ? pattern : undefined,
    })
    const frames = STEP * 3
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('chord')].fill(2)
    params[param('octaves')].fill(1)
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames).fill(1), clock, new Float32Array(frames)],
      out,
      params,
      frames,
    )
    expect(out[3][0]).toBe(0)
    expect(out[3][STEP]).toBe(1)
    expect(Math.round(out[0][STEP] * 12)).toBe(0)
  })

  it('defaults every pattern position on when no pattern data was saved', () => {
    expect(ARP_MODULE.params[param('patternLength')].default).toBe(ARP_PATTERN_STEPS)
    const { out } = run(ARP_PATTERN_STEPS, { chord: 2, octaves: 1 })
    const edges = Array.from({ length: ARP_PATTERN_STEPS }, (_, step) => out[3][step * STEP] >= 0.5)
    expect(edges.every(Boolean)).toBe(true)
  })

  it('goes back to the start of the figure on reset', () => {
    // A place rather than an event, like the Arranger: the next clock plays step one rather than step two.
    //
    // Two octaves, deliberately. A one-octave triad wraps to its root every third step on its own, so a
    // reset dropped there proves nothing — the assertion passes with the reset handler deleted outright.
    // The reset falls between edges rather than on one, which is where a Transport would put it.
    const { notes } = run(6, {
      chord: 2,
      octaves: 2,
      mode: 0,
      reset: (i) => i >= STEP * 3 - 4 && i < STEP * 3 - 2,
    })
    expect(notes.slice(0, 3)).toEqual([0, 4, 7])
    expect(notes.slice(3)).toEqual([0, 4, 7])
  })

  it('says nothing until it is clocked', () => {
    const arp = new ArpProcessor(SR, deps, 'arp-1')
    const frames = 256
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    const out = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    arp.process(
      Array.from({ length: 5 }, () => new Float32Array(frames)),
      out,
      params,
      frames,
    )
    expect([...out[1]].every((v) => v === 0)).toBe(true)
  })
})

describe('the awkward settings', () => {
  it('survives a figure exactly one note long', () => {
    // Octave chord, one octave: length 1, which is where every turning-point branch divides by nothing.
    const { notes } = run(4, { chord: 0, octaves: 1, mode: 2 })
    expect(notes).toEqual([0, 0, 0, 0])
  })

  it('stays inside the chord table however the knob is driven', () => {
    // The chord param is a CV target like any other, so a Combinator or a lane can push it past its range.
    for (const which of [-5, 99]) {
      const { notes } = run(3, { chord: which, octaves: 1 })
      expect(notes.every((n) => Number.isFinite(n))).toBe(true)
    }
  })

  it('keeps a random figure inside the chord, though its source of randomness is bipolar', () => {
    // `Random.next()` is [-1, 1) — it is a noise source before it is a die — so it is folded before it
    // becomes an index. Used raw, half the rolls are negative, and a negative index reads off the front of
    // the table and plays a NaN. That does not sound wrong; it silences every voice downstream, which is
    // the kind of failure that gets blamed on the patch.
    const { notes } = run(32, { chord: 3, octaves: 2, mode: 4 })
    expect(notes.every((n) => Number.isFinite(n) && n >= 0 && n <= 19)).toBe(true)
    // And it moves, rather than being clamped to one end of the figure by the same fold.
    expect(new Set(notes).size).toBeGreaterThan(2)
  })

  it('plays something for every chord and every mode', () => {
    // Cheap, and it is the sweep that would have caught an off-by-one in the table.
    for (let chord = 0; chord <= 7; chord++) {
      for (let mode = 0; mode <= 4; mode++) {
        for (let insert = 0; insert <= 4; insert++) {
          const { notes } = run(8, { chord, octaves: 2, mode, insert })
          expect(
            notes.every((n) => Number.isFinite(n) && n >= 0 && n < 48),
            `${chord}/${mode}/${insert}`,
          ).toBe(true)
        }
      }
    }
  })

  it('does not correlate two arps set to random', () => {
    // Seeded from the module id, the same reasoning the Noise gives — two of them walking in step would
    // read as one of them being broken.
    const one = new ArpProcessor(SR, deps, 'arp-1')
    const two = new ArpProcessor(SR, deps, 'arp-2')
    const frames = STEP * 12
    const clock = Float32Array.from({ length: frames }, (_, i) => (i % STEP < STEP / 2 ? 1 : 0))
    const params = ARP_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
    params[param('mode')].fill(4)
    params[param('octaves')].fill(3)
    const a = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    const b = ARP_MODULE.outlets.map(() => new Float32Array(frames))
    const zero = new Float32Array(frames)
    const inputs = [zero, zero, new Float32Array(frames).fill(1), clock, zero]
    one.process(inputs, a, params, frames)
    two.process(inputs, b, params, frames)
    expect([...a[0]]).not.toEqual([...b[0]])
  })
})
