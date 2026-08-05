import { describe, expect, it } from 'vitest'
import { REVERB_MODULE, ReverbProcessor } from './reverb.js'

// A reverb is judged by ear and tested by property. What is worth asserting is that it is a room and not an
// oscillator: it rings on after the input stops, it always dies away, it does not ring at one period, and it
// gets darker as it decays. Those are the four ways an FDN goes wrong.

const SR = 44100
/** Every param, in def order, so the harness cannot fall behind a device that grows a section. It did
 *  once: this was a hand-written list of four while the processor had grown to eleven, and the failure was
 *  an undefined read rather than anything that named the missing knob. */
const ORDER = REVERB_MODULE.params.map((param) => param.id)

type Options = Record<string, number | undefined>

/**
 * Feed a signal in and hand back both channels. Rendered in one call, which the processor allows.
 *
 * The outlet is stereo, so this allocates two. Everything below that asks about "the reverb" asks the LEFT
 * channel, deliberately: it is arithmetically the mono output this module had before it had two, and these
 * properties are about the network rather than about the width.
 */
function both(signal: (i: number) => number, frames: number, options: Options = {}) {
  const processor = new ReverbProcessor(SR)
  const input = Float32Array.from({ length: frames }, (_, i) => signal(i))
  const params = ORDER.map((id) => {
    const def = REVERB_MODULE.params.find((p) => p.id === id)!
    return new Float32Array(frames).fill(options[id] ?? def.default)
  })
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  processor.process([input], [left, right], params, frames)
  return { left, right }
}

function run(signal: (i: number) => number, frames: number, options: Options = {}) {
  return both(signal, frames, options).left
}

/** An impulse: one sample, then silence. Everything after it is the reverb's own doing. */
const impulse = (i: number) => (i === 0 ? 1 : 0)

const rms = (data: Float32Array, from: number, to: number) => {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / (to - from))
}

const SECOND = SR

describe('the reverb', () => {
  it('rings on long after the input has stopped', () => {
    // The whole point, and the thing a delay line alone does not do: one sample in, a tail out.
    const out = run(impulse, SECOND, { mix: 1, decay: 0.9 })
    // A tenth of a second in, well past every delay line's own length, there is still something there.
    expect(rms(out, Math.round(0.1 * SR), Math.round(0.15 * SR))).toBeGreaterThan(1e-4)
  })

  it('always dies away, at every decay setting', () => {
    // The failure that matters: a feedback network that gains energy is an oscillator that will not stop, and
    // on a master bus it would be the last thing anybody heard. The Householder matrix is unitary and the
    // decay is capped below 1 precisely so this cannot happen.
    for (const decay of [0, 0.5, 0.9, 0.98, 5]) {
      const out = run(impulse, 3 * SECOND, { mix: 1, decay })
      const early = rms(out, Math.round(0.05 * SR), Math.round(0.1 * SR))
      const late = rms(out, Math.round(2.5 * SR), Math.round(2.9 * SR))
      expect(late, `decay ${decay}`).toBeLessThan(Math.max(early, 1e-9))
    }
  })

  it('rings longer the higher the decay', () => {
    const at = (decay: number) =>
      rms(run(impulse, SECOND, { mix: 1, decay }), Math.round(0.3 * SR), Math.round(0.4 * SR))
    expect(at(0.9)).toBeGreaterThan(at(0.5))
    expect(at(0.5)).toBeGreaterThan(at(0.1))
  })

  it('builds up echo density instead of repeating once per line', () => {
    // What the mixing matrix buys. Eight delay lines without it are eight separate echoes; with it, every
    // line feeds every other and the count multiplies each pass. Counted as how many samples are meaningfully
    // non-zero in a window well after the first round trip — a handful of discrete echoes would be sparse.
    //
    // This is the assertion that sent the reverb from four lines to eight: at four it came back as 0.12, and
    // a fifth of a second into a tail that is a rattle rather than a room.
    const out = run(impulse, SECOND, { mix: 1, decay: 0.9, damp: 0 })
    const from = Math.round(0.2 * SR)
    const to = Math.round(0.25 * SR)
    const level = rms(out, from, to)
    let busy = 0
    for (let i = from; i < to; i++) if (Math.abs(out[i]) > level * 0.25) busy++
    // More than a fifth of the window is doing something. A few discrete echoes would light up a few dozen
    // samples out of two thousand.
    expect(busy / (to - from)).toBeGreaterThan(0.2)
  })

  it('does not ring at one period, which is what a bad reverb sounds like', () => {
    // Delay lengths sharing a factor stack their echoes and the tail rings at that period — the metallic
    // sound. Tested by autocorrelation: if the tail were periodic there would be a strong peak at the lag of
    // that period, and there is not.
    const out = run(impulse, SECOND, { mix: 1, decay: 0.92, damp: 0 })
    const from = Math.round(0.15 * SR)
    const window = 4096
    const energy = rms(out, from, from + window)

    let strongest = 0
    // Lags from 1ms to 50ms, which covers every delay length here and their small multiples.
    for (let lag = Math.round(0.001 * SR); lag < Math.round(0.05 * SR); lag += 8) {
      let sum = 0
      for (let i = 0; i < window; i++) sum += out[from + i] * out[from + i + lag]
      const correlation = Math.abs(sum / window) / (energy * energy)
      if (correlation > strongest) strongest = correlation
    }
    // A periodic tail correlates with itself near 1 at its period. Anything well under that is noise-like,
    // which is what a room is.
    expect(strongest).toBeLessThan(0.5)
  })

  it('gets darker as it decays rather than merely being dark', () => {
    // Damping lives in the feedback path so it compounds with each pass, which is what a room does — the
    // treble goes first. Measured as high-frequency energy, via the mean absolute difference between
    // neighbouring samples relative to the level.
    const brightness = (data: Float32Array, from: number, to: number) => {
      let diff = 0
      for (let i = from + 1; i < to; i++) diff += Math.abs(data[i] - data[i - 1])
      return diff / (to - from) / Math.max(rms(data, from, to), 1e-12)
    }
    const out = run(impulse, SECOND, { mix: 1, decay: 0.92, damp: 0.7 })
    const early = brightness(out, Math.round(0.05 * SR), Math.round(0.1 * SR))
    const late = brightness(out, Math.round(0.4 * SR), Math.round(0.5 * SR))
    expect(late).toBeLessThan(early)
  })

  it('passes the dry signal through untouched at a mix of zero', () => {
    // A reverb dropped into a chain and left alone must not change the sound. Exactly, not approximately —
    // the mix is a crossfade and at zero the wet side contributes nothing at all.
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const out = run(tone, 2048, { mix: 0 })
    for (let i = 0; i < 2048; i++) expect(out[i]).toBeCloseTo(tone(i), 6)
  })

  it('crossfades the dry signal out rather than adding the wet on top', () => {
    // A wet/dry that summed would make the mix knob a volume knob as well.
    //
    // Tested on the FIRST sample of an impulse, which is the one place the two can be told apart exactly: no
    // delay line has been written yet, so the wet side is precisely zero and the output is the dry
    // coefficient alone. The first version of this compared the RMS of a sustained tone at each mix setting
    // and asserted the wet was never louder — which is false, and not a bug: a room sustaining a continuous
    // tone builds up, and its steady-state level is higher than the direct sound. That is reverb.
    for (const mix of [0, 0.25, 0.5, 1]) {
      expect(run(impulse, 64, { mix })[0]).toBeCloseTo(1 - mix, 6)
    }
  })

  it('builds up on a sustained tone, because that is what a room does', () => {
    // The other half of the correction above, stated as the property it actually is.
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const dry = rms(run(tone, SECOND, { mix: 0 }), 0, SECOND)
    const wet = rms(run(tone, SECOND, { mix: 1, decay: 0.9 }), Math.round(0.5 * SR), SECOND)
    expect(wet).toBeGreaterThan(dry)
  })

  it('makes a bigger room out of a bigger size', () => {
    // Size shortens every line by the same fraction, so a small room's echoes arrive sooner. Measured as
    // when the output first becomes non-trivial after the impulse.
    const firstEcho = (size: number) => {
      const out = run(impulse, SECOND, { mix: 1, size, decay: 0.9 })
      for (let i = 1; i < out.length; i++) if (Math.abs(out[i]) > 1e-3) return i
      return out.length
    }
    expect(firstEcho(1)).toBeGreaterThan(firstEcho(0.3))
  })

  it('survives being swept, which is a good noise and an easy crash', () => {
    // Size is read per sample so the room can be swept. Changing the read position of a delay line while it
    // is running is exactly where an index runs off the end of its buffer.
    const processor = new ReverbProcessor(SR)
    const frames = SECOND
    const input = Float32Array.from({ length: frames }, (_, i) => (i % 4410 === 0 ? 1 : 0))
    const params = ORDER.map((id) => {
      const def = REVERB_MODULE.params.find((p) => p.id === id)!
      return new Float32Array(frames).fill(def.default)
    })
    // A full sweep of size across the block, and mix wide open so nothing is hidden by the dry signal.
    for (let i = 0; i < frames; i++) params[0][i] = 0.1 + 0.9 * (i / frames)
    params[3].fill(1)
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    processor.process([input], [left, right], params, frames)
    for (const x of left) expect(Number.isFinite(x)).toBe(true)
    for (const x of right) expect(Number.isFinite(x)).toBe(true)
  })

  it('stays finite when its knobs are driven outside their range', () => {
    // Nothing stops a patch file carrying a decay of 5 or a size of −1, and a feedback network is where a
    // bad number becomes an infinity that silences an AudioNode for the life of the context.
    for (const options of [
      { decay: 5, size: -1, damp: 5, mix: 5 },
      { decay: -3, size: 0, damp: -1, mix: -1 },
    ]) {
      const out = run(impulse, 8192, options)
      for (const x of out) expect(Number.isFinite(x)).toBe(true)
    }
  })
})

describe('the reverb in stereo', () => {
  // One network, two output mixing vectors — the standard way an FDN is made stereo, and the reason the
  // left channel can stay arithmetically what it was when this module had only one outlet.

  const correlation = (a: Float32Array, b: Float32Array, from: number, to: number) => {
    let ab = 0
    let aa = 0
    let bb = 0
    for (let i = from; i < to; i++) {
      ab += a[i] * b[i]
      aa += a[i] * a[i]
      bb += b[i] * b[i]
    }
    return ab / Math.sqrt(Math.max(aa * bb, 1e-30))
  }

  it('is identical on both channels with no wet signal at all', () => {
    // The dry half is the same mono input on both sides, so "no effect" means what it says. A reverb that
    // widened at a mix of zero would be a reverb you could not switch off.
    const { left, right } = both((i) => Math.sin(i / 20), SECOND / 4, { mix: 0 })
    expect([...right]).toEqual([...left])
  })

  it('sends a different tail to each channel', () => {
    const { left, right } = both(impulse, SECOND, { mix: 1, decay: 0.9 })
    const from = Math.round(0.05 * SR)
    const to = Math.round(0.5 * SR)
    // Uncorrelated rather than merely unequal: an alternating sign over the same taps has no reason to
    // favour one parity, so the two tails should share almost nothing.
    expect(Math.abs(correlation(left, right, from, to))).toBeLessThan(0.2)
  })

  it('carries the same energy on both channels', () => {
    // The other half of the choice. Splitting the eight lines four and four would also decorrelate, and it
    // would give each side half the echo density — audibly sparser than the mono version was. Every line
    // is in both channels here, so neither side is the poor relation.
    const { left, right } = both(impulse, SECOND, { mix: 1, decay: 0.9 })
    const from = Math.round(0.05 * SR)
    const to = Math.round(0.5 * SR)
    const energy = (data: Float32Array) => rms(data, from, to)
    expect(energy(right)).toBeGreaterThan(energy(left) * 0.5)
    expect(energy(right)).toBeLessThan(energy(left) * 2)
  })

  it('keeps the left channel as the mono reverb it always was', () => {
    // Patched into anything mono this folds to its left channel, so this is the promise that a patch
    // written before the outlet was stereo sounds the same. Asserted as the mean of the taps, which is the
    // arithmetic that was there before — the right channel is the same taps signed.
    const { left, right } = both(impulse, SECOND, { mix: 1, decay: 0.9 })
    // The first tap to arrive comes from the shortest line, and reaches both channels with the same sign,
    // because line 0 is positive in both vectors.
    const first = left.findIndex((x) => Math.abs(x) > 1e-6)
    expect(first).toBeGreaterThan(0)
    expect(right[first]).toBeCloseTo(left[first], 12)
  })
})

describe('the algorithms', () => {
  /**
   * The reverb exactly as it was before it had algorithms, transcribed.
   *
   * This is the strongest check available and the only one worth making about compatibility: "sounds about
   * the same" is not a promise, and every other test in this file would go on passing if Room had drifted
   * by a hair. Kept as a literal transcription rather than a refactor of the real one on purpose — a shared
   * helper would drift with it and prove nothing.
   *
   * It reads its input and its knobs out of `Float32Array`s rather than taking them as numbers, which is
   * not fussiness: the real processor is handed Float32 param buffers, so a decay of 0.9 reaches it as
   * 0.89999997615814209. Comparing against a reference that used the float64 0.9 produced a mismatch in the
   * eighth decimal place and looked exactly like a bug in the reverb.
   */
  function legacy(signal: (i: number) => number, frames: number, options: Options = {}): Float32Array {
    const buffer = (id: string) =>
      new Float32Array(frames).fill(
        options[id] ?? REVERB_MODULE.params.find((p) => p.id === id)!.default,
      )
    const input = Float32Array.from({ length: frames }, (_, i) => signal(i))
    const sizeParam = buffer('size')
    const decayParam = buffer('decay')
    const dampParam = buffer('damp')
    const mixParam = buffer('mix')

    const primes = [1327, 1543, 1873, 2053, 2399, 2687, 2927, 3271]
    const lengths = primes.map((samples) => {
      const scaled = Math.max(1, Math.round((samples * SR) / 44100))
      return scaled % 2 === 0 ? scaled + 1 : scaled
    })
    const lines = lengths.map((length) => new Float32Array(length))
    const write = lengths.map(() => 0)
    const damped = lengths.map(() => 0)
    const taps = lengths.map(() => 0)
    const count = lines.length
    const out = new Float32Array(frames)

    for (let i = 0; i < frames; i++) {
      const damp = dampParam[i] < 0 ? 0 : dampParam[i] > 0.99 ? 0.99 : dampParam[i]
      let size = sizeParam[i]
      if (size < 0.1) size = 0.1
      else if (size > 1) size = 1

      let sum = 0
      for (let line = 0; line < count; line++) {
        const line_ = lines[line]
        let at = write[line] - Math.max(1, Math.round(lengths[line] * size))
        if (at < 0) at += line_.length
        const tap = line_[at]
        taps[line] = tap
        sum += tap
      }

      let decay = decayParam[i]
      if (decay < 0) decay = 0
      else if (decay > 0.98) decay = 0.98

      const share = (2 * sum) / count
      const sample = input[i]
      let wet = 0
      for (let line = 0; line < count; line++) {
        const mixed = taps[line] - share
        damped[line] = mixed + (damped[line] - mixed) * damp
        const line_ = lines[line]
        line_[write[line]] = sample + damped[line] * decay
        write[line]++
        if (write[line] >= line_.length) write[line] = 0
        wet += taps[line]
      }
      wet /= count
      let mix = mixParam[i]
      if (mix < 0) mix = 0
      else if (mix > 1) mix = 1
      out[i] = sample * (1 - mix) + wet * mix
    }
    return out
  }

  it('leaves Room bit-identical to the reverb that existed before algorithms', () => {
    // Not "close to" — equal. Every saved patch defaults to Room with the EQ and the gate off, so anything
    // less than equality here means this release quietly re-voiced somebody's track.
    const tone = (i: number) => 0.4 * Math.sin(i / 7) + 0.2 * Math.sin(i / 3.1)
    for (const options of [
      {},
      { mix: 1, decay: 0.9 },
      { mix: 0.5, size: 0.35, damp: 0.8, decay: 0.95 },
    ]) {
      expect([...run(tone, 8192, options)]).toEqual([...legacy(tone, 8192, options)])
      expect([...run(impulse, 8192, options)]).toEqual([...legacy(impulse, 8192, options)])
    }
  })

  it('leaves Room bit-identical with the new knobs asked for at their defaults', () => {
    // The branches that skip the EQ and the gate are what make the promise above true, and a one-pole at
    // 20Hz is not a wire. This is the test that fails if either section is ever run flat rather than
    // stepped past.
    const options = { mix: 1, decay: 0.9, algorithm: 0, lowCut: 20, highCut: 18000, gate: 0 }
    expect([...run(impulse, 8192, options)]).toEqual([...legacy(impulse, 8192, { mix: 1, decay: 0.9 })])
  })

  it('makes four genuinely different tails', () => {
    // Different from each other rather than merely different from silence: a selector whose entries were
    // the same network at four sizes would still pass every other assertion here.
    const tails = [0, 1, 2, 3].map((algorithm) =>
      run(impulse, SECOND, { mix: 1, decay: 0.9, damp: 0.2, algorithm }),
    )
    const from = Math.round(0.05 * SR)
    const to = Math.round(0.3 * SR)
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        let ab = 0
        let aa = 0
        let bb = 0
        for (let i = from; i < to; i++) {
          ab += tails[a][i] * tails[b][i]
          aa += tails[a][i] * tails[a][i]
          bb += tails[b][i] * tails[b][i]
        }
        const shared = Math.abs(ab / Math.sqrt(Math.max(aa * bb, 1e-30)))
        expect(shared, `algorithm ${a} against ${b}`).toBeLessThan(0.3)
      }
    }
  })

  it('all of them still die away, and none of them goes non-finite', () => {
    // The property the Householder matrix guarantees, re-asserted per algorithm — because Spring adds
    // allpasses *inside* the feedback path, which is exactly where a unitary argument could be undone by a
    // filter that was not.
    for (const algorithm of [0, 1, 2, 3]) {
      for (const decay of [0.5, 0.98, 5]) {
        const out = run(impulse, 2 * SECOND, { mix: 1, decay, damp: 0, algorithm })
        const early = rms(out, Math.round(0.05 * SR), Math.round(0.1 * SR))
        const late = rms(out, Math.round(1.6 * SR), Math.round(1.9 * SR))
        expect(late, `algorithm ${algorithm} at decay ${decay}`).toBeLessThan(Math.max(early, 1e-9))
        // One assertion for the whole block rather than one per sample: 130,000 expectations per render
        // took this file from two seconds to twelve.
        expect(out.findIndex((x) => !Number.isFinite(x)), `algorithm ${algorithm}`).toBe(-1)
      }
    }
  })

  it('diffuses the attack on Hall and Plate, and does not on Room', () => {
    // What the input allpasses buy, measured as crest factor: an impulse into a bare FDN arrives as a few
    // discrete spikes with silence between them, which is a high peak over a low RMS. Diffused, the same
    // energy is spread and the ratio falls.
    //
    // The window is the first hundred milliseconds rather than the first fifty, and that is not arbitrary:
    // Hall's shortest line is 60ms, so a shorter window measures its diffusion against nothing at all and
    // reports it as *less* dense than Room. Measured at 14.6 for Room against 8.2 and 4.4.
    const crest = (algorithm: number) => {
      const out = run(impulse, SECOND, { mix: 1, decay: 0.9, damp: 0, algorithm })
      const from = 0
      const to = Math.round(0.1 * SR)
      let peak = 0
      for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(out[i]))
      return peak / Math.max(rms(out, from, to), 1e-12)
    }
    const room = crest(0)
    expect(crest(1)).toBeLessThan(room * 0.8)
    expect(crest(2)).toBeLessThan(room * 0.5)
  })

  it('disperses on Spring, so the top of a sound arrives ahead of the bottom', () => {
    // The chirp, and the only test here that isolates it. A one-pole allpass delays low frequencies more
    // than high — four samples at DC against a quarter of one at Nyquist for this coefficient — and the
    // cascade sits INSIDE the loop, so the difference compounds on every pass.
    //
    // Measured as the arrival of a narrow band rather than as a band split of one impulse. That matters:
    // splitting an impulse response into bands and comparing their centroids conflates dispersion with the
    // delay lengths, and reports Hall as the most dispersive algorithm here, which it is not. Two separate
    // bursts through the same network share every length and differ only in frequency.
    const burst = (hz: number) => {
      const length = Math.round(0.01 * SR)
      return (i: number) =>
        i < length
          ? Math.sin((2 * Math.PI * hz * i) / SR) *
            (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length))
          : 0
    }
    const arrival = (hz: number, algorithm: number) => {
      const out = run(burst(hz), SECOND, { mix: 1, decay: 0.9, damp: 0, algorithm })
      let sum = 0
      let weight = 0
      for (let i = Math.round(0.02 * SR); i < Math.round(0.4 * SR); i++) {
        const energy = out[i] * out[i]
        sum += i * energy
        weight += energy
      }
      return (sum / Math.max(weight, 1e-30) / SR) * 1000
    }
    const spread = (algorithm: number) => arrival(200, algorithm) - arrival(4000, algorithm)

    // Room has no allpasses anywhere and comes back at −1.5ms: the two bands arrive together. Spring comes
    // back at +22ms, which is inside the range a real spring tank chirps over.
    expect(Math.abs(spread(0))).toBeLessThan(5)
    expect(spread(3)).toBeGreaterThan(10)
  })
})

describe('the EQ and the gate', () => {
  const bandEnergy = (data: Float32Array, from: number, to: number, frequency: number) => {
    let re = 0
    let im = 0
    for (let i = from; i < to; i++) {
      const phase = (2 * Math.PI * frequency * i) / SR
      re += data[i] * Math.cos(phase)
      im += data[i] * Math.sin(phase)
    }
    return Math.hypot(re, im) / (to - from)
  }

  it('cuts the bottom out of the tail without touching the dry signal', () => {
    // The most reached-for control in fitting a reverb into a mix, and the reason it is on the wet path
    // only: a low cut that also thinned the source would be a filter you could already patch.
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 80 * i) / SR)
    const open = run(tone, SECOND, { mix: 1, decay: 0.9, lowCut: 20 })
    const cut = run(tone, SECOND, { mix: 1, decay: 0.9, lowCut: 1200 })
    const from = Math.round(0.5 * SR)
    expect(bandEnergy(cut, from, SECOND, 80)).toBeLessThan(bandEnergy(open, from, SECOND, 80) * 0.5)

    // And with no wet signal at all it does nothing whatsoever, at any setting.
    for (const lowCut of [20, 500, 2000]) {
      expect([...run(tone, 2048, { mix: 0, lowCut })]).toEqual([...run(tone, 2048, { mix: 0 })])
    }
  })

  it('takes the top off the tail', () => {
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 6000 * i) / SR)
    const open = run(tone, SECOND, { mix: 1, decay: 0.9, damp: 0, highCut: 18000 })
    const cut = run(tone, SECOND, { mix: 1, decay: 0.9, damp: 0, highCut: 1500 })
    const from = Math.round(0.5 * SR)
    expect(bandEnergy(cut, from, SECOND, 6000)).toBeLessThan(
      bandEnergy(open, from, SECOND, 6000) * 0.5,
    )
  })

  it('shuts the tail off after the sound that opened it', () => {
    // The eighties snare: a burst, a hold, and then nothing — where the same burst without the gate rings
    // on for a second.
    const burst = (i: number) => (i < Math.round(0.02 * SR) ? (i % 2 === 0 ? 0.8 : -0.8) : 0)
    const options = { mix: 1, decay: 0.95, damp: 0, algorithm: 2 }
    const open = run(burst, SECOND, options)
    const gated = run(burst, SECOND, {
      ...options,
      gate: 1,
      gateThresh: 0.05,
      gateHold: 0.12,
      gateRelease: 0.01,
    })

    // While the gate is held open the tail is there in both.
    const during = Math.round(0.05 * SR)
    expect(rms(gated, during, during + 512)).toBeGreaterThan(rms(open, during, during + 512) * 0.5)
    // Well after the hold and the release have run out, one of them has stopped and the other has not.
    const after = Math.round(0.4 * SR)
    expect(rms(gated, after, after + 2048)).toBeLessThan(rms(open, after, after + 2048) * 0.01)
  })

  it('opens again on the next hit rather than staying shut', () => {
    // A gate that latched would work once and then silence the device for the rest of the session.
    const hits = (i: number) => {
      const at = i % Math.round(0.25 * SR)
      return at < Math.round(0.01 * SR) ? (at % 2 === 0 ? 0.8 : -0.8) : 0
    }
    const out = run(hits, SECOND, {
      mix: 1,
      decay: 0.9,
      gate: 1,
      gateThresh: 0.05,
      gateHold: 0.05,
      gateRelease: 0.01,
    })
    for (const beat of [1, 2, 3]) {
      const at = Math.round(beat * 0.25 * SR) + 256
      expect(rms(out, at, at + 512), `hit ${beat}`).toBeGreaterThan(1e-4)
    }
  })

  it('leaves the dry signal alone whatever the gate is doing', () => {
    // The gate is a wet-path section, so a shut gate must not mute the device — which is what a patch with
    // this in a chain rather than on a send would otherwise hear.
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const out = run(tone, 4096, { mix: 0, gate: 1, gateThresh: 1, gateHold: 0, gateRelease: 0.001 })
    for (let i = 0; i < 4096; i++) expect(out[i]).toBeCloseTo(tone(i), 6)
  })
})
