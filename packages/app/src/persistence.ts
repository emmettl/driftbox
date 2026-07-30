import { decodeSong, encodeSong, type Song } from '@driftbox/engine'
import { fromHash, linkTo, takeFromUrl, toHash } from './hash.js'

// Where a song is kept. The engine owns the format (`engine/song-io.ts`); this owns the
// three places a song can live, all of which are browser APIs the engine may not touch:
//
//   localStorage  the working session, so a reload does not lose an evening's work
//   a file        the durable copy, and the one you can put in version control
//   the URL hash  a song you can paste to somebody
//
// The hash encoding itself now lives in `hash.ts`, because the rack needs the same thing for
// patches and the two have to be distinguishable. What is left here is the song-shaped half:
// which key in localStorage, which decoder, and the fact that a patch link arriving on this
// page is not this page's to open.

const STORAGE_KEY = 'driftbox.song.v1'

// ---- the working session ------------------------------------------------------

/**
 * Read back the song from the last session.
 *
 * Every failure here is non-fatal and deliberately silent. Storage can be unavailable
 * (private browsing, a blocked third-party context) or hold something an older build
 * wrote, and neither is worth an error in front of somebody who just opened a drum
 * machine — they get the default song, which is a working app.
 */
export function loadStoredSong(): Song | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    return text === null ? null : decodeSong(text)
  } catch {
    return null
  }
}

export function storeSong(song: Song): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeSong(song))
  } catch {
    // Full, or unavailable. Losing the autosave is survivable; throwing here would take
    // out whichever knob-drag happened to be the one that filled the quota.
  }
}

export function clearStoredSong(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // As above.
  }
}

/**
 * Persist, but not on every frame.
 *
 * A knob drag changes the song sixty times a second and `localStorage.setItem` is
 * synchronous — writing on each one serialises the whole song on the main thread mid-
 * gesture, which is exactly when the audio scheduler needs it. Trailing edge, so the
 * value that lands is the one the drag finished on.
 */
export function autosave(song: Song): void {
  clearTimeout(pending)
  pending = setTimeout(() => storeSong(song), 400)
}

let pending: ReturnType<typeof setTimeout> | undefined

// ---- panel state ---------------------------------------------------------------
//
// Separate from the song, and deliberately so: which panels you have folded away is a
// property of your screen, not of the music. It must not travel in a shared link, and a
// song imported from a file should not rearrange somebody's layout.

const PANELS_KEY = 'driftbox.panels.v1'

export function loadCollapsed(): Record<string, boolean> {
  try {
    const text = localStorage.getItem(PANELS_KEY)
    const parsed: unknown = text === null ? null : JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) if (value === true) out[key] = true
    return out
  } catch {
    return {}
  }
}

export function saveCollapsed(collapsed: Record<string, boolean>): void {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(collapsed))
  } catch {
    // Unavailable or full. A layout that does not persist is a small loss.
  }
}

// ---- files --------------------------------------------------------------------

export function downloadSong(song: Song, name = 'driftbox-song'): void {
  const blob = new Blob([encodeSong(song)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Save a blob under a name.
 *
 * One at a time and awaited between, because a browser that is handed a dozen downloads in
 * the same tick shows one permission prompt and quietly drops the rest.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function readSongFile(file: File): Promise<Song | null> {
  try {
    return decodeSong(await file.text())
  } catch {
    return null
  }
}

/** Open a file picker and hand back whatever the user chose, or null if they cancelled
 *  or picked something that is not a song. */
export function pickSongFile(): Promise<Song | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      resolve(file ? readSongFile(file) : null)
    }
    // No 'cancel' event in every browser, so a cancelled picker simply never resolves.
    // That is fine — nothing is waiting on it but a button handler.
    input.click()
  })
}

// ---- shareable links ----------------------------------------------------------

/** The song, compressed and base64url'd, ready to go in a URL hash. */
export function songToHash(song: Song): Promise<string> {
  return toHash('song', encodeSong(song))
}

export async function songFromHash(hash: string): Promise<Song | null> {
  const found = await fromHash(hash)
  // A patch link is not a song, and saying so by returning null is the whole reason the kind
  // travels in the marker rather than being inferred from whether decoding happens to work.
  return found?.kind === 'song' ? decodeSong(found.text) : null
}

export function shareLink(song: Song): Promise<string> {
  return linkTo('song', encodeSong(song))
}

/**
 * Take the song out of the current URL, if there is one, and clear the hash.
 *
 * A patch link left on this page stays in the URL untouched — see `takeFromUrl`.
 */
export async function takeSongFromUrl(): Promise<Song | null> {
  const text = await takeFromUrl('song')
  return text === null ? null : decodeSong(text)
}
