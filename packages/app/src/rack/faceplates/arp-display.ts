export interface ArpPreviewOptions {
  source: number
  chord: number
  octaves: number
  mode: number
  shift: number
  steps?: number
}
export interface ArpPreviewStep {
  label: string
  octave: number
  description: string
}

const CHORDS = [
  [0],
  [0, 7],
  [0, 4, 7],
  [0, 3, 7],
  [0, 4, 7, 11],
  [0, 3, 7, 10],
  [0, 5, 7],
  [0, 3, 6],
] as const

const directionIndex = (step: number, length: number, mode: number): number => {
  if (length <= 1) return 0
  if (mode === 1) return length - 1 - (step % length)
  if (mode === 2) {
    const cycle = length * 2 - 2
    const at = step % cycle
    return at < length ? at : cycle - at
  }
  if (mode === 3) {
    const cycle = length * 2 - 2
    const at = step % cycle
    return at < length ? length - 1 - at : at - length + 1
  }
  // Random cannot be predicted without duplicating the processor's state. This fixed permutation says
  // "unordered" without making a display-only RNG claim to be the notes that will sound.
  if (mode === 4) return (step * 5 + 3) % length
  return step % length
}

/** A configuration preview: exact intervals in Root mode, potential collected lanes in Played mode. */
export function arpPreview(options: ArpPreviewOptions): ArpPreviewStep[] {
  const played = options.source >= 0.5
  const octaves = Math.max(1, Math.min(4, Math.round(options.octaves)))
  const shift = Math.max(-3, Math.min(3, Math.round(options.shift)))
  const mode = Math.max(0, Math.min(5, Math.round(options.mode)))
  const count = Math.max(1, Math.round(options.steps ?? 16))
  const base = played
    ? Array.from({ length: 8 }, (_, lane) => lane)
    : [...CHORDS[Math.max(0, Math.min(CHORDS.length - 1, Math.round(options.chord)))]]
  const length = base.length * octaves

  return Array.from({ length: count }, (_, step) => {
    const at = directionIndex(step, length, mode)
    const octave = Math.floor(at / base.length) + shift
    if (played) {
      const lane = base[at % base.length] + 1
      return {
        label: `${lane}`,
        octave,
        description: `Played input lane ${lane}, ${octave === 0 ? 'root octave' : `octave ${octave > 0 ? '+' : ''}${octave}`}`,
      }
    }
    const interval = base[at % base.length] + 12 * octave
    return {
      label: interval > 0 ? `+${interval}` : `${interval}`,
      octave,
      description: `Root interval ${interval > 0 ? '+' : ''}${interval} semitones`,
    }
  })
}
