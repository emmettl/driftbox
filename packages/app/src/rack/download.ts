import { toWav } from '@driftbox/engine'

// Handing a rendered buffer to the browser as a file.
//
// Two exports do this — the patch and the retained song's mix — and they had a copy each of the same six
// lines, including the same 10-second revoke and the same regular expression turning a patch name into
// something a filesystem will take. The name is the part worth testing: it is the only piece of this app
// that anybody's operating system has an opinion about.

/**
 * A patch name as a file name.
 *
 * Every run of anything that is not a word character or a hyphen becomes a single hyphen, which is
 * deliberately blunt: names here are typed by people and contain slashes, quotes and emoji, and a
 * conservative rule is better than a clever one that lets a `/` through into a download.
 *
 * An empty or whitespace-only name falls back rather than producing a file called `.wav` — which is not a
 * name, and which some browsers treat as a hidden file and others refuse outright.
 */
export function wavFileName(
  name: string | null | undefined,
  fallback: string,
  suffix = '',
): string {
  const cleaned = (name ?? '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${cleaned || fallback}${suffix}.wav`
}

/**
 * Save a rendered buffer under that name.
 *
 * Revoked on a later turn of the event loop rather than immediately: revoking before the click has been
 * handled cancels the download in some browsers.
 */
export function downloadWav(buffer: AudioBuffer, fileName: string): void {
  const url = URL.createObjectURL(toWav(buffer))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
