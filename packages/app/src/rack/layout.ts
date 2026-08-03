import type { ModuleDef, PatchModule, Port } from '@driftbox/rack'

// Where every module and every jack sits, in one coordinate system.
//
// This is pure arithmetic on plain objects, and that is the point. The alternative is measuring the
// DOM — `getBoundingClientRect` on every jack — and then cables would depend on layout having
// settled, would need re-measuring on every resize and every scroll, and could not be tested
// without a browser. Instead the front panel, the back panel and the cables are all laid out in the
// same fixed design space, and the SVG that draws the cables uses it as its `viewBox`. Nothing has
// to agree with anything at runtime because there is only one set of numbers.
//
// The space is in design units that happen to be pixel-ish at a normal zoom. It scales as one piece.

/** One half-width column. A full-width module is two of these. */
export const COLUMN = 240
/**
 * One row of rack height. Modules are a whole number of rows tall.
 *
 * Fine rather than coarse — 60 and not the 104 this started at. A coarse row means a module with two
 * knobs rounds up to the same height as one with six, and the first render of this had a Clock with two
 * knobs and 90px of nothing under them. The row still exists so that modules line up; it just should not
 * be the reason a module is empty.
 */
export const ROW = 60

/**
 * One control's cell on a faceplate.
 *
 * Every control is exactly this size — a knob, a two-option selector, a twelve-option stepper. That is
 * what lets `genericRows` compute a module's height by arithmetic instead of measuring the DOM, and it is
 * why a param with twelve positions gets a stepper rather than twelve buttons: twelve buttons cannot fit
 * in a cell, and a control that changes the grid's shape takes the arithmetic with it.
 */
export const CELL_WIDTH = 58
export const CELL_HEIGHT = 62
/** The title strip, and the padding above and below the controls. */
export const TITLE = 28
export const PAD = 18

/** Vertical pitch between jacks on the back panel. */
export const JACK = 30
/** How far in from the edge of a column the jacks sit. */
export const JACK_INSET = 30

export const RACK_WIDTH = COLUMN * 2

/** Half or full width. Nothing wider — a rack that lines up is worth more than a module that fits
 *  its contents exactly, and this is the one dimension where being strict pays off visually. */
export type Span = 1 | 2

export interface Size {
  span: Span
  rows: number
}

export interface Placement {
  id: string
  type: string
  span: Span
  /** 0 or 1. Always 0 for a full-width module. */
  column: 0 | 1
  row: number
  rows: number
  /** In design units, ready to position with. */
  x: number
  y: number
  width: number
  height: number
}

export interface Layout {
  placements: Placement[]
  rows: number
  width: number
  height: number
}

/** A rectangle in rack design units. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** The direction-independent rectangle swept between two pointer positions. */
export function boundsBetween(
  start: { x: number; y: number },
  end: { x: number; y: number },
): Bounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/**
 * Devices touched by a rubber-band rectangle, in rack order.
 *
 * Edge contact alone does not count. That keeps a band ending exactly on a row or column boundary from
 * unexpectedly taking the device on the far side, while any visible overlap does — the convention used
 * by desktop editors rather than requiring somebody to surround a whole faceplate.
 */
export function placementsInBounds(
  placements: readonly Placement[],
  bounds: Bounds,
): string[] {
  if (bounds.width <= 0 || bounds.height <= 0) return []
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  return placements
    .filter(
      (placement) =>
        placement.x < right &&
        placement.x + placement.width > bounds.x &&
        placement.y < bottom &&
        placement.y + placement.height > bounds.y,
    )
    .map((placement) => placement.id)
}

/** The geometry shared by the front and rear versions of a lifted module. */
export interface ModuleDragGeometry {
  id: string
  /** Pointer position in rack design units. */
  at: { x: number; y: number }
  /** Where within the module it was picked up. */
  grab: { x: number; y: number }
  /** The lifted size. A preview pairing may stretch a slot, but not the thing in the hand. */
  width: number
  height: number
}

/** Where a lifted module actually is, rather than the slot it would occupy if released. */
export function dragBounds(drag: ModuleDragGeometry): Bounds {
  return {
    x: drag.at.x - drag.grab.x,
    y: drag.at.y - drag.grab.y,
    width: drag.width,
    height: drag.height,
  }
}

/**
 * Replace the preview slot for the lifted module with its pointer-following position.
 *
 * The rear panel feeds this result to `jacks`, which makes the bay, every jack on it and every attached
 * cable endpoint move from the same geometry. Keeping it pure also checks the half-width case without
 * trying to infer SVG positions from a browser screenshot.
 */
export function withDraggedPlacement(
  placements: readonly Placement[],
  drag: ModuleDragGeometry,
): Placement[] {
  const bounds = dragBounds(drag)
  return placements.map((placement) =>
    placement.id === drag.id ? { ...placement, ...bounds } : placement,
  )
}

/**
 * Stack modules down the rack, in patch order.
 *
 * Two adjacent half-width modules share a row; anything else gets a row to itself. Order-preserving
 * on purpose: a packer that shuffled modules to fill gaps would move things the user had arranged,
 * and in a rack the arrangement IS the document. A lone half-width module leaves the other half of
 * its row empty, which looks deliberate and is.
 */
export function layout(modules: readonly PatchModule[], sizeFor: (type: string) => Size): Layout {
  const placements: Placement[] = []
  let row = 0

  for (let i = 0; i < modules.length; i++) {
    const module = modules[i]
    const size = sizeFor(module.type)

    const next = modules[i + 1]
    const nextSize = next ? sizeFor(next.type) : null
    const paired = size.span === 1 && nextSize?.span === 1

    const rows = paired ? Math.max(size.rows, nextSize.rows) : size.rows

    placements.push(place(module, size.span, 0, row, rows))
    if (paired && next) {
      placements.push(place(next, 1, 1, row, rows))
      i++
    }
    row += rows
  }

  return {
    placements,
    rows: row,
    width: RACK_WIDTH,
    height: row * ROW,
  }
}

function place(
  module: PatchModule,
  span: Span,
  column: 0 | 1,
  row: number,
  rows: number,
): Placement {
  return {
    id: module.id,
    type: module.type,
    span,
    column,
    row,
    rows,
    x: column * COLUMN,
    y: row * ROW,
    width: span * COLUMN,
    height: rows * ROW,
  }
}

// ---------------------------------------------------------------------------------------
// Jacks
// ---------------------------------------------------------------------------------------

export interface Jack {
  module: string
  port: string
  name: string
  kind: 'in' | 'out'
  /** Two channels on one jack. Drawn differently, because a cable out of one carries a pair. */
  stereo: boolean
  x: number
  y: number
}

/**
 * Where each module's jacks sit on the back panel.
 *
 * Inlets down the left edge, outlets down the right. Not because it is prettier — because it makes a
 * signal chain read left to right, so a patch that flows the obvious way has cables that mostly
 * point the same direction and a patch with feedback in it visibly doubles back. That is free
 * information about what a patch does, from the geometry rather than from a label.
 *
 * The back panel is ALWAYS laid out from the def like this, even for a module whose front is
 * hand-built. Reason's back panels were near-uniform too, and the payoff is that cables work for
 * every module including one this build has never heard of.
 */
export function jacks(placements: readonly Placement[], defs: Record<string, ModuleDef>): Jack[] {
  const out: Jack[] = []

  for (const placement of placements) {
    const def = defs[placement.type]
    if (!def) continue

    const column = (ports: readonly Port[], kind: 'in' | 'out') => {
      // Centred vertically in the module's slot, so a two-row module with one jack does not have it
      // clinging to the top edge.
      const span = (ports.length - 1) * JACK
      const top = placement.y + placement.height / 2 - span / 2
      ports.forEach((port, index) => {
        out.push({
          module: placement.id,
          port: port.id,
          name: port.name,
          stereo: port.stereo === true,
          kind,
          x:
            kind === 'in'
              ? placement.x + JACK_INSET
              : placement.x + placement.width - JACK_INSET,
          y: top + index * JACK,
        })
      })
    }

    column(def.inlets, 'in')
    column(def.outlets, 'out')
  }

  return out
}

/** How many rows a module needs for its jacks alone. A Mixer has eight inlets and would otherwise have
 *  them overlapping, or spilling out of its own slot and into the module below. */
export function rowsForJacks(def: ModuleDef): number {
  const most = Math.max(def.inlets.length, def.outlets.length, 1)
  return Math.max(1, Math.ceil(((most - 1) * JACK + 40) / ROW))
}

/**
 * "3 in · 1 out". What a module's jacks add up to, said in words.
 *
 * Here rather than in either of the two places that draw it — the generic faceplate's title strip and the
 * picker's cards — because two of them would eventually disagree, and this is exactly the sort of string
 * nobody would notice had drifted.
 *
 * The "in" half is dropped when there is none. A Transport reading "0 in · 6 out" spends half the line
 * saying nothing, and "no inlets" is a thing you can see by looking at the module anyway.
 */
export function portSummary(def: ModuleDef): string {
  const parts = []
  if (def.inlets.length) parts.push(`${def.inlets.length} in`)
  parts.push(`${def.outlets.length} out`)
  return parts.join(' · ')
}

/** How many control cells fit across a module of this span. */
export function columnsFor(span: Span): number {
  return span === 1 ? 3 : 7
}

/**
 * The jack nearest a point, within `radius`, optionally of one kind only.
 *
 * This is how a cable finds what it was dropped on, and it replaced asking the DOM. `pointerup`'s target
 * is not the thing under the pointer on a touchscreen: the browser applies implicit pointer capture, so
 * every event including the release is delivered to the element the touch *started* on. Patching was
 * therefore completely broken on touch while working on a mouse, and the source jack was being handed to
 * itself as the drop target.
 *
 * Resolving by position fixes that and is better than fixing it with `elementFromPoint`, for three
 * reasons: it behaves identically for mouse and touch, it needs no DOM at all so it is testable here, and
 * it SNAPS — which is not a nicety on a touchscreen where a fingertip is wider than the jack it is
 * covering.
 *
 * Filtering by kind is what makes the snap forgiving rather than merely tolerant: dragging from an outlet,
 * only inlets are candidates, so the nearest sensible target wins instead of the nearest one of any sort.
 */
export function nearestJack(
  list: readonly Jack[],
  point: { x: number; y: number },
  radius: number,
  kind?: 'in' | 'out',
): Jack | undefined {
  let best: Jack | undefined
  let closest = radius
  for (const jack of list) {
    if (kind && jack.kind !== kind) continue
    const distance = Math.hypot(jack.x - point.x, jack.y - point.y)
    if (distance <= closest) {
      closest = distance
      best = jack
    }
  }
  return best
}

/** How close a drop has to be to count. Generous, because "nearest" resolves any ambiguity — and a
 *  fingertip is wider than a jack. */
export const SNAP = 30

// ---------------------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------------------

/**
 * Where a module dragged to `point` would be inserted, as an index into the module list.
 *
 * Here rather than in the component for the same reason `nearestJack` is: this is geometry, the whole
 * point of this file is that the geometry is arithmetic rather than DOM measurement, and a rule that
 * lives in a pointer handler can only be checked by hand in a browser.
 *
 * **Counted by midpoints rather than by hit-testing a box.** Asking which module the pointer is *over*
 * has no answer in the gaps and no answer past either end, so it needs special cases that are easy to
 * get subtly wrong. A full-width row is crossed vertically. Within a row of half-width modules, each
 * module is crossed horizontally. That gives every point an insertion index and, crucially, makes it
 * possible to put a narrow module to the left or right of another one instead of only above or below it.
 *
 * A lone half-width module uses the same horizontal rule. Dropping on its empty right half inserts after
 * it, which lets the layout pair the two modules; dropping on its left inserts before it and makes the
 * dragged module the left-hand one.
 */
export function dropIndex(
  placements: readonly Placement[],
  point: { x: number; y: number },
): number {
  let index = 0

  while (index < placements.length) {
    const first = placements[index]
    const row = [first]
    while (
      index + row.length < placements.length &&
      placements[index + row.length].row === first.row
    ) {
      row.push(placements[index + row.length])
    }

    const bottom = Math.max(...row.map((placement) => placement.y + placement.height))
    if (point.y < first.y) return index
    if (point.y >= bottom) {
      index += row.length
      continue
    }

    // A narrow row reads left to right. This includes a lone narrow module: crossing its midpoint
    // means "put it on the right", while staying before it means "put it on the left".
    if (row.some((placement) => placement.span === 1)) {
      let crossed = 0
      for (const placement of row) {
        if (point.x > placement.x + placement.width / 2) crossed++
      }
      return index + crossed
    }

    return point.y > first.y + first.height / 2 ? index + 1 : index
  }

  return placements.length
}

/**
 * The module list with `from` moved so that it lands at `to`.
 *
 * `to` is an insertion index *in the original list*, which is what `dropIndex` reports — so moving a
 * module downward has to account for its own removal shifting everything after it up by one. Getting
 * that wrong is the classic off-by-one in every drag-to-reorder, and the symptom is that dragging one
 * place down does nothing at all: the item is removed from index 3, re-inserted at index 4, and index 4
 * of the shortened list is where it already was.
 *
 * Returns the same array reference when nothing would move, so a drag that ends where it started does
 * not bump the revision and rebuild the graph.
 */
export function reordered<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from < 0 || from >= items.length) return items
  const target = Math.max(0, Math.min(items.length, to))
  // Removing `from` shifts everything after it down one, so an insertion point beyond it means the same
  // position it already occupies.
  if (target === from || target === from + 1) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(target > from ? target - 1 : target, 0, moved)
  return next
}

/**
 * Find a jack by module, port **and kind**.
 *
 * The kind is not optional, and that is the point. A port id is unique within its own column but not
 * across both, and nothing ever said it had to be: `Arp` has a `pitch` inlet and a `pitch` outlet, which
 * is the natural naming for a module that takes a note and gives back a different one, and the patch
 * format has always allowed it — a cable's ends are an outlet and an inlet *by position*, so `from` and
 * `to` carry the direction that a flat list of jacks throws away.
 *
 * Looking one up without saying which side you meant answered with the inlet every time, because
 * `jacks()` builds the inlet column first. Every cable's endpoints are resolved through here, so a cable
 * leaving `Arp` was drawn leaving the wrong hole — on the left, where its input is.
 */
export function jackAt(
  list: readonly Jack[],
  module: string,
  port: string,
  kind: 'in' | 'out',
): Jack | undefined {
  return list.find(
    (jack) => jack.module === module && jack.port === port && jack.kind === kind,
  )
}
