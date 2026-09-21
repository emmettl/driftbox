import { describe, expect, it } from 'vitest'
import { AUTOMATION_TARGET, setAutomationPoint } from './automation.js'
import { Bassline } from './bassline.js'
import { DEFAULT_FX } from './effects.js'
import { MIX_BUS_GAIN } from './master.js'
import { songBars } from './pattern.js'
import { planSong } from './schedule.js'
import { acidSong, defaultSong } from './songs/index.js'
import { renderMix, renderStems } from './stems.js'

describe('stem preview windows', () => {
  it('renders only the requested window plus its tail', async () => {
    const song = acidSong()
    const hit = planSong(song, songBars(song)).flatMap((step) => step.drums)[0]
    const start = Math.max(0, hit.time - 0.25)
    const [stem] = await renderStems(song, {
      only: [hit.voiceId],
      start,
      duration: 1,
      tail: 0.25,
      sampleRate: 8000,
      useLadder: false,
    })

    expect(stem.voiceId).toBe(hit.voiceId)
    expect(stem.buffer.duration).toBeCloseTo(1.25, 2)
    const signal = stem.buffer.getChannelData(0)
    expect(signal.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
  })
})

describe('mastered song mix', () => {
  it('renders a stereo window through the complete authored bus', async () => {
    const buffer = await renderMix(acidSong(), {
      // The two-bar intro is deliberately centred; the panned clap and open hat arrive
      // in the Acid section after it.
      duration: 5,
      tail: 0.25,
      sampleRate: 8000,
      useLadder: false,
    })

    expect(buffer.numberOfChannels).toBe(2)
    expect(buffer.duration).toBeCloseTo(5.25, 2)
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    expect(left.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
    expect(right.some((sample) => Math.abs(sample) > 0.001)).toBe(true)
    // The acid song pans its clap, hats and rim. Identical channels would mean the
    // offline route collapsed the stereo panners before writing the file.
    expect(left.some((sample, index) => Math.abs(sample - right[index]) > 0.00001)).toBe(true)
  })

  it('applies global effect automation at its offline song time', async () => {
    const seed = defaultSong()
    const rest = { note: null, accent: false, slide: false }
    const song = {
      ...seed,
      patterns: [{
        id: 'echo',
        name: 'Echo',
        length: 4,
        tracks: {},
        bass: {
          '303.a': [
            { note: 0, accent: false, slide: false },
            rest,
            rest,
            rest,
          ],
        },
      }],
      chain: [{ pattern: 'echo', repeat: 1 }],
      kit: {
        ...seed.kit,
        sends: { '303.a': { delay: 1, reverb: 0 } },
      },
      fx: { ...(seed.fx ?? DEFAULT_FX), delayFeedback: 0 },
    }
    const automated = setAutomationPoint(
      song,
      AUTOMATION_TARGET.fx('delayFeedback'),
      0,
      1,
      1,
    )
    const options = { tail: 1, sampleRate: 8000, useLadder: false }
    const [dryEcho, repeatingEcho] = await Promise.all([
      renderMix(song, options),
      renderMix(automated, options),
    ])
    const tailAt = Math.floor(0.6 * options.sampleRate)
    const energy = (buffer: AudioBuffer) =>
      buffer.getChannelData(0).slice(tailAt).reduce((sum, sample) => sum + Math.abs(sample), 0)

    expect(energy(repeatingEcho)).toBeGreaterThan(energy(dryEcho) * 1.5)
  })
})

describe('303 stems', () => {
  // `Bassline.play` cancels each param from the new note's time before scheduling it, and a
  // ramp's event time is its END — so a note that starts before the previous note's filter
  // decay has finished cancels that decay's ramp outright. Scheduled from the render quantum
  // the note falls in, the ramp has already played and nothing audible is lost. Scheduled
  // before `startRendering()`, every cancel lands before anything has rendered, the ramps go
  // retroactively, and the cutoff sits flat at each note's peak instead of sweeping. The stem
  // render did the second thing while the mix did the first, so a stem of an acid line was not
  // the line in the mix.
  it('sweeps the filter on notes whose decay overlaps the next note, as the mix does', async () => {
    const SR = 48000
    const seed = acidSong()
    // Dry, so the reference below needs nothing but the 303 and the bus gain.
    const song = {
      ...seed,
      kit: { ...seed.kit, sends: { ...seed.kit.sends, '303.a': { delay: 0, reverb: 0 } } },
    }
    const plan = planSong(song, songBars(song))
    const bar = plan[0].stepSeconds * 16
    const start = bar * 8
    const duration = bar * 2
    const tail = 0.5

    const hits = plan
      .flatMap((step) => step.bass)
      .filter((hit) => hit.voiceId === '303.a')
      .map((hit) => ({ ...hit, time: hit.time - start }))
      .filter((hit) => hit.time >= 0 && hit.time < duration)
    // The precondition: this window is only a test of anything if decays really do overlap.
    // Here the decay is one step long, so it is the swing that does it — a note pulled a
    // couple of milliseconds early lands inside the decay of the note before it.
    const overlapping = hits.filter((hit, index) => {
      const next = hits[index + 1]
      return hit.note.retrigger && next && next.time <= hit.time + hit.note.filter.decay
    })
    expect(overlapping.length).toBeGreaterThanOrEqual(4)
    expect(hits.every((hit) => hit.sends.delay === 0 && hit.sends.reverb === 0)).toBe(true)

    const [stem] = await renderStems(song, { only: ['303.a'], start, duration, tail, sampleRate: SR })

    // The reference: the same notes on a bare 303, each scheduled from a suspension at the
    // render quantum it falls in — written out here rather than shared with `stems.ts`, so
    // that it checks the scheduling instead of agreeing with it.
    const ctx = new OfflineAudioContext(1, Math.ceil((duration + tail) * SR), SR)
    const { bassline, usingLadder } = await Bassline.create(ctx)
    expect(usingLadder).toBe(true)
    const bus = ctx.createGain()
    bus.gain.value = MIX_BUS_GAIN
    bassline.output.connect(bus)
    bus.connect(ctx.destination)
    const byQuantum = new Map<number, typeof hits>()
    for (const hit of hits) {
      const quantum = Math.floor((hit.time * SR) / 128)
      byQuantum.set(quantum, [...(byQuantum.get(quantum) ?? []), hit])
    }
    const suspensions: Promise<void>[] = []
    for (const [quantum, group] of byQuantum) {
      const schedule = () => { for (const hit of group) bassline.play(hit.note, hit.time) }
      if (quantum <= 0) schedule()
      else suspensions.push(ctx.suspend((quantum * 128) / SR).then(() => { schedule(); return ctx.resume() }))
    }
    const rendering = ctx.startRendering()
    await Promise.all(suspensions)
    const expected = (await rendering).getChannelData(0)

    const actual = stem.buffer.getChannelData(0)
    expect(actual.length).toBe(expected.length)
    let peak = 0
    let worst = 0
    for (let i = 0; i < expected.length; i++) {
      peak = Math.max(peak, Math.abs(expected[i]))
      worst = Math.max(worst, Math.abs(actual[i] - expected[i]))
    }
    expect(peak).toBeGreaterThan(0.05)
    // Identical graphs scheduled identically; anything above rounding is a different sweep.
    // Before the fix this was 0.35 against a peak of 0.40.
    expect(worst).toBeLessThan(peak * 1e-3)
  })
})
