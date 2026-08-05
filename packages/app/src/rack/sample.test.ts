import { describe, expect, it } from 'vitest'
import {
  guessBars,
  normalise,
  previewSampleRate,
  sampleName,
  tempoForBars,
  toMono,
  waveformPeaks,
} from './sample.js'

// Loading somebody's own break. The whole thing turns on one question — how long is a bar of this file —
// because the Sampler slices by equal division and a chop only lands on the beat if the answer is right.

describe('deriving a tempo from a file', () => {
  it('is the tempo at which the file is exactly that many bars', () => {
    // One bar of four beats in 1.379 seconds is 174bpm, which is where the shipped breaks live.
    expect(tempoForBars(1.3793, 1)).toBeCloseTo(174, 1)
    expect(tempoForBars(2, 1)).toBe(120)
    expect(tempoForBars(4, 2)).toBe(120)
  })

  it('halves when the same file is called twice as many bars', () => {
    // The one mistake this can make, and it is out by exactly a factor of two — which is why the bar count
    // is worth guessing well and worth showing.
    expect(tempoForBars(2, 2)).toBe(tempoForBars(2, 1) * 2)
  })

  it('refuses to divide by nothing', () => {
    // A zero-length decode or a silly bar count should give a number the caller can reject, not NaN or
    // Infinity leaking into the patch's tempo where it would be saved and shared.
    for (const [duration, bars] of [[0, 1], [2, 0], [-1, 1], [2, -4]]) {
      const tempo = tempoForBars(duration, bars)
      expect(Number.isFinite(tempo)).toBe(true)
      expect(tempo).toBe(0)
    }
  })
})

describe('guessing how many bars a file is', () => {
  it('picks one bar for a one-bar loop at the patch’s tempo', () => {
    // Somebody dropping a break into a 174bpm patch has a 174bpm break. That assumption is what makes the
    // guess right nearly always.
    expect(guessBars(1.3793, 174)).toBe(1)
  })

  it('picks two bars for a two-bar loop', () => {
    expect(guessBars(2.7586, 174)).toBe(2)
    expect(guessBars(4, 120)).toBe(2)
  })

  it('picks four and eight for longer loops', () => {
    expect(guessBars(5.5172, 174)).toBe(4)
    expect(guessBars(11.03, 174)).toBe(8)
  })

  it('compares tempos as ratios rather than differences', () => {
    // Tempo is heard as a ratio, so 87 is exactly as far from 174 as 348 is. Comparing differences would
    // make the slower guess always look closer and the guess would be biased to too few bars.
    //
    // A file that is 1.5 bars at 174: one bar implies 116, two implies 232. In ratio those are 0.58 and
    // 0.42 of an octave, so two bars wins. By difference, 174-116=58 beats 232-174=58 only on a tie —
    // and for anything slightly longer the linear comparison picks wrong.
    const duration = (1.5 * 4 * 60) / 174
    expect(guessBars(duration, 174)).toBe(2)
  })

  it('always returns a usable count for a file it cannot make sense of', () => {
    for (const duration of [0, -3, 0.0001, 600]) {
      const bars = guessBars(duration, 174)
      expect(bars).toBeGreaterThan(0)
      expect(Number.isInteger(bars)).toBe(true)
    }
  })

  it('lands the sampler’s slice boundaries on the beat, which is the point', () => {
    // The claim the whole file rests on: with the derived tempo, sixteen equal slices of the buffer are
    // sixteen sixteenths of a bar. Checked the way `breaks.test.ts` checks its own arithmetic.
    const rate = 44100
    for (const [duration, bars] of [[1.3793, 1], [2.7586, 2], [3.1, 1]]) {
      const tempo = tempoForBars(duration, bars)
      const perBar = (rate * 60 * 4) / tempo
      const frames = Math.round(duration * rate)
      // The buffer is exactly `bars` of those, to within a sample of rounding.
      expect(Math.abs(frames - perBar * bars)).toBeLessThan(2)
    }
  })
})

describe('preparing the samples', () => {
  /** A stand-in for an AudioBuffer: only the three members `toMono` touches. */
  const fakeBuffer = (channels: number[][]) => ({
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData: (i: number) => Float32Array.from(channels[i]),
  }) as unknown as AudioBuffer

  it('averages channels rather than adding them', () => {
    // Two channels summed at full level is 6dB of gain nobody asked for, and on a break that is the
    // difference between fitting in the mix and burying it.
    const mono = toMono(fakeBuffer([[1, 0.5, 0], [1, 0.5, 0]]))
    expect([...mono]).toEqual([1, 0.5, 0])
  })

  it('keeps a mono file as it is', () => {
    // Compared loosely because these make the round trip through a Float32Array, where 0.2 comes back as
    // 0.20000000298023224. Asserting exact equality on a float that is not a power of two was the test
    // being wrong, not the sum.
    const mono = toMono(fakeBuffer([[0.2, -0.4]]))
    expect(mono[0]).toBeCloseTo(0.2, 6)
    expect(mono[1]).toBeCloseTo(-0.4, 6)
  })

  it('survives a buffer with no channels at all', () => {
    expect(toMono(fakeBuffer([])).length).toBe(0)
  })

  it('normalises to just under full scale', () => {
    // Somebody's own file could be mastered anywhere. A break that arrives at a predictable level is one
    // whose channel fader means the same thing from one break to the next.
    const quiet = normalise(Float32Array.from([0.1, -0.05, 0.02]))
    expect(Math.max(...[...quiet].map(Math.abs))).toBeCloseTo(0.9, 6)

    const loud = normalise(Float32Array.from([2, -3, 1]))
    expect(Math.max(...[...loud].map(Math.abs))).toBeCloseTo(0.9, 6)
  })

  it('leaves silence alone rather than dividing by zero', () => {
    const silent = normalise(new Float32Array(8))
    for (const x of silent) expect(x).toBe(0)
  })

  it('reduces audio to a normalised waveform overview', () => {
    const peaks = waveformPeaks(Float32Array.from([0, 0.25, -0.5, 0, 1, 0.5, 0, -0.25]), 4)
    expect(peaks).toHaveLength(4)
    expect(peaks).toEqual([0.25, 0.5, 1, 0.25])
  })

  it('keeps an empty waveform displayable', () => {
    expect(waveformPeaks(new Float32Array(), 3)).toEqual([0, 0, 0])
  })

  it('names a patch after the file it came from', () => {
    expect(sampleName('Amen Break.wav')).toBe('Amen Break')
    expect(sampleName('think.aiff')).toBe('think')
    expect(sampleName('no-extension')).toBe('no-extension')
    // A file called nothing but an extension still has to produce a name.
    expect(sampleName('.wav')).toBe('sample')
  })
})

// Auditioning a loaded file means putting it back into a buffer, and a buffer needs the rate it was
// decoded at. That rate is not kept — only the frames and the seconds they lasted — so it is recovered by
// division, and the wrong answer here changes the length and the pitch of everything anybody loaded.
describe('auditioning a retained sample', () => {
  it('recovers the rate it was decoded at', () => {
    expect(previewSampleRate(44100, 1)).toBe(44100)
    expect(previewSampleRate(96000, 2)).toBe(48000)
    // Two bars of a 174bpm break at 48kHz, to the frame.
    expect(previewSampleRate(132414, 132414 / 48000)).toBe(48000)
  })

  it('stays inside what createBuffer will accept, whatever it is handed', () => {
    // A click handler must not throw because a duration was recorded as zero or missing.
    expect(previewSampleRate(1000, 0)).toBe(44100)
    expect(previewSampleRate(1000, -1)).toBe(44100)
    expect(previewSampleRate(0, 1)).toBe(3_000)
    expect(previewSampleRate(44100, 0.0001)).toBe(192_000)
  })
})
