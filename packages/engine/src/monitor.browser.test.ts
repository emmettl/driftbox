import { describe, expect, it } from 'vitest'
import { DriftboxEngine } from './index.js'
import { defaultSong } from './songs/index.js'

// What the arithmetic in `monitor.test.ts` cannot answer: whether compensating the picture moved
// the sound. The whole design rests on the analyser being on a branch rather than in the line, and
// the way that goes wrong is not subtle — it is the entire mix arriving late, which on a wired
// output is a few milliseconds nobody would hear in isolation and every producer would feel.
//
// Rendered offline because it has to be sample-exact. "The kick still sounds like it did" is an
// opinion; "the first non-zero sample is at the same index" is a measurement.

/** An offline context that claims a device latency, which a real one never has. `outputLatency` is
 *  read-only and absent on OfflineAudioContext, so it is defined onto the instance — the engine has
 *  no way to tell the difference, which is the point. */
function contextReporting(outputLatency: number | undefined): OfflineAudioContext {
  const sampleRate = 44_100
  const ctx = new OfflineAudioContext(1, sampleRate, sampleRate)
  if (outputLatency !== undefined) {
    Object.defineProperty(ctx, 'outputLatency', { value: outputLatency, configurable: true })
  }
  return ctx
}

/**
 * A cowbell, and the voice matters.
 *
 * The kick was the obvious choice and it does not work: `bassDrum` has a noise layer, and
 * `render.ts` seeds its noise buffer only when a seed is passed — the 909's PCM ROM does, ordinary
 * noise does not. So two renders of a kick differ in their samples, and a test comparing one
 * render against another is comparing two different pieces of noise. It failed exactly that way
 * once, on a peak that should have been identical to six places.
 *
 * The cowbell is two square oscillators and an envelope, with nothing random in it, so two renders
 * of it are the same buffer twice. Worth knowing before writing any other test that compares
 * renders — and the prerequisite named in `docs/PLATFORM-GAPS.md` for fingerprinting the voices.
 */
async function renderHit(outputLatency: number | undefined) {
  const ctx = contextReporting(outputLatency)
  const engine = new DriftboxEngine(defaultSong(), { context: ctx as unknown as AudioContext })
  const compensation = engine.monitorDelay
  engine.trigger('808.cb', 0.05, 1, undefined, { delay: 0, reverb: 0 })
  const buffer = await ctx.startRendering()
  engine.dispose()

  const samples = buffer.getChannelData(0)
  let onset = -1
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i])
    if (onset < 0 && value > 1e-4) onset = i
    peak = Math.max(peak, value)
  }
  return { compensation, onset, peak }
}

describe('the monitor tap', () => {
  it('does not delay the audio it compensates the picture for', async () => {
    // 300ms is the high end of a Bluetooth stack — six times a sixteenth note at 120bpm. If the
    // analyser were still in the signal path, this is where that would show up as the mix
    // arriving 13,230 samples late.
    const none = await renderHit(undefined)
    const bluetooth = await renderHit(0.3)

    expect(none.onset).toBeGreaterThanOrEqual(0)
    expect(bluetooth.onset).toBe(none.onset)
  })

  it('contributes nothing to the mix from its silent return', async () => {
    // The tap ends in a gain of zero that reaches the output, so that the branch is guaranteed to
    // be processed. Exactly zero, or it is a delayed second copy of the whole mix — which at 300ms
    // would be an audible slapback nobody asked for, and at 0 a doubling.
    const none = await renderHit(undefined)
    const bluetooth = await renderHit(0.3)

    expect(bluetooth.peak).toBeCloseTo(none.peak, 6)
  })

  it('takes the latency the context reports', async () => {
    expect((await renderHit(0.18)).compensation).toBeCloseTo(0.18, 6)
  })

  it('compensates by nothing for an offline render, which has no device to be late', async () => {
    // The fallback chain has to answer this without a branch at the call site, because every
    // measurement in this project's browser suite runs through it.
    expect((await renderHit(undefined)).compensation).toBe(0)
  })

  it('clamps a latency larger than the delay line can hold', async () => {
    // maxDelayTime is fixed at construction. Without the clamp the node truncates it silently.
    expect((await renderHit(9)).compensation).toBeCloseTo(0.5, 6)
  })
})
