import { useRef, useState } from 'react'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import { audioTrackPosition, audioTrackStart } from './audio-track-display.js'
import type { FaceplateProps } from './types.js'

export function AudioTrack({ def, module, value, onChange, routed }: FaceplateProps) {
  const info = useRack((state) => state.audioTracks[module.id])
  const loadAudioTrackInto = useRack((state) => state.loadAudioTrackInto)
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const position = audioTrackPosition(value('start'))
  const level = def.params.find((candidate) => candidate.id === 'level')!

  const choose = async (chosen?: File) => {
    if (!chosen || !loadAudioTrackInto) return
    setBusy(true)
    try {
      await loadAudioTrackInto(module.id, chosen)
    } finally {
      setBusy(false)
    }
  }

  const place = (bar: number, step: number) => onChange('start', audioTrackStart(bar, step))

  return (
    <>
      <header className="rk-title rk-audio-track-title">
        <span className="rk-name">Audio Track</span>
        <span className="rk-audio-track-model">AT—64</span>
        <span className="rk-ports">stereo · timeline</span>
      </header>

      <div
        className="rk-audio-track-display"
        data-empty={info ? 'no' : 'yes'}
        data-dragging={dragging ? 'yes' : 'no'}
        onDragEnter={(event) => {
          event.preventDefault()
          if (loadAudioTrackInto) setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void choose(event.dataTransfer.files[0])
        }}
      >
        {info ? (
          <svg viewBox="0 0 384 72" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="36" x2="384" y2="36" />
            {info.peaks.map((peak, index) => {
              const height = Math.max(1, Math.min(1, peak) * 58)
              return (
                <rect
                  key={index}
                  x={(index * 384) / info.peaks.length}
                  y={36 - height / 2}
                  width={Math.max(1, 300 / info.peaks.length)}
                  height={height}
                />
              )
            })}
          </svg>
        ) : (
          <button
            type="button"
            disabled={busy || !loadAudioTrackInto}
            onClick={() => file.current?.click()}
          >
            <strong>{busy ? 'Reading audio…' : 'Drop audio here'}</strong>
            <span>or choose a local recording</span>
          </button>
        )}
        {dragging && <span className="rk-audio-track-drop">Drop to place</span>}
      </div>

      <div className="rk-audio-track-file">
        <button
          type="button"
          disabled={busy || !loadAudioTrackInto}
          onClick={() => file.current?.click()}
          title={loadAudioTrackInto ? `${info ? 'Replace' : 'Load'} audio file` : 'Not ready yet'}
        >
          {busy ? 'Loading…' : info ? 'Replace' : 'Load audio'}
        </button>
        <span>
          <strong title={info?.name}>{info?.name ?? 'No recording loaded'}</strong>
          {info && <small>{info.channels === 2 ? 'stereo' : 'mono'} · {info.seconds.toFixed(2)}s</small>}
        </span>
        <input
          ref={file}
          type="file"
          accept="audio/*,.wav,.aif,.aiff,.flac,.mp3"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            event.target.value = ''
            void choose(chosen)
          }}
        />
      </div>

      <div className="rk-audio-track-controls">
        <div className="rk-audio-track-position" data-routed={routed?.('start') ? 'yes' : undefined}>
          <span>start</span>
          <label>
            <span>bar</span>
            <input
              type="number"
              min="1"
              max="64"
              value={position.bar}
              onChange={(event) => place(event.currentTarget.valueAsNumber, position.step)}
              aria-label="Audio track start bar"
            />
          </label>
          <label>
            <span>step</span>
            <input
              type="number"
              min="1"
              max="16"
              value={position.step}
              onChange={(event) => place(position.bar, event.currentTarget.valueAsNumber)}
              aria-label="Audio track start sixteenth"
            />
          </label>
        </div>
        <ParamControl
          def={level}
          value={value('level')}
          onChange={(next) => onChange('level', next)}
          colour="var(--nine)"
          routed={routed?.('level')}
        />
      </div>
    </>
  )
}
