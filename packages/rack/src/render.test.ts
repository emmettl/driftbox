import { describe, expect, it } from 'vitest'
import { PATCHES } from './patches/index.js'
import { renderLength } from './render.js'

// The arithmetic, which is the only part of rendering worth testing in Node — there is no
// `OfflineAudioContext` here, and `breaks.ts` already records why stubbing one is the wrong shape: the stub
// grows a method every time the graph touches one, and what it proves is that the stub is complete rather
// than that the render is right. The render itself is checked in a browser.

const SR = 44100

describe('how long an export is', () => {
  it('is the bars it was asked for, plus the tail', () => {
    // Four bars of four beats at 120bpm is eight seconds, plus two of tail.
    expect(renderLength(4, 120, SR, 2)).toBe(10 * SR)
    expect(renderLength(1, 120, SR, 0)).toBe(2 * SR)
  })

  it('scales the way tempo does', () => {
    // Twice the tempo, half the music. Getting this inverted would export at half speed and everything about
    // the file would still look right — the sort of wrong that survives a long time.
    expect(renderLength(4, 240, SR, 0)).toBe(renderLength(4, 120, SR, 0) / 2)
    // 174bpm, four bars: 5.517 seconds.
    expect(renderLength(4, 174, SR, 0) / SR).toBeCloseTo(5.517, 3)
  })

  it('lands a whole number of samples at any rate', () => {
    // A fractional length would be rounded by the OfflineAudioContext anyway; doing it here means the
    // arithmetic and the buffer agree about how long the file is.
    for (const rate of [44100, 48000, 96000]) {
      for (const tempo of [120, 174, 87]) {
        const length = renderLength(4, tempo, rate, 2)
        expect(Number.isInteger(length)).toBe(true)
        expect(length).toBeGreaterThan(0)
      }
    }
  })

  it('never renders an empty buffer, whatever it is asked for', () => {
    // An OfflineAudioContext with a length of zero throws, which would turn a silly input into a crash.
    expect(renderLength(0, 120, SR, 0)).toBeGreaterThan(0)
    expect(renderLength(1, 100000, SR, 0)).toBeGreaterThan(0)
  })

  it('leaves room for the tail a shipped patch actually has', () => {
    // The reason a tail exists at all. Two seconds has to clear the longest release and reverb decay in the
    // patches we ship, or an export ends mid-ring — which sounds broken rather than short.
    const longest = Math.max(
      ...PATCHES.flatMap((preset) =>
        preset.build().modules.flatMap((module) => {
          const release = module.params?.release ?? 0
          // A reverb's decay is a feedback coefficient rather than a time, so it is judged by its own scale.
          const reverb = module.type === 'reverb' ? (module.params?.decay ?? 0.82) * 2 : 0
          return [release, reverb]
        }),
      ),
    )
    expect(longest).toBeLessThan(2)
  })
})
