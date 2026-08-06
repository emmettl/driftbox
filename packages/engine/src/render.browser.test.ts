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
 * **This file used to replace `Math.random` for its whole duration, and no longer has to.**
 *
 * `render.ts` starts every analogue-style noise source at an offset into the shared buffer so that
 * overlapping claps do not comb-filter, and that offset used to be drawn at random. It made a
 * voice's peak a random variable: the first version of this file asserted a hard ceiling on the
 * worst of twenty-five samples, passed 550 renders locally at a high-water mark of 0.916, and then
 * failed on its first CI run at 1.069 — the same distribution, a different tail. A test that fails
 * one run in some unknown number teaches people to re-run CI until it goes green. Seeding the
 * global made every number here a fixed function of one constant, which fixed the flake.
 *
 * The offset is now a function of *which hit it is* — the voice, the source within it, and when it
 * lands — so there is no global left to seed and nothing random to stabilise. The sweep instead
 * asks `renderVoiceOffline` for a different variant each pass, which perturbs that identity and
 * nothing else. Deliberately not by rendering at later start times: a hit that does not land on a
 * render-quantum boundary changes much more than its noise offset, by up to a factor of five on a
 * voice containing no noise at all. See the parameter's own note.
 *
 * Twenty-five is enough for the mean to settle to three decimal places, which is what the band and
 * the spread are actually asking about, and it costs about three seconds. The noise voices swing
 * far too wide for one render to mean anything on its own.
 */
const PASSES = 25

interface Measured {
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

async function peaks(voice: (typeof ALL_VOICES)[number], count: number): Promise<number[]> {
  const out: number[] = []
  for (let n = 0; n < count; n++) {
    out.push(measure(await renderVoiceOffline(voice, undefined, 1, SR, n)).peak)
  }
  return out
}

/** Measured once and read by every test below: rendering the kit twenty-five times over is the
 *  expensive part, and all of these assertions ask about the same set of renders. */
const kit = new Map<string, Measured>()

beforeAll(async () => {
  for (const voice of ALL_VOICES) {
    const collected: number[] = []
    let decayMs = 0
    for (let n = 0; n < PASSES; n++) {
      const result = measure(await renderVoiceOffline(voice, undefined, 1, SR, n))
      collected.push(result.peak)
      decayMs = result.decayMs
    }
    kit.set(voice.id, {
      peaks: collected,
      mean: collected.reduce((a, b) => a + b, 0) / collected.length,
      decayMs,
    })
  }
}, 120_000)

/** The one voice known to cross full scale. Excluded from the ceiling below and given its own
 *  test, rather than quietly widening the threshold for everything. */
const CLIPS = '808.cp'

describe('what comes out of a voice at default knobs', () => {
  it('stays under full scale, for every voice but the 808 clap', () => {
    // The defaults clipping is ours; a user turning things up and clipping is theirs. Judged on
    // every individual render rather than on the mean, because a voice that clips one render in
    // twenty still clips. The next-closest to the ceiling are the 909 kick and clap, both at
    // 0.913 under this seed.
    for (const [id, { peaks: p }] of kit) {
      if (id === CLIPS) continue
      expect(Math.max(...p), id).toBeLessThan(1)
    }
  })

  it('sits in the band every trim was set against', () => {
    // `trim = 0.75 / peak`, applied per voice, is the whole reason a kick built from three sources
    // and a hat built from one arrive at the same level. A voice outside this band means its trim
    // no longer matches its synthesis — which is not audible as "wrong", only as a clap you cannot
    // hear under the kick. Measured range under this seed: 0.732 to 0.786.
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
    //
    // 1.073 under this seed. The threshold is the doc's 1.2 rather than something tighter because
    // 1.2 is the number the kit was calibrated to, not because the margin is needed.
    const means = [...kit.values()].map((entry) => entry.mean)
    const spread = Math.max(...means) / Math.min(...means)
    expect(spread).toBeLessThan(1.2)
  })
})

describe('the 808 clap crosses full scale, and it is not the test being unlucky', () => {
  // Found by CI on the first run of this file, at 1.069, and characterised since over 200 offsets:
  // the clap runs 0.587 to 1.179, median 0.749, mean 0.759, and crosses full scale on 2 of the 200
  // — one percent of the hits. Its trim is set from that mean and is correct on that basis, which
  // is exactly why nothing had noticed: the voice is right on average and over full scale at the
  // top of its own distribution.
  //
  // The cause is structural rather than a mistake. A clap is several noise bursts a few
  // milliseconds apart, each starting at its own offset into the shared buffer; when those offsets
  // happen to line up the bursts stop cancelling and start summing. The 909 clap is built the same
  // way and stays under, running 0.708 to 0.933 over the same sweep.
  //
  // NOT fixed here, because the fix is a judgement rather than an edit. Trimming the worst case
  // under 1.0 means scaling by about 0.87, which drops the clap's mean to 0.69 and puts it below
  // every other voice in the kit — quieter all the time to protect against an offset that comes up
  // rarely. And `docs/VERIFYING-AUDIO.md` is explicit that the trims were measured against each
  // other, so moving one is a recalibration of all twenty-two rather than a one-line change.
  //
  // So this pins the behaviour instead: it fails if the clap gets worse, and it fails if somebody
  // fixes it without updating the story here.

  it('peaks past full scale on some offsets, and no worse than it does today', async () => {
    const voice = ALL_VOICES.find((v) => v.id === CLIPS)!
    // Its own sweep rather than the twenty-five in `beforeAll`: the tail is the whole point of this
    // test, and it needs more of the distribution than the band and spread do. Nothing has to be
    // reset first — the offsets are a function of the hit times below and of nothing else, so this
    // measures the same thing whatever ran before it and however many voices the kit contains.
    const p = await peaks(voice, 200)
    const worst = Math.max(...p)

    // 1.179 over these 200 variants. Asserted from both sides on purpose — the upper bound catches
    // the clap getting louder, and the lower one catches this test quietly stopping to sample the
    // tail it exists to measure, which is how it would rot into a test of nothing.
    expect(worst).toBeGreaterThan(1)
    expect(worst).toBeLessThan(1.25)
  }, 60_000)
})

describe('a voice decays like the instrument it is imitating', () => {
  // Three claims the doc makes in a sentence — "a kick decays in a few hundred milliseconds, a
  // closed hat in tens, a crash in over a second". They are worth asserting because the failure
  // they guard is not a crash or a wrong number, it is a hat that rings like a cymbal, which
  // nothing else in this suite can tell you about.

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
