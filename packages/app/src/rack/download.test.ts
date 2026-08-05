import { describe, expect, it } from 'vitest'
import { wavFileName } from './download.js'

// A patch name is typed by a person and lands, unaltered, in somebody's Downloads folder. Slashes,
// quotes, colons and emoji all appear in real names and each is a problem on at least one filesystem, so
// the rule is deliberately blunt rather than clever.

describe('naming an exported file', () => {
  it('keeps a plain name as it is', () => {
    expect(wavFileName('pressure-system', 'driftbox-rack')).toBe('pressure-system.wav')
    expect(wavFileName('Take_2', 'driftbox-rack')).toBe('Take_2.wav')
  })

  it('collapses everything a filesystem would rather not see', () => {
    expect(wavFileName('my patch: v2 / final', 'driftbox-rack')).toBe('my-patch-v2-final.wav')
    expect(wavFileName('..\\..\\etc\\passwd', 'driftbox-rack')).toBe('etc-passwd.wav')
    expect(wavFileName('🎛️ jungle 🎛️', 'driftbox-rack')).toBe('jungle.wav')
  })

  it('falls back rather than producing a file with no name at all', () => {
    expect(wavFileName(null, 'driftbox-rack')).toBe('driftbox-rack.wav')
    expect(wavFileName(undefined, 'driftbox-song')).toBe('driftbox-song.wav')
    expect(wavFileName('', 'driftbox-rack')).toBe('driftbox-rack.wav')
    // A name made entirely of punctuation would otherwise leave `.wav`, which some browsers treat as a
    // hidden file and others refuse outright.
    expect(wavFileName('***', 'driftbox-rack')).toBe('driftbox-rack.wav')
    expect(wavFileName('   ', 'driftbox-rack')).toBe('driftbox-rack.wav')
  })

  it('marks the song mix apart from the patch render of the same document', () => {
    expect(wavFileName('pressure-system', 'driftbox-song', '-mix')).toBe('pressure-system-mix.wav')
    expect(wavFileName(null, 'driftbox-song', '-mix')).toBe('driftbox-song-mix.wav')
  })
})
