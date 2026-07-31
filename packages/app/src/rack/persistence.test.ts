import type { Patch } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import { toHash } from '../hash.js'
import { songFromHash, songToHash } from '../persistence.js'
import { patchFromHash, patchToHash, rackDocumentFromHash } from './persistence.js'

// The storage and file halves are browser plumbing and are tested by using them. What is worth
// testing here is the part where the two documents meet: a patch link and a song link travel in
// the same fragment, and the whole point of the kind marker is that neither page can be fooled
// by the other's.

const PATCH: Patch = {
  modules: [
    { id: 'osc', type: 'vco', params: { tune: -12 }, pos: [0, 0] },
    { id: 'out', type: 'out', params: { level: 0.6 } },
  ],
  cables: [{ from: ['osc', 'out'], to: ['out', 'in'] }],
}

const SONG = {
  bpm: 128,
  swing: 0,
  patterns: [{ id: 'p1', name: 'One', length: 4, tracks: { bd: [1, 0, 0, 0] }, bass: {} }],
  chain: [{ pattern: 'p1', repeat: 1 }],
  kit: { params: {}, bass: {}, sends: {}, swing: {} },
  fx: { delaySend: 0, reverbSend: 0, delayTime: 0.5, delayFeedback: 0.3, reverbSize: 0.5 },
}

describe('a patch in a URL', () => {
  it('round-trips', async () => {
    expect(await patchFromHash(await patchToHash(PATCH))).toEqual(PATCH)
  })

  it('fits in something you could paste into a chat window', async () => {
    // The reason this is a product feature and not a checkbox: VCV Rack cannot be a link. A
    // patch of forty modules has to stay short enough to send to somebody.
    const big: Patch = {
      modules: Array.from({ length: 40 }, (_, i) => ({
        id: `mod-${i}`,
        type: i % 2 ? 'vco' : 'ladder',
        params: { tune: i, shape: 1, width: 0.5 },
        pos: [i % 8, Math.floor(i / 8)] as [number, number],
      })),
      cables: Array.from({ length: 39 }, (_, i) => ({
        from: [`mod-${i}`, 'out'] as [string, string],
        to: [`mod-${i + 1}`, 'in'] as [string, string],
      })),
    }
    const hash = await patchToHash(big)
    expect(hash.length).toBeLessThan(1000)
    expect(await patchFromHash(hash)).toEqual(big)
  })

  it('carries a Combinator’s routings', async () => {
    // A routing lives in the patch rather than in the graph precisely so that everything downstream gets
    // it for free — the link included. Worth one test on the whole path rather than trusting the layering,
    // because a link that arrived with the macros silently unwired would be the same patch by name only.
    const wired: Patch = {
      ...PATCH,
      modules: [...PATCH.modules, { id: 'macro', type: 'combi', params: { rotary1: 20 } }],
      modulation: [
        { from: ['macro', 'rotary1'], to: ['osc', 'tune'], min: -24, max: 24 },
        // And one with an end left absent, meaning the target's own limit — which is the shape a fresh
        // routing has, and the one a codec is most likely to repair into a zero on the way past.
        { from: ['macro', 'button1'], to: ['osc', 'shape'], max: 2 },
      ],
    }
    expect(await patchFromHash(await patchToHash(wired))).toEqual(wired)
  })

  it('is not readable as a song, and a song is not readable as a patch', async () => {
    // Both directions, because the failure is asymmetric otherwise: a song happens to have no
    // `modules` array so it would decode to null anyway, whereas a patch handed to decodeSong
    // could in principle survive. The marker means neither has to be lucky.
    expect(await songFromHash(await patchToHash(PATCH))).toBeNull()
    expect(await patchFromHash(await songToHash(SONG as never))).toBeNull()
  })

  it('wraps a song link as an exact groovebox-compatible rack document', async () => {
    const hash = await songToHash(SONG as never)
    const document = await rackDocumentFromHash(hash)

    expect(document).toEqual({
      modules: [],
      cables: [],
      groovebox: expect.any(String),
    })
    expect(document?.groovebox && JSON.parse(document.groovebox).song).toEqual(SONG)
  })

  it('retains a future song from a link without decoding or rewriting it', async () => {
    const future = '{"v":999,"song":{"future":true,"unknown":["kept",7]}}'
    const document = await rackDocumentFromHash(await toHash('song', future))
    expect(document?.groovebox).toBe(future)
  })

  it('is null rather than a throw when the link is not one at all', async () => {
    // This runs on page load, before there is any UI to catch an exception with.
    for (const junk of ['', '#', 'nonsense', 'p', 'pz', '#pz!!!!']) {
      expect(await patchFromHash(junk)).toBeNull()
    }
  })
})
