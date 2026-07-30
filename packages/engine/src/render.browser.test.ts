import { beforeAll, describe, expect, it } from 'vitest'
import { ALL_VOICES } from './kit.js'
import { renderVoiceOffline } from './index.js'

// The level measurements, which until now lived in `docs/VERIFYING-AUDIO.md` as instructions.
//
// They are the checks that have actually found bugs here — three of them, all invisible to
// `npm test` because `render.test.ts` runs against a stub. The worst was the renderer ignoring
// `Source.gain`: every source played at whatever its envelope peaked at, the 808 kick's click
// arrived at full scale over the body, and the number that showed it was the kit spread, at 1.43
// where it should have been near 1.0. Nothing about that was visible in what the renderer
// *scheduled* — only in what came out.
//
// So this is the same arithmetic the doc asks a person to run by hand after touching a voice,
// `render.ts` or the bus, run instead on every push. What stays in the doc is the part a number
// cannot settle: whether a kick sounds like a kick.
//
// It needs a real `OfflineAudioContext`, which is why it is a browser test. The stub in
// `render.test.ts` is not an oversight to be replaced — it checks the schedule, which is a
// different question and a faster one. Both are worth having.

const SR = 44100

/**
 * How many times each voice is rendered before its peak is believed.
 *
 * Not a round number picked for comfort. The noise-based voices start at a random offset into a
 * shared buffer, so the claps swing between 0.77 and 0.92 from one render to the next — and the
 * spread assertion below divides the loudest voice by the quietest, which lands on exactly those
 * tails. Averaging seven renders, as the doc suggests for a human reading a number off a console,
 * leaves the spread wobbling between 1.06 and 1.19 across full passes: a threshold of 1.2 would
 * have failed roughly one run in five for no reason at all. Twenty-five holds it to 1.07–1.11,
 * which is a margin worth asserting against. It costs about three seconds.
 */
const PASSES = 25

interface Measured {
  /** Every peak, one per render, so the ceiling is judged on all of them and not on their mean. */
  peaks: number[]
  mean: number
  /** From the last render. Only asserted on for voices whose decay does not vary. */
  decayMs: number
}

function measure(data: Float32Array): { peak: number; decayMs: number } {
  let peak = 0
  let peakAt = 0
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i])
    if (a > peak) {
      peak = a
      peakAt = i
    }
  }
  // Time from the peak until it stays below 1% of it — the same definition the doc uses, so the
  // numbers here and the numbers somebody measures by hand mean the same thing.
  let tail = peakAt
  for (let i = data.length - 1; i > peakAt; i--) {
    if (Math.abs(data[i]) > peak * 0.01) {
      tail = i
      break
    }
  }
  return { peak, decayMs: Math.round(((tail - peakAt) / SR) * 1000) }
}

/** Measured once and read by every test below: rendering the kit twenty-five times over is the
 *  expensive part, and all three assertions are asking about the same set of renders. */
const kit = new Map<string, Measured>()

beforeAll(async () => {
  for (const voice of ALL_VOICES) {
    const peaks: number[] = []
    let decayMs = 0
    for (let n = 0; n < PASSES; n++) {
      const result = measure(await renderVoiceOffline(voice, undefined, 1, SR))
      peaks.push(result.peak)
      decayMs = result.decayMs
    }
    kit.set(voice.id, { peaks, mean: peaks.reduce((a, b) => a + b, 0) / peaks.length, decayMs })
  }
}, 120_000)

describe('what comes out of a voice at default knobs', () => {
  it('never reaches full scale, on any render', () => {
    // The defaults clipping is ours; a user turning things up and clipping is theirs. Judged on
    // every individual render rather than on the mean, because a voice that clips one render in
    // twenty still clips — and the claps, which are the ones that vary, are also the ones closest
    // to the ceiling at about 0.92.
    for (const [id, { peaks }] of kit) {
      expect(Math.max(...peaks), id).toBeLessThan(1)
    }
  })

  it('sits in the band every trim was set against', () => {
    // `trim = 0.75 / peak`, applied per voice, is the whole reason a kick built from three sources
    // and a hat built from one arrive at the same level. A voice outside this band means its trim
    // no longer matches its synthesis — which is not audible as "wrong", only as a clap you cannot
    // hear under the kick.
    for (const [id, { mean }] of kit) {
      expect(mean, id).toBeGreaterThan(0.65)
      expect(mean, id).toBeLessThan(0.9)
    }
  })
})

describe('the kit balances against itself', () => {
  it('has no voice standing more than a fifth clear of the quietest', () => {
    // The measurement that caught the `Source.gain` bug, where this read 1.43–1.67. The band test
    // above would catch a single voice drifting; this catches the case that one did not — every
    // voice wrong together, in a way that leaves each of them individually plausible.
    const means = [...kit.values()].map((entry) => entry.mean)
    const spread = Math.max(...means) / Math.min(...means)
    expect(spread).toBeLessThan(1.2)
  })
})

describe('a voice decays like the instrument it is imitating', () => {
  // Three claims the doc makes in a sentence — "a kick decays in a few hundred milliseconds, a
  // closed hat in tens, a crash in over a second". They are worth asserting because the failure
  // they guard is not a crash or a wrong number, it is a hat that rings like a cymbal, which
  // nothing else in this suite can tell you about. Only voices whose decay is stable across
  // renders are named here; the claps swing by 70ms and would be a coin toss.

  it('gives a kick a few hundred milliseconds', () => {
    for (const id of ['909.bd', '808.bd']) {
      const { decayMs } = kit.get(id)!
      expect(decayMs, id).toBeGreaterThan(150)
      expect(decayMs, id).toBeLessThan(700)
    }
  })

  it('gives a closed hat tens', () => {
    // The tightest of the three, and the one that matters most: a closed hat is what a pattern
    // uses to mark time, and one that rings into the next step smears the whole groove.
    for (const id of ['909.ch', '808.ch']) {
      expect(kit.get(id)!.decayMs, id).toBeLessThan(80)
    }
  })

  it('lets a crash ring past a second', () => {
    expect(kit.get('909.cr')!.decayMs).toBeGreaterThan(1000)
  })
})
