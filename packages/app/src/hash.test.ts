import { describe, expect, it } from 'vitest'
import { fromHash, toHash } from './hash.js'
import { songFromHash } from './persistence.js'

// The hash codec was untested for as long as it only had one caller. Giving it a second one —
// patches, for the rack — meant changing the marker, and changing a marker is how you silently
// break every link anybody has already shared. Hence the pinned literal below.

// A hash produced by the implementation as it stood BEFORE the kind marker existed, captured
// from the running code rather than constructed by hand. If a change to the codec cannot read
// this, that change has broken every link in every chat window and bookmark that already
// exists.
const SHARED_BEFORE_KINDS =
  'zRY_BbsJADET_Zc4WSlJA1X5Arz2UG-LgEBdWkGW1WQFttP-OHUh7s0czTzMjrnANYbiEA9yINvZwdfOuys2bVC1qQuScJYUBbjvCd3CINQiBe9H7M4g-ZwmHfIRbEnLi_WmYcOrd1lRRQ9WuEFoeTC9lR9gf2YeJ-MLP2CRROGstc518NlDkxP0U_YdoRwndfD7rKprwfbdIJ2f--VKHjWgMe5XUzsIbPQ0bbxuqxer1f4h0rdY3bfkX8r-TaV1KeQA'

describe('the URL hash', () => {
  it('still reads a song link shared before kinds existed', () => {
    expect(SHARED_BEFORE_KINDS.startsWith('z')).toBe(true)
    return expect(songFromHash(SHARED_BEFORE_KINDS)).resolves.toMatchObject({
      bpm: 128,
      chain: [{ pattern: 'p1', repeat: 2 }],
    })
  })

  it('round-trips either kind', async () => {
    for (const kind of ['song', 'patch'] as const) {
      const text = JSON.stringify({ hello: 'world', numbers: [1, 2, 3] })
      const found = await fromHash(await toHash(kind, text))
      expect(found).toEqual({ kind, text })
    }
  })

  it('keeps a song and a patch apart', async () => {
    // The reason the kind travels in the marker at all. Without it, a patch link opened in the
    // sequencer would decode to null and look like a corrupt link rather than a link for
    // somewhere else.
    const asSong = await toHash('song', '{"a":1}')
    const asPatch = await toHash('patch', '{"a":1}')

    expect(asSong).not.toBe(asPatch)
    expect((await fromHash(asSong))?.kind).toBe('song')
    expect((await fromHash(asPatch))?.kind).toBe('patch')
    // Same payload, so the markers are doing the work and nothing else is.
    expect(asSong.slice(1)).toBe(asPatch.slice(2))
  })

  it('marks a song with one character and a patch with two', async () => {
    // Not cosmetic: the one-character song markers are the ones already in the wild, so they
    // cannot grow a prefix. Everything after them has to fit around that.
    expect(await toHash('song', 'x')).toMatch(/^[zr]/)
    expect(await toHash('patch', 'x')).toMatch(/^p[zr]/)
  })

  it('tolerates a leading hash', async () => {
    const hash = await toHash('patch', '{"a":1}')
    expect(await fromHash(`#${hash}`)).toEqual(await fromHash(hash))
  })

  it('refuses anything that is not one of ours', async () => {
    for (const junk of ['', '#', 'z', 'pz', 'x', 'qsomething', '#!/', 'p']) {
      expect(await fromHash(junk)).toBeNull()
    }
  })

  it('refuses a payload that has been mangled in transit', async () => {
    // Chat clients wrap long links and email clients rewrite them. The failure has to be a
    // null, not a throw, because it happens on page load before there is any UI to catch it.
    const hash = await toHash('song', JSON.stringify({ a: 1, b: 2, c: 3 }))
    expect(await fromHash(hash.slice(0, hash.length - 6))).toBeNull()
    expect(await fromHash(`${hash.slice(0, 1)}!!!!not base64!!!!`)).toBeNull()
  })

  it('compresses rather than merely encoding', async () => {
    // If this ever stops holding, the shareable link is quietly four thirds the size of the
    // JSON instead of a sixth of it, and there is nothing to see but a longer URL.
    const repetitive = JSON.stringify({
      modules: Array.from({ length: 40 }, (_, i) => ({
        id: `module-${i}`,
        type: 'vco',
        params: { tune: 0, shape: 0, width: 0.5 },
      })),
    })
    const hash = await toHash('patch', repetitive)
    expect(hash.length).toBeLessThan(repetitive.length / 4)
  })
})
