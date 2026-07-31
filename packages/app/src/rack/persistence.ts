import { decodePatch, encodePatch, withGrooveboxSource, type Patch } from '@driftbox/rack'
import { fromHash, linkTo, takeDocumentFromUrl, takeFromUrl, toHash } from '../hash.js'

// Where a patch is kept. `@driftbox/rack` owns the format (`rack/patch-io.ts`); this owns the
// three places a patch can live, all of which are browser APIs the rack may not touch. It is
// the sequencer's `../persistence.ts` with a different document in it, and the shared half —
// compression, base64url, the kind marker — is `../hash.ts`.
//
// Everything under `src/rack/` belongs to the rack's entry point rather than the sequencer's.
// The two share the codec, the styles and (eventually) most of the controls, and share no
// state, no store and no router.

const STORAGE_KEY = 'driftbox.patch.v1'

// ---- the working session ------------------------------------------------------

/**
 * Read back the patch from the last session.
 *
 * Every failure here is non-fatal and deliberately silent, for the reason the sequencer's
 * equivalent gives: storage can be unavailable, or hold something an older build wrote, and
 * neither is worth an error in front of somebody who just opened a synth. They get an empty
 * rack, which is a working rack.
 */
export function loadStoredPatch(): Patch | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    return text === null ? null : decodePatch(text)
  } catch {
    return null
  }
}

export function storePatch(patch: Patch): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodePatch(patch))
  } catch {
    // Full, or unavailable. Losing the autosave is survivable; throwing here would take out
    // whichever cable-drag happened to be the one that filled the quota.
  }
}

export function clearStoredPatch(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // As above.
  }
}

/**
 * Persist, but not on every frame.
 *
 * Dragging a cable changes the patch as often as the pointer moves, and `localStorage.setItem`
 * is synchronous — writing on each one serialises the whole patch on the main thread mid-
 * gesture, which is exactly when the audio thread wants it left alone. Trailing edge, so the
 * value that lands is the one the drag finished on.
 */
export function autosavePatch(patch: Patch): void {
  clearTimeout(pending)
  pending = setTimeout(() => storePatch(patch), 400)
}

let pending: ReturnType<typeof setTimeout> | undefined

// ---- files --------------------------------------------------------------------

export function downloadPatch(patch: Patch, name = 'driftbox-patch'): void {
  const blob = new Blob([encodePatch(patch)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export async function readPatchFile(file: File): Promise<Patch | null> {
  try {
    return decodePatch(await file.text())
  } catch {
    return null
  }
}

/** Open a file picker and hand back whatever the user chose, or null if they cancelled or
 *  picked something that is not a patch. */
export function pickPatchFile(): Promise<Patch | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      resolve(file ? readPatchFile(file) : null)
    }
    // No 'cancel' event in every browser, so a cancelled picker simply never resolves. That is
    // fine — nothing is waiting on it but a button handler.
    input.click()
  })
}

/**
 * Open a picker for a VCV Rack patch and hand back its bytes.
 *
 * Bytes rather than text, because a `.vcv` is a zip — see `@driftbox/rack`'s `vcv/zip.ts`, which reads one with
 * `DecompressionStream` and no library, since a zip entry is deflate-raw and this app has been using that for
 * the URL since patch sharing existed.
 */
export function pickVcvFile(): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.vcv,application/zip'
    input.onchange = () => {
      const file = input.files?.[0]
      resolve(file ? file.arrayBuffer() : null)
    }
    input.click()
  })
}

// ---- shareable links ----------------------------------------------------------

export function patchToHash(patch: Patch): Promise<string> {
  return toHash('patch', encodePatch(patch))
}

export async function patchFromHash(hash: string): Promise<Patch | null> {
  const found = await fromHash(hash)
  return found?.kind === 'patch' ? decodePatch(found.text) : null
}

function asRackDocument(
  found: { kind: 'patch' | 'song'; text: string } | null,
): Patch | null {
  if (!found) return null
  if (found.kind === 'patch') return decodePatch(found.text)
  return withGrooveboxSource({ modules: [], cables: [], groovebox: found.text })
}

/**
 * Turn either document kind the rack can host into a Patch.
 *
 * A song is wrapped as its exact encoded text, without decoding and re-encoding it. That
 * is what lets this build import a future song safely even when it cannot edit it.
 */
export async function rackDocumentFromHash(hash: string): Promise<Patch | null> {
  return asRackDocument(await fromHash(hash))
}

export function patchShareLink(patch: Patch): Promise<string> {
  return linkTo('patch', encodePatch(patch))
}

/** A sequencer link carrying the retained groovebox document, or null for a native patch. */
export async function sequencerLink(patch: Patch): Promise<string | null> {
  if (!patch.groovebox) return null
  const url = new URL('./index.html', window.location.href)
  url.hash = await toHash('song', patch.groovebox)
  return url.toString()
}

/**
 * Take the patch out of the current URL, if there is one, and clear the hash.
 *
 * A song link arriving here is left in the URL rather than consumed — it belongs to the
 * sequencer's page, and wiping it would destroy a link somebody could still paste there.
 */
export async function takePatchFromUrl(): Promise<Patch | null> {
  const text = await takeFromUrl('patch')
  return text === null ? null : decodePatch(text)
}

/**
 * Take either a native patch or a groovebox song from the rack URL.
 *
 * Kept beside `takePatchFromUrl` rather than changing that function's meaning: callers
 * which specifically validate patch links should continue to reject songs.
 */
export async function takeRackDocumentFromUrl(): Promise<Patch | null> {
  return asRackDocument(await takeDocumentFromUrl(['patch', 'song']))
}
