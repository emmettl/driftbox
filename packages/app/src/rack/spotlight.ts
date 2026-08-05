import type { RefObject } from 'react'

// Turning "the Add module button" into something a particle stream can fall into.
//
// `PlayBeacon` wants a ref. A tour step cannot hold one: it is data, written in `tutorials.ts` long before
// anything renders, and the control it points at may not exist yet — the Voice card is inside a palette
// that is shut, the Ladder's panel is a module nobody has added. So a step names its target with a **CSS
// selector**, and this turns a list of them into something ref-shaped.
//
// **A getter rather than a stored element, and that is the whole trick.** The beacon already re-reads
// `target.current.getBoundingClientRect()` every frame, because buttons move with the safe-area inset and
// when the header rewraps. Resolving the selector in that same read makes the target *live* for free: the
// stream follows a control that has only just appeared, lets go of one that has gone, and needs no
// observer, no polling and no cache that can go stale. One `querySelector` per frame per stream, against a
// single attribute selector, is not a cost worth engineering around.
//
// **Several selectors, most specific first.** The commonest step in these tours is "open the picker and
// choose the Voice", which is two targets in sequence and one instruction. Written as
// `['.rk-card[data-module="voice"]', '[data-beacon="add"]']` it is one: the stream sits on Add module
// until the palette opens, then moves to the card, because the card is now the first one that matches.

/**
 * A live ref that always answers with the first of these selectors currently in the document.
 *
 * Returns something with a `current`, so it drops straight into `BeaconTarget.target`. Nothing is stored:
 * every read is a fresh query.
 */
export function spotlightRef(selectors: readonly string[]): RefObject<HTMLElement | null> {
  return {
    get current() {
      for (const selector of selectors) {
        // Guarded because these are hand-written strings in a data file. A typo that made a selector
        // invalid would otherwise throw inside a requestAnimationFrame callback, where it takes the whole
        // beacon down and reads as the rack having broken rather than as a tour pointing nowhere.
        try {
          const found = document.querySelector<HTMLElement>(selector)
          if (found) return found
        } catch {
          continue
        }
      }
      return null
    },
  }
}

/**
 * Is this a selector a tour is allowed to aim at?
 *
 * The tours may only name things that exist *to be named* — `data-beacon` on a header control,
 * `data-module-type` on a module's front or back panel, `data-module` or `data-chunk` on a picker card.
 * All four are attributes put there for this and for nothing else, so renaming a class or restyling a
 * button cannot silently unaim a tour.
 *
 * Exported for the test rather than used at runtime: a selector that has rotted points at nothing and
 * fails silently, which is exactly the class of bug worth catching where it is cheap.
 */
export function isAimable(selector: string): boolean {
  return /^(\.rk-card)?\[data-(beacon|module|module-type|chunk)="[a-z0-9-]+"\]$/.test(selector)
}
