import type { ModuleDef } from '@driftbox/rack'
import { CELL_HEIGHT, PAD, ROW, TITLE, columnsFor, rowsForJacks, type Size, type Span } from '../layout.js'
import { Combinator } from './Combinator.js'
import { Generic } from './Generic.js'
import { Ladder } from './Ladder.js'
import { Midi } from './Midi.js'
import { Out } from './Out.js'
import { Sampler } from './Sampler.js'
import { Vco } from './Vco.js'
import type { FaceplateComponent } from './types.js'

// Which modules have a hand-built front panel, and what happens to the ones that do not.
//
// **The registry is sparse and there is a fallback.** That is the whole design, and it is the same
// principle the compiler uses for a module type it does not recognise: degrade sensibly rather than
// fail. A module with no entry here still gets a working faceplate, derived from its def — its name,
// a control per param, a count of its jacks. Not beautiful; usable, and correct by construction
// because it cannot disagree with the def it was generated from.
//
// Three consequences worth being explicit about, because they are why it is built this way rather
// than as sixteen hand-written components:
//
//   1. **Adding a module stays a class, a def and a test.** No UI work is required to make it
//      appear, be patched and be played. Hand-building its faceplate is an improvement you can make
//      later, or never.
//   2. **A module loaded from somewhere else gets a faceplate for free.** If third-party modules
//      ever happen — step 5 in `docs/RACK.md` — this is the mechanism that makes them presentable
//      without trusting anybody's markup.
//   3. **The back panel is never hand-built.** Jacks are laid out from the def in `layout.ts` for
//      every module without exception, so cables work everywhere, including for a module this build
//      has never heard of.
//
// Reason hand-built every device, which is exactly why it shipped forty and not four hundred.

interface Entry {
  component: FaceplateComponent
  span?: Span
  /** Rows the front needs. The back's needs are worked out from the def and the larger wins. */
  rows?: number
}

const FACEPLATES: Record<string, Entry> = {
  // Eight outlets, so the back already asks for five rows and the front gets them for nothing. Which is
  // just as well: a row of four rotaries, a row of four buttons and a way through to the routing list is
  // about that tall, and a Combinator is a big device in Reason too.
  combi: { component: Combinator, rows: 5 },
  vco: { component: Vco, rows: 2 },
  ladder: { component: Ladder },
  midi: { component: Midi, rows: 2 },
  out: { component: Out, span: 1 },
  sampler: { component: Sampler, rows: 3 },
}

export function faceplateFor(type: string): FaceplateComponent {
  return FACEPLATES[type]?.component ?? Generic
}

/**
 * How big a module is.
 *
 * The front and the back both have to fit, and they have different needs — a Mixer has two knobs and
 * eight inlets, so its height comes from the jacks; a VCO has three controls and three jacks, so its
 * height comes from the front. Taking the larger of the two is what keeps a module's jacks inside
 * its own slot instead of spilling into the module below it.
 */
export function sizeFor(defs: Record<string, ModuleDef>): (type: string) => Size {
  return (type) => {
    const def = defs[type]
    const entry = FACEPLATES[type]
    const span = entry?.span ?? 2
    if (!def) return { span, rows: entry?.rows ?? 1 }

    const front = entry?.rows ?? genericRows(def, span)
    return { span, rows: Math.max(front, rowsForJacks(def)) }
  }
}

/**
 * What the generic faceplate needs: a title, then its controls in a grid.
 *
 * Exact rather than approximate, because the grid is a real CSS grid with a fixed column count and a
 * fixed cell size — so this arithmetic and the rendered height cannot disagree. The first version of
 * this guessed at a flex-wrapped layout and was wrong by 250px on the sequencer, which rendered as a
 * module with a large empty hole in it.
 */
export function genericRows(def: ModuleDef, span: Span): number {
  // Visible params only. A hidden one is written by the host and never drawn, so counting it would reserve
  // height for a control that is not there — which is the same class of mistake as the flex-wrap formula
  // this replaced, just quieter.
  const shown = def.params.filter((param) => !param.hidden).length
  if (shown === 0) return 1
  const stacked = Math.ceil(shown / columnsFor(span))
  return Math.max(1, Math.ceil((TITLE + PAD + stacked * CELL_HEIGHT) / ROW))
}

export { Generic } from './Generic.js'
export type { FaceplateComponent, FaceplateProps } from './types.js'
