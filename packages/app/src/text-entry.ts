// The most important rule any page-level keyboard listener has: **never steal a key from a field
// somebody is typing in.**
//
// It lives here rather than beside either keyboard because both of them need it and neither owns it. The
// rack's listener had three copies of the tag-name check before `rack/shortcuts.ts` collected them; the
// sequencer's `Keys` had a fourth, written as an array literal inline in its `keydown` handler. Four
// spellings of one rule is how one of them ends up missing `SELECT`.

/** Anything a keystroke belongs to rather than to the page. */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA'
}

/**
 * The same question for a `<select>`, which also consumes typed characters.
 *
 * A select responds to them by jumping to a matching option, so a page-level letter key landing on
 * somebody's half-finished choice is the same theft as the text case.
 */
export function isFormControl(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return isTextEntry(target) || element?.tagName === 'SELECT'
}
