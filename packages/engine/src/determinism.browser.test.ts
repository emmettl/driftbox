import { describe, expect, it } from 'vitest'
import { impulseResponse } from './effects.js'
import { noiseBuffer } from './render.js'
import { voiceById } from './kit.js'
import { DriftboxEngine, renderVoiceOffline } from './index.js'
import { defaultSong } from './songs/index.js'
import { DEFAULT_PARAMS } from './types.js'

// Same input, same samples — asserted, because it used not to be.
//
// Every noise source in the engine was `Math.random`: the noise buffer, the reverb's impulse
// response, and the per-hit offset into that buffer. So a stem rendered offline carried different
// noise and landed in a different room from the mix it was cut from, the busiest pattern's peak
// wandered between runs, and no test could compare one render to another. That last one is how it
// was found — `monitor.browser.test.ts` first compared two renders of a kick, which should have
// been identical and were not, and had to be rewritten around a voice with no noise in it.
//
// Everything here renders into *separate* contexts, because a single context caches its noise
// buffer and would pass whatever the seeding did.
//
// **The engine is deterministic. Chromium's renderer is not bit-reproducible, and that is worth
// knowing before anyone writes another test that compares two renders.**
//
// What is generated in JavaScript — the noise buffers, the impulse responses — comes out identical
// to the sample, every time, and is asserted that way below. What comes back from
// `startRendering()` does not. A voice rendered straight to a destination differs from itself by
// up to one float32 ULP (1.2e-7), *intermittently* — the same voice is bit-exact on one run and
// one ULP out on the next. Through the engine's full master chain it reaches 6.6e-5, about
// -84dBFS, measured across seven voices wet and dry and still zero for most of them.
//
// None of it is the engine's doing. The per-hit noise offsets were instrumented and come out
// identical; a biquad, a compressor and a waveshaper are each bit-exact in isolation. What is left
// is the order in which several inputs are summed into a node, which is Chromium's business rather
// than ours and is free to differ run to run.
//
// So: bit-exactness is demanded of everything this code computes, and a tolerance is used for
// everything the platform renders — both of them orders of magnitude below the ~0.1 that a
// re-introduced `Math.random` would produce, because a different slice of noise is not a rounding
// difference, it is a different signal. The same caveat applies to the spectral fingerprinting in
// `docs/PLATFORM-GAPS.md`: those fixtures will need tolerances too, and this is why.

/** The largest absolute sample difference between two renders. */
function maxDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY
  let worst = 0
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
  return worst
}

/** A voice rendered on its own. Measured worst case is one float32 ULP, 1.2e-7. */
const VOICE_RESIDUAL = 1e-5

/** A voice rendered through the whole master chain. Measured worst case 6.6e-5. */
const ENGINE_RESIDUAL = 1e-3

const offline = () => new OfflineAudioContext(1, 44_100, 44_100)

describe('noiseBuffer', () => {
  it('gives two contexts the same noise, to the sample', () => {
    // No seed asked for, so this is the path that used to be Math.random.
    const a = noiseBuffer(offline()).getChannelData(0)
    const b = noiseBuffer(offline()).getChannelData(0)
    expect(maxDifference(a, b)).toBe(0)
  })

  it('still gives a seeded voice what its seed asks for', () => {
    // The 909's cymbal ROM. Unchanged, and it must stay both deterministic and distinct per seed.
    const rom = (seed: number) => noiseBuffer(offline(), { seed, bitDepth: 6 }).getChannelData(0)
    expect(maxDifference(rom(0x909), rom(0x909))).toBe(0)
    expect(maxDifference(rom(0x909), rom(0x90a))).toBeGreaterThan(0)
  })

  it('keeps the two lengths apart', () => {
    // Length keys off whether a seed was asked for, not off the seed used. Conflating them would
    // silently double every snare buffer.
    expect(noiseBuffer(offline()).duration).toBeCloseTo(2, 6)
    expect(noiseBuffer(offline(), { seed: 0x909 }).duration).toBeCloseTo(4, 6)
  })
})

describe('impulseResponse', () => {
  it('builds the same room twice, to the sample', () => {
    const room = () => impulseResponse(offline(), 1.5, 0.4)
    expect(maxDifference(room().getChannelData(0), room().getChannelData(0))).toBe(0)
  })

  it('keeps its two channels uncorrelated, which is what makes it wide', () => {
    // The property the two seeds exist to preserve. Equal seeds would collapse the reverb to mono
    // — silently, and only on headphones.
    const room = impulseResponse(offline(), 1.5, 0.4)
    expect(maxDifference(room.getChannelData(0), room.getChannelData(1))).toBeGreaterThan(0)
  })
})

describe('a voice rendered on its own', () => {
  // The assertion that would catch a returning `Math.random` anywhere in the voice path: straight
  // to a destination, no master chain. Not bit-exact — see the note at the top — but two orders of
  // magnitude tighter than the full engine, and five below a different piece of noise.
  it.each(['808.bd', '808.sd', '808.cp', '909.ch'])('renders %s identically twice', async (id) => {
    const voice = voiceById(id)!
    const a = await renderVoiceOffline(voice, DEFAULT_PARAMS)
    const b = await renderVoiceOffline(voice, DEFAULT_PARAMS)
    expect(maxDifference(a, b)).toBeLessThan(VOICE_RESIDUAL)
  })
})

describe('a voice rendered through the engine', () => {
  const renderTwice = async (voice: string, reverb: number) => {
    const once = async () => {
      const ctx = offline()
      const engine = new DriftboxEngine(defaultSong(), { context: ctx as unknown as AudioContext })
      engine.trigger(voice, 0.05, 1, undefined, { delay: 0, reverb })
      const buffer = await ctx.startRendering()
      engine.dispose()
      return buffer.getChannelData(0)
    }
    return maxDifference(await once(), await once())
  }

  it('renders a noisy voice the same way twice', async () => {
    // 808.bd is the exact comparison that failed before any of this.
    expect(await renderTwice('808.bd', 0)).toBeLessThan(ENGINE_RESIDUAL)
    expect(await renderTwice('808.sd', 0)).toBeLessThan(ENGINE_RESIDUAL)
  })

  it('renders the same way through the reverb send too', async () => {
    // The send is the other half: a voice can be deterministic while the room it lands in is not,
    // and a stem that will not sit back into its mix is exactly that failure.
    expect(await renderTwice('808.sd', 0.8)).toBeLessThan(ENGINE_RESIDUAL)
  })
})
