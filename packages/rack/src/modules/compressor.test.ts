import { describe, expect, it } from 'vitest'
import { COMPRESSOR_MODULE, CompressorProcessor } from './compressor.js'

// The compressor, and the assertions worth making are about dynamics rather than about samples: a signal
// over the threshold comes down, one under it does not, and the sidechain decides which signal is being
// asked about. That last one is the reason this module exists in a drum-and-bass rack at all.

const SR = 44100
const ORDER = ['threshold', 'ratio', 'attack', 'release', 'makeup', 'knee'] as const

interface Options {
  threshold?: number
  ratio?: number
  attack?: number
  release?: number
  makeup?: number
  knee?: number
  /** Patched into the Key inlet. Absent means nothing is patched, which is a buffer of zeroes. */
  key?: (i: number) => number
}

/** Run a signal through and hand back both outlets. */
function run(signal: (i: number) => number, frames: number, options: Options = {}) {
  const processor = new CompressorProcessor(SR)
  const input = Float32Array.from({ length: frames }, (_, i) => signal(i))
  const key = Float32Array.from({ length: frames }, (_, i) => options.key?.(i) ?? 0)
  const params = ORDER.map((id) => {
    const def = COMPRESSOR_MODULE.params.find((p) => p.id === id)!
    return new Float32Array(frames).fill(options[id] ?? def.default)
  })
  const out = new Float32Array(frames)
  const gain = new Float32Array(frames)
  processor.process([input, key], [out, gain], params, frames)
  return { out, gain, input }
}

/** Peak of the last tenth of a run — after any attack has finished doing its work. */
const settledPeak = (data: Float32Array) => {
  let peak = 0
  for (let i = Math.floor(data.length * 0.9); i < data.length; i++) {
    const x = data[i] < 0 ? -data[i] : data[i]
    if (x > peak) peak = x
  }
  return peak
}

/** A sine at `hz`, so the detector sees a real waveform rather than DC. */
const sine = (hz: number, amplitude: number) => (i: number) =>
  amplitude * Math.sin((2 * Math.PI * hz * i) / SR)

const SECOND = SR

describe('the compressor', () => {
  it('leaves a signal under the threshold alone', () => {
    // The half that matters most. A compressor that touched everything would change the sound of every
    // patch it was dropped into, and nobody would trust it in the chain.
    const quiet = sine(220, 0.02) // about −34dB, well under the default −18
    const { out } = run(quiet, SECOND, { knee: 0 })
    const clean = run(quiet, SECOND, { threshold: 0, ratio: 1, knee: 0 })
    expect(settledPeak(out)).toBeCloseTo(settledPeak(clean.out), 3)
  })

  it('brings a signal over the threshold down', () => {
    const loud = sine(220, 0.9)
    const compressed = settledPeak(run(loud, SECOND, { knee: 0 }).out)
    expect(compressed).toBeLessThan(0.9)
    // Down, not off: the point is control, not a gate.
    expect(compressed).toBeGreaterThan(0.1)
  })

  it('comes down further the higher the ratio', () => {
    const loud = sine(220, 0.9)
    const gentle = settledPeak(run(loud, SECOND, { ratio: 2, knee: 0 }).out)
    const firm = settledPeak(run(loud, SECOND, { ratio: 10, knee: 0 }).out)
    expect(firm).toBeLessThan(gentle)
  })

  it('reduces by the amount the ratio says it will', () => {
    // The arithmetic, not just the direction — because a ratio knob that merely made things quieter in the
    // right order would look right in every other test here. 4:1 at 12dB over the threshold is 9dB down.
    const threshold = -20
    const overBy = 12
    const amplitude = Math.pow(10, (threshold + overBy) / 20)
    const { out } = run(sine(220, amplitude), 2 * SECOND, {
      threshold,
      ratio: 4,
      knee: 0,
      attack: 0.0001,
      // Long against the 4.5ms period of the test tone. A peak follower droops between the crests of a sine,
      // and with a release of 10ms it drooped enough to under-compress by 0.6dB — which is the detector
      // being a peak detector, not the ratio being wrong. Holding the envelope up is what isolates the one
      // from the other.
      release: 0.3,
    })
    const outDb = 20 * Math.log10(settledPeak(out))
    const expected = threshold + overBy / 4
    expect(outDb).toBeCloseTo(expected, 0)
  })

  it('takes time to react, in the direction the attack knob says', () => {
    // A compressor with no attack is a waveshaper. The first moments of a loud passage get through, which is
    // what leaves a kick its click.
    const loud = sine(220, 0.9)
    const slow = run(loud, SECOND, { attack: 0.1, knee: 0 })
    const fast = run(loud, SECOND, { attack: 0.0005, knee: 0 })
    // Measured early, where the two differ. By the end both have arrived at the same place.
    const early = (d: Float32Array) => {
      let peak = 0
      for (let i = 0; i < 0.01 * SR; i++) {
        const x = d[i] < 0 ? -d[i] : d[i]
        if (x > peak) peak = x
      }
      return peak
    }
    expect(early(slow.out)).toBeGreaterThan(early(fast.out))
  })

  it('lets go again after the loud part stops', () => {
    // Without a release it would duck once and stay ducked, and a bassline would disappear after the first
    // kick of the bar.
    const frames = SECOND
    const half = frames / 2
    const { out } = run(
      (i) => (i < half ? sine(220, 0.9)(i) : sine(220, 0.05)(i)),
      frames,
      { release: 0.05, knee: 0 },
    )
    // The quiet half comes back close to its own level rather than staying held down.
    expect(settledPeak(out)).toBeGreaterThan(0.04)
  })

  it('ducks the input from the sidechain rather than from itself', () => {
    // The reason this module is in a drum-and-bass rack. Fed a kick, a steady bass gets out of its way, and
    // that duck is the pump the genre is built on.
    const bass = sine(55, 0.5)
    const frames = SECOND
    // A kick on the first half only, so the difference is visible within one run.
    const kick = (i: number) => (i < frames / 2 ? 0.95 : 0)

    const { out } = run(bass, frames, { key: kick, ratio: 8, threshold: -20, knee: 0 })
    const during = (() => {
      let peak = 0
      for (let i = Math.floor(frames * 0.3); i < frames * 0.45; i++) {
        const x = out[i] < 0 ? -out[i] : out[i]
        if (x > peak) peak = x
      }
      return peak
    })()
    // Ducked while the key is loud, back up once it stops.
    expect(during).toBeLessThan(0.3)
    expect(settledPeak(out)).toBeGreaterThan(during * 1.5)
  })

  it('reads its own input when nothing is patched into the key', () => {
    // An unconnected inlet reads the zero buffer, so "is it all zero" is the honest question. Getting this
    // backwards would make an unpatched compressor do nothing at all, silently.
    const loud = sine(220, 0.9)
    const unpatched = settledPeak(run(loud, SECOND, { knee: 0 }).out)
    const keyed = settledPeak(run(loud, SECOND, { key: loud, knee: 0 }).out)
    expect(unpatched).toBeCloseTo(keyed, 3)
  })

  it('does not duck for a key that is silent', () => {
    // The other side of the same decision: a key patched from something not currently playing must fall back
    // to the input, or the compressor would switch itself off whenever the kick track rested.
    const loud = sine(220, 0.9)
    const silentKey = settledPeak(run(loud, SECOND, { key: () => 0, knee: 0 }).out)
    const unpatched = settledPeak(run(loud, SECOND, { knee: 0 }).out)
    expect(silentKey).toBeCloseTo(unpatched, 3)
  })

  it('reports its gain reduction as a signal', () => {
    // One outlet, and it makes the compressor's own ducking available to patch — into a filter, into
    // anything. Positive volts for reduction, so it reads like an envelope.
    const { gain } = run(sine(220, 0.9), SECOND, { ratio: 8, knee: 0 })
    expect(gain[gain.length - 1]).toBeGreaterThan(0)
    const quiet = run(sine(220, 0.01), SECOND, { knee: 0 })
    expect(quiet.gain[quiet.gain.length - 1]).toBeCloseTo(0, 4)
  })

  it('makes up the level it took away', () => {
    const loud = sine(220, 0.5)
    const plain = settledPeak(run(loud, SECOND, { knee: 0 }).out)
    const boosted = settledPeak(run(loud, SECOND, { knee: 0, makeup: 6 }).out)
    expect(boosted / plain).toBeCloseTo(2, 1)
  })

  it('eases into the ratio across a soft knee', () => {
    // A signal hovering at the threshold should not switch the compressor on and off. Just below the
    // threshold, a soft knee is already doing a little and a hard knee is doing nothing at all.
    const threshold = -20
    const justUnder = Math.pow(10, (threshold - 2) / 20)
    const hard = settledPeak(run(sine(220, justUnder), SECOND, { threshold, knee: 0 }).out)
    const soft = settledPeak(run(sine(220, justUnder), SECOND, { threshold, knee: 12 }).out)
    expect(soft).toBeLessThan(hard)
  })

  it('stays finite on silence and on a ratio of one', () => {
    // A ratio of 1 is no compression, and log of zero is −Infinity — which is why the detector floors at
    // −100dB rather than taking the log of whatever arrives.
    for (const options of [{ ratio: 1 }, { ratio: 0 }, {}]) {
      const { out, gain } = run(() => 0, 512, options)
      for (const x of out) expect(Number.isFinite(x)).toBe(true)
      for (const x of gain) expect(Number.isFinite(x)).toBe(true)
    }
  })
})
