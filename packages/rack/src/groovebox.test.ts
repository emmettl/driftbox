import { SONGS, encodeSong } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import {
  embedGrooveboxSong,
  grooveboxSong,
  isGrooveboxEditable,
  patchCompatibility,
} from './groovebox.js'
import { decodePatch, encodePatch } from './patch-io.js'
import type { Patch } from './types.js'

describe('the groovebox document bridge', () => {
  it.each(SONGS)('round-trips the complete shipped song $id', ({ build }) => {
    const song = build()
    const patch = embedGrooveboxSong(song)
    const saved = decodePatch(encodePatch(patch))

    expect(saved).not.toBeNull()
    expect(saved && patchCompatibility(saved)).toBe('groovebox-compatible')
    expect(saved && isGrooveboxEditable(saved)).toBe(true)
    expect(saved && grooveboxSong(saved)).toEqual(song)
    expect(saved && encodeSong(grooveboxSong(saved)!)).toBe(encodeSong(song))
  })

  it('preserves a future song exactly even when this build cannot edit it', () => {
    const future = '{"v":999,"song":{"future":true,"unknown":["kept",7]}}'
    const patch: Patch = { modules: [], cables: [], groovebox: future }
    const saved = decodePatch(encodePatch(patch))!

    expect(saved.groovebox).toBe(future)
    expect(patchCompatibility(saved)).toBe('groovebox-compatible')
    expect(grooveboxSong(saved)).toBeNull()
    expect(isGrooveboxEditable(saved)).toBe(false)
  })

  it.each([
    {
      field: 'module',
      extend: (patch: Patch): Patch => ({
        ...patch,
        modules: [{ id: 'osc', type: 'vco' }],
      }),
    },
    {
      field: 'cable',
      extend: (patch: Patch): Patch => ({
        ...patch,
        modules: [
          { id: 'osc', type: 'vco' },
          { id: 'out', type: 'out' },
        ],
        cables: [{ from: ['osc', 'out'], to: ['out', 'in'] }],
      }),
    },
    {
      field: 'modulation',
      extend: (patch: Patch): Patch => ({
        ...patch,
        modules: [
          { id: 'combi', type: 'combi' },
          { id: 'osc', type: 'vco' },
        ],
        modulation: [{ from: ['combi', 'rotary-1'], to: ['osc', 'tune'] }],
      }),
    },
    {
      field: 'voice count',
      extend: (patch: Patch): Patch => ({ ...patch, voices: 4 }),
    },
    {
      field: 'generated break',
      extend: (patch: Patch): Patch => ({ ...patch, break: 'amenish' }),
    },
    {
      field: 'tempo override',
      extend: (patch: Patch): Patch => ({ ...patch, tempo: 130 }),
    },
  ])('marks a document with a rack $field as extended without losing its song', ({ extend }) => {
    const song = SONGS[0].build()
    const extended = extend(embedGrooveboxSong(song))

    expect(patchCompatibility(extended)).toBe('rack-extended')
    expect(isGrooveboxEditable(extended)).toBe(false)
    expect(grooveboxSong(extended)).toEqual(song)
  })

  it('classifies a patch without a retained song as rack-native', () => {
    expect(patchCompatibility({ modules: [], cables: [] })).toBe('rack-native')
    expect(isGrooveboxEditable({ modules: [], cables: [] })).toBe(false)
  })

  it('treats an explicit single voice like the patch codec does: as the default', () => {
    const patch = { ...embedGrooveboxSong(SONGS[0].build()), voices: 1 }
    expect(patchCompatibility(patch)).toBe('groovebox-compatible')
  })
})
