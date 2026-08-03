import type { Patch } from '@driftbox/rack'

// Undo, as a stack of documents rather than a log of inverse operations.
//
// **Storing the patch is the cheap option here, and that is not obvious until you count.** The usual
// argument for an operation log — a patch is large, an operation is small — does not survive the
// measurement `docs/RACK.md` already made for a different reason: a forty-module patch is under a
// thousand characters in a URL. Sixty-four of those is a few tens of kilobytes, which is less than one
// of the seventeen scenes and far less than a single loaded break.
//
// What an operation log would cost is the part that matters. Every action in the store would need an
// inverse, every action added later would need one too, and the day somebody forgets, undo does not
// fail loudly — it silently restores a document that never existed. A stack of whole patches cannot
// have that bug, because it never has to know what an edit meant.
//
// Nothing here touches the store, React or storage, so all of it is testable in Node. That is the same
// standard `layout.ts`, `browse.ts` and `cc.ts` hold themselves to, and for the same reason: the rules
// are where the mistakes are.

export interface HistoryEntry {
  patch: Patch
  /**
   * What kind of edit moved us off this patch, or null for one that must never coalesce.
   *
   * Held on the entry rather than passed around because coalescing is a question about the edit that is
   * *arriving* compared with the one that produced the top of the stack — see `remember`.
   */
  key: string | null
}

export interface History {
  /** Oldest first. The last entry is what one undo restores. */
  past: HistoryEntry[]
  /** What undo has stepped over, newest last. Cleared by any fresh edit. */
  future: HistoryEntry[]
}

export const NO_HISTORY: History = { past: [], future: [] }

/**
 * How many steps back you can go.
 *
 * Sixty-four rather than unlimited. A rack session is a long one and every entry pins a whole patch,
 * including — for a document carrying a retained groovebox song — an encoded song per step. Unlimited
 * would make the memory a function of how long the tab has been open, which is the kind of growth
 * nobody notices until it is a bug report about a slow page.
 */
export const HISTORY_LIMIT = 64

/**
 * A coalescing key: consecutive edits sharing one collapse into a single undo step.
 *
 * **This is the whole reason a knob drag is one undo and not four hundred.** `setParam` fires on every
 * pointer move, sixty times a second, and each of those is a real document change — so without this,
 * one drag of one knob would fill the entire history and undo would crawl back through it a pixel at a
 * time.
 *
 * Keyed by *what was edited* rather than by time. The alternative — collapse anything within 300ms —
 * needs a clock, which makes the rules untestable in Node without faking one, and it is wrong in both
 * directions: a slow deliberate drag becomes many steps, and two quick edits to different knobs become
 * one. Turning the same knob twice in a row genuinely is one gesture; turning two knobs is two.
 */
export function paramKey(moduleId: string, paramId: string): string {
  return `param:${moduleId}:${paramId}`
}

export function dataKey(moduleId: string, slot: string): string {
  return `data:${moduleId}:${slot}`
}

/**
 * Record where we were, before an edit takes effect.
 *
 * `before` is the patch being left behind, not the new one. The current document lives in the store and
 * is not duplicated here — which is what makes `stepBack` need to be handed it.
 */
export function remember(
  history: History,
  before: Patch,
  key: string | null,
  limit = HISTORY_LIMIT,
): History {
  const top = history.past[history.past.length - 1]
  // Coalesce: the top of the stack was left by the same kind of edit, so this one continues a gesture
  // rather than starting another. Keep the OLDER snapshot — undo should land where the drag began, not
  // one pointer move back into it.
  if (key !== null && top?.key === key) {
    return history.future.length === 0 ? history : { past: history.past, future: [] }
  }

  const past = [...history.past, { patch: before, key }]
  // Drop from the front. The oldest step is the one nobody is coming back for, and a limit that dropped
  // the newest would make undo stop working exactly when it is being used hardest.
  if (past.length > limit) past.splice(0, past.length - limit)

  // Any fresh edit abandons the redo stack. This is the standard behaviour everywhere and the only
  // sound one: a redo entry describes a future that the new edit has just made unreachable.
  return { past, future: [] }
}

/** Undo. Returns null when there is nothing to go back to, so the caller can decline without a check. */
export function stepBack(history: History, current: Patch): { history: History; patch: Patch } | null {
  const entry = history.past[history.past.length - 1]
  if (!entry) return null
  return {
    patch: entry.patch,
    history: {
      past: history.past.slice(0, -1),
      // The current document goes onto the redo stack carrying the SAME key, because it is the same
      // edit seen from the other side. That keeps a coalesced drag one step in both directions.
      future: [...history.future, { patch: current, key: entry.key }],
    },
  }
}

/** Redo, the exact mirror. */
export function stepForward(
  history: History,
  current: Patch,
): { history: History; patch: Patch } | null {
  const entry = history.future[history.future.length - 1]
  if (!entry) return null
  return {
    patch: entry.patch,
    history: {
      past: [...history.past, { patch: current, key: entry.key }],
      future: history.future.slice(0, -1),
    },
  }
}

/**
 * Does moving between these two patches need the graph rebuilt?
 *
 * The store's ordinary edits know the answer because they know what they did — `structural` bumps the
 * revision and a knob does not. A restore knows nothing about the edit it is reversing, so it has to
 * ask the document, and asking it the *narrowest* question is the point: a rebuild resets every
 * oscillator's phase and every filter's history, so undoing a knob must not cause one.
 *
 * What the compiler builds a plan from is modules, their types and the cables between them, plus the
 * voice count. **Params and pattern data are deliberately absent from this list**, even though both are
 * compiled into the plan, because both also reach the audio thread as messages — a param ramps across
 * one block and data lands in the Graph's `pushed` map, which beats `seeded` and survives a rebuild.
 * Input trims are absent for the same reason as params: each has its own hidden ramped slot. The retained
 * groovebox song is absent too: it belongs to a hosted engine that swaps its song live, not to the worklet
 * graph.
 */
export function needsRebuild(before: Patch, after: Patch): boolean {
  if (before === after) return false
  if ((before.voices ?? 1) !== (after.voices ?? 1)) return true

  if (before.modules.length !== after.modules.length) return true
  for (let i = 0; i < before.modules.length; i++) {
    const a = before.modules[i]
    const b = after.modules[i]
    // Order as well as membership: the module list *is* the rack's layout, and the plan is emitted in
    // that order. Comparing as sets would call a reorder a no-op and leave the graph as it was.
    if (a.id !== b.id || a.type !== b.type || a.version !== b.version) return true
    // Bypass is structural, because the compiler resolves it into the plan: a bypassed module gets no node
    // and everything reading its outlets is pointed at its input instead. Undoing one therefore has to
    // rebuild, unlike undoing a knob.
    if ((a.bypassed === true) !== (b.bypassed === true)) return true
  }

  if (before.cables.length !== after.cables.length) return true
  for (let i = 0; i < before.cables.length; i++) {
    const a = before.cables[i]
    const b = after.cables[i]
    if (a.from[0] !== b.from[0] || a.from[1] !== b.from[1]) return true
    if (a.to[0] !== b.to[0] || a.to[1] !== b.to[1]) return true
  }

  return false
}
