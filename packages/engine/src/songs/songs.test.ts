import { describe, expect, it } from 'vitest'
import { SONGS, defaultSong, driftlingsSong, songPresetById } from './index.js'
import { encodeSong, decodeSong } from '../song-io.js'
import { songBars, patternForBar } from '../pattern.js'
import { ALL_VOICES } from '../index.js'
import { BASS_VOICES } from '../bass.js'

// The shipped songs are content, so most of what matters about them is not testable —
// whether they are any good is a matter for ears. What IS testable is that each is a
// well-formed Song the rest of the engine can play, which is easy to break by hand: a
// chain entry naming a pattern that was renamed, a voice id with a typo, a note out of
// the range the grid can show.

describe('every shipped song', () => {
  it.each(SONGS)('$id is a complete, playable song', ({ build }) => {
    const song = build()
    expect(song.patterns.length).toBeGreaterThan(0)
    expect(song.chain.length).toBeGreaterThan(0)
    expect(song.bpm).toBeGreaterThan(20)
    expect(song.bpm).toBeLessThan(300)
    expect(song.swing).toBeGreaterThanOrEqual(0)
    expect(song.swing).toBeLessThanOrEqual(1)
  })

  it.each(SONGS)('$id has no chain entry pointing at a pattern that is not there', ({ build }) => {
    // The failure this prevents is not an error — `patternForBar` falls back to the first
    // pattern — it is a bar of the wrong music, which is much harder to notice.
    const song = build()
    const ids = new Set(song.patterns.map((p) => p.id))
    for (const step of song.chain) expect(ids).toContain(step.pattern)
  })

  it.each(SONGS)('$id only names voices that exist', ({ build }) => {
    const drums = new Set(ALL_VOICES.map((v) => v.id))
    const bass = new Set(BASS_VOICES.map((v) => v.id))
    for (const pattern of build().patterns) {
      for (const id of Object.keys(pattern.tracks)) expect(drums).toContain(id)
      for (const id of Object.keys(pattern.bass ?? {})) expect(bass).toContain(id)
    }
  })

  it.each(SONGS)('$id has tracks the length of the pattern they are in', ({ build }) => {
    for (const pattern of build().patterns) {
      for (const track of Object.values(pattern.tracks)) {
        expect(track).toHaveLength(pattern.length)
      }
      for (const line of Object.values(pattern.bass ?? {})) {
        expect(line).toHaveLength(pattern.length)
      }
    }
  })

  it.each(SONGS)('$id keeps its notes inside the range the grid can reach', ({ build }) => {
    // A note outside 0..24 is one nobody can see or edit, so it may as well not be there.
    for (const pattern of build().patterns) {
      for (const line of Object.values(pattern.bass ?? {})) {
        for (const step of line) {
          if (step.note === null) continue
          expect(step.note).toBeGreaterThanOrEqual(0)
          expect(step.note).toBeLessThanOrEqual(24)
        }
      }
    }
  })

  it.each(SONGS)('$id survives being saved and loaded', ({ build }) => {
    const song = build()
    expect(decodeSong(encodeSong(song))).toEqual(song)
  })

  it.each(SONGS)('$id carries its authored visual in the song document', ({ visual, build }) => {
    expect(build().visual).toBe(visual)
  })

  it.each(SONGS)('$id is long enough to be a track rather than a loop', ({ build }) => {
    expect(songBars(build())).toBeGreaterThanOrEqual(32)
  })

  it.each(SONGS)('$id hands back a fresh song each time', ({ build }) => {
    // Built rather than stored, so editing one cannot alter what the next person loads.
    const first = build()
    first.patterns[0].name = 'edited'
    first.bpm = 999
    expect(build().patterns[0].name).not.toBe('edited')
    expect(build().bpm).not.toBe(999)
  })
})

describe('the set of them', () => {
  it('has unique ids and names', () => {
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length)
    expect(new Set(SONGS.map((s) => s.name)).size).toBe(SONGS.length)
  })

  it('covers a real range of tempo rather than three of the same thing', () => {
    const tempos = SONGS.map((s) => s.build().bpm)
    expect(Math.max(...tempos) - Math.min(...tempos)).toBeGreaterThan(30)
  })

  it('uses both drum machines across the set', () => {
    const machines = new Set<string>()
    for (const preset of SONGS) {
      for (const pattern of preset.build().patterns) {
        for (const id of Object.keys(pattern.tracks)) machines.add(id.split('.')[0])
      }
    }
    expect(machines).toContain('808')
    expect(machines).toContain('909')
  })

  it('sets the 303s up genuinely differently', () => {
    // The claim the set is making: the same two synths, two instruments. Acid is
    // resonance at the top with a short decay; darkwave is the filter mostly shut with
    // the envelope barely moving.
    const acid = songPresetById('acid')!.build().kit.bass!['303.a']
    const dark = songPresetById('darkwave')!.build().kit.bass!['303.a']
    expect(acid.resonance).toBeGreaterThan(dark.resonance + 0.3)
    expect(acid.envMod).toBeGreaterThan(dark.envMod + 0.3)
    expect(acid.decay).toBeLessThan(dark.decay)
  })

  it('looks up by id, and says so when there is nothing', () => {
    expect(songPresetById('acid')?.name).toBe('Acieed')
    expect(songPresetById('nope')).toBeUndefined()
  })

  it('exports host soundtracks without putting them in the visual set list', () => {
    expect(driftlingsSong().patterns).not.toHaveLength(0)
    expect(songPresetById('driftlings')).toBeUndefined()
  })

  it('opens on the first one', () => {
    expect(defaultSong()).toEqual(SONGS[0].build())
  })

  it('does not open two songs with the same four bars', () => {
    // Acieed and Ascend shipped with byte-identical opening patterns — the same kick, the
    // same closed hat, differing only in tempo — and sat next to each other in the set, so
    // skipping from one to the other sounded like the same track starting again. Ordering
    // them apart hides that; this is what stops it being written twice in the first place.
    const openings = new Map<string, string>()
    for (const preset of SONGS) {
      const song = preset.build()
      const first = patternForBar(song, 0)!
      const shape = JSON.stringify([first.tracks, first.bass ?? {}])
      const clash = openings.get(shape)
      expect(clash, `${preset.id} opens exactly like ${clash}`).toBeUndefined()
      openings.set(shape, preset.id)
    }
  })

  it('starts every song on a bar that actually plays something', () => {
    // An intro that is four bars of silence reads as the app being broken.
    for (const preset of SONGS) {
      const song = preset.build()
      const first = patternForBar(song, 0)!
      const hits =
        Object.values(first.tracks).flat().filter(Boolean).length +
        Object.values(first.bass ?? {})
          .flat()
          .filter((s) => s.note !== null).length
      expect(hits).toBeGreaterThan(0)
    }
  })
})
