import type { RackView } from './view.js'

/**
 * The one line in the footer that says what your hands can do here.
 *
 * Six sentences, one per arrangement of the instrument and per side of it, because the useful advice is
 * genuinely different in each: there is no knob to drag in full-pad mode, and nothing to patch on the
 * front. It was a nested ternary inside the footer's JSX, which is exactly where a wrong pairing hides —
 * the back of the rack quietly advising you to drag a knob is not a crash and not a visual glitch.
 */
export function rackHint(view: RackView, flipped: boolean): string {
  if (view === 'split') {
    return flipped
      ? 'Patch while you perform · the creature keeps the filter live'
      : 'Drag knobs and pad together · Tab turns both around'
  }
  if (view === 'pad') {
    return flipped
      ? 'The creature lives back here · the filter still works'
      : 'Drag the pad · Tab to see what is behind it'
  }
  return flipped
    ? 'Drag between jacks to patch · × beside an input unplugs'
    : 'Drag a knob · Tab for the back'
}
