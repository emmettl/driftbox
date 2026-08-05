import { isFormControl } from './text-entry.js'

// The sequencer page's six keys, as one decision.
//
// Out of `App.tsx` because it was a ladder of six `if`s inside a `keydown` listener, and none of them
// could be asked a question. It also held the fifth copy in this app of "never steal a key from a field
// somebody is typing in" — the rack collected three into `rack/shortcuts.ts`, the Keys panel had a fourth,
// and this was the last one, written as the same inline array literal.

export type AppAction =
  | { kind: 'transport' }
  | { kind: 'help' }
  | { kind: 'performance' }
  | { kind: 'scope' }
  | { kind: 'scene' }
  | null

export interface AppKeyStroke {
  key: string
  /** Physical key, so the space bar is the space bar whatever the layout says it types. */
  code?: string
  repeat?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
}

/**
 * What a keydown on the sequencer page means.
 *
 * `Escape` leaves performance mode and means nothing outside it, so it is the one key whose answer
 * depends on where you already are. Everything else is the same key everywhere.
 *
 * Two guards that were not here before, both the same failure — a keystroke doing something nobody asked
 * for:
 *
 *   - **Accelerators are refused.** `v`, `x` and `c` are the performance, scope and scene keys, which
 *     meant Cmd+C on a selection changed the visual scene and Cmd+X changed the meter. Copying something
 *     off the page is not a request to redecorate it.
 *   - **Auto-repeat is refused.** Space is the transport and the handler suppresses the browser's own
 *     scroll, so holding it down toggled play and stop thirty times a second and left the transport in
 *     whichever state the key happened to come up on.
 */
export function appKeyDown(event: AppKeyStroke, performing: boolean): AppAction {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return null
  if (isFormControl(event.target ?? null)) return null

  // The physical key rather than what it types: space on a focused slider is already excluded above, and
  // a layout that puts something else there still has a space bar.
  if (event.code === 'Space') return { kind: 'transport' }
  if (event.key === '?') return { kind: 'help' }

  const key = event.key.toLowerCase()
  if (key === 'v') return { kind: 'performance' }
  if (event.key === 'Escape') return performing ? { kind: 'performance' } : null
  if (key === 'x') return { kind: 'scope' }
  if (key === 'c') return { kind: 'scene' }
  return null
}

/**
 * Whether the browser's own meaning for the key must be suppressed.
 *
 * Only the two that would otherwise do something visible: space scrolls the page, and `?` opens a
 * find-in-page bar in some browsers. Leaving `v`, `x`, `c` and `Escape` alone matters — `Escape` still
 * has to close a native dialog stacked above this one.
 */
export const claimsKey = (action: AppAction): boolean =>
  action?.kind === 'transport' || action?.kind === 'help'
