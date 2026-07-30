import { describe, expect, it } from 'vitest'
import { SONG_FORMAT, decodeSong, encodeSong } from './song-io.js'
import { defaultKit, patternForBar, type Song } from './pattern.js'
import { DEFAULT_BASS_PARAMS } from './bass.js'
import { DEFAULT_FX } from './effects.js'
import { DEFAULT_PARAMS } from './types.js'

// A song arrives from outside the program — from storage written by an older build, a
// file somebody edited by hand, or a URL somebody else sent. The tests that matter here
// are not the round trip; they are what happens when the input is wrong, because the
// failure mode for getting that wrong is the app white-screening on load with the
// user's work apparently gone.

const song = (over: Partial<Song> = {}): Song => ({
  bpm: 102,
  swing: 0.28,
  patterns: [
    {
      id: 'a',
      name: 'A',
      length: 16,
      tracks: { '808.bd': [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      bass: {
        '303.a': Array.from({ length: 16 }, (_, i) =>
          i === 0 ? { note: 12, accent: true, slide: true } : { note: null, accent: false, slide: false },
        ),
      },
    },
  ],
  chain: [{ pattern: 'a', repeat: 1 }],
  kit: defaultKit(['808.bd']),
  fx: { ...DEFAULT_FX },
  ...over,
})

describe('a round trip', () => {
  it('gives back exactly what went in', () => {
    const original = song()
    expect(decodeSong(encodeSong(original))).toEqual(original)
  })

  it('keeps notes, accents and slides', () => {
    const step = decodeSong(encodeSong(song()))!.patterns[0].bass!['303.a'][0]
    expect(step).toEqual({ note: 12, accent: true, slide: true })
  })

  it('keeps independent machine clips', () => {
    const withClips = song({
      patterns: [
        ...song().patterns,
        { id: 'b', name: 'B', length: 8, tracks: {}, bass: {} },
      ],
      chain: [{ pattern: 'a', clips: { tr909: 'b', '303.a': 'b' }, repeat: 4 }],
    })
    expect(decodeSong(encodeSong(withClips))!.chain).toEqual(withClips.chain)
  })

  it('keeps 909 flam marks and their global width', () => {
    const original = song({
      patterns: [
        {
          ...song().patterns[0],
          flams: { '909.sd': [true, ...Array<boolean>(15).fill(false)] },
        },
      ],
      kit: { ...song().kit, flam: 0.73 },
    })
    const loaded = decodeSong(encodeSong(original))!
    expect(loaded.patterns[0].flams).toEqual(original.patterns[0].flams)
    expect(loaded.kit.flam).toBe(0.73)
  })

  it('keeps per-voice send levels', () => {
    const text = JSON.stringify(
      song({ kit: { params: {}, sends: { '808.bd': { delay: 0.4, reverb: 0.9 } } } }),
    )
    expect(decodeSong(text)!.kit.sends!['808.bd']).toEqual({ delay: 0.4, reverb: 0.9 })
  })

  it('fills in effect settings a song was saved without', () => {
    // Songs saved before the sends existed have no `fx` at all, and must still load.
    const text = '{"patterns":[{"id":"a","tracks":{}}]}'
    expect(decodeSong(text)!.fx).toEqual(DEFAULT_FX)
  })

  it('keeps every field of a fully populated kit', () => {
    // The catch-all. Twice now a field has been added to `Kit` and one of the places
    // that rebuilds one was missed — the symptom is a control that works until you
    // reload, which is a long way from where the bug is. Populate everything, round
    // trip, and compare the whole object rather than picking fields off it.
    const full = song({
      kit: {
        params: { '808.bd': { ...DEFAULT_PARAMS, level: 0.31 } },
        bass: { '303.a': { ...DEFAULT_BASS_PARAMS, cutoff: 0.77 } },
        sends: { '808.bd': { delay: 0.21, reverb: 0.43 } },
        swing: { '808.ch': 0.83 },
      },
    })
    expect(decodeSong(encodeSong(full))!.kit).toEqual(full.kit)
  })

  it('keeps per-voice swing', () => {
    const text = JSON.stringify(song({ kit: { params: {}, swing: { '808.ch': 0.83 } } }))
    expect(decodeSong(text)!.kit.swing!['808.ch']).toBe(0.83)
  })

  it('reads a bare song as well as an enveloped one', () => {
    // So a file assembled by hand out of `JSON.stringify(song)` still loads.
    expect(decodeSong(JSON.stringify(song()))?.bpm).toBe(102)
  })
})

describe('a song saved by an older build', () => {
  // Format 1 wrote the chain as a bare list of pattern ids. Anybody who used the app
  // before song mode has one of these in localStorage right now, and it has to keep
  // playing exactly as it did — a migration that changes the arrangement is worse than
  // one that refuses.
  const v1 = JSON.stringify({
    v: 1,
    song: {
      bpm: 102,
      swing: 0.28,
      patterns: [
        { id: 'a', name: 'A', length: 16, tracks: {} },
        { id: 'b', name: 'B', length: 16, tracks: {} },
      ],
      chain: ['a', 'b', 'b'],
      kit: { params: {} },
    },
  })

  it('turns each bare pattern id into one bar', () => {
    expect(decodeSong(v1)!.chain).toEqual([
      { pattern: 'a', repeat: 1 },
      { pattern: 'b', repeat: 1 },
      { pattern: 'b', repeat: 1 },
    ])
  })

  it('plays bar for bar exactly as it used to', () => {
    const loaded = decodeSong(v1)!
    expect(['a', 'b', 'b'].map((_, bar) => patternForBar(loaded, bar)!.id)).toEqual([
      'a',
      'b',
      'b',
    ])
  })

  it('migrates a file with no version on it at all', () => {
    // Hand-written, or from before the envelope existed. The migration keys off the
    // shape of the value, not off the version number, precisely so this works.
    const bare = '{"patterns":[{"id":"a","tracks":{}}],"chain":["a","a"]}'
    expect(decodeSong(bare)!.chain).toEqual([
      { pattern: 'a', repeat: 1 },
      { pattern: 'a', repeat: 1 },
    ])
  })

  it('accepts a chain with both shapes in it', () => {
    const mixed = '{"patterns":[{"id":"a","tracks":{}}],"chain":["a",{"pattern":"a","repeat":4}]}'
    expect(decodeSong(mixed)!.chain).toEqual([
      { pattern: 'a', repeat: 1 },
      { pattern: 'a', repeat: 4 },
    ])
  })

  it('is written back out in the current format', () => {
    // Migrate on the way in, never on the way out.
    const round = decodeSong(encodeSong(decodeSong(v1)!))!
    expect(round.chain).toEqual(decodeSong(v1)!.chain)
    expect(JSON.parse(encodeSong(round)).v).toBe(SONG_FORMAT)
  })
})

describe('input that is not a song', () => {
  it.each([
    ['not json at all', 'hello'],
    ['empty', ''],
    ['a bare number', '42'],
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['an object with nothing in it', '{}'],
    ['a song with no patterns', JSON.stringify({ bpm: 120, patterns: [] })],
    ['patterns that are not objects', JSON.stringify({ patterns: [1, 'x', null] })],
  ])('is refused: %s', (_label, text) => {
    expect(decodeSong(text)).toBeNull()
  })

  it('is refused if it comes from a newer format than this build understands', () => {
    // Guessing at a shape that did not exist yet is how you silently corrupt somebody's
    // song. Refusing is recoverable; they can open the newer build.
    const text = JSON.stringify({ v: SONG_FORMAT + 1, song: song() })
    expect(decodeSong(text)).toBeNull()
  })
})

describe('input that is a song but damaged', () => {
  it('repairs rather than refuses, so one bad step does not cost the session', () => {
    const text = JSON.stringify({
      bpm: 'fast',
      swing: 9,
      patterns: [{ id: 'a', tracks: { '808.bd': [1, 'x', 7, null, true] } }],
      chain: ['a'],
    })

    const loaded = decodeSong(text)!
    expect(loaded.bpm).toBe(120)
    expect(loaded.swing).toBe(1)
    // Everything unreadable became a rest, and the track was padded to the bar.
    expect(loaded.patterns[0].tracks['808.bd']).toEqual([1, ...Array<number>(15).fill(0)])
  })

  it('clamps a tempo that would break the scheduler', () => {
    // Note that JSON cannot carry NaN or Infinity — they stringify to `null`. So the
    // realistic bad tempos are out-of-range numbers and wrong types, and `null` has to
    // land on the default rather than being coerced to 0 and clamped to the slowest
    // tempo the app allows.
    for (const [bpm, expected] of [
      ['0', 20],
      ['-40', 20],
      ['100000', 300],
      ['null', 120],
      ['"fast"', 120],
    ] as const) {
      const text = `{"bpm":${bpm},"patterns":[{"id":"a","tracks":{}}]}`
      expect(decodeSong(text)!.bpm).toBe(expected)
    }
  })

  it('clamps knobs into the range the UI can show', () => {
    const text = JSON.stringify(
      song({ kit: { params: { '808.bd': { ...DEFAULT_PARAMS, level: 40, tune: -3 } } } }),
    )
    const params = decodeSong(text)!.kit.params['808.bd']
    expect(params.level).toBe(1)
    expect(params.tune).toBe(0)
    // A knob that was missing entirely comes back at its default rather than undefined,
    // which would render as an empty dial and build a spec full of NaN.
    expect(params.decay).toBe(DEFAULT_PARAMS.decay)
  })

  it('fills in a 303 that has no settings saved for it', () => {
    const text = '{"patterns":[{"id":"a","tracks":{}}],"kit":{"bass":{"303.a":{}}}}'
    expect(decodeSong(text)!.kit.bass!['303.a']).toEqual(DEFAULT_BASS_PARAMS)
  })

  it('drops chain entries naming a pattern that is not in the file', () => {
    // `patternForBar` falls back to the first pattern for an unknown id, so leaving
    // these in would play the wrong bar rather than nothing — a subtler wrong.
    const text = JSON.stringify(
      song({
        chain: [
          { pattern: 'a', repeat: 2 },
          { pattern: 'ghost', repeat: 1 },
          { pattern: 'a', repeat: 1 },
        ],
      }),
    )
    expect(decodeSong(text)!.chain).toEqual([
      { pattern: 'a', repeat: 2 },
      { pattern: 'a', repeat: 1 },
    ])
  })

  it('drops only invalid clip overrides and keeps the section', () => {
    const text = JSON.stringify(
      song({
        chain: [
          {
            pattern: 'a',
            clips: { tr808: 'a', tr909: 'ghost' },
            repeat: 2,
          },
        ],
      }),
    )
    expect(decodeSong(text)!.chain).toEqual([
      { pattern: 'a', clips: { tr808: 'a' }, repeat: 2 },
    ])
  })

  it('keeps voice ids it does not recognise', () => {
    // They may belong to a machine added in a later build. Deleting somebody's settings
    // because they opened an older version is not a repair.
    const text = JSON.stringify(song({ kit: { params: { '606.bd': DEFAULT_PARAMS } } }))
    expect(decodeSong(text)!.kit.params['606.bd']).toEqual(DEFAULT_PARAMS)
  })

  it('pads and trims a bassline to the pattern length', () => {
    const text =
      '{"patterns":[{"id":"a","name":"A","length":8,"tracks":{},"bass":{"303.a":[{"note":5}]}}]}'
    const line = decodeSong(text)!.patterns[0].bass!['303.a']
    expect(line).toHaveLength(8)
    expect(line[0]).toEqual({ note: 5, accent: false, slide: false })
    expect(line[7]).toEqual({ note: null, accent: false, slide: false })
  })

  it('clamps a note to the range the grid can reach', () => {
    // A note the grid cannot show is a note nobody can edit or remove, which is worse
    // than a wrong pitch.
    const text = '{"patterns":[{"id":"a","length":1,"tracks":{},"bass":{"303.a":[{"note":999}]}}]}'
    expect(decodeSong(text)!.patterns[0].bass!['303.a'][0].note).toBe(24)
  })

  it('gives a nameless pattern a name and an id, so the UI has something to show', () => {
    const loaded = decodeSong(JSON.stringify({ patterns: [{ tracks: {} }] }))!
    expect(loaded.patterns[0].id).not.toBe('')
    expect(loaded.patterns[0].name).not.toBe('')
  })
})
