// The monophonic voice stack, which is the whole reason this keyboard behaves like a 303.
//
// Out of `Keys.tsx` because the two rules in it are the instrument's character rather than the
// component's plumbing, and both were three lines wedged between a `useRef` mutation and an engine call
// where nothing could reach them:
//
//   - a second key pressed while the first is down GLIDES, rather than restarting. That is the slide
//     from the sequencer, arrived at from the other end.
//   - releasing the newer of two held keys FALLS BACK to the older one rather than going silent, so
//     rolling between two keys never leaves a gap.
//
// Both are audible and neither is visible. A missed fallback is a hole in a phrase somebody plays once
// and cannot reproduce; a missed legato is a retriggered envelope that just sounds a bit wrong.

export interface Press {
  held: number[]
  /**
   * Whether this note glides into the one already sounding.
   *
   * True whenever something else was already down — including a key pressed twice without release,
   * which a browser's auto-repeat cannot produce but a pointer sliding across the keys can.
   */
  legato: boolean
}

/** Put a note on top of the stack. A note already in it moves up rather than appearing twice. */
export function pressNote(held: readonly number[], semitone: number): Press {
  const next = [...held.filter((note) => note !== semitone), semitone]
  return { held: next, legato: next.length > 1 }
}

export interface Lift {
  held: number[]
  /**
   * The note that should be sounding now: the newest one still down, or null to close the gate.
   *
   * Null only when the stack empties. Releasing the top of a two-note stack returns the other note,
   * which the caller re-triggers legato — the gap this prevents is the one a player hears.
   */
  sounding: number | null
}

/** Take a note off the stack, wherever in it that note happens to be. */
export function liftNote(held: readonly number[], semitone: number): Lift {
  const next = held.filter((note) => note !== semitone)
  return { held: next, sounding: next.length > 0 ? next[next.length - 1] : null }
}

/**
 * Everything up, as when the window loses focus.
 *
 * A key held while focus leaves never sends its key-up, so without this the note sustains until
 * something else happens to stop it — which, on a monophonic voice, can be minutes.
 */
export function releaseAll(): Lift {
  return { held: [], sounding: null }
}
