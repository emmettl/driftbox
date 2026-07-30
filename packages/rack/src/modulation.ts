import type { ModRoute, ModuleDef, Patch, PatchModule, Registry } from './types.js'

// Combinator routing: turning one rotary and having six knobs move.
//
// This is the whole of Reason's Modulation Routing, and the surprising thing about it is where it does
// *not* live. It is not in the graph, not in the plan, not on the audio thread, and it adds nothing to the
// message ABI. A route is arithmetic from one parameter to another, and both are already numbers in the
// patch — so applying one is a pure function from a Patch to a Patch, and everything downstream carries it
// for free: the routed value saves, autosaves, travels in a URL, renders in an offline export, and shows up
// as the target knob visibly moving. None of that needed a line of new machinery.
//
// **Why not make it a cable into a param instead?** Because a param is not an inlet. An inlet is a buffer
// the graph fills at sample rate; a param is a slot the host writes and the Graph ramps across one block.
// Joining the two would mean either promoting every param to a buffer — doubling the allocation for
// something a knob moves twice a minute — or letting the audio thread write params, which is a second
// writer on values the host believes it owns. The MIDI module's `hidden` flag documents how badly that
// fight goes. Control-rate is also what Reason's Combinator actually is, so this is faithful rather than a
// compromise.
//
// **The rule for two routes onto one target: the later one wins.** Same rule as two cables into one inlet,
// and it should be — a contested destination is the same problem in both places, and having the answer
// differ by which kind of connection you happened to use would be a trap. `applyModulation` walks the list
// in order and simply writes, so the last write stands.
//
// **One pass, over a working copy.** A route whose *source* was written by an earlier route reads the new
// value, so chaining one Combinator into another works and works in a defined order. One pass is also what
// bounds it: a route from A to B and back from B to A settles after a single application instead of
// oscillating for ever, at the cost of the second route being a block behind — which is exactly the trade
// the compiler makes when it breaks a cycle in the cable graph, and it is the same trade for the same
// reason.

/** A route that could be resolved against the registry, with everything needed to apply it. */
interface Resolved {
  route: ModRoute
  target: PatchModule
  def: ModuleDef
  /** The target's param def. */
  param: ModuleDef['params'][number]
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * What a param currently reads, falling back to its default.
 *
 * The same rule `compile` uses and the store's `paramValue` uses, and the third copy is deliberate: this
 * file is in `@driftbox/rack` and must not reach into the app, and `compile`'s copy is entangled with
 * migration and clamping. Three lines, one rule, asserted in the tests of all three.
 */
function paramValue(module: PatchModule, def: ModuleDef, paramId: string): number | null {
  const param = def.params.find((candidate) => candidate.id === paramId)
  if (!param) return null
  const saved = module.params?.[paramId]
  return finite(saved) ? saved : param.default
}

/**
 * Where a route's source sits, as 0..1 across its own range.
 *
 * Normalised rather than assumed, which is what lets the source be a rotary running 0..127, a button
 * running 0..1, or any param a later module invents — including another module's, because nothing here
 * checks that the source is a Combinator. A rotary is the obvious thing to drive a route with; an ADSR's
 * sustain knob is a stranger one and there is no reason to forbid it.
 */
export function sourcePosition(
  patch: Patch,
  registry: Registry,
  from: readonly [string, string],
): number | null {
  const module = patch.modules.find((candidate) => candidate.id === from[0])
  if (!module) return null
  const def = registry[module.type]
  if (!def) return null
  const param = def.params.find((candidate) => candidate.id === from[1])
  if (!param) return null

  const value = paramValue(module, def, from[1])
  if (value === null) return null
  const span = param.max - param.min
  if (span === 0) return 0
  const position = (value - param.min) / span
  return position < 0 ? 0 : position > 1 ? 1 : position
}

/**
 * What one route puts on its target, given where its source is.
 *
 * Linear between `min` and `max`, then clamped to the target's own range and rounded if the target is
 * stepped. The rounding is not a detail: a route onto a VCO's waveform selector or a Quantizer's scale has
 * to land *on* a shape rather than two thirds of the way between two of them, which is the same reason
 * `ParamDef.stepped` exists at all.
 */
export function routeValue(route: ModRoute, position: number, param: ModuleDef['params'][number]): number {
  const min = finite(route.min) ? route.min : param.min
  const max = finite(route.max) ? route.max : param.max
  // `min > max` is legal and inverts the route. Reason's Min/Max work this way and it is the cheapest way
  // to have one rotary open one thing while it closes another.
  let value = min + (max - min) * position
  if (value < param.min) value = param.min
  else if (value > param.max) value = param.max
  return param.stepped ? Math.round(value) : value
}

/**
 * Resolve a route against the registry, or null if either end is missing.
 *
 * A route naming a module or a param this build does not have is **skipped, never deleted** — the same rule
 * `compile` applies to an unknown module type, and for the identical reason: opening a newer patch in an
 * older build and re-saving must not quietly demolish it. `patch-io.ts` carries routes through untouched,
 * so a route this build cannot apply survives a round trip and works again in the build that can.
 */
function resolve(patch: Patch, registry: Registry, route: ModRoute): Resolved | null {
  if (!Array.isArray(route?.to) || !Array.isArray(route?.from)) return null
  const target = patch.modules.find((candidate) => candidate.id === route.to[0])
  if (!target) return null
  const def = registry[target.type]
  if (!def) return null
  const param = def.params.find((candidate) => candidate.id === route.to[1])
  if (!param) return null
  // A hidden param is one the host writes — a MIDI module's note. Routing a rotary at it would be the
  // second-writer fight that flag exists to prevent, so a route at one is resolved as unroutable rather
  // than obeyed. Kept in the patch like any other unresolvable route.
  if (param.hidden) return null
  return { route, target, def, param }
}

/**
 * Apply every routing in a patch, returning a patch whose target params say what its rotaries say.
 *
 * Pure, total, and idempotent for a patch with no chains in it — applying it twice changes nothing, which
 * matters because it runs on every knob turn *and* inside `compile`. Two callers, one function, and so they
 * cannot disagree about what a routing means:
 *
 *   - the **store** applies it so the target knob visibly moves and the document saves what is heard;
 *   - **`compile`** applies it so a patch that never went through a store — a shipped preset, a link opened
 *     headlessly, an offline render — still plays what its routing says.
 *
 * Modules with no route pointing at them are returned by reference, so React's diffing still sees that most
 * of the rack did not change.
 */
export function applyModulation(patch: Patch, registry: Registry): Patch {
  const routes = Array.isArray(patch?.modulation) ? patch.modulation : []
  if (routes.length === 0) return patch

  // A working copy, keyed by id. Written as routes are applied, so a route reading a param an earlier route
  // wrote sees the new value — see the note on chaining at the top of this file.
  const working = new Map<string, PatchModule>(patch.modules.map((module) => [module.id, module]))
  const live: Patch = { ...patch, modules: patch.modules }
  let changed = false

  for (const route of routes) {
    // Rebuilt each time rather than hoisted, so `sourcePosition` reads the working copy. The array is
    // small — a Combinator has eight controls — and this runs on a knob turn, not per block.
    live.modules = [...working.values()]

    const resolved = resolve(live, registry, route)
    if (!resolved) continue
    const position = sourcePosition(live, registry, route.from)
    if (position === null) continue

    const value = routeValue(route, position, resolved.param)
    const current = paramValue(resolved.target, resolved.def, resolved.param.id)
    if (current === value) continue

    working.set(resolved.target.id, {
      ...resolved.target,
      params: { ...resolved.target.params, [resolved.param.id]: value },
    })
    changed = true
  }

  // The identity is the signal everywhere else in this app — the store diffs patches by reference and the
  // Graph compares data arrays by identity — so a pass that changed nothing has to hand back the same
  // object rather than an equal one.
  if (!changed) return patch
  return { ...patch, modules: patch.modules.map((module) => working.get(module.id) ?? module) }
}

/**
 * Which params are being driven by a routing, as `moduleId` → set of `paramId`.
 *
 * For a faceplate that wants to say so. A knob that moves on its own and cannot be held is confusing until
 * you know why, and the honest fix is to mark it rather than to disable it — Reason lets you grab a routed
 * knob too, and the routing simply takes it back on the next gesture.
 */
export function routedParams(patch: Patch): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const route of Array.isArray(patch?.modulation) ? patch.modulation : []) {
    if (!Array.isArray(route?.to)) continue
    const [moduleId, paramId] = route.to
    if (typeof moduleId !== 'string' || typeof paramId !== 'string') continue
    const set = out.get(moduleId) ?? new Set<string>()
    set.add(paramId)
    out.set(moduleId, set)
  }
  return out
}
