import { MODULES, patchPresetById, renderPatch } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import { breakById, renderBreak } from './breaks.js'

// The hero patch has two contracts the Node suite cannot make:
//
//   1. its generated break actually reaches a real AudioWorklet; and
//   2. the assembled mix is neither silent nor a clipped mono wall.
//
// Compiling the patch proves every cable names a real port, but the rack has shipped a perfectly valid,
// perfectly silent offline render before — `render.ts` records the message-order race that caused it. This
// is deliberately an end-to-end render through the same two engines the page uses after Start.

const SR = 22050

const rms = (values: Float32Array, from = 0, to = values.length): number => {
  let energy = 0
  for (let i = from; i < to; i++) energy += values[i] * values[i]
  return Math.sqrt(energy / Math.max(1, to - from))
}

describe('Pressure System in a browser', () => {
  it('renders as a changing, bounded stereo record', async () => {
    const preset = patchPresetById('pressure-system')!
    const patch = preset.build()
    const breakDef = breakById(preset.needsBreak!)!
    const sample = await renderBreak(breakDef, { sampleRate: SR })

    // Twelve bars reaches through a four-bar intro, four bars establishing the groove, and into the first
    // drop. Long enough to prove the Arranger changes the record; short enough for an ordinary test run.
    const bars = 12
    const rendered = await renderPatch(patch, {
      registry: MODULES,
      bars,
      tail: 0.5,
      sampleRate: SR,
      data: { 'sampler-1': { sample } },
    })

    const left = rendered.getChannelData(0)
    const right = rendered.getChannelData(1)
    const musicFrames = Math.round((bars * 4 * 60 * SR) / patch.tempo!)
    const perBar = Math.floor(musicFrames / bars)

    let peak = 0
    for (let i = 0; i < musicFrames; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
    }
    expect(peak).toBeGreaterThan(0.2)
    expect(peak).toBeLessThanOrEqual(1.001)

    const levels = Array.from({ length: bars }, (_, bar) => {
      const from = bar * perBar
      const to = Math.min(musicFrames, from + perBar)
      return (rms(left, from, to) + rms(right, from, to)) / 2
    })
    // No dead air while a section changes, and the drop has materially more weight than the four-bar intro.
    expect(Math.min(...levels)).toBeGreaterThan(0.015)
    const intro = levels.slice(0, 4).reduce((sum, value) => sum + value, 0) / 4
    const drop = levels.slice(8).reduce((sum, value) => sum + value, 0) / (bars - 8)
    expect(drop).toBeGreaterThan(intro * 1.05)
    // A drop should add weight, not become a limiter-held wall. This is a broad guardrail around the failure
    // that prompted the second mix: too many full-time parts made every later bar feel equally overstuffed.
    expect(drop).toBeLessThan(intro * 2.4)

    // The delayed Reese is panned apart. Measure the drop where it is deliberately present rather than the
    // sparse mono intro: a non-zero difference proves the stereo route survived without requiring every bar
    // of the record to be wide.
    const difference = Float32Array.from(left.slice(0, musicFrames), (value, i) => value - right[i])
    expect(rms(difference, 8 * perBar)).toBeGreaterThan(0.005)
  }, 30_000)
})
