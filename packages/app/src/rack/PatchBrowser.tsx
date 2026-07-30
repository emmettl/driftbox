import { PATCHES } from '@driftbox/rack'
import { useState } from 'react'
import {
  deletePatch,
  freshName,
  listPatches,
  loadPatch,
  renamePatch,
  savePatch,
  type SavedPatch,
} from './library.js'
import { downloadPatch, pickPatchFile } from './persistence.js'
import { useRack } from './store.js'

// The patch picker: four shipped patches, whatever has been saved, and the file in and out.
//
// Named `PatchBrowser` rather than `Library`, which is what it was for about a minute. `library.ts` holds the
// storage layer, and on a case-insensitive filesystem — which macOS is by default — `Library.tsx` and
// `library.ts` are the same path. TypeScript resolved `./Library.js` to the storage module and reported that
// two file names differed only in casing. It would have worked on Linux and failed here, or the reverse.
//
// One thing here is worth more than it looks: **loading a patch is one of the two operations that can lose
// work**, so both of them ask. Overwriting a save asks too. Everything else in the rack is either
// reversible or autosaved, and these are not.

export function PatchBrowser({ onClose }: { onClose: () => void }) {
  const patch = useRack((s) => s.patch)
  const name = useRack((s) => s.name)
  const load = useRack((s) => s.load)
  const setName = useRack((s) => s.setName)

  const [saved, setSaved] = useState<SavedPatch[]>(() => listPatches())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = () => setSaved(listPatches())

  const adopt = (next: Parameters<typeof load>[0], as: string | null) => {
    load(next)
    setName(as)
    onClose()
  }

  return (
    <div className="rk-library">
      <section>
        <h2>Shipped</h2>
        <ul>
          {PATCHES.map((preset) => (
            <li key={preset.id}>
              <button type="button" onClick={() => adopt(preset.build(), preset.name)}>
                <strong>{preset.name}</strong>
                <span>{preset.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Saved</h2>
        {saved.length === 0 && <p className="rk-empty">Nothing yet.</p>}
        <ul>
          {saved.map((entry) => (
            <li key={entry.name}>
              {renaming === entry.name ? (
                <form
                  className="rk-rename"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!renamePatch(entry.name, draft)) {
                      setProblem(`Could not rename to “${draft.trim()}” — that name is taken.`)
                      return
                    }
                    if (name === entry.name) setName(draft.trim())
                    setRenaming(null)
                    setProblem(null)
                    refresh()
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    aria-label="New name"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                  />
                  <button type="submit">OK</button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const next = loadPatch(entry.name)
                      if (!next) {
                        setProblem(`“${entry.name}” could not be read.`)
                        return
                      }
                      adopt(next, entry.name)
                    }}
                  >
                    <strong>{entry.name}</strong>
                    {name === entry.name && <span>open</span>}
                  </button>
                  <button
                    type="button"
                    className="rk-tiny"
                    aria-label={`Rename ${entry.name}`}
                    onClick={() => {
                      setRenaming(entry.name)
                      setDraft(entry.name)
                    }}
                  >
                    rename
                  </button>
                  <button
                    type="button"
                    className="rk-tiny"
                    aria-label={`Delete ${entry.name}`}
                    onClick={() => {
                      // Asks, because it is not reversible and not autosaved.
                      if (!confirm(`Delete “${entry.name}”?`)) return
                      deletePatch(entry.name)
                      if (name === entry.name) setName(null)
                      refresh()
                    }}
                  >
                    delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rk-library-actions">
        <button
          type="button"
          onClick={() => {
            // Overwrites silently only when it is the patch already open under that name; anything else asks.
            const target = name ?? freshName('Patch')
            const clash = name === null && listPatches().some((entry) => entry.name === target)
            if (clash && !confirm(`Replace “${target}”?`)) return
            if (!savePatch(target, patch)) {
              setProblem('Could not save — storage is unavailable or full.')
              return
            }
            setName(target)
            setProblem(null)
            refresh()
          }}
        >
          {name ? `Save “${name}”` : 'Save'}
        </button>

        <button
          type="button"
          onClick={() => {
            const wanted = prompt('Save as', freshName(name ?? 'Patch'))
            if (wanted === null) return
            if (!savePatch(wanted, patch)) {
              setProblem('Could not save under that name.')
              return
            }
            setName(wanted.trim())
            setProblem(null)
            refresh()
          }}
        >
          Save as…
        </button>

        <button type="button" onClick={() => downloadPatch(patch, name ?? 'driftbox-patch')}>
          Export file
        </button>

        <button
          type="button"
          onClick={async () => {
            const next = await pickPatchFile()
            if (next) adopt(next, null)
          }}
        >
          Import file
        </button>
      </section>

      {problem && <p className="rk-warn">{problem}</p>}
    </div>
  )
}
