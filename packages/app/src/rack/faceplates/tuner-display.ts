const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const

export interface TunerDisplay {
  detected: boolean
  note: string
  octave: number | null
  cents: number
  frequency: number
}

/** Translate detector telemetry into the equal-tempered note named by the faceplate. */
export function tunerDisplay(frequency: number, reference: number, clarity: number): TunerDisplay {
  if (!(frequency > 0) || !(reference > 0) || clarity < 0.55) {
    return { detected: false, note: '—', octave: null, cents: 0, frequency: 0 }
  }
  const midi = 69 + 12 * Math.log2(frequency / reference)
  const nearest = Math.round(midi)
  const index = ((nearest % 12) + 12) % 12
  return {
    detected: true,
    note: NOTES[index],
    octave: Math.floor(nearest / 12) - 1,
    cents: Math.max(-50, Math.min(50, (midi - nearest) * 100)),
    frequency,
  }
}
