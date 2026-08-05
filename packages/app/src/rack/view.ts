// Which of the three arrangements of the instrument is on screen, and which one it opens on.
//
// Split apart from `RackApp` because the opening choice is arithmetic on one number and belongs somewhere a
// Node test can reach it — the component itself needs a DOM to say anything at all.

export type RackView = 'rack' | 'split' | 'pad'

/**
 * The narrowest viewport that seats both bays of the split view.
 *
 * Two 480px bays, the 24px gutter between them, and the grid's 16px padding on either side: 1016px exactly.
 * `rack.css` carries the same number from the other end, as the `max-width: 1015px` where the pair stops
 * being centred and starts at the rack's left edge instead. `view.test.ts` holds the two in step.
 */
export const SPLIT_MIN_WIDTH = 1016

/**
 * The view the rack opens on.
 *
 * Split, wherever there is room for it. The rack alone is a complete instrument and says nothing about the
 * performance surface beside it, so opening on the rack meant the pad — the filter, the scenes, the whole
 * reason the Kaoss insert exists — was reachable only by somebody who thought to press a button labelled
 * View. Anything that has to be discovered before it can be used is, for most people, not there.
 *
 * Below that width it stays on the rack, because split's first impression on a narrow window is a rack cut
 * off at the right-hand edge and a pad you have to swipe sideways to find, which is a worse introduction to
 * both than the rack on its own. The View button still reaches the pad from there.
 *
 * Decided once, at mount, rather than followed live: after the first frame the view is whatever the person
 * chose, and resizing a window is not a request to be moved out of it.
 */
export function initialRackView(viewportWidth: number): RackView {
  return viewportWidth >= SPLIT_MIN_WIDTH ? 'split' : 'rack'
}
