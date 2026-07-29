import { useEffect, useRef, useState } from 'react'
import { useBox } from '../store'

// The pattern list: switch, rename, add, copy, delete.
//
// Until this existed the app could only ever arrange the patterns it shipped with, which
// made song mode four fixed things in a row. `emptyPattern` had been sitting in the
// engine unused the whole time.
//
// Renaming is a double click on the chip rather than a separate control, because a name
// is not a property you set once — you rename a pattern when you work out what it is for,
// which is halfway through writing it. Copy is next to it for the same reason: nobody
// writes a second pattern from scratch, they take the one that works and change two
// things.

export function PatternBar() {
  const song = useBox((s) => s.song)
  const editing = useBox((s) => s.editing)
  const setEditing = useBox((s) => s.setEditing)
  const newPattern = useBox((s) => s.newPattern)
  const copyPattern = useBox((s) => s.copyPattern)
  const namePattern = useBox((s) => s.namePattern)
  const dropPattern = useBox((s) => s.dropPattern)

  const [renaming, setRenaming] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) input.current?.select()
  }, [renaming])

  // The last pattern cannot go: a song with none has nothing to show in the grid.
  const canDelete = song.patterns.length > 1

  return (
    <div className="patterns">
      {song.patterns.map((p) =>
        renaming === p.id ? (
          <input
            key={p.id}
            ref={input}
            className="pattern-rename"
            defaultValue={p.name}
            aria-label={`Rename ${p.name}`}
            onBlur={(e) => {
              namePattern(p.id, e.target.value)
              setRenaming(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              // Escape abandons the edit — blur would otherwise commit it, which is the
              // opposite of what escape means everywhere else.
              if (e.key === 'Escape') {
                e.currentTarget.value = p.name
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <button
            key={p.id}
            className={p.id === editing ? 'on' : ''}
            onClick={() => setEditing(p.id)}
            onDoubleClick={() => setRenaming(p.id)}
            title={`${p.name} — double click to rename`}
          >
            {p.name}
          </button>
        ),
      )}

      <button className="pattern-tool" onClick={newPattern} title="New empty pattern">
        +
      </button>
      <button
        className="pattern-tool"
        onClick={() => copyPattern(editing)}
        title="Duplicate this pattern"
      >
        ⧉
      </button>
      <button
        className="pattern-tool pattern-drop"
        onClick={() => {
          const pattern = song.patterns.find((p) => p.id === editing)
          if (!pattern) return
          // Asks, because it takes the pattern out of the arrangement as well and there
          // is no undo anywhere in this app.
          if (confirm(`Delete "${pattern.name}"? It will be removed from the song too.`)) {
            dropPattern(editing)
          }
        }}
        disabled={!canDelete}
        title={canDelete ? 'Delete this pattern' : 'A song needs at least one pattern'}
      >
        ×
      </button>
    </div>
  )
}
