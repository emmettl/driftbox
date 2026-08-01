import { PATCHES, embedGrooveboxSong, importVcv, type ImportNote } from '@driftbox/rack'
import { useState } from 'react'
import { BREAKS } from './breaks.js'
import {
  deleteDocument,
  freshName,
  listDocuments,
  loadDocument,
  renameDocument,
  savePatch,
  type SavedDocument,
} from './library.js'
import { downloadPatch, pickPatchFile, pickVcvFile } from './persistence.js'
import { useRack } from './store.js'

interface Props {
  onClose: () => void
  onLoadBreak?: (id: string) => void
}

type BrowserTab = 'showcase' | 'saved' | 'breaks' | 'files'

const TABS: readonly { id: BrowserTab; label: string }[] = [
  { id: 'showcase', label: 'Showcase' },
  { id: 'saved', label: 'My library' },
  { id: 'breaks', label: 'Breaks' },
  { id: 'files', label: 'Import / export' },
]

/** A deliberate preset browser, not a settings dump: every factory patch says what it proves before it
 * replaces the rack, while personal storage and file plumbing stay one tab away instead of competing
 * with the things somebody came here to hear. */
export function PatchBrowser({ onClose, onLoadBreak }: Props) {
  const patch = useRack((s) => s.patch)
  const name = useRack((s) => s.name)
  const load = useRack((s) => s.load)
  const setName = useRack((s) => s.setName)

  const [tab, setTab] = useState<BrowserTab>('showcase')
  const [saved, setSaved] = useState<SavedDocument[]>(() => listDocuments())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [report, setReport] = useState<ImportNote[] | null>(null)

  const refresh = () => setSaved(listDocuments())

  const adopt = (next: Parameters<typeof load>[0], as: string | null) => {
    load(next)
    setName(as)
    onClose()
  }

  const saveCurrent = () => {
    const target = name ?? freshName('Patch')
    if (!savePatch(target, patch)) {
      setProblem('Could not save — storage is unavailable or full.')
      return
    }
    setName(target)
    setProblem(null)
    refresh()
  }

  const saveCurrentAs = () => {
    const wanted = prompt('Save as', freshName(name ?? 'Patch'))
    if (wanted === null || wanted.trim() === '') return
    const target = wanted.trim()
    const existing = saved.find((entry) => entry.name === target)
    if (existing && !confirm(`Replace “${target}” (${existing.kind})?`)) return
    if (!savePatch(target, patch)) {
      setProblem('Could not save under that name.')
      return
    }
    setName(target)
    setProblem(null)
    refresh()
  }

  return (
    <div className="rk-library" aria-label="Patch browser">
      <header className="rk-library-head">
        <div>
          <span className="rk-library-kicker">Factory signal archive</span>
          <h2>Choose a system, not just a preset.</h2>
          <p>Each one is wired to demonstrate a different side of the rack and opens ready to move.</p>
        </div>
        <button type="button" className="rk-library-close" onClick={onClose} aria-label="Close patch browser">
          ×
        </button>
      </header>

      <nav className="rk-library-tabs" role="tablist" aria-label="Patch browser sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`rk-library-${entry.id}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'saved' && <span>{saved.length}</span>}
          </button>
        ))}
      </nav>

      <div
        className="rk-library-panel"
        id={`rk-library-${tab}`}
        role="tabpanel"
        aria-label={TABS.find((entry) => entry.id === tab)?.label}
      >
        {tab === 'showcase' && (
          <section className="rk-showcase">
            <div className="rk-preset-grid">
              {PATCHES.map((preset) => {
                const built = preset.build()
                const meters = built.modules.filter((module) => module.type === 'meter').length
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`rk-preset-card rk-preset-${preset.accent}${preset.featured ? ' rk-preset-featured' : ''}`}
                    onClick={() => {
                      adopt(built, preset.name)
                      if (preset.needsBreak) onLoadBreak?.(preset.needsBreak)
                    }}
                  >
                    <span className="rk-preset-topline">
                      <span>{preset.kicker}</span>
                      {preset.featured && <em>editor’s pick</em>}
                    </span>
                    <span className="rk-preset-visual" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <b>VU—{meters}</b>
                    </span>
                    <strong>{preset.name}</strong>
                    <span className="rk-preset-blurb">{preset.blurb}</span>
                    <span className="rk-preset-tags">
                      {preset.features.map((feature) => (
                        <i key={feature}>{feature}</i>
                      ))}
                    </span>
                    <span className="rk-preset-meta">
                      <span>
                        {built.modules.length} modules · {built.cables.length} cables
                        {built.tempo ? ` · ${built.tempo} bpm` : ''}
                      </span>
                      <b>{name === preset.name ? 'open' : 'load →'}</b>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {tab === 'saved' && (
          <section className="rk-saved">
            <div className="rk-current-patch">
              <div>
                <span>Current rack</span>
                <strong>{name ?? 'Untitled patch'}</strong>
                <small>
                  {patch.modules.length} modules · {patch.cables.length} cables
                </small>
              </div>
              <button type="button" className="rk-primary" onClick={saveCurrent}>
                {name ? 'Save changes' : 'Save patch'}
              </button>
              <button type="button" onClick={saveCurrentAs}>
                Save as…
              </button>
            </div>

            {saved.length === 0 && (
              <div className="rk-library-empty">
                <strong>Your document shelf is empty.</strong>
                <span>Save this rack or a groovebox song and it will appear here.</span>
              </div>
            )}

            <ul className="rk-saved-list">
              {saved.map((entry) => (
                <li key={entry.name}>
                  {renaming === entry.name ? (
                    <form
                      className="rk-rename"
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (!renameDocument(entry.name, draft)) {
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
                      <button type="submit">Rename</button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rk-saved-load"
                        onClick={() => {
                          const next = loadDocument(entry.name)
                          if (!next) {
                            setProblem(`“${entry.name}” could not be read.`)
                            return
                          }
                          adopt(
                            next.kind === 'song' ? embedGrooveboxSong(next.song) : next.patch,
                            entry.name,
                          )
                        }}
                      >
                        <strong>
                          <i className={`rk-document-kind rk-document-kind-${entry.kind}`}>
                            {entry.kind}
                          </i>
                          {entry.name}
                        </strong>
                        <span>
                          {name === entry.name
                            ? 'Open now'
                            : entry.kind === 'song'
                              ? 'Load song →'
                              : `${entry.compatibility.replace('-', ' ')} →`}
                        </span>
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
                          if (!confirm(`Delete “${entry.name}”?`)) return
                          deleteDocument(entry.name)
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
        )}

        {tab === 'breaks' && (
          <section className="rk-breaks">
            <div className="rk-library-section-head">
              <div>
                <span>Drum source</span>
                <h3>Freshly synthesised breaks</h3>
              </div>
              <p>No sample pack: each bar is rendered from the 909 when you load it.</p>
            </div>
            {!patch.modules.some((module) => module.type === 'sampler') && (
              <p className="rk-library-callout">Add a Sampler first, or choose a showcase patch that includes one.</p>
            )}
            <div className="rk-break-grid">
              {BREAKS.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  disabled={!onLoadBreak}
                  onClick={() => {
                    onLoadBreak?.(entry.id)
                    onClose()
                  }}
                >
                  <span className="rk-break-number">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{entry.name}</strong>
                  <span>{entry.blurb}</span>
                  <b>{entry.tempo} bpm →</b>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === 'files' && (
          <section className="rk-files">
            <div className="rk-file-card">
              <span>Driftbox patch</span>
              <strong>Portable and editable</strong>
              <p>Move this rack between browsers or keep a local backup.</p>
              <div>
                <button type="button" onClick={() => downloadPatch(patch, name ?? 'driftbox-patch')}>
                  Export current
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
              </div>
            </div>
            <div className="rk-file-card">
              <span>VCV Rack bridge</span>
              <strong>Bring the patching across</strong>
              <p>Module and port mapping is best effort; the import report shows every decision.</p>
              <button
                type="button"
                onClick={async () => {
                  const bytes = await pickVcvFile()
                  if (!bytes) return
                  const result = await importVcv(bytes)
                  if (!result) {
                    setProblem('That is not a VCV Rack patch.')
                    return
                  }
                  setProblem(null)
                  setReport(result.notes)
                  if (result.patch.modules.length > 0) {
                    load(result.patch)
                    setName(null)
                  }
                }}
              >
                Import .vcv
              </button>
            </div>
          </section>
        )}

        {problem && <p className="rk-warn rk-library-problem">{problem}</p>}

        {report && tab === 'files' && (
          <section className="rk-report">
            <h2>VCV import report · knob values are not carried over, so check these mappings.</h2>
            <ul>
              {report.map((note, index) => (
                <li key={index} className={`rk-note rk-note-${note.kind}`}>
                  <span>{note.kind}</span>
                  {note.detail}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
