import type { ModRoute, Patch, PatchCable, PatchModule } from './types.js'

// Turning a patch into text and back.
//
// The writing half is nearly nothing — a Patch is already plain JSON, which was the point of
// building it that way. The reading half is where the work is, and it is careful for the
// reason `song-io.ts` in the engine gives: **a patch arrives from outside the program**. From
// localStorage written by an older build, from a file somebody edited by hand, or from a URL
// somebody else sent. None of that is trustworthy, and the failure mode for trusting it is
// not a subtle bug — it is the rack going silent with somebody's work apparently gone.
//
// So `decodePatch` never throws on a value it can repair, and only gives up if what it was
// handed is not a patch at all.
//
// **It does not take a registry, and that is deliberate.** This file has no idea which
// modules exist. Validating against the registry here would delete exactly what the
// placeholder rule in `compile.ts` exists to protect: a patch has to survive a round trip
// through a build that is missing some of its modules, or opening a newer patch in an older
// build and re-saving would demolish it. Two consequences worth knowing:
//
//   - Param values are NOT clamped here. `compile` clamps them against the def, which is the
//     only place that knows what the range is.
//   - Per-module `version` is preserved but not acted on. Migration needs `ModuleDef.migrate`,
//     so `compile` runs it.

/**
 * Bumped when the shape changes in a way a reader cannot infer from the value alone.
 *
 * 2 — a patch may retain an opaque, versioned groovebox song envelope.
 * 1 — the original.
 *
 * Old patches are migrated on the way in, never on the way out: everything is written in the
 * current format. Per-MODULE versions are a separate mechanism and live on each module — see
 * `ModuleDef.migrate`.
 */
export const PATCH_FORMAT = 2

interface Envelope {
  v: number
  patch: unknown
}

export function encodePatch(patch: Patch): string {
  return JSON.stringify({ v: PATCH_FORMAT, patch } satisfies Envelope)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** A port reference: `[moduleId, portId]`, both non-empty strings. */
function endpoint(value: unknown): [string, string] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  return isName(value[0]) && isName(value[1]) ? [value[0], value[1]] : null
}

function position(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const [x, y] = value
  if (typeof x !== 'number' || !Number.isFinite(x)) return undefined
  if (typeof y !== 'number' || !Number.isFinite(y)) return undefined
  return [x, y]
}

/**
 * Knob positions, kept as they are.
 *
 * Anything not a finite number is dropped — `Number(null)` is 0, which would quietly park a
 * knob at the bottom of its range rather than at its default. An id this build does not know
 * is KEPT: it may belong to a newer version of the module, and `compile` ignores what it
 * cannot place while `encodePatch` writes it back out again.
 */
function params(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, number> = {}
  let any = false
  for (const [id, raw] of Object.entries(value)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    out[id] = raw
    any = true
  }
  return any ? out : undefined
}

/**
 * Bulk data belonging to the document — a sequencer's pattern.
 *
 * Kept as plain finite numbers and otherwise unexamined. What a run of numbers *means* is the module's business,
 * and a reader that understood pattern shapes would be a reader that could not carry a module it had never heard
 * of — which is the property everything else in this file exists to protect.
 *
 * A sample buffer deliberately never arrives here. It is pushed straight at the audio thread, because a patch
 * should store which break rather than several hundred kilobytes of one.
 */
function data(value: unknown): Record<string, number[]> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, number[]> = {}
  let any = false
  for (const [slot, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) continue
    const numbers = raw.filter(
      (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
    )
    if (numbers.length !== raw.length) continue
    out[slot] = numbers
    any = true
  }
  return any ? out : undefined
}

function module(value: unknown): PatchModule | null {
  if (!isRecord(value)) return null
  if (!isName(value.id) || !isName(value.type)) return null

  const out: PatchModule = { id: value.id, type: value.type }
  // A version that is not a positive whole number is treated as absent, which means "current"
  // — a patch somebody wrote by hand should not have to declare one.
  if (typeof value.version === 'number' && Number.isInteger(value.version) && value.version > 0) {
    out.version = value.version
  }
  const knobs = params(value.params)
  if (knobs) out.params = knobs
  const bulk = data(value.data)
  if (bulk) out.data = bulk
  const pos = position(value.pos)
  if (pos) out.pos = pos
  // Only `true` is written, never `false`. A module in circuit says nothing, so a patch that has never had
  // anything bypassed round-trips byte-identical to one written before bypass existed.
  if (value.bypassed === true) out.bypassed = true
  return out
}

/**
 * Read a patch back. Returns `null` only when the input is not a patch at all — unparseable,
 * the wrong shape, or from a format version this build does not understand.
 *
 * An EMPTY patch is a patch. `decodeSong` gives up when a song has no patterns, because a
 * song with no patterns cannot play; an empty rack is where everybody starts.
 */
export function decodePatch(text: string): Patch | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  // Accept a bare Patch as well as an enveloped one, so something assembled by hand out of
  // `JSON.stringify(patch)` still loads.
  const body = isRecord(parsed.patch) ? parsed.patch : parsed
  if (typeof parsed.v === 'number' && parsed.v > PATCH_FORMAT) return null
  if (!Array.isArray(body.modules)) return null

  const modules: PatchModule[] = []
  const ids = new Set<string>()
  for (const raw of body.modules) {
    const parsedModule = module(raw)
    if (!parsedModule) continue
    // Two modules sharing an id would make every cable touching it ambiguous, and there is no
    // repair for that other than picking one.
    if (ids.has(parsedModule.id)) continue
    ids.add(parsedModule.id)
    modules.push(parsedModule)
  }

  const cables: PatchCable[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(body.cables) ? body.cables : []) {
    if (!isRecord(raw)) continue
    const from = endpoint(raw.from)
    const to = endpoint(raw.to)
    if (!from || !to) continue
    // A cable to a module that is not in this patch is dead weight. Unlike a module of an
    // unknown TYPE — which is kept, because a newer build may know what it is — an endpoint
    // naming an id nothing in the file has is corruption, and keeping it would mean it
    // accumulated across every save from here on.
    if (!ids.has(from[0]) || !ids.has(to[0])) continue
    // Deduped by destination as well as identity: `compile` takes the last cable into a
    // contested inlet, so an exact duplicate is noise that would show up as a
    // `replaced-cable` note for no reason.
    const key = JSON.stringify([from, to])
    if (seen.has(key)) continue
    seen.add(key)
    cables.push({ from, to })
  }

  // Combinator routings. Both ends have to name a module the file actually contains, on the same reasoning
  // as a cable: a route to an id nothing here has is corruption with no repair, and keeping it would mean it
  // accumulated across every save from here on.
  //
  // A route naming a *param* this build has never heard of is kept, because that is the same case as a
  // module type this build does not have — it may belong to a newer version of the module, and
  // `applyModulation` skips what it cannot resolve rather than deleting it.
  const modulation: ModRoute[] = []
  for (const raw of Array.isArray(body.modulation) ? body.modulation : []) {
    if (!isRecord(raw)) continue
    const from = endpoint(raw.from)
    const to = endpoint(raw.to)
    if (!from || !to) continue
    if (!ids.has(from[0]) || !ids.has(to[0])) continue
    // An end that is not a finite number is left absent rather than repaired to zero, which would park the
    // target at the bottom of its range and look like a routing that works but is aimed wrong. Absent means
    // the target's own limit, and `applyModulation` is the one place that knows what that is.
    const route: ModRoute = { from, to }
    if (typeof raw.min === 'number' && Number.isFinite(raw.min)) route.min = raw.min
    if (typeof raw.max === 'number' && Number.isFinite(raw.max)) route.max = raw.max
    modulation.push(route)
  }

  const patch: Patch = { modules, cables }
  // A short host-resolved id, never the audio itself. Empty or non-string values cannot name anything and
  // are dropped rather than being turned into a break the host has to guess at.
  if (isName(body.break)) patch.break = body.break
  // Deliberately opaque. `@driftbox/engine` owns this envelope and may be newer than the
  // engine installed beside this rack. Parsing and rebuilding it here would turn a safe
  // open-and-save into data loss; the document bridge decodes it only when a caller asks
  // to edit the song.
  if (typeof body.groovebox === 'string' && body.groovebox !== '') {
    patch.groovebox = body.groovebox
  }
  // Absent means none, so a patch written before the Combinator existed round-trips byte-identically —
  // the same standard `break`, `groovebox`, `voices` and `tempo` hold themselves to.
  if (modulation.length > 0) patch.modulation = modulation
  // Absent means one, which is what every patch written before polyphony existed means — so this stays
  // absent rather than being written as 1, and an old patch round-trips byte-identically.
  const voices = body.voices
  if (typeof voices === 'number' && Number.isInteger(voices) && voices > 1 && voices <= 8) {
    patch.voices = voices
  }
  // Absent means 120, so a patch written before tempo existed round-trips unchanged.
  const tempo = body.tempo
  if (typeof tempo === 'number' && Number.isFinite(tempo) && tempo >= 20 && tempo <= 400) {
    patch.tempo = tempo
  }
  return patch
}
