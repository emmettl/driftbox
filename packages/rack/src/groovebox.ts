import {
  decodeSong,
  encodeSong,
  renderMix,
  type MixOptions,
  type Song,
} from '@driftbox/engine'
import { GROOVEBOX_MODULE } from './modules/groovebox.js'
import type { Patch } from './types.js'

export const GROOVEBOX_SOURCE_ID = 'groovebox'

/**
 * Materialise the retained song's one derived rack device.
 *
 * Old bridge documents contain only `groovebox`; adding the source at the edge keeps them
 * forward-compatible. The device is representational rather than rack-authored, so its
 * presence alone does not make the document rack-extended. A cable from it does.
 */
export function withGrooveboxSource(patch: Patch): Patch {
  if (!patch.groovebox || patch.modules.some((module) => module.type === GROOVEBOX_MODULE.type)) {
    return patch
  }

  const taken = new Set(patch.modules.map((module) => module.id))
  let id = GROOVEBOX_SOURCE_ID
  for (let suffix = 2; taken.has(id); suffix++) id = `${GROOVEBOX_SOURCE_ID}-${suffix}`

  return {
    ...patch,
    modules: [{ id, type: GROOVEBOX_MODULE.type, pos: [0, 0] }, ...patch.modules],
  }
}

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
  return withGrooveboxSource({ ...patch, groovebox: encodeSong(song) })
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
 * Render exactly the authored mix retained by a rack document.
 *
 * This is intentionally not `renderPatch`: rack modules and cables are additive work and
 * belong to Patch WAV. Song WAV must cross the same Song boundary as the sequencer export,
 * including after the patch and embedded Song codecs have round-tripped the document.
 */
export async function renderRetainedSongMix(
  patch: Patch,
  options: MixOptions = {},
): Promise<AudioBuffer | null> {
  const song = grooveboxSong(patch)
  return song ? renderMix(song, options) : null
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

  const sourceModules = patch.modules.filter((module) => module.type === GROOVEBOX_MODULE.type)
  const derivedSourceOnly =
    sourceModules.length <= 1 &&
    sourceModules.every(
      (module) =>
        Object.keys(module.params ?? {}).length === 0 &&
        Object.keys(module.data ?? {}).length === 0,
    )

  const hasRackState =
    patch.modules.some((module) => module.type !== GROOVEBOX_MODULE.type) ||
    !derivedSourceOnly ||
    patch.cables.length > 0 ||
    patch.visual !== undefined ||
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
