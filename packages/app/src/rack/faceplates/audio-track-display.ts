/** Turn a zero-based rack sixteenth into the one-based position shown on the faceplate. */
export function audioTrackPosition(start: number): { bar: number; step: number } {
  const safe = Math.max(0, Math.min(1023, Math.round(start)))
  return { bar: Math.floor(safe / 16) + 1, step: (safe % 16) + 1 }
}

/** Reassemble the faceplate's one-based bar and step fields into a rack sixteenth. */
export function audioTrackStart(bar: number, step: number): number {
  const safeBar = Math.max(1, Math.min(64, Math.round(bar) || 1))
  const safeStep = Math.max(1, Math.min(16, Math.round(step) || 1))
  return (safeBar - 1) * 16 + safeStep - 1
}
