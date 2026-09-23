import { describe, expect, it } from 'vitest'
import { SONG_FILE_ACCEPT, songFileName } from './persistence'

describe('song files', () => {
  it('saves a song as .driftbox', () => {
    expect(songFileName('driftbox-song')).toBe('driftbox-song.driftbox')
    expect(songFileName('Night Bus')).toBe('Night Bus.driftbox')
  })

  it('offers .driftbox in the picker, and .json for songs saved before it', () => {
    const offered = SONG_FILE_ACCEPT.split(',')
    expect(offered).toContain('.driftbox')
    expect(offered).toContain('.json')
  })
})
