import type { BassStep } from '../bass.js'
import type { Pattern, StepValue } from '../pattern.js'

// Patterns written as a picture rather than as arrays of numbers, because that is what a
// drum pattern is — and a wall of zeroes and ones is both unreadable and unwritable.
//
//   X = accent   x = normal   . = rest   space = ignored, for grouping into beats

export function steps(notation: string): StepValue[] {
  return notation
    .replace(/\s/g, '')
    .split('')
    .map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : 0))
}

/**
 * A bassline, one whitespace-separated token per step.
 *
 *   .      rest
 *   0      a note, in semitones above the synth's root
 *   7a     accented
 *   12s    slides into whatever comes next
 *   5p     paused but retaining pitch 5
 *   5ps    paused pitch that slides into the next note
 *   0as    both
 *   |      ignored, for grouping into beats
 *
 * Wordier than the drum notation because a bass step carries three things rather than
 * one, but it keeps the same property: the line is legible as a line in the source.
 */
export function bassSteps(notation: string): BassStep[] {
  return notation
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '|')
    .map((token) => {
      if (token === '.') return { note: null, accent: false, slide: false }
      const [, digits, flags] = /^(-?\d+)([asp]*)$/.exec(token) ?? []
      if (digits === undefined) throw new Error(`Unreadable bass step: ${token}`)
      return {
        note: Number(digits),
        accent: flags.includes('a'),
        slide: flags.includes('s'),
        ...(flags.includes('p') ? { gate: false } : {}),
      }
    })
}

export function pattern(
  id: string,
  name: string,
  tracks: Record<string, string>,
  bassLines: Record<string, string> = {},
  length = 16,
): Pattern {
  // Counted, and it throws.
  //
  // A line one character short is invisible by eye — the whole point of the notation is
  // that it reads as a picture, and a picture does not tell you it is 13 wide when it
  // should be 14. Left unchecked it silently becomes a track shorter than its pattern,
  // which the loader then pads, so the song plays subtly differently from how it reads.
  // Better to refuse to build at all.
  const out: Record<string, StepValue[]> = {}
  for (const [voice, notation] of Object.entries(tracks)) {
    const parsed = steps(notation)
    if (parsed.length !== length) {
      throw new Error(`${id}/${voice}: ${parsed.length} steps written, ${length} expected`)
    }
    out[voice] = parsed
  }

  const bass: Record<string, BassStep[]> = {}
  for (const [voice, notation] of Object.entries(bassLines)) {
    const parsed = bassSteps(notation)
    if (parsed.length !== length) {
      throw new Error(`${id}/${voice}: ${parsed.length} steps written, ${length} expected`)
    }
    bass[voice] = parsed
  }

  return { id, name, length, tracks: out, bass }
}

/**
 * Deep-copy a pattern list.
 *
 * Every song builder returns `clonePatterns(...)` rather than the module-level array it
 * built once. Without it, two calls to the same builder hand back the SAME pattern
 * objects — so anything that mutates a pattern in place would edit the shipped song
 * permanently, and `reset` would restore the corrupted version rather than the original.
 *
 * Nothing mutates today; the store is immutable throughout. This is here because "the
 * defaults are only safe as long as nobody writes `pattern.name = ...`" is not a property
 * worth relying on, and the failure would be silent and permanent.
 */
export function clonePatterns(patterns: Pattern[]): Pattern[] {
  return patterns.map((p) => ({
    ...p,
    tracks: Object.fromEntries(Object.entries(p.tracks).map(([id, t]) => [id, [...t]])),
    trackLengths: p.trackLengths ? { ...p.trackLengths } : undefined,
    pcf: p.pcf ? [...p.pcf] : undefined,
    bass: p.bass
      ? Object.fromEntries(Object.entries(p.bass).map(([id, l]) => [id, l.map((s) => ({ ...s }))]))
      : undefined,
  }))
}
