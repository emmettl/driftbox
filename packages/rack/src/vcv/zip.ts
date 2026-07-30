// Just enough zip to get one file out of one.
//
// A `.vcv` is a zip holding `patch.json`, and a zip entry is deflate-raw — which `DecompressionStream` already
// does, and which `app/src/hash.ts` has been using for the URL since patch sharing existed. So reading one
// needs no library, only the central directory parsed by hand. That is about sixty lines and no dependency,
// against a zip library that would be the first runtime dependency anywhere in this repo.
//
// Deliberately not a general zip reader. No CRC check, no zip64, no encryption, no data descriptors — the
// sizes are read from the central directory rather than the local header precisely because a local header is
// allowed to say zero and defer to a descriptor at the end of the data. What it will do is refuse rather than
// guess: `null` for anything it does not recognise, because the input is a file somebody downloaded.

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** Stored, or deflated. Anything else is refused. */
const STORED = 0
const DEFLATED = 8

interface Entry {
  name: string
  method: number
  compressedSize: number
  offset: number
}

/**
 * Read the central directory.
 *
 * The end-of-central-directory record is at the end of the file, after a comment of unknown length — so it has
 * to be found by scanning backwards for its signature. 22 bytes is the record with no comment; 64KB past that
 * is the largest a comment can be.
 */
function entries(view: DataView): Entry[] | null {
  const size = view.byteLength
  let eocd = -1
  for (let at = size - 22; at >= Math.max(0, size - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD) {
      eocd = at
      break
    }
  }
  if (eocd < 0) return null

  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const found: Entry[] = []

  for (let i = 0; i < count; i++) {
    if (at + 46 > size || view.getUint32(at, true) !== CENTRAL) return null
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const offset = view.getUint32(at + 42, true)

    const bytes = new Uint8Array(view.buffer, view.byteOffset + at + 46, nameLength)
    found.push({ name: new TextDecoder().decode(bytes), method, compressedSize, offset })
    at += 46 + nameLength + extraLength + commentLength
  }
  return found
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  try {
    const stream = new Blob([data as BufferSource])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    // Truncated, or not actually deflate.
    return null
  }
}

/**
 * Pull one named file out of a zip, as text.
 *
 * Null for anything it cannot do: not a zip, no such entry, a compression method it does not know, a truncated
 * stream. The caller is reading a file somebody downloaded, so every one of those is a thing that will happen.
 */
export async function readZipText(buffer: ArrayBuffer, wanted: string): Promise<string | null> {
  const view = new DataView(buffer)
  const list = entries(view)
  if (!list) return null

  const entry = list.find((candidate) => candidate.name === wanted)
  if (!entry) return null
  if (entry.method !== STORED && entry.method !== DEFLATED) return null

  // The local header repeats the name and may carry a different amount of extra data than the central
  // directory did, so its length has to be read here rather than reused.
  const at = entry.offset
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL) return null
  const nameLength = view.getUint16(at + 26, true)
  const extraLength = view.getUint16(at + 28, true)
  const start = at + 30 + nameLength + extraLength
  if (start + entry.compressedSize > view.byteLength) return null

  const data = new Uint8Array(buffer, start, entry.compressedSize)
  const plain = entry.method === STORED ? data : await inflate(data)
  if (!plain) return null
  return new TextDecoder().decode(plain)
}

/** The names inside a zip, for saying what was in a file that had no `patch.json`. */
export function listZip(buffer: ArrayBuffer): string[] {
  return entries(new DataView(buffer))?.map((entry) => entry.name) ?? []
}
