// The rack's keyboard, as predicates.
//
// Every one of these was an `if` at the top of a `keydown` listener inside `RackApp`, which made the most
// important rule in the set — **never steal a key from a field somebody is typing in** — three separate
// copies of a tag-name check. Hijacking Cmd+Z inside a rename field would replace the browser's own undo,
// about a different thing, with a patch-level one; that is the sort of bug people describe as "it deleted
// my typing" and nobody can reproduce on demand.
//
// Pure, so `shortcuts.test.ts` can hold each rule against the events a browser really sends.

/** Anything a keystroke belongs to rather than to the page. */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA'
}

/**
 * The same question for `?`, which a `<select>` also wants.
 *
 * A select responds to typed characters by jumping to a matching option, so opening the help dialog over
 * somebody's half-finished choice is the same theft as the text case. The undo and flip keys leave selects
 * alone because neither `Tab` nor Cmd+Z types anything into one.
 */
export function isFormControl(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return isTextEntry(target) || element?.tagName === 'SELECT'
}

/** `?` opens the guide, unless it is being typed into something. */
export function isHelpKey(event: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  return event.key === '?' && !isFormControl(event.target)
}

/** Tab flips the rack, the way it does in Reason. Kept off inputs so a rename field is still usable. */
export function isFlipKey(event: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  return event.key === 'Tab' && !isTextEntry(event.target)
}

/**
 * Undo and redo, on the keys every other program puts them on.
 *
 * Both accents are accepted — Cmd on a Mac, Ctrl elsewhere, plus Ctrl+Y for redo, which is what Windows
 * habits reach for.
 */
export function historyIntent(
  event: Pick<KeyboardEvent, 'key' | 'target' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
): 'undo' | 'redo' | null {
  if (!event.metaKey && !event.ctrlKey) return null
  const key = event.key.toLowerCase()
  const back = key === 'z' && !event.shiftKey
  const forward = (key === 'z' && event.shiftKey) || key === 'y'
  if (!back && !forward) return null
  if (isTextEntry(event.target)) return null
  return back ? 'undo' : 'redo'
}
