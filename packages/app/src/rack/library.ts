import { decodePatch, encodePatch, type Patch } from '@driftbox/rack'

// Named patches, kept in localStorage.
//
// The rest of `rack/persistence.ts` gives a patch three places to live — one autosave slot, a file, a URL.
// None of those lets you keep two patches at once, which is the difference between the rack being a toy you
// open and a tool you use. This is the fourth place: a list of them, by name.
//
// **Storage is a parameter.** Every function takes the store it should read, defaulting to `localStorage`.
// That is what makes this testable in Node without a browser or a mock global, and it costs one argument —
// the same trade `compile` makes by taking a registry instead of importing one.
//
// Everything is wrapped so that a failure is a missing patch rather than a broken page. Storage can be
// unavailable (private browsing, a blocked third-party context), full, or hold something an older build
// wrote, and none of those is worth an error in front of somebody who just opened a synth.

const KEY = 'driftbox.patches.v1'

/** Just enough of `Storage` to be swapped out in a test. */
export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface SavedPatch {
  name: string
  /** Encoded rather than decoded, so listing the library does not parse every patch in it. */
  text: string
}

/** The browser's, or nothing if it cannot be reached. Read lazily: at module scope this would throw on
 *  import in a context that blocks storage, and take the whole page with it. */
function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function read(store: Store | null): SavedPatch[] {
  if (!store) return []
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const out: SavedPatch[] = []
    const seen = new Set<string>()
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const { name, text } = entry as Record<string, unknown>
      if (typeof name !== 'string' || name === '' || typeof text !== 'string') continue
      // A duplicate name would make every operation ambiguous, and there is no repair but picking one.
      if (seen.has(name)) continue
      seen.add(name)
      out.push({ name, text })
    }
    return out
  } catch {
    return []
  }
}

function write(store: Store | null, list: readonly SavedPatch[]): boolean {
  if (!store) return false
  try {
    store.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    // Full, or unavailable. The caller is told, because unlike the autosave a save somebody asked for by
    // name is a save they will expect to find again.
    return false
  }
}

/** Every saved patch, newest first — which is the order somebody looks for the one they just saved in. */
export function listPatches(store: Store | null = browserStore()): SavedPatch[] {
  return read(store)
}

/** Save under a name, replacing any patch already using it. Returns false when storage refused. */
export function savePatch(
  name: string,
  patch: Patch,
  store: Store | null = browserStore(),
): boolean {
  const trimmed = name.trim()
  if (trimmed === '') return false
  const rest = read(store).filter((entry) => entry.name !== trimmed)
  return write(store, [{ name: trimmed, text: encodePatch(patch) }, ...rest])
}

/** Null when there is nothing under that name, or when what is there is not a patch. */
export function loadPatch(name: string, store: Store | null = browserStore()): Patch | null {
  const found = read(store).find((entry) => entry.name === name)
  return found ? decodePatch(found.text) : null
}

export function deletePatch(name: string, store: Store | null = browserStore()): boolean {
  const list = read(store)
  const rest = list.filter((entry) => entry.name !== name)
  if (rest.length === list.length) return false
  return write(store, rest)
}

/**
 * Rename, keeping its place in the list.
 *
 * Refuses to overwrite a different patch that already has the target name — a rename that silently
 * destroyed something is the one operation in a library nobody forgives.
 */
export function renamePatch(
  from: string,
  to: string,
  store: Store | null = browserStore(),
): boolean {
  const trimmed = to.trim()
  if (trimmed === '' || from === trimmed) return false
  const list = read(store)
  if (!list.some((entry) => entry.name === from)) return false
  if (list.some((entry) => entry.name === trimmed)) return false
  return write(
    store,
    list.map((entry) => (entry.name === from ? { ...entry, name: trimmed } : entry)),
  )
}

/** A name not already taken, for "save as" on a patch that came from a preset. `Acid`, `Acid 2`, … */
export function freshName(wanted: string, store: Store | null = browserStore()): string {
  const taken = new Set(read(store).map((entry) => entry.name))
  const base = wanted.trim() === '' ? 'Patch' : wanted.trim()
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}
