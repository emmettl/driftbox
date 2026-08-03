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

describe('how it is clocked', () => {
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
        const { notes } = run(6, { chord, octaves: 2, mode })
        expect(notes.every((n) => Number.isFinite(n) && n >= 0 && n < 48), `${chord}/${mode}`).toBe(true)
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
