import { decodeSong, encodeSong, type Song } from '@driftbox/engine'
import {
  decodePatch,
  encodePatch,
  grooveboxSong,
  patchCompatibility,
  type Patch,
  type PatchCompatibility,
} from '@driftbox/rack'

// One named shelf for every document Driftbox can author.
//
// A song and a patch used to have unrelated persistence: one groovebox autosave slot
// and a rack-only named list. That made moving between the two modes feel like moving
// between products. The library records the document kind and its compatibility at the
// edge, so either editor can list the complete shelf without parsing every document or
// pretending a rack-extended patch is safe to flatten into a song.

const KEY = 'driftbox.documents.v1'
const LEGACY_PATCH_KEY = 'driftbox.patches.v1'

export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type DocumentKind = 'song' | 'patch'
export type DocumentCompatibility = PatchCompatibility

export interface SavedDocument {
  name: string
  kind: DocumentKind
  compatibility: DocumentCompatibility
  /** Encoded so listing the shelf never decodes every song and patch on it. */
  text: string
}

export type LoadedDocument =
  | { kind: 'song'; song: Song }
  | { kind: 'patch'; patch: Patch }

function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const COMPATIBILITY = new Set<DocumentCompatibility>([
  'rack-native',
  'groovebox-compatible',
  'rack-extended',
])

function parseCurrent(text: string): SavedDocument[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    const out: SavedDocument[] = []
    const seen = new Set<string>()
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const { name, kind, compatibility, text: encoded } = entry as Record<string, unknown>
      if (
        typeof name !== 'string' ||
        name === '' ||
        (kind !== 'song' && kind !== 'patch') ||
        typeof compatibility !== 'string' ||
        !COMPATIBILITY.has(compatibility as DocumentCompatibility) ||
        typeof encoded !== 'string' ||
        seen.has(name)
      ) {
        continue
      }
      // A plain song can always be edited in the groovebox. Do not trust contradictory
      // metadata written by hand or by a broken older build.
      const resolved = kind === 'song' ? 'groovebox-compatible' : compatibility
      seen.add(name)
      out.push({ name, kind, compatibility: resolved as DocumentCompatibility, text: encoded })
    }
    return out
  } catch {
    return []
  }
}

function parseLegacyPatches(text: string): SavedDocument[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    const out: SavedDocument[] = []
    const seen = new Set<string>()
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const { name, text: encoded } = entry as Record<string, unknown>
      if (
        typeof name !== 'string' ||
        name === '' ||
        typeof encoded !== 'string' ||
        seen.has(name)
      ) {
        continue
      }
      const patch = decodePatch(encoded)
      seen.add(name)
      out.push({
        name,
        kind: 'patch',
        compatibility: patch ? patchCompatibility(patch) : 'rack-native',
        text: encoded,
      })
    }
    return out
  } catch {
    return []
  }
}

function read(store: Store | null): SavedDocument[] {
  if (!store) return []
  try {
    const current = store.getItem(KEY)
    if (current !== null) return parseCurrent(current)
    const legacy = store.getItem(LEGACY_PATCH_KEY)
    return legacy === null ? [] : parseLegacyPatches(legacy)
  } catch {
    return []
  }
}

function write(store: Store | null, list: readonly SavedDocument[]): boolean {
  if (!store) return false
  try {
    store.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export function listDocuments(store: Store | null = browserStore()): SavedDocument[] {
  return read(store)
}

function save(
  entry: SavedDocument,
  store: Store | null,
): boolean {
  const trimmed = entry.name.trim()
  if (trimmed === '') return false
  const rest = read(store).filter((candidate) => candidate.name !== trimmed)
  return write(store, [{ ...entry, name: trimmed }, ...rest])
}

export function saveSong(
  name: string,
  song: Song,
  store: Store | null = browserStore(),
): boolean {
  return save(
    {
      name,
      kind: 'song',
      compatibility: 'groovebox-compatible',
      text: encodeSong(song),
    },
    store,
  )
}

export function savePatch(
  name: string,
  patch: Patch,
  store: Store | null = browserStore(),
): boolean {
  return save(
    {
      name,
      kind: 'patch',
      compatibility: patchCompatibility(patch),
      text: encodePatch(patch),
    },
    store,
  )
}

export function loadDocument(
  name: string,
  store: Store | null = browserStore(),
): LoadedDocument | null {
  const found = read(store).find((entry) => entry.name === name)
  if (!found) return null
  if (found.kind === 'song') {
    const song = decodeSong(found.text)
    return song ? { kind: 'song', song } : null
  }
  const patch = decodePatch(found.text)
  return patch ? { kind: 'patch', patch } : null
}

export function loadSong(name: string, store: Store | null = browserStore()): Song | null {
  const loaded = loadDocument(name, store)
  if (!loaded) return null
  if (loaded.kind === 'song') return loaded.song
  return patchCompatibility(loaded.patch) === 'groovebox-compatible'
    ? grooveboxSong(loaded.patch)
    : null
}

export function loadPatch(name: string, store: Store | null = browserStore()): Patch | null {
  const loaded = loadDocument(name, store)
  return loaded?.kind === 'patch' ? loaded.patch : null
}

export function deleteDocument(name: string, store: Store | null = browserStore()): boolean {
  const list = read(store)
  const rest = list.filter((entry) => entry.name !== name)
  return rest.length !== list.length && write(store, rest)
}

export function renameDocument(
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

export function freshName(wanted: string, store: Store | null = browserStore()): string {
  const taken = new Set(read(store).map((entry) => entry.name))
  const base = wanted.trim() === '' ? 'Patch' : wanted.trim()
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}

// Compatibility names for the rack-local API while callers migrate to documents.
export const listPatches = (store: Store | null = browserStore()): SavedDocument[] =>
  read(store).filter((entry) => entry.kind === 'patch')
export const deletePatch = deleteDocument
export const renamePatch = renameDocument
export type SavedPatch = SavedDocument
