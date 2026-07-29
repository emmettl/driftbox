import { decodeSong, encodeSong, type Song } from '@driftbox/engine'

// Where a song is kept. The engine owns the format (`engine/song-io.ts`); this owns the
// three places a song can live, all of which are browser APIs the engine may not touch:
//
//   localStorage  the working session, so a reload does not lose an evening's work
//   a file        the durable copy, and the one you can put in version control
//   the URL hash  a song you can paste to somebody
//
// The URL is the interesting one. A song is repetitive JSON — patterns that share a
// vocabulary of voice ids and are mostly zeroes — so it compresses hard. Measured on the
// shipped song: 6020 bytes of JSON becomes 987 characters of base64 after deflate, a
// sixth of the size. Under a kilobyte is short enough to paste into a chat window, which
// is the only length that actually matters here.

const STORAGE_KEY = 'driftbox.song.v1'

/** Marks how the payload in the hash was encoded, so a browser without CompressionStream
 *  can still read a link made by one that had it, and vice versa. */
const DEFLATED = 'z'
const PLAIN = 'r'

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

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function through(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** The song, compressed and base64url'd, ready to go in a URL hash. */
export async function songToHash(song: Song): Promise<string> {
  const bytes = new TextEncoder().encode(encodeSong(song))
  if (typeof CompressionStream === 'undefined') return PLAIN + toBase64Url(bytes)

  const stream = new Blob([bytes as BufferSource]).stream().pipeThrough(
    new CompressionStream('deflate-raw'),
  )
  return DEFLATED + toBase64Url(await through(stream))
}

export async function songFromHash(hash: string): Promise<Song | null> {
  const payload = hash.replace(/^#/, '')
  const kind = payload[0]
  const body = payload.slice(1)
  if (body === '' || (kind !== DEFLATED && kind !== PLAIN)) return null

  try {
    const bytes = fromBase64Url(body)
    if (kind === PLAIN) return decodeSong(new TextDecoder().decode(bytes))

    if (typeof DecompressionStream === 'undefined') return null
    const stream = new Blob([bytes as BufferSource]).stream().pipeThrough(
      new DecompressionStream('deflate-raw'),
    )
    return decodeSong(new TextDecoder().decode(await through(stream)))
  } catch {
    // Truncated by a chat client, mangled by an email wrapper, or simply not a song.
    return null
  }
}

export async function shareLink(song: Song): Promise<string> {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#${await songToHash(song)}`
}

/**
 * Take the song out of the current URL, if there is one, and clear the hash.
 *
 * Clearing matters. Leaving it there means the next reload silently throws away
 * everything done since the link was opened and starts again from the shared version,
 * which looks exactly like losing your work.
 */
export async function takeSongFromUrl(): Promise<Song | null> {
  const hash = window.location.hash
  if (hash.length < 2) return null

  const song = await songFromHash(hash)
  if (song) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return song
}
