import { decodeSong, encodeSong, type Song } from '@driftbox/engine'
import type { Patch } from './types.js'

/**
 * The three document states in the rack-over-groovebox compatibility contract.
 *
 * Compatibility describes what can be saved without losing rack-authored intent. It is
 * deliberately separate from editability: an older build can preserve a future embedded
 * song exactly while being unable to decode and edit it.
 */
export type PatchCompatibility =
  | 'rack-native'
  | 'groovebox-compatible'
  | 'rack-extended'

/**
 * Retain a complete, versioned groovebox song inside a rack document.
 *
 * Existing rack state is never replaced. Embedding into an empty patch creates a document
 * editable in either mode; embedding into an authored patch creates a rack-extended
 * document whose original song is still available losslessly.
 */
export function embedGrooveboxSong(
  song: Song,
  patch: Patch = { modules: [], cables: [] },
): Patch {
  return { ...patch, groovebox: encodeSong(song) }
}

/**
 * Decode the retained groovebox song when this build understands its version.
 *
 * `null` does not mean the embedded text was discarded. `decodePatch` preserves that text
 * opaquely so a newer build can still open it after this one saves the patch.
 */
export function grooveboxSong(patch: Patch): Song | null {
  return patch.groovebox ? decodeSong(patch.groovebox) : null
}

/**
 * Classify a patch before offering a groovebox save.
 *
 * Every rack-authored field counts as an extension, including a generated break or tempo
 * override. A caller must not silently save only the embedded song and imply that modules,
 * cables or other rack intent came with it.
 */
export function patchCompatibility(patch: Patch): PatchCompatibility {
  if (!patch.groovebox) return 'rack-native'

  const hasRackState =
    patch.modules.length > 0 ||
    patch.cables.length > 0 ||
    patch.break !== undefined ||
    (patch.modulation?.length ?? 0) > 0 ||
    (patch.voices ?? 1) > 1 ||
    patch.tempo !== undefined

  return hasRackState ? 'rack-extended' : 'groovebox-compatible'
}

/** Whether this build can safely hand the document to the groovebox editor. */
export function isGrooveboxEditable(patch: Patch): boolean {
  return patchCompatibility(patch) === 'groovebox-compatible' && grooveboxSong(patch) !== null
}
