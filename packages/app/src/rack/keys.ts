// Where the keys of a piano go, and which computer key plays which note.
//
// Pure, and separate from the component, because the geometry is the part that can be wrong in ways that
// are hard to see and easy to assert: black keys belong *between* particular white ones, and the two gaps
// — where B meets C and E meets F — are how anybody finds their place on a keyboard without counting.
//
// **The colours follow the pitch.** `app/src/ui/Keys.tsx` has the long version of why, learned the hard
// way: its first version laid white keys at 0,2,4,5,7,9,11 — the shape of a piano starting at C — while
// the 303's note 0 is an A, so C, F and G came out black and C#, F# and G# came out white, which is
// backwards from every keyboard ever built.
//
// Here the conclusion is the opposite one, for the same reason. **The rack's 0 V is MIDI 36, a C2** — see
// the comment in `modules/midi.ts` — so a piano starting at C is exactly right, and semitone 0 of this
// layout is a C. Same principle, different root, different answer.

/** Semitones that are white keys, from C. The two gaps in the black row fall at 2→4 and 7→9. */
const WHITE = [0, 2, 4, 5, 7, 9, 11]

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** The white key is the unit. Everything else is a fraction of it, so one number scales the keyboard. */
export const WHITE_WIDTH = 1
/** A real piano's black key is a little over half the width of a white one: 13.7mm against 23.5mm. */
export const BLACK_WIDTH = 0.62

/**
 * How tall a white key is, in white-key WIDTHS.
 *
 * Here rather than in the CSS because it is what makes the keyboard's aspect ratio honest. The first
 * version drew the keys into a `0 0 15 1` viewBox stretched with `preserveAspectRatio: none`, which meant
 * a white key came out 63px wide and 92px tall — nearly square. Everything about that reads wrong: the
 * black keys look fat, and the rounded corners come out as ovals because the two axes scale differently.
 *
 * A real piano is about 6.4 of these. That is far too tall for a bar at the bottom of a page, so 2.5 is a
 * compromise — enough that a key is clearly taller than it is wide, short enough to leave the rack visible.
 */
export const WHITE_HEIGHT = 2.5
/** About three fifths of the white key's length, which is what leaves room to play a white key in front. */
export const BLACK_HEIGHT = WHITE_HEIGHT * 0.62

export interface PianoKey {
  /** Semitones above the low C of this layout. */
  semitone: number
  black: boolean
  /** `C`, `F#` — with the octave number appended by `noteName`, not here. */
  name: string
  /** Left edge, in white-key widths. */
  x: number
  width: number
}

/**
 * The name MIDI note `note` has, `C2` style.
 *
 * MIDI 36 is C2, which is the convention the rack's pitch inlets are built around: a C2 on a keyboard
 * plays a C2 on the VCO at zero transpose. Note that this is the Yamaha-style numbering where 60 is C4;
 * the alternative puts 60 at C3, and picking the one the rest of the rack already assumes is the only
 * choice that avoids a small permanent lie in the labels.
 */
export function noteName(note: number): string {
  const octave = Math.floor(note / 12) - 1
  return `${NAMES[((note % 12) + 12) % 12]}${octave}`
}

/**
 * Every key of an `octaves`-octave keyboard, in drawing order.
 *
 * White keys first and then black, because the blacks overlap the whites and must be painted on top —
 * an SVG or a stack of absolutely-positioned divs both take them in exactly this order, so the array is
 * usable as-is rather than needing the caller to sort it.
 *
 * A trailing C is included, because a keyboard that stops on a B looks truncated and there is nowhere to
 * finish a scale.
 */
export function pianoKeys(octaves: number): PianoKey[] {
  const whites: PianoKey[] = []
  const blacks: PianoKey[] = []
  const total = octaves * 12 + 1

  let whiteIndex = 0
  for (let semitone = 0; semitone < total; semitone++) {
    const pitchClass = semitone % 12
    const name = NAMES[pitchClass]
    if (WHITE.includes(pitchClass)) {
      whites.push({ semitone, black: false, name, x: whiteIndex * WHITE_WIDTH, width: WHITE_WIDTH })
      whiteIndex++
      continue
    }
    // A black key straddles the boundary it sits above, which is the white key just added. Centring it on
    // that boundary is what produces the two gaps for free: there is no black key at B→C or E→F because
    // those pitch classes are not in this branch at all.
    blacks.push({
      semitone,
      black: true,
      name,
      x: whiteIndex * WHITE_WIDTH - BLACK_WIDTH / 2,
      width: BLACK_WIDTH,
    })
  }
  return [...whites, ...blacks]
}

/** How wide a keyboard of this many octaves is, in white-key widths. */
export function keyboardWidth(octaves: number): number {
  return (octaves * 7 + 1) * WHITE_WIDTH
}

/** The five black keys of an octave, from C. */
const BLACK = [1, 3, 6, 8, 10]

/**
 * Which semitone each computer key plays.
 *
 * The mapping every tracker and DAW has used for thirty years: `zxcvbnm` is a white-key octave, `sdghj`
 * are its blacks on the row above, and `qwertyu` / `23567` are the octave above that. Two octaves under
 * the hands without moving them is enough to play a bassline and its answer.
 *
 * Written out as one string per row against the semitones it covers, rather than derived by walking the
 * pattern. The derived version was six lines of index arithmetic that had to be traced to be believed;
 * this can be read straight off. The gaps at E→F and B→C are simply the blacks `sdghj` has only five of.
 */
const ROWS: { keys: string; semitones: readonly number[] }[] = [
  { keys: 'zxcvbnm', semitones: WHITE },
  { keys: 'sdghj', semitones: BLACK },
  { keys: 'qwertyu', semitones: WHITE.map((s) => s + 12) },
  { keys: '23567', semitones: BLACK.map((s) => s + 12) },
]

/** Computer key to semitone, for the two octaves the rows cover. */
export function keyMap(): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of ROWS) {
    for (let i = 0; i < row.keys.length; i++) map.set(row.keys[i], row.semitones[i])
  }
  return map
}
