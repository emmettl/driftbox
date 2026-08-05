import { isFormControl } from '../text-entry.js'
import { capFor, semitoneOf, type KeyCap } from './keys-layout.js'

// The computer keyboard, as one decision instead of a ladder of `if`s inside a listener.
//
// Out of `Keys.tsx` because the ladder had three rules tangled together — what the key means, whether it
// means anything here, and whether the browser's own meaning has to be suppressed — and none of them
// could be asked a question. The one that matters most is the guard at the top: `a` through `k` are
// notes, so without it, typing a pattern name would play a tune and write nothing.

export type KeyAction =
  | { kind: 'note'; semitone: number }
  | { kind: 'rest' }
  | { kind: 'tie' }
  | { kind: 'octave'; delta: number }
  | { kind: 'accent'; down: boolean }
  | null

/** The parts of a keystroke this keyboard reads. */
export interface KeyStroke {
  key: string
  repeat?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
}

export interface KeysState {
  octave: number
  /**
   * Whether 303 step entry is open, which is what makes Backspace and Enter mean anything.
   *
   * False while a pitched drum is selected, in another view, or with no entry cursor: a rest written
   * into a tom lane is not a thing, and Backspace elsewhere should keep its usual meaning.
   */
  entry: boolean
}

/**
 * What a keydown means here, or null for one that belongs to somebody else.
 *
 * The accelerators are refused outright — a keyboard that plays a note on Cmd+S is one you cannot save
 * from — and so is anything landing on a field. Auto-repeat is refused too: held down, it would
 * retrigger the note thirty times a second, which is the opposite of holding a note.
 */
export function keysKeyDown(event: KeyStroke, state: KeysState): KeyAction {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return null
  if (isFormControl(event.target ?? null)) return null

  const cap = capFor(event.key)
  if (cap) return { kind: 'note', semitone: semitoneOf(cap, state.octave) }

  if (state.entry && event.key === 'Backspace') return { kind: 'rest' }
  if (state.entry && event.key === 'Enter') return { kind: 'tie' }

  if (event.key === 'z') return { kind: 'octave', delta: -1 }
  if (event.key === 'x') return { kind: 'octave', delta: 1 }
  if (event.key === 'Shift') return { kind: 'accent', down: true }
  return null
}

/**
 * What a keyup means.
 *
 * Deliberately not guarded by the field check the way keydown is. A key pressed on the page and released
 * over a field it was tabbed into still has to lift its note, or it sustains forever.
 */
export function keysKeyUp(event: Pick<KeyStroke, 'key'>, octave: number): KeyAction {
  const cap: KeyCap | undefined = capFor(event.key)
  if (cap) return { kind: 'note', semitone: semitoneOf(cap, octave) }
  if (event.key === 'Shift') return { kind: 'accent', down: false }
  return null
}

/**
 * Whether the browser's own meaning for the key must be suppressed.
 *
 * Only the three that would otherwise do something visible: a note key types a letter, Backspace
 * navigates back in some browsers, and Enter submits. The octave and accent keys are left alone because
 * suppressing them would take `z` away from an undo somebody meant for the page.
 */
export const claimsKey = (action: KeyAction): boolean =>
  action?.kind === 'note' || action?.kind === 'rest' || action?.kind === 'tie'
