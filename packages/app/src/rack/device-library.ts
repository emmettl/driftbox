import { MODULES, completeParams, type DevicePatch } from '@driftbox/rack'

// The shelf your own device patches sit on, beside the factory bank.
//
// **Its own key rather than a corner of `document-library.ts`**, and the reason is what a device patch
// *is*. That library holds documents: a song or a whole rack, each with a name you chose, each the thing
// you were working on. A device patch is a fragment — sixteen numbers belonging to one kind of device —
// and it is listed *per device type* rather than all together. Filing "Acid" the ladder setting next to
// "Amen Study" the song would mean a browser that had to explain the difference every time it drew a row.
//
// Same storage shape and the same defensiveness as the document library, because it is the same
// situation: `localStorage` may be absent, full, or hold something an older build wrote — none of which
// is a reason to lose what is already there or to throw on the way to a render.
//
// **Nothing here is trusted.** Values are checked against the def on the way *out*, not only on the way
// in, because a patch may have been written when a param had a different range, or by hand in the
// devtools console. `completeParams` drops anything that is not a finite number; the range clamp is here.

const KEY = 'driftbox.devicepatches.v1'

export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function parse(text: string): DevicePatch[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    const out: DevicePatch[] = []
    const seen = new Set<string>()
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const { id, type, name, params } = entry as Record<string, unknown>
      if (
        typeof id !== 'string' ||
        id === '' ||
        // Reserved: Init is synthesised from the def, and a stored one would appear in the bank twice.
        id === 'init' ||
        typeof type !== 'string' ||
        typeof name !== 'string' ||
        name.trim() === '' ||
        typeof params !== 'object' ||
        params === null ||
        Array.isArray(params) ||
        seen.has(`${type}/${id}`)
      ) {
        continue
      }
      const numbers: Record<string, number> = {}
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) numbers[key] = value
      }
      seen.add(`${type}/${id}`)
      out.push({ id, type, name, params: numbers })
    }
    return out
  } catch {
    return []
  }
}

function read(store: Store | null): DevicePatch[] {
  if (!store) return []
  try {
    const text = store.getItem(KEY)
    return text === null ? [] : parse(text)
  } catch {
    return []
  }
}

function write(store: Store | null, list: readonly DevicePatch[]): boolean {
  if (!store) return false
  try {
    store.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/**
 * Every stored patch for one device type, oldest edit last.
 *
 * Clamped against the def on the way out. A patch stored when `cutoff` reached 20 kHz must not push a
 * module past the limit this build gives it — that is a value the knob could never produce and nothing
 * downstream is written to expect.
 */
export function listDevicePatches(
  type: string,
  store: Store | null = browserStore(),
): DevicePatch[] {
  const def = MODULES[type]
  return read(store)
    .filter((patch) => patch.type === type)
    .map((patch) => {
      if (!def) return patch
      const params: Record<string, number> = {}
      for (const [id, value] of Object.entries(completeParams(def, patch.params))) {
        const param = def.params.find((candidate) => candidate.id === id)!
        params[id] = Math.min(param.max, Math.max(param.min, value))
      }
      return { ...patch, params }
    })
}

/** An id from a name: stable, readable in storage, and never `init`. */
function idFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  // A name of nothing but punctuation slugs to an empty string, and `init` is reserved. Both fall back
  // rather than fail: somebody who typed `***` meant to save something.
  return slug === '' || slug === 'init' ? 'patch' : slug
}

/**
 * Save one device's knobs under a name, replacing any patch of that name for that device.
 *
 * Replacing rather than accumulating, because that is what a save button means when the name is already
 * on the shelf — the document library takes the same line, for the same reason.
 */
export function saveDevicePatch(
  type: string,
  name: string,
  params: Record<string, number>,
  store: Store | null = browserStore(),
): boolean {
  const trimmed = name.trim()
  if (trimmed === '') return false
  const id = idFor(trimmed)
  const rest = read(store).filter(
    (patch) => patch.type !== type || (patch.id !== id && patch.name !== trimmed),
  )
  return write(store, [...rest, { id, type, name: trimmed, params: { ...params } }])
}

export function deleteDevicePatch(
  type: string,
  id: string,
  store: Store | null = browserStore(),
): boolean {
  const list = read(store)
  const rest = list.filter((patch) => patch.type !== type || patch.id !== id)
  return rest.length !== list.length && write(store, rest)
}

/**
 * A name not already taken for this device, so saving twice in a row does not silently overwrite.
 *
 * The document library's `freshName` in miniature, and the same reasoning: a save that quietly replaced
 * something is the one storage mistake you cannot undo.
 */
export function freshDevicePatchName(
  type: string,
  wanted: string,
  store: Store | null = browserStore(),
): string {
  const base = wanted.trim() === '' ? 'Patch' : wanted.trim()
  const taken = new Set(listDevicePatches(type, store).map((patch) => patch.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}
