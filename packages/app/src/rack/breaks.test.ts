import { MODULES } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import { BREAKS, barSamples, breakById } from './breaks.js'

// The breaks are the answer to "where does the sampler's content come from without a licence question", so what
// matters is that they are exactly one bar at their stated tempo — because that is the only thing that makes
// sixteen equal slices line up with sixteen sixteenths. Everything else about a break is taste.
//
// `renderStems` renders through an OfflineAudioContext, which Node does not have. It takes an injectable factory
// for exactly this reason, and there is no stub of Web Audio worth writing here — so the rendering itself is
// checked in a browser and what is checked here is the arithmetic and the definitions.

describe('the break definitions', () => {
  it('are all exactly sixteen steps, which is what makes slicing line up', () => {
    // A break that was seventeen steps long would put every slice boundary in the wrong place, and the symptom
    // would be a chop that drifts further out of time the further into the bar it gets.
    for (const entry of BREAKS) {
      for (const [voiceId, line] of Object.entries(entry.tracks)) {
        const written = line.replace(/\s/g, '').length
        expect(written, `${entry.id} ${voiceId}`).toBe(16)
      }
    }
  })

  it('only name voices the engine actually has', () => {
    // A typo in a voice id renders silence for that line, and silence is indistinguishable from a rest.
    for (const entry of BREAKS) {
      for (const voiceId of Object.keys(entry.tracks)) {
        expect(voiceId, `${entry.id}`).toMatch(/^909\./)
      }
    }
  })

  it('use only the notation characters the engine understands', () => {
    // Anything else is read as a rest, so a `o` meant as an open hat would silently be nothing.
    for (const entry of BREAKS) {
      for (const [voiceId, line] of Object.entries(entry.tracks)) {
        expect(line.replace(/[Xx.\s]/g, ''), `${entry.id} ${voiceId}`).toBe('')
      }
    }
  })

  it('are all at a drum-and-bass tempo', () => {
    for (const entry of BREAKS) {
      expect(entry.tempo).toBeGreaterThanOrEqual(160)
      expect(entry.tempo).toBeLessThanOrEqual(180)
    }
  })

  it('have unique ids and names, and something to say about themselves', () => {
    expect(new Set(BREAKS.map((b) => b.id)).size).toBe(BREAKS.length)
    expect(new Set(BREAKS.map((b) => b.name)).size).toBe(BREAKS.length)
    for (const entry of BREAKS) {
      expect(entry.blurb.length).toBeGreaterThan(10)
      expect(entry.blurb.length).toBeLessThan(60)
    }
  })

  it('are found by id, and nothing by a wrong one', () => {
    expect(breakById('jungle')?.name).toBe('Jungle')
    expect(breakById('nonesuch')).toBeUndefined()
  })

  it('differ from each other rather than being one beat three times', () => {
    // Three variations of the same bar would demonstrate nothing. The kick lines in particular have to disagree.
    const kicks = BREAKS.map((b) => b.tracks['909.bd'])
    expect(new Set(kicks).size).toBe(BREAKS.length)
  })
})

describe('the length a break has to be', () => {
  // The only part of rendering worth testing in Node, and the part everything else rests on. Stubbing
  // OfflineAudioContext was the first attempt: the stub grew a method every time the engine's effects chain
  // touched one, and what it would have proved is that the stub was complete rather than that the render was
  // right. The render itself is checked in a browser, where a real OfflineAudioContext exists.

  it('is one bar at the break\u2019s own tempo', () => {
    // 174bpm, four beats to a bar: 1.379 seconds.
    expect(barSamples(174, 44100)).toBe(60828)
    expect(barSamples(174, 44100) / 44100).toBeCloseTo(1.379, 3)
    expect(barSamples(174, 48000)).toBe(66207)
  })

  it('scales the way tempo does', () => {
    // Twice the tempo, half the bar. Getting this inverted would render a break at half speed and everything
    // downstream would still line up, which is the sort of wrong that survives a long time.
    //
    // Within a sample rather than exactly, because rounding does not compose: round(x/87) is 121655 and
    // 2 * round(x/174) is 121656. Both are right; asserting they are equal was not.
    expect(Math.abs(barSamples(87, 44100) - barSamples(174, 44100) * 2)).toBeLessThanOrEqual(1)
    expect(barSamples(120, 44100)).toBe(88200)
  })

  it('puts every sixteenth boundary within a sample of where the beat is', () => {
    // Not exactly integral in general, and it does not need to be — what matters is that the sampler's
    // `floor(index * perSlice)` never lands a slice more than a sample away from the beat.
    for (const entry of BREAKS) {
      for (const rate of [44100, 48000]) {
        const perSlice = barSamples(entry.tempo, rate) / 16
        for (let i = 0; i <= 16; i++) {
          expect(Math.abs(Math.floor(i * perSlice) - i * perSlice)).toBeLessThan(1)
        }
      }
    }
  })
})

describe('the sampler and the breaks agree', () => {
  it('slices by the same count the break has steps', () => {
    // Sixteen is the sampler's default and sixteen is a bar of sixteenths. If either moved, a freshly dropped
    // sampler would chop a break into something other than its own steps.
    const slices = MODULES.sampler.params.find((p) => p.id === 'slices')!
    expect(slices.default).toBe(16)
    for (const entry of BREAKS) {
      expect(Object.values(entry.tracks)[0].replace(/\s/g, '').length).toBe(slices.default)
    }
  })
})
