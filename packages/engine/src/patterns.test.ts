import { describe, expect, it } from 'vitest'
import {
  addPattern,
  alterBassLine,
  alterTrack,
  defaultKit,
  duplicatePattern,
  emptyPattern,
  randomizeBassLine,
  randomizeTrack,
  removePattern,
  renamePattern,
  rotateBassLine,
  rotateTrack,
  transposeBassLine,
  uniquePatternId,
  type Pattern,
  type Song,
} from './pattern.js'
import { metronomeClick } from './metronome.js'

// Building the pattern list. Until this existed the app was stuck with whatever patterns
// it shipped with, which made song mode an arrangement of four fixed things.
//
// The interesting cases are all about ids: they are the keys the arrangement refers to,
// so a collision or a stale reference is a bar of the wrong pattern rather than an error.

const song = (over: Partial<Song> = {}): Song => ({
  bpm: 120,
  swing: 0,
  patterns: [
    {
      id: 'a',
      name: 'A',
      length: 16,
      tracks: { '808.bd': [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      bass: {
        '303.a': Array.from({ length: 16 }, () => ({ note: null, accent: false, slide: false })),
      },
    },
    { id: 'b', name: 'B', length: 8, tracks: {} },
  ],
  chain: [
    { pattern: 'a', repeat: 2 },
    { pattern: 'b', repeat: 1 },
    { pattern: 'a', repeat: 4 },
  ],
  kit: defaultKit([]),
  ...over,
})

describe('unique ids', () => {
  it('uses the name asked for when nothing has it', () => {
    expect(uniquePatternId(song(), 'c')).toBe('c')
  })

  it('does not collide with an existing one', () => {
    expect(uniquePatternId(song(), 'a')).toBe('a-2')
  })

  it('keeps counting past a taken suffix', () => {
    const s = song({ patterns: [emptyPattern('a', 'A'), emptyPattern('a-2', 'A2')] })
    expect(uniquePatternId(s, 'a')).toBe('a-3')
  })
})

describe('adding', () => {
  it('appends an empty pattern and says which it is', () => {
    const { song: next, id } = addPattern(song())
    expect(next.patterns).toHaveLength(3)
    expect(next.patterns[2].id).toBe(id)
    expect(next.patterns[2].tracks).toEqual({})
  })

  it('never collides, however many times it is called', () => {
    let s = song()
    for (let i = 0; i < 30; i++) s = addPattern(s).song
    expect(new Set(s.patterns.map((p) => p.id)).size).toBe(s.patterns.length)
    expect(new Set(s.patterns.map((p) => p.name)).size).toBe(s.patterns.length)
  })

  it('leaves the arrangement alone — a new pattern is not automatically in the song', () => {
    expect(addPattern(song()).song.chain).toEqual(song().chain)
  })
})

describe('duplicating', () => {
  it('copies the steps', () => {
    const { song: next, id } = duplicatePattern(song(), 'a')
    const copy = next.patterns.find((p) => p.id === id)!
    expect(copy.tracks['808.bd']).toEqual(song().patterns[0].tracks['808.bd'])
    expect(copy.length).toBe(16)
  })

  it('puts the copy next to the original rather than at the end', () => {
    const { song: next, id } = duplicatePattern(song(), 'a')
    expect(next.patterns[1].id).toBe(id)
  })

  it('gives the copy its own step arrays', () => {
    // The bug this exists to prevent: a shallow copy shares the arrays, so editing the
    // copy silently edits the original. It looks like it worked until you play the
    // other one.
    const original = song()
    const { song: next, id } = duplicatePattern(original, 'a')
    const copy = next.patterns.find((p) => p.id === id)!

    copy.tracks['808.bd'][0] = 2
    copy.bass!['303.a'][0].note = 12

    expect(next.patterns[0].tracks['808.bd'][0]).toBe(1)
    expect(next.patterns[0].bass!['303.a'][0].note).toBeNull()
  })

  it('is a no-op on an id that is not there', () => {
    const s = song()
    expect(duplicatePattern(s, 'nope').song).toEqual(s)
  })
})

describe('renaming', () => {
  it('changes the name and not the id, because the chain refers to the id', () => {
    const next = renamePattern(song(), 'a', 'Intro')
    expect(next.patterns[0]).toMatchObject({ id: 'a', name: 'Intro' })
    expect(next.chain).toEqual(song().chain)
  })

  it('trims, and refuses an empty name', () => {
    expect(renamePattern(song(), 'a', '  Verse  ').patterns[0].name).toBe('Verse')
    expect(renamePattern(song(), 'a', '   ').patterns[0].name).toBe('A')
  })
})

describe('removing', () => {
  it('takes every reference out of the arrangement too', () => {
    // Left behind, they would not error — patternForBar falls back to the first pattern
    // — they would quietly play the wrong bar, which is worse.
    const next = removePattern(song(), 'a')
    expect(next.patterns.map((p) => p.id)).toEqual(['b'])
    expect(next.chain).toEqual([{ pattern: 'b', repeat: 1 }])
  })

  it('refuses to remove the last pattern', () => {
    const one = song({ patterns: [emptyPattern('a', 'A')], chain: [] })
    expect(removePattern(one, 'a')).toEqual(one)
  })

  it('is a no-op on an id that is not there', () => {
    const s = song()
    expect(removePattern(s, 'nope')).toEqual(s)
  })
})

describe('pattern transforms', () => {
  const pattern = (): Pattern => ({
    id: 'tools',
    name: 'Tools',
    length: 4,
    tracks: { '909.bd': [1, 0, 2, 0], '909.sd': [0, 1, 0, 0] },
    bass: {
      '303.a': [
        { note: 2, accent: true, slide: false },
        { note: null, accent: false, slide: false },
        { note: 12, accent: false, slide: true },
        { note: 24, accent: false, slide: false },
      ],
    },
  })

  it('rotates one drum lane around the pattern and leaves the others alone', () => {
    const before = pattern()
    const next = rotateTrack(before, '909.bd', 1)
    expect(next.tracks['909.bd']).toEqual([0, 1, 0, 2])
    expect(next.tracks['909.sd']).toBe(before.tracks['909.sd'])
    expect(before.tracks['909.bd']).toEqual([1, 0, 2, 0])
  })

  it('rotates a bass line with its articulation attached', () => {
    const next = rotateBassLine(pattern(), '303.a', -1)
    expect(next.bass!['303.a']).toEqual([
      { note: null, accent: false, slide: false },
      { note: 12, accent: false, slide: true },
      { note: 24, accent: false, slide: false },
      { note: 2, accent: true, slide: false },
    ])
  })

  it('transposes sounding notes and clamps them to the editor range', () => {
    const up = transposeBassLine(pattern(), '303.a', 5).bass!['303.a']
    expect(up.map((step) => step.note)).toEqual([7, null, 17, 24])
    expect(up[0].accent).toBe(true)
    expect(up[2].slide).toBe(true)

    const down = transposeBassLine(pattern(), '303.a', -20).bass!['303.a']
    expect(down.map((step) => step.note)).toEqual([0, null, 0, 4])
  })

  it('randomises a drum lane into rests, hits and accents with an injectable source', () => {
    const values = [0.1, 0.7, 0.95, 0.2]
    const next = randomizeTrack(pattern(), '909.bd', () => values.shift() ?? 0)
    expect(next.tracks['909.bd']).toEqual([0, 1, 2, 0])
  })

  it('randomises a 303 line without touching the other pattern material', () => {
    const values = [0.1, 0.7, 0.5, 0.9, 0.1, 0.99, 0.99, 0.1, 0.1, 0.2]
    const before = pattern()
    const next = randomizeBassLine(before, '303.a', () => values.shift() ?? 0)
    expect(next.bass!['303.a']).toEqual([
      { note: null, accent: false, slide: false },
      { note: 12, accent: false, slide: true },
      { note: 24, accent: true, slide: true },
      { note: null, accent: false, slide: false },
    ])
    expect(next.tracks).toBe(before.tracks)
  })

  it('alters existing material without changing how much of it there is', () => {
    const next = alterTrack(pattern(), '909.bd', () => 0)
    expect(next.tracks['909.bd']).not.toEqual(pattern().tracks['909.bd'])
    expect([...next.tracks['909.bd']].sort()).toEqual([0, 0, 1, 2])

    const bass = alterBassLine(pattern(), '303.a', () => 0).bass!['303.a']
    expect(bass).not.toEqual(pattern().bass!['303.a'])
    expect(bass.map((step) => step.note).sort((a, b) => (a ?? -1) - (b ?? -1))).toEqual([
      null,
      2,
      12,
      24,
    ])
    expect(bass.filter((step) => step.accent)).toHaveLength(1)
    expect(bass.filter((step) => step.slide)).toHaveLength(1)
  })

  it('does not create a lane when asked to rotate or alter one that is absent', () => {
    const before = pattern()
    expect(rotateTrack(before, '808.bd', 1)).toBe(before)
    expect(alterBassLine(before, '303.b', () => 0)).toBe(before)
  })
})

describe('the metronome click', () => {
  it('is short enough to be a click rather than a note', () => {
    expect(metronomeClick(false).duration).toBeLessThan(0.1)
  })

  it('marks the first beat of the bar higher and audibly louder', () => {
    const weak = metronomeClick(false)
    const strong = metronomeClick(true)
    // Audibly, not merely numerically. A first pass had the two rendering at 0.68 and
    // 0.67 — different gains, near-identical peaks, because they sit at different
    // frequencies — and the downbeat stopped reading as a downbeat.
    expect(strong.gain / weak.gain).toBeGreaterThan(1.25)
    // Pitch, so a count-in says where the bar is and not merely how fast it is going.
    const pitch = (s: typeof weak) =>
      s.sources.filter((x) => x.kind === 'osc').map((x) => x.frequency)[0]
    expect(pitch(strong)).toBeGreaterThan(pitch(weak)!)
  })

  it('has noise on the transient, so it does not read as part of the music', () => {
    expect(metronomeClick(false).sources.some((s) => s.kind === 'noise')).toBe(true)
  })

  it('stays well below full scale — it is a guide, not an instrument', () => {
    for (const strong of [false, true]) expect(metronomeClick(strong).gain).toBeLessThan(0.7)
  })
})
