/** −48dB to +3dB mapped onto a display's useful 0..1 span. */
export function meterPosition(amplitude: number): number {
  if (!(amplitude > 0)) return 0
  const db = 20 * Math.log10(amplitude)
  return Math.max(0, Math.min(1, (db + 48) / 51))
}

export function meterLabel(amplitude: number): string {
  if (!(amplitude > 0)) return '−∞ dB'
  const db = 20 * Math.log10(amplitude)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export function waveformPoints(
  waveform: ArrayLike<number>,
  width = 300,
  height = 78,
): string {
  if (waveform.length === 0) return `0,${height / 2} ${width},${height / 2}`
  const last = Math.max(1, waveform.length - 1)
  return Array.from(
    { length: waveform.length },
    (_, index) =>
      `${((index / last) * width).toFixed(1)},${(
        height / 2 -
        Math.max(-1, Math.min(1, waveform[index])) * (height * 0.42)
      ).toFixed(1)}`,
  ).join(' ')
}
