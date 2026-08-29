import { describe, expect, it } from 'vitest'
import {
  barLengthForBar,
  chainBarAt,
  chainAppend,
  chainMove,
  chainPositionAt,
  chainRemove,
  chainRecordClip,
  chainSetClip,
  chainSetPattern,
  chainSetRepeat,
  defaultKit,
  patternForBar,
  patternForClip,
  patternForVoice,
  positionForStep,
  songBars,
  stepForPosition,
  swingFor,
  type Song,
} from './pattern.js'

// The arrangement is the layer between "a pattern" and "a track". Everything here is
// pure index arithmetic, which is exactly the kind of thing that is fine until a repeat
// count is 0 or a bar number is negative and the scheduler starts asking for bar -1.

const song = (over: Partial<Song> = {}): Song => ({
  bpm: 120,
  swing: 0,
  patterns: [
    { id: 'a', name: 'A', length: 16, tracks: {} },
    { id: 'b', name: 'B', length: 8, tracks: {} },
  ],
  chain: [
    { pattern: 'a', repeat: 2 },
    { pattern: 'b', repeat: 3 },
  ],
  kit: defaultKit([]),
  ...over,
})

describe('how long a song is', () => {
  it('is the sum of the repeats, not the number of entries', () => {
    expect(songBars(song())).toBe(5)
  })

  it('is zero for an empty chain', () => {
    expect(songBars(song({ chain: [] }))).toBe(0)
  })

  it('counts a nonsense repeat as one bar rather than none', () => {
    // A zero or negative repeat would otherwise make an entry that can never play but
    // still takes up a row in the editor — a section that silently does nothing.
    expect(songBars(song({ chain: [{ pattern: 'a', repeat: 0 }] }))).toBe(1)
    expect(songBars(song({ chain: [{ pattern: 'a', repeat: -4 }] }))).toBe(1)
  })

  it('finds the absolute bar where each section starts', () => {
    const s = song()
    expect(chainBarAt(s, 0)).toBe(0)
    expect(chainBarAt(s, 1)).toBe(2)
    expect(chainBarAt(s, 2)).toBe(5)
    expect(chainBarAt(s, 999)).toBe(5)
  })
})

describe('finding the bar', () => {
  it('holds each entry for its whole repeat', () => {
    const s = song()
    expect(chainPositionAt(s, 0)).toMatchObject({ index: 0, barWithin: 0 })
    expect(chainPositionAt(s, 1)).toMatchObject({ index: 0, barWithin: 1 })
    expect(chainPositionAt(s, 2)).toMatchObject({ index: 1, barWithin: 0 })
    expect(chainPositionAt(s, 4)).toMatchObject({ index: 1, barWithin: 2 })
  })

  it('loops at the end of the song', () => {
    const s = song()
    expect(chainPositionAt(s, 5)).toMatchObject({ index: 0, barWithin: 0 })
    expect(chainPositionAt(s, 12)).toMatchObject({ index: 1, barWithin: 0 })
  })

  it('handles a negative bar without falling off the front', () => {
    // Nothing asks for one today, but an index that goes negative is the classic way a
    // loop lookup starts returning undefined once somebody adds a count-in.
    expect(chainPositionAt(song(), -1)).toMatchObject({ index: 1, barWithin: 2 })
  })

  it('is undefined only when there is no chain at all', () => {
    expect(chainPositionAt(song({ chain: [] }), 0)).toBeUndefined()
  })
})

describe('which pattern plays', () => {
  it('follows the arrangement', () => {
    const s = song()
    expect(patternForBar(s, 0)?.id).toBe('a')
    expect(patternForBar(s, 2)?.id).toBe('b')
    expect(patternForBar(s, 5)?.id).toBe('a')
  })

  it('falls back to the first pattern rather than going silent', () => {
    // A song with no chain is a perfectly reasonable thing to be holding while you
    // build one, and it should still make a noise.
    expect(patternForBar(song({ chain: [] }), 3)?.id).toBe('a')
    expect(patternForBar(song({ chain: [{ pattern: 'gone', repeat: 1 }] }), 0)?.id).toBe('a')
  })

  it('is undefined when there are no patterns to play', () => {
    expect(patternForBar(song({ patterns: [], chain: [] }), 0)).toBeUndefined()
  })

  it('lets a chain mix patterns of different lengths', () => {
    // The polymetric case: 16 steps then 8. This is what the transport's per-bar length
    // lookup exists for — reading bar 0's length forever would play B at A's length.
    const s = song()
    expect(patternForBar(s, 0)?.length).toBe(16)
    expect(patternForBar(s, 2)?.length).toBe(8)
  })

  it('selects each machine independently and falls back for the rest', () => {
    const s = song({
      chain: [
        {
          pattern: 'a',
          clips: { tr909: 'b', '303.a': 'b' },
          repeat: 2,
        },
      ],
    })
    expect(patternForClip(s, 0, 'tr808')?.id).toBe('a')
    expect(patternForClip(s, 0, 'tr909')?.id).toBe('b')
    expect(patternForVoice(s, 0, '808.bd')?.id).toBe('a')
    expect(patternForVoice(s, 0, '909.bd')?.id).toBe('b')
    expect(patternForVoice(s, 0, '303.a')?.id).toBe('b')
    expect(patternForVoice(s, 0, '303.b')?.id).toBe('a')
  })

  it('uses the longest selected clip as the section length', () => {
    const s = song({
      chain: [{ pattern: 'b', clips: { tr808: 'a' }, repeat: 1 }],
    })
    expect(patternForBar(s, 0)?.length).toBe(8)
    expect(barLengthForBar(s, 0)).toBe(16)
  })

  it('maps an external song-position step through variable bar lengths', () => {
    const s = song()
    expect(positionForStep(s, 0)).toEqual({ bar: 0, index: 0 })
    expect(positionForStep(s, 17)).toEqual({ bar: 1, index: 1 })
    expect(positionForStep(s, 32)).toEqual({ bar: 2, index: 0 })
    expect(positionForStep(s, 40)).toEqual({ bar: 3, index: 0 })
  })

  it('wraps an external song-position step at the end of the arrangement', () => {
    const s = song()
    expect(positionForStep(s, 56)).toEqual({ bar: 0, index: 0 })
  })

  it('maps song-position steps across the fallback loop when there is no chain', () => {
    const s = song({ chain: [] })
    expect(positionForStep(s, 18)).toEqual({ bar: 1, index: 2 })
  })

  it('maps variable-length arrangement positions back to song-position steps', () => {
    const s = song()
    expect(stepForPosition(s, 0, 0)).toBe(0)
    expect(stepForPosition(s, 1, 1)).toBe(17)
    expect(stepForPosition(s, 2, 0)).toBe(32)
    expect(stepForPosition(s, 3, 0)).toBe(40)
    expect(stepForPosition(s, 5, 0)).toBe(0)
  })

  it('maps fallback bars without wrapping when there is no finite arrangement', () => {
    expect(stepForPosition(song({ chain: [] }), 3, 2)).toBe(50)
  })
})

describe('editing the arrangement', () => {
  it('appends a bar at a time', () => {
    expect(chainAppend(song(), 'b')).toHaveLength(3)
    expect(chainAppend(song(), 'b')[2]).toEqual({ pattern: 'b', repeat: 1 })
  })

  it('removes by position, not by pattern', () => {
    // The same pattern appears more than once in most arrangements, so removing "the
    // b entry" is not a well-formed request.
    const s = song({ chain: [
      { pattern: 'a', repeat: 1 },
      { pattern: 'b', repeat: 1 },
      { pattern: 'a', repeat: 1 },
    ] })
    expect(chainRemove(s, 1).map((c) => c.pattern)).toEqual(['a', 'a'])
  })

  it('clamps a repeat into something playable', () => {
    expect(chainSetRepeat(song(), 0, 0)[0].repeat).toBe(1)
    expect(chainSetRepeat(song(), 0, -3)[0].repeat).toBe(1)
    expect(chainSetRepeat(song(), 0, 999)[0].repeat).toBe(64)
    expect(chainSetRepeat(song(), 0, 3.7)[0].repeat).toBe(4)
  })

  it('swaps the pattern without losing the repeat', () => {
    const next = chainSetPattern(song(), 0, 'b')
    expect(next[0]).toEqual({ pattern: 'b', repeat: 2 })
  })

  it('overrides one clip without changing the others', () => {
    const next = chainSetClip(song(), 0, 'tr909', 'b')
    expect(next[0]).toEqual({ pattern: 'a', clips: { tr909: 'b' }, repeat: 2 })
    expect(next[1]).toEqual(song().chain[1])
  })

  it('removes a redundant clip override when it returns to the fallback', () => {
    const withClip = song({
      chain: [{ pattern: 'a', clips: { tr909: 'b', '303.a': 'b' }, repeat: 2 }],
    })
    expect(chainSetClip(withClip, 0, 'tr909', 'a')[0]).toEqual({
      pattern: 'a',
      clips: { '303.a': 'b' },
      repeat: 2,
    })
    expect(
      chainSetClip(
        song({ chain: [{ pattern: 'a', clips: { tr909: 'b' }, repeat: 2 }] }),
        0,
        'tr909',
        'a',
      )[0],
    ).toEqual({ pattern: 'a', repeat: 2 })
  })

  it('records a clip launch from its bar boundary without rewriting earlier repeats', () => {
    const next = chainRecordClip(
      song({ chain: [{ pattern: 'a', repeat: 4 }] }),
      2,
      'tr808',
      'b',
    )
    expect(next).toEqual([
      { pattern: 'a', repeat: 2 },
      { pattern: 'a', clips: { tr808: 'b' }, repeat: 2 },
    ])
  })

  it('records Follow by removing the machine override from the boundary onward', () => {
    const next = chainRecordClip(
      song({ chain: [{ pattern: 'a', clips: { tr808: 'b', tr909: 'b' }, repeat: 4 }] }),
      1,
      'tr808',
      null,
    )
    expect(next).toEqual([
      { pattern: 'a', clips: { tr808: 'b', tr909: 'b' }, repeat: 1 },
      { pattern: 'a', clips: { tr909: 'b' }, repeat: 3 },
    ])
  })

  it('does not split the arrangement for a launch it already contains', () => {
    const s = song({ chain: [{ pattern: 'a', clips: { tr808: 'b' }, repeat: 4 }] })
    expect(chainRecordClip(s, 2, 'tr808', 'b')).toBe(s.chain)
  })

  it('gives an empty arrangement one recordable fallback bar', () => {
    expect(chainRecordClip(song({ chain: [] }), 0, 'tr808', 'b')).toEqual([
      { pattern: 'a', clips: { tr808: 'b' }, repeat: 1 },
    ])
  })

  it('moves an entry up and down', () => {
    expect(chainMove(song(), 0, 1).map((c) => c.pattern)).toEqual(['b', 'a'])
    expect(chainMove(song(), 1, -1).map((c) => c.pattern)).toEqual(['b', 'a'])
  })

  it('refuses to move an entry off either end', () => {
    expect(chainMove(song(), 0, -1)).toEqual(song().chain)
    expect(chainMove(song(), 1, 1)).toEqual(song().chain)
    expect(chainMove(song(), 9, 1)).toEqual(song().chain)
  })

  it('never mutates the song it was given', () => {
    const s = song()
    const before = JSON.stringify(s.chain)
    chainAppend(s, 'b')
    chainRemove(s, 0)
    chainRecordClip(s, 1, 'tr808', 'b')
    chainMove(s, 0, 1)
    chainSetRepeat(s, 0, 8)
    expect(JSON.stringify(s.chain)).toBe(before)
  })
})

describe('per-voice swing', () => {
  it('follows the song when a voice has no offset of its own', () => {
    expect(swingFor(song({ swing: 0.4 }), '808.ch')).toBe(0.4)
  })

  it('is centred, so a knob at the middle changes nothing', () => {
    const s = song({ swing: 0.4, kit: { params: {}, swing: { '808.ch': 0.5 } } })
    expect(swingFor(s, '808.ch')).toBeCloseTo(0.4, 10)
  })

  it('lets one voice shuffle while another stays straight', () => {
    // The whole point: hats against a kick on the grid.
    const s = song({ swing: 0.5, kit: { params: {}, swing: { '808.ch': 0.8, '808.bd': 0 } } })
    expect(swingFor(s, '808.ch')).toBeGreaterThan(0.5)
    expect(swingFor(s, '808.bd')).toBe(0)
  })

  it('reaches dead straight and fully shuffled from anywhere the song is set', () => {
    for (const swing of [0, 0.3, 0.7, 1]) {
      const straight = song({ swing, kit: { params: {}, swing: { x: 0 } } })
      const shuffled = song({ swing, kit: { params: {}, swing: { x: 1 } } })
      expect(swingFor(straight, 'x')).toBe(0)
      expect(swingFor(shuffled, 'x')).toBe(1)
    }
  })

  it('moves every voice when the song swing moves', () => {
    // An offset rather than an absolute value, so turning the master swing up does not
    // silently leave behind every voice you had ever touched.
    const at = (swing: number) =>
      swingFor(song({ swing, kit: { params: {}, swing: { x: 0.6 } } }), 'x')
    expect(at(0.5)).toBeGreaterThan(at(0.2))
  })
})
