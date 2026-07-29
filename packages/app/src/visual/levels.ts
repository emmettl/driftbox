import type { DriftboxEngine } from '@driftbox/engine'

// Reading the mix, for whatever is on screen.
//
// Shared by every scene so they all agree about what "bass" means — two scenes with
// slightly different band edges would look like one of them was broken the moment you
// switched between them.

export interface Levels {
  bass: number
  high: number
}

/** One reusable buffer. Allocating 1024 bytes per frame per scene is not free. */
const spectrum = new Uint8Array(1024)

export function readLevels(engine: DriftboxEngine | null | undefined): Levels {
  const analyser = engine?.analyser
  if (!analyser) return { bass: 0, high: 0 }

  const bins = Math.min(spectrum.length, analyser.frequencyBinCount)
  analyser.getByteFrequencyData(spectrum.subarray(0, bins) as Uint8Array<ArrayBuffer>)

  // Roughly: the first few bins are the kick's fundamental, the top third is hats and
  // the noise in snares and claps.
  const lowEnd = Math.max(1, Math.floor(bins * 0.035))
  let bass = 0
  for (let i = 0; i < lowEnd; i++) bass += spectrum[i]
  bass /= lowEnd * 255

  const highStart = Math.floor(bins * 0.55)
  let high = 0
  for (let i = highStart; i < bins; i++) high += spectrum[i]
  high /= (bins - highStart) * 255

  return { bass, high }
}

/**
 * Asymmetric smoothing: snap up on a transient, ease down afterwards.
 *
 * Symmetric smoothing makes every hit look like a slow swell and loses the punch
 * entirely — which is the difference between a visualiser that is reading the music and
 * one that is just moving.
 */
export function ease(current: number, target: number, dt: number, fall = 3.2): number {
  return target > current ? target : current + (target - current) * Math.min(1, dt * fall)
}

/**
 * The spectrum split into `count` bands, for a scene that wants more than "bass" and
 * "highs" — a radial analyser needs one number per lane.
 *
 * Logarithmic band edges, because the ear is: split 1024 linear FFT bins evenly and
 * fifteen of sixteen lanes get the top two octaves, where a drum machine has almost
 * nothing but hats. This puts a kick, a snare and a hat in different lanes, which is the
 * entire point of showing them separately.
 */
export function readBands(
  engine: DriftboxEngine | null | undefined,
  out: Float32Array,
): Float32Array {
  const analyser = engine?.analyser
  if (!analyser) {
    out.fill(0)
    return out
  }

  const bins = Math.min(spectrum.length, analyser.frequencyBinCount)
  analyser.getByteFrequencyData(spectrum.subarray(0, bins) as Uint8Array<ArrayBuffer>)

  const count = out.length
  for (let band = 0; band < count; band++) {
    // Each band covers a constant RATIO of the spectrum rather than a constant width.
    const from = Math.floor(Math.pow(bins, band / count))
    const to = Math.max(from + 1, Math.floor(Math.pow(bins, (band + 1) / count)))
    let sum = 0
    for (let i = from; i < to && i < bins; i++) sum += spectrum[i]
    out[band] = sum / ((to - from) * 255)
  }
  return out
}
