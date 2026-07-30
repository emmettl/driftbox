import { describe, expect, it } from 'vitest'
import { songSeconds, toWav, voicesUsed } from './stems.js'
import { acidSong, defaultSong } from './songs/index.js'
import { planSong, planStep } from './schedule.js'
import { songBars, type Pattern } from './pattern.js'

// The parts of stem rendering that do not need an audio context. The rendering itself is
// verified in the browser — an OfflineAudioContext is not a thing Node has — and what that
// check asserts is recall: every hit the schedule asks for makes a sound in that voice's
// stem, at that moment. Extra energy between hits is the voice's own delay and reverb,
// which belongs there.

describe('which voices need a stem', () => {
  it('is every voice the chain actually reaches', () => {
    const song = acidSong()
    const used = voicesUsed(song)
    expect(used.length).toBeGreaterThan(0)
    for (const id of used) {
      const anywhere = song.patterns.some(
        (p) =>
          (p.tracks[id]?.some(Boolean) ?? false) ||
          (p.bass?.[id]?.some((s) => s.note !== null) ?? false),
      )
      expect(anywhere, `${id} is listed but never played`).toBe(true)
    }
  })

  it('ignores a pattern that is no longer in the chain', () => {
    // You write a pattern, take it out of the arrangement, and it stays in the song. A
    // stem of a voice that only appears there is a silent file to wonder about.
    const song = acidSong()
    const orphan = {
      ...song.patterns[0],
      id: 'orphan',
      tracks: { '808.cb': Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : 0)) },
      bass: {},
    }
    const withOrphan = { ...song, patterns: [...song.patterns, orphan] }
    expect(voicesUsed(withOrphan)).not.toContain('808.cb')
  })

  it('counts a voice whose track exists but is empty as unused', () => {
    const song = acidSong()
    const first = song.patterns[0]
    const silent = { ...first, tracks: { ...first.tracks, '808.ma': new Array(first.length).fill(0) } }
    const patched = { ...song, patterns: [silent, ...song.patterns.slice(1)] }
    expect(voicesUsed(patched)).not.toContain('808.ma')
  })

  it('falls back to the first pattern when the chain is empty, as the transport does', () => {
    // `patternForBar` plays pattern one when there is no chain. If this did not agree, a
    // song with an empty chain would make a sound and render no stems at all.
    const song = { ...acidSong(), chain: [] }
    const used = voicesUsed(song)
    expect(used.length).toBeGreaterThan(0)
    for (const id of used) {
      expect(Object.keys(song.patterns[0].tracks).concat(Object.keys(song.patterns[0].bass ?? {})))
        .toContain(id)
    }
  })
})

describe('how long a stem is', () => {
  it('covers the whole arrangement plus a tail', () => {
    const song = acidSong()
    const bare = songSeconds(song, 0)
    expect(songSeconds(song, 4)).toBeCloseTo(bare + 4, 5)
    // Long enough for every step the chain walks.
    const steps = planSong(song, songBars(song)).length
    expect(bare).toBeCloseTo((steps * 60) / song.bpm / 4, 5)
  })
})

describe('the WAV header', () => {
  const fake = (frames: number, channels = 2, rate = 44100) =>
    ({
      numberOfChannels: channels,
      length: frames,
      sampleRate: rate,
      getChannelData: () => new Float32Array(frames).fill(0.5),
    }) as unknown as AudioBuffer

  it('declares IEEE float, not PCM', async () => {
    // Writing format 1 with 32-bit samples produces a file that opens and sounds like
    // tearing static, which is a miserable thing to debug from the other end.
    const view = new DataView(await toWav(fake(8)).arrayBuffer())
    expect(view.getUint16(20, true)).toBe(3)
    expect(view.getUint16(34, true)).toBe(32)
  })

  it('has a data length that matches the file', async () => {
    const buffer = await toWav(fake(1000, 2, 48000)).arrayBuffer()
    const view = new DataView(buffer)
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe('RIFF')
    expect(view.getUint32(40, true)).toBe(1000 * 2 * 4)
    expect(view.getUint32(40, true) + 44).toBe(buffer.byteLength)
    expect(view.getUint32(24, true)).toBe(48000)
  })

  it('keeps a sample that is over full scale', async () => {
    // The whole reason for float. A stem is pre-master and the 909 hat does exceed 1.
    const loud = {
      numberOfChannels: 1,
      length: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array([1.4]),
    } as unknown as AudioBuffer
    const view = new DataView(await toWav(loud).arrayBuffer())
    expect(view.getFloat32(44, true)).toBeCloseTo(1.4, 5)
  })
})

describe('the shared step planner', () => {
  it('gives the live engine and the renderer the same answer', () => {
    // They call one function, so this asserts the function is a function of the song and
    // the step alone — no clock, no engine state, nothing that could differ offline.
    const song = acidSong()
    const event = { absolute: 4, index: 4, bar: 0, time: 12.5, stepSeconds: 0.119 }
    expect(planStep(song, event)).toEqual(planStep(song, event))
  })

  it('applies swing per voice rather than to the step', () => {
    const song = { ...defaultSong(), swing: 0.5 }
    const plan = planStep(song, { absolute: 1, index: 1, bar: 0, time: 10, stepSeconds: 0.1 })
    // An odd step is the one swing moves, and it can only move later.
    for (const hit of plan.drums) expect(hit.time).toBeGreaterThanOrEqual(10)
  })

  it('plays the first pattern when there is no chain, rather than nothing', () => {
    // The documented fallback. Worth pinning: the stem renderer relies on it agreeing.
    const song = { ...defaultSong(), chain: [] }
    const plan = planStep(song, { absolute: 0, index: 0, bar: 0, time: 0, stepSeconds: 0.1 })
    expect(plan.drums.length + plan.bass.length).toBeGreaterThan(0)
  })

  it('says nothing for a song with no patterns at all', () => {
    const plan = planStep(
      { ...defaultSong(), patterns: [], chain: [] },
      { absolute: 0, index: 0, bar: 0, time: 0, stepSeconds: 0.1 },
    )
    expect(plan.drums).toHaveLength(0)
    expect(plan.bass).toHaveLength(0)
  })

  it('plays each machine from its independently selected clip', () => {
    const base = defaultSong()
    const rest = { note: null, accent: false, slide: false }
    const primary: Pattern = {
      id: 'primary',
      name: 'Primary',
      length: 4,
      tracks: {
        '808.bd': [1, 0, 0, 0],
        '909.bd': [1, 0, 0, 0],
      },
      bass: { '303.a': [{ note: 2, accent: false, slide: false }, rest, rest, rest] },
    }
    const alternate: Pattern = {
      id: 'alternate',
      name: 'Alternate',
      length: 4,
      tracks: {
        '808.bd': [0, 1, 0, 0],
        '909.bd': [0, 1, 0, 0],
      },
      bass: { '303.a': [rest, { note: 7, accent: true, slide: false }, rest, rest] },
    }
    const song = {
      ...base,
      patterns: [primary, alternate],
      chain: [
        {
          pattern: 'primary',
          clips: { tr909: 'alternate', '303.a': 'alternate' },
          repeat: 1,
        },
      ],
    }

    const first = planStep(song, {
      absolute: 0,
      index: 0,
      bar: 0,
      time: 0,
      stepSeconds: 0.1,
    })
    expect(first.drums.map((hit) => hit.voiceId)).toEqual(['808.bd'])
    expect(first.bass).toHaveLength(0)

    const second = planStep(song, {
      absolute: 1,
      index: 1,
      bar: 0,
      time: 0.1,
      stepSeconds: 0.1,
    })
    expect(second.drums.map((hit) => hit.voiceId)).toEqual(['909.bd'])
    expect(second.bass.map((hit) => hit.voiceId)).toEqual(['303.a'])
  })
})
