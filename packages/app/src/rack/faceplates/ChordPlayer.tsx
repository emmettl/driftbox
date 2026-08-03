import { CHORD_PLAYER_LANES } from '@driftbox/rack'
import { ParamControl } from '../ParamControl.js'
import { chordPreview } from './chord-player-display.js'
import type { FaceplateProps } from './types.js'

const CONTROL_IDS = ['key', 'scale', 'notes', 'inversion', 'open', 'octUp', 'octDown', 'color'] as const
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const noteLabel = (note: number, root: number) => {
  const name = NOTE_NAMES[((note % 12) + 12) % 12]
  const octave = Math.floor((note - root) / 12)
  return {
    name,
    octave: octave === 0 ? 'root octave' : octave > 0 ? `+${octave} octave` : `${octave} octave`,
    badge: octave === 0 ? 'root' : octave > 0 ? `+${octave}×` : `${octave}×`,
  }
}

// Nine generic controls say how this device is configured but not what chord they make. Chord Loom keeps an
// eight-lane preview visible and gives Alter its actual momentary behaviour. Every ordinary control remains a
// ParamControl, so routing, automation and the processor contract stay authoritative.
export function ChordPlayer({ def, module, value, onChange, routed }: FaceplateProps) {
  const key = Math.max(0, Math.min(11, Math.round(value('key'))))
  const scale = Math.max(0, Math.min(13, Math.round(value('scale'))))
  const notes = Math.max(1, Math.min(5, Math.round(value('notes'))))
  const inversion = Math.max(0, Math.min(4, Math.round(value('inversion'))))
  const altered = value('alter') >= 0.5
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const scaleName = param('scale').labels?.[scale] ?? `Scale ${scale + 1}`
  const chord = chordPreview({
    key,
    scale,
    custom: module.data?.customScale,
    notes,
    inversion,
    open: value('open') >= 0.5,
    octUp: value('octUp') >= 0.5,
    octDown: value('octDown') >= 0.5,
    color: value('color') >= 0.5,
    alter: altered,
  })

  const releaseAlter = () => {
    if (value('alter') >= 0.5) onChange('alter', 0)
  }

  return (
    <>
      <header className="rk-title rk-chord-title">
        <span className="rk-name">Chord Loom</span>
        <span className="rk-chord-model">CP—8</span>
        <span className="rk-chord-readout">{NOTE_NAMES[key]} {scaleName} · {chord.length} voices</span>
      </header>

      <div className="rk-chord-display" data-open={value('open') >= 0.5 ? 'yes' : undefined}>
        <div className="rk-chord-notes" role="list" aria-label={`${NOTE_NAMES[key]} ${scaleName} chord preview`}>
          {Array.from({ length: CHORD_PLAYER_LANES }, (_, lane) => {
            const note = chord[lane]
            const label = note === undefined ? null : noteLabel(note, key)
            return (
              <span
                key={lane}
                role="listitem"
                className="rk-chord-note"
                data-active={label ? 'yes' : 'no'}
                aria-label={label ? `${label.name}, ${label.octave}` : `Voice ${lane + 1} unused`}
              >
                <i>{lane + 1}</i>
                <b>{label?.name ?? '—'}</b>
                <em>{label?.badge ?? 'idle'}</em>
              </span>
            )
          })}
        </div>
        <div className="rk-chord-legend">
          <span>{notes} tertian</span>
          <button
            type="button"
            className="rk-chord-alter"
            data-routed={routed?.('alter') ? 'yes' : undefined}
            aria-pressed={altered}
            aria-label="Hold to alter chord"
            onPointerDown={(event) => {
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              onChange('alter', 1)
            }}
            onPointerUp={(event) => {
              event.stopPropagation()
              event.currentTarget.releasePointerCapture(event.pointerId)
              releaseAlter()
            }}
            onPointerCancel={releaseAlter}
            onLostPointerCapture={releaseAlter}
            onBlur={releaseAlter}
            onKeyDown={(event) => {
              if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                event.preventDefault()
                onChange('alter', 1)
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                releaseAlter()
              }
            }}
          >
            Alter
          </button>
          <span>{inversion === 0 ? 'root position' : `inversion ${inversion}`}</span>
        </div>
      </div>

      <div className="rk-chord-controls">
        {CONTROL_IDS.map((id) => (
          <ParamControl
            key={id}
            def={param(id)}
            value={value(id)}
            onChange={(next) => onChange(id, next)}
            colour={id === 'key' ? 'var(--three)' : id === 'scale' ? 'var(--nine)' : undefined}
            routed={routed?.(id)}
          />
        ))}
      </div>
    </>
  )
}
