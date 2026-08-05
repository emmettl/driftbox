import { embedGrooveboxSong, grooveboxSong, type Imported, type Patch } from '@driftbox/rack'
import type { LoadedDocument, SavedDocument } from '../document-library.js'

// Everything the patch browser decides, out of the JSX it was written inside.
//
// It was untestable by construction, not merely by accident: `saveCurrentAs` opens a `prompt()` and a
// `confirm()` in the middle of its own logic, so the five branches after them — dismissed, blank,
// whitespace, overwrite accepted, overwrite declined — could only be reached by a person clicking through
// a modal dialog five times. The two dialogs are now ports, which is the same shape `groovebox-host.ts`
// uses for the transport.
//
// The rest is smaller but has the same problem: what the shelf says about each document, what happens to
// the open document's name when the file behind it is renamed or deleted, and which of a VCV import's
// three outcomes this was. All of them were expressions inside event handlers inside list items.

/** What the browser needs from a person, and cannot ask for in a test. */
export interface Dialogs {
  /** Ask for a name, offering one. Null when dismissed. */
  ask: (question: string, suggestion: string) => string | null
  /** Ask before overwriting or deleting. */
  confirm: (question: string) => boolean
}

/** The sentence shown when something did not work. Collected so they read as one voice. */
export const PROBLEMS = {
  save: 'Could not save — storage is unavailable or full.',
  saveAs: 'Could not save under that name.',
  vcv: 'That is not a VCV Rack patch.',
  rename: (draft: string) => `Could not rename to “${draft.trim()}” — that name is taken.`,
  unreadable: (name: string) => `“${name}” could not be read.`,
} as const

/**
 * Where a plain save writes.
 *
 * An untitled rack gets a fresh name rather than a prompt: the button says "Save patch", and a dialog
 * appearing when it was pressed is the thing "Save as…" is for.
 */
export const saveTarget = (name: string | null, fresh: (base: string) => string): string =>
  name ?? fresh('Patch')

/**
 * "Save as…", down to the name to write — or null for every way of not writing one.
 *
 * A dismissed prompt and an empty one are both refusals, and a name that is only spaces is empty. The
 * overwrite question is asked against the shelf rather than against the open document, because saving
 * over a *different* patch is the case worth stopping; saving over the one already open is what the
 * other button does.
 */
export function saveAsName(
  current: string | null,
  saved: readonly SavedDocument[],
  dialogs: Dialogs,
  fresh: (base: string) => string,
): string | null {
  const wanted = dialogs.ask('Save as', fresh(current ?? 'Patch'))
  if (wanted === null || wanted.trim() === '') return null
  const target = wanted.trim()
  const existing = saved.find((entry) => entry.name === target)
  if (existing && !dialogs.confirm(`Replace “${target}” (${existing.kind})?`)) return null
  return target
}

/** The question asked before a document is thrown away. */
export const deleteQuestion = (name: string): string => `Delete “${name}”?`

/**
 * The open document's name after the file behind it is renamed.
 *
 * Only follows when it was that file. Renaming some other document and having the header change with it
 * would leave the rack claiming to be a patch it is not, and the next save would write to the wrong one.
 */
export const nameAfterRename = (
  current: string | null,
  from: string,
  to: string,
): string | null => (current === from ? to.trim() : current)

/** And after it is deleted: the rack is still open, but it is no longer a document on the shelf. */
export const nameAfterDelete = (current: string | null, deleted: string): string | null =>
  current === deleted ? null : current

/**
 * What loading a shelf entry puts in the rack.
 *
 * A saved song is not a patch. It becomes one by being embedded whole — the authored patterns and
 * arrangement carried across opaquely, with the derived Groovebox source wired in — rather than by being
 * exploded into modules, which is the product boundary this whole bridge exists to keep.
 */
export const adoptDocument = (document: LoadedDocument): Patch =>
  document.kind === 'song' ? embedGrooveboxSong(document.song) : document.patch

/**
 * What a shelf entry's action line says.
 *
 * Three states, not two. The open document says so instead of offering to load itself again; a song says
 * it is a song, because loading one brings a whole arrangement with it; and a patch reports the
 * compatibility it will open at, which is the one thing that decides whether it can go back to the
 * sequencer afterwards.
 */
export function entryAction(entry: SavedDocument, current: string | null): string {
  if (current === entry.name) return 'Open now'
  if (entry.kind === 'song') return 'Load song →'
  return `${entry.compatibility.replace('-', ' ')} →`
}

/** The same distinction on a factory card, which has no compatibility to report. */
export const presetAction = (preset: string, current: string | null): string =>
  current === preset ? 'open' : 'load →'

/**
 * The tempo a card should report.
 *
 * A song patch usually carries no tempo of its own: it leaves the retained song in charge rather than
 * overriding it, so the number worth showing is the song's. Reading only `patch.tempo` would leave every
 * Rack++ song card claiming no tempo at all.
 */
export const presetTempo = (patch: Patch): number | undefined =>
  patch.tempo || grooveboxSong(patch)?.bpm

/** What a factory card says it is about to put in the rack. */
export function presetSummary(patch: Patch): string {
  const tempo = presetTempo(patch)
  const suffix = tempo ? ` · ${tempo} bpm` : ''
  return `${patch.modules.length} modules · ${patch.cables.length} cables${suffix}`
}

/** How many meters a patch has, which is the number the card's fake VU display shows. */
export const meterCount = (patch: Patch): number =>
  patch.modules.filter((module) => module.type === 'meter').length

export type VcvOutcome =
  | { kind: 'rejected'; problem: string }
  /** Understood, but there is nothing to open. The report is still worth showing. */
  | { kind: 'empty'; notes: Imported['notes'] }
  | { kind: 'loaded'; patch: Patch; notes: Imported['notes'] }

/**
 * Which of the three things a VCV import turned out to be.
 *
 * The middle one is the reason this is not a boolean. A patch made entirely of modules this rack has no
 * answer for parses fine and imports nothing, and replacing the open rack with an empty one would be the
 * worst possible response — so the notes are shown and the rack is left alone.
 */
export function vcvOutcome(result: Imported | null): VcvOutcome {
  if (!result) return { kind: 'rejected', problem: PROBLEMS.vcv }
  if (result.patch.modules.length === 0) return { kind: 'empty', notes: result.notes }
  return { kind: 'loaded', patch: result.patch, notes: result.notes }
}
