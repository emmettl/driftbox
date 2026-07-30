// Arithmetic shared by the canvas's meters.
//
// Kept outside the component because these are the claims worth testing: that the VU reads energy
// rather than average signed amplitude, that a one-sample transient still reaches the peak marker,
// and that the waterfall divides a spectrum logarithmically. Canvas calls are merely how those
// answers are painted.

export interface SignalLevel {
  rms: number
  peak: number
}

/** RMS is perceived level; peak is the headroom a transient actually consumed. */
export function measureLevel(samples: Float32Array): SignalLevel {
  if (samples.length === 0) return { rms: 0, peak: 0 }

  let squares = 0
  let peak = 0
  for (const sample of samples) {
    squares += sample * sample
    peak = Math.max(peak, Math.abs(sample))
  }
  return { rms: Math.sqrt(squares / samples.length), peak }
}

/** Put an amplitude on a decibel scale, with silence pinned to the left edge. */
export function dbPosition(amplitude: number, floor = -60): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return 0
  const db = 20 * Math.log10(amplitude)
  return Math.max(0, Math.min(1, (db - floor) / -floor))
}

/**
 * Meter ballistics: quick enough to catch a drum hit, slow enough on the way down to read as level.
 *
 * This is deliberately not `ease` from levels.ts. Scene energy snaps up because animation should
 * punch on the exact frame of a kick; a VU needle has mass and should visibly travel.
 */
export function smoothMeter(current: number, target: number, dt: number): number {
  const rate = target > current ? 14 : 2.8
  return current + (target - current) * Math.min(1, Math.max(0, dt) * rate)
}

/**
 * Average FFT bins into logarithmic bands, low to high.
 *
 * The first boundary starts at zero rather than one so DC and the lowest bass bin are not silently
 * discarded. Every band advances by at least one bin, which also keeps small test analysers honest.
 */
export function spectrumBands(spectrum: Uint8Array, out: Float32Array): Float32Array {
  if (spectrum.length === 0) {
    out.fill(0)
    return out
  }

  let from = 0
  for (let band = 0; band < out.length; band++) {
    const to = Math.min(
      spectrum.length,
      Math.max(from + 1, Math.round(Math.pow(spectrum.length, (band + 1) / out.length))),
    )
    let sum = 0
    for (let bin = from; bin < to; bin++) sum += spectrum[bin]
    out[band] = sum / ((to - from) * 255)
    from = to
  }
  return out
}

/**
 * The same logarithmic grouping for raw decibel data.
 *
 * `getByteFrequencyData` is scaled through an AnalyserNode's `maxDecibels`, whose default is −30 dB.
 * A mastered drum mix drives many bins past that and turns a waterfall into a solid block of 255s.
 * Reading floats preserves the real values; this maps −96..0 dB onto the canvas without clipping the
 * interesting half of the signal first.
 */
export function decibelBands(
  spectrum: Float32Array,
  out: Float32Array,
  floor = -96,
  ceiling = 0,
): Float32Array {
  if (spectrum.length === 0 || ceiling <= floor) {
    out.fill(0)
    return out
  }

  let from = 0
  for (let band = 0; band < out.length; band++) {
    const to = Math.min(
      spectrum.length,
      Math.max(from + 1, Math.round(Math.pow(spectrum.length, (band + 1) / out.length))),
    )
    let sum = 0
    for (let bin = from; bin < to; bin++) {
      const db = spectrum[bin]
      sum += Number.isFinite(db) ? Math.max(0, Math.min(1, (db - floor) / (ceiling - floor))) : 0
    }
    out[band] = sum / (to - from)
    from = to
  }
  return out
}
