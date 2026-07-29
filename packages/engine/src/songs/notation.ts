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
      const [, digits, flags] = /^(-?\d+)([as]*)$/.exec(token) ?? []
      if (digits === undefined) throw new Error(`Unreadable bass step: ${token}`)
      return {
        note: Number(digits),
        accent: flags.includes('a'),
        slide: flags.includes('s'),
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
  const out: Record<string, StepValue[]> = {}
  for (const [voice, notation] of Object.entries(tracks)) out[voice] = steps(notation)

  const bass: Record<string, BassStep[]> = {}
  for (const [voice, notation] of Object.entries(bassLines)) bass[voice] = bassSteps(notation)

  return { id, name, length, tracks: out, bass }
}
