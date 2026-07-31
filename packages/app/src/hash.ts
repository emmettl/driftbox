// Putting a document in a URL fragment.
//
// This was inside `persistence.ts` and served songs only. The rack needs the same thing for
// patches, and the two must be distinguishable — so the encoding moved here and grew a
// **kind** alongside the compression marker it already had.
//
// The fragment is the right place for this and not merely a convenient one: everything after
// the `#` never reaches a server, so a shared link carries somebody's work without it being
// logged by anything on the way.
//
// The compression is what makes it usable at all. Both documents are repetitive JSON — a song
// is patterns of mostly zeroes sharing a vocabulary of voice ids, a patch is modules and
// cables sharing module ids — so deflate takes about a sixth of it. Measured on the shipped
// song: 6020 bytes becomes 987 characters. Under a kilobyte is short enough to paste into a
// chat window, which is the only length that actually matters here.

export type HashKind = 'song' | 'patch'

interface Marker {
  kind: HashKind
  deflated: boolean
}

/**
 * The marker that leads the payload.
 *
 * A song's markers are ONE character, `z` and `r`, because that is what shipped before there
 * was anything else to be — every link anybody has already shared starts with one of them, and
 * they have to keep meaning what they meant. A patch gets `p` and then the same encoding
 * character. So the table is read longest-first: nothing here would actually be ambiguous,
 * since no song marker begins with `p`, but a new kind added carelessly could make it so, and
 * longest-first means that mistake cannot happen.
 *
 * `r` for raw and `z` for deflated: a browser without CompressionStream can still read a link
 * made by one that had it, and the other way round.
 */
const MARKERS: readonly (readonly [string, Marker])[] = [
  ['pz', { kind: 'patch', deflated: true }],
  ['pr', { kind: 'patch', deflated: false }],
  ['z', { kind: 'song', deflated: true }],
  ['r', { kind: 'song', deflated: false }],
]

const markerFor = (kind: HashKind, deflated: boolean): string =>
  MARKERS.find(([, m]) => m.kind === kind && m.deflated === deflated)![0]

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

/** Compressed and base64url'd, with a marker saying what it is and how it was encoded. */
export async function toHash(kind: HashKind, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  if (typeof CompressionStream === 'undefined') {
    return markerFor(kind, false) + toBase64Url(bytes)
  }

  const stream = new Blob([bytes as BufferSource])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return markerFor(kind, true) + toBase64Url(await through(stream))
}

/**
 * Read a fragment back, or null if it is not one of ours.
 *
 * The kind comes back rather than being asserted, so a caller can tell "this is a patch link,
 * open it in the rack" apart from "this is not a link at all". Handing a patch to a song
 * decoder would merely fail, which is safe and says nothing useful.
 */
export async function fromHash(hash: string): Promise<{ kind: HashKind; text: string } | null> {
  const payload = hash.replace(/^#/, '')
  const found = MARKERS.find(([prefix]) => payload.startsWith(prefix))
  if (!found) return null
  const [prefix, marker] = found
  const body = payload.slice(prefix.length)
  if (body === '') return null

  try {
    const bytes = fromBase64Url(body)
    if (!marker.deflated) {
      return { kind: marker.kind, text: new TextDecoder().decode(bytes) }
    }
    if (typeof DecompressionStream === 'undefined') return null
    const stream = new Blob([bytes as BufferSource])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
    return { kind: marker.kind, text: new TextDecoder().decode(await through(stream)) }
  } catch {
    // Truncated by a chat client, mangled by an email wrapper, or simply not one of ours.
    return null
  }
}

/** A link to this page carrying `text`. Relative to wherever the page actually is, so the
 *  rack's entry point and the sequencer's each produce links to themselves. */
export function linkTo(kind: HashKind, text: string): Promise<string> {
  const { origin, pathname } = window.location
  return toHash(kind, text).then((hash) => `${origin}${pathname}#${hash}`)
}

/**
 * Take the document out of the current URL, if there is one of the right kind, and clear the
 * hash.
 *
 * Clearing matters. Leaving it there means the next reload silently throws away everything
 * done since the link was opened and starts again from the shared version, which looks exactly
 * like losing your work.
 *
 * A fragment of the WRONG kind is left in place: it is not this page's to consume, and wiping
 * it would destroy a link somebody could still paste into the right one.
 */
export async function takeFromUrl(kind: HashKind): Promise<string | null> {
  const found = await takeDocumentFromUrl([kind])
  return found?.text ?? null
}

/**
 * Take any one of the document kinds a page knows how to host.
 *
 * The rack is the first caller with more than one: it opens native patches and retains
 * groovebox songs. Keeping the clear-on-consume rule here means both entry points still
 * avoid a reload replacing edits with the original shared document.
 */
export async function takeDocumentFromUrl(
  kinds: readonly HashKind[],
): Promise<{ kind: HashKind; text: string } | null> {
  const hash = window.location.hash
  if (hash.length < 2) return null

  const found = await fromHash(hash)
  if (!found || !kinds.includes(found.kind)) return null

  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return found
}
