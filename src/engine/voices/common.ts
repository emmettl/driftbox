import type { OscSource, VoiceParams } from '../types'

/** Map a normalised 0..1 knob onto a real range. */
export function range(value: number, low: number, high: number): number {
  return low + (high - low) * Math.max(0, Math.min(1, value))
}

/** Map a knob onto a range where equal knob movement means equal musical change —
 *  right for anything measured in Hz or seconds, where the ear hears ratios. */
export function ratioRange(value: number, low: number, high: number): number {
  return low * Math.pow(high / low, Math.max(0, Math.min(1, value)))
}

/** Accent on these machines is not just "louder". A hit that is accented is also
 *  slightly brighter and rings a little longer, because the higher trigger voltage
 *  drives the envelope circuit harder. */
export function accentGain(params: VoiceParams, accent: number): number {
  return range(params.level, 0, 1) * (0.62 + 0.38 * accent)
}

/**
 * The metallic source both machines use for hats and cymbals: six square oscillators
 * at deliberately inharmonic ratios. There is no filter here that makes this sound
 * like a cymbal — the character comes from the ratios never lining up into a harmonic
 * series, so the ear refuses to hear a pitch.
 *
 * The ratios are the well-known 808 set; the 909 uses the same trick with different
 * filtering downstream.
 */
export const METALLIC_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21] as const

export function metallicSources(
  base: number,
  gain: number,
  amp: OscSource['amp'],
): OscSource[] {
  return METALLIC_RATIOS.map((ratio) => ({
    kind: 'osc' as const,
    type: 'square' as const,
    frequency: base * ratio,
    gain,
    amp,
  }))
}
