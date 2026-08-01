import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  deleteDocument,
  freshName,
  listDocuments,
  loadDocument,
  renameDocument,
  saveSong,
  type SavedDocument,
} from '../document-library.js'
import { grooveboxSong, patchCompatibility } from '@driftbox/rack'
import { useBox } from '../store.js'
import '../document-library.css'

const compatibilityLabel = (entry: SavedDocument): string => {
  if (entry.kind === 'song') return 'groovebox · rack'
  if (entry.compatibility === 'groovebox-compatible') return 'both modes'
  if (entry.compatibility === 'rack-extended') return 'rack extended'
  return 'rack only'
}

const editableHere = (entry: SavedDocument): boolean =>
  entry.kind === 'song' || entry.compatibility === 'groovebox-compatible'

/** The groovebox view over the shared document shelf. Rack-only entries remain visible
 * and labelled rather than disappearing, but cannot be flattened by loading them here. */
export function SongLibrary({ onClose }: { onClose: () => void }) {
  const song = useBox((state) => state.song)
  const currentName = useBox((state) => state.libraryName)
  const loadSong = useBox((state) => state.loadSong)
  const setLibraryName = useBox((state) => state.setLibraryName)
  const [documents, setDocuments] = useState(() => listDocuments())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = () => setDocuments(listDocuments())

  const saveCurrent = () => {
    const target = currentName ?? freshName('Song')
    if (!saveSong(target, song)) {
      setProblem('Could not save — storage is unavailable or full.')
      return
    }
    setLibraryName(target)
    setProblem(null)
    refresh()
  }

  const saveCurrentAs = () => {
    const wanted = prompt('Save song as', freshName(currentName ?? 'Song'))
    if (wanted === null || wanted.trim() === '') return
    const target = wanted.trim()
    const existing = documents.find((entry) => entry.name === target)
    if (existing && !confirm(`Replace “${target}” (${existing.kind})?`)) return
    if (!saveSong(target, song)) {
      setProblem('Could not save under that name.')
      return
    }
    setLibraryName(target)
    setProblem(null)
    refresh()
  }

  const open = (entry: SavedDocument) => {
    if (!editableHere(entry)) return
    const loaded = loadDocument(entry.name)
    if (!loaded) {
      setProblem(`“${entry.name}” could not be read.`)
      return
    }
    const next =
      loaded.kind === 'song'
        ? loaded.song
        : patchCompatibility(loaded.patch) === 'groovebox-compatible'
          ? grooveboxSong(loaded.patch)
          : null
    if (!next) {
      setProblem(`“${entry.name}” does not contain a song this build can edit.`)
      return
    }
    loadSong(next)
    setLibraryName(entry.name)
    onClose()
  }

  return createPortal(
    <div className="db-library-layer" role="presentation">
      <section className="db-library" role="dialog" aria-modal="true" aria-label="Document library">
        <header className="db-library-head">
          <div>
            <span>Local document library</span>
            <h2>Songs and racks, one shelf.</h2>
            <p>Rack-only work stays visible here without being flattened into the groovebox.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close document library">
            ×
          </button>
        </header>

        <div className="db-library-current">
          <div>
            <span>Current song</span>
            <strong>{currentName ?? 'Untitled song'}</strong>
            <small>{song.patterns.length} patterns · {song.chain.length} sections</small>
          </div>
          <button type="button" className="db-library-primary" onClick={saveCurrent}>
            {currentName ? 'Save changes' : 'Save song'}
          </button>
          <button type="button" onClick={saveCurrentAs}>Save as…</button>
        </div>

        {documents.length === 0 ? (
          <div className="db-library-empty">
            <strong>Your shelf is empty.</strong>
            <span>Save this song and it will be available in both modes.</span>
          </div>
        ) : (
          <ul className="db-library-list">
            {documents.map((entry) => (
              <li key={entry.name}>
                {renaming === entry.name ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!renameDocument(entry.name, draft)) {
                        setProblem(`Could not rename to “${draft.trim()}” — that name is taken.`)
                        return
                      }
                      if (currentName === entry.name) setLibraryName(draft.trim())
                      setRenaming(null)
                      setProblem(null)
                      refresh()
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="New document name"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setRenaming(null)
                      }}
                    />
                    <button type="submit">Rename</button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="db-library-open"
                      disabled={!editableHere(entry)}
                      onClick={() => open(entry)}
                    >
                      <span className={`db-library-kind db-library-kind-${entry.kind}`}>
                        {entry.kind}
                      </span>
                      <strong>{entry.name}</strong>
                      <small>{compatibilityLabel(entry)}</small>
                      <b>
                        {currentName === entry.name
                          ? 'open now'
                          : editableHere(entry)
                            ? 'load →'
                            : 'open in rack'}
                      </b>
                    </button>
                    <button
                      type="button"
                      className="db-library-tiny"
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
                      className="db-library-tiny"
                      aria-label={`Delete ${entry.name}`}
                      onClick={() => {
                        if (!confirm(`Delete “${entry.name}”?`)) return
                        deleteDocument(entry.name)
                        if (currentName === entry.name) setLibraryName(null)
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
        )}

        {problem && <p className="db-library-problem">{problem}</p>}
      </section>
    </div>,
    document.body,
  )
}
