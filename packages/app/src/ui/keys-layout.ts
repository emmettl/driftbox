// The keyboard's geometry: which computer key is which semitone, what that semitone is called, and how
// far up and down the grid can be moved.
//
// Out of `Keys.tsx` because none of it is React, and because the layout is the one part of that component
// with a claim worth writing down: the colours follow the PITCH. The first version of it put white keys
// at 0,2,4,5,7,9,11 — the shape of a piano starting at C — while the 303's note 0 is an A, so C, F and G
// came out black and C#, F# and G# came out white. That is precisely backwards from every keyboard ever
// built, it looks fine in a screenshot, and no test could reach it while the array sat inside a component
// that needed a browser to render.

export interface KeyCap {
  /** The computer key that plays it. */
  key: string
  /** Semitones above the 303's root, before the octave shift. */
  semitone: number
  black: boolean
  /** Scale degree from the root, which is what the cap prints. */
  degree: string
}

/**
 * One octave of a real piano, from the 303's root.
 *
 * From A the pattern is: one black, a gap where B meets C, two blacks, a gap where E meets F, then two
 * more. Those two gaps are the thing that makes a keyboard legible at a glance — they are how you find
 * middle C without counting — and they only appear if the black keys are placed by pitch.
 *
 * The consequence, worth saying out loud: the home row spells A natural MINOR rather than A major,
 * because that is what the white keys from an A are. For a major scale under the fingers, start on `d`,
 * which is a C.
 *
 * The letters keep the shape of the computer keyboard: black keys sit on the number row's neighbours,
 * above the gap between the two white keys they fall between.
 */
export const LAYOUT: readonly KeyCap[] = [
  { key: 'a', semitone: 0, black: false, degree: '1' },
  { key: 'w', semitone: 1, black: true, degree: '♭2' },
  { key: 's', semitone: 2, black: false, degree: '2' },
  // No black key between B and C. This gap is not a mistake.
  { key: 'd', semitone: 3, black: false, degree: '♭3' },
  { key: 'r', semitone: 4, black: true, degree: '3' },
  { key: 'f', semitone: 5, black: false, degree: '4' },
  { key: 't', semitone: 6, black: true, degree: '♭5' },
  { key: 'g', semitone: 7, black: false, degree: '5' },
  // Nor between E and F.
  { key: 'h', semitone: 8, black: false, degree: '♭6' },
  { key: 'u', semitone: 9, black: true, degree: '6' },
  { key: 'j', semitone: 10, black: false, degree: '♭7' },
  { key: 'i', semitone: 11, black: true, degree: '7' },
  { key: 'k', semitone: 12, black: false, degree: '8' },
]

/** Pitch names from the 303's root, which is an A. */
const NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']

export const noteName = (semitones: number): string =>
  NAMES[((semitones % 12) + 12) % 12]

/** Highest octave offset the grid can still show — notes run 0..24. */
export const MAX_OCTAVE = 1
/** Lowest, which is where the root itself sits at the bottom of the grid. */
export const MIN_OCTAVE = -1

/** The cap a keystroke plays, if any. Case-insensitive, because Shift is the accent. */
export const capFor = (key: string): KeyCap | undefined =>
  LAYOUT.find((cap) => cap.key === key.toLowerCase())

/** Where a cap lands once the octave buttons have been used. */
export const semitoneOf = (cap: KeyCap, octave: number): number => cap.semitone + octave * 12

/** Move the grid, without letting it leave the range the 303 has notes for. */
export const shiftOctave = (octave: number, delta: number): number =>
  Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, octave + delta))

/**
 * Whether a pitched drum can still reach this note.
 *
 * A tom tunes across a little under an octave, so the top of the keyboard is out of its reach. Those
 * keys are dimmed rather than removed — the shape stays a keyboard, and it is obvious why the end of it
 * has gone quiet. The way further up is the next tom, which is what the machine's three of them are for.
 */
export const outOfRange = (
  pitched: { low: number; high: number } | undefined,
  semitone: number,
): boolean => (pitched ? pitched.low * Math.pow(2, semitone / 12) > pitched.high : false)
