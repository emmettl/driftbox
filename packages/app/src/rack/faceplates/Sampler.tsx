import { useRef, useState } from 'react'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import type { FaceplateProps } from './types.js'

const BAR_OPTIONS = [1, 2, 4, 8] as const

// A sampler should answer three questions at a glance: what is loaded, where the cuts are, and which cut
// will play. The generic parameter grid could only answer the last one, and even then as a number. This
// faceplate keeps the audio itself out of React while turning its small peak envelope into a real editing
// surface: the slice markers are buttons, the selected slice is visible, and a file can be dropped anywhere
// on the display instead of being hidden behind one tiny control.

export function Sampler({ def, module, value, onChange, routed }: FaceplateProps) {
  const info = useRack((state) => state.samples[module.id])
  const loadSampleInto = useRack((state) => state.loadSampleInto)
  const setBars = useRack((state) => state.setSampleBars)
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const slices = Math.max(1, Math.min(32, Math.round(value('slices'))))
  const selected = Math.max(0, Math.min(slices - 1, Math.round(value('slice'))))

  const choose = async (chosen?: File) => {
    if (!chosen || !loadSampleInto) return
    setBusy(true)
    try {
      await loadSampleInto(module.id, chosen)
    } finally {
      setBusy(false)
    }
  }

  const moveSlice = (by: number) =>
    onChange('slice', (selected + by + slices) % slices)

  return (
    <>
      <header className="rk-title rk-sampler-title">
        <span className="rk-name">Slice Lab</span>
        <span className="rk-sampler-model">S—32</span>
        <span className="rk-sampler-state" data-ready={info ? 'yes' : 'no'}>
          <i />
          {busy ? 'decoding' : info ? 'sample ready' : 'empty'}
        </span>
      </header>

      <div
        className="rk-sampler-display"
        data-empty={info ? 'no' : 'yes'}
        data-dragging={dragging ? 'yes' : 'no'}
        onDragEnter={(event) => {
          event.preventDefault()
          if (loadSampleInto) setDragging(true)
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
          <>
            <svg
              className="rk-sampler-wave"
              viewBox="0 0 192 64"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line x1="0" y1="32" x2="192" y2="32" />
              {info.peaks.map((peak, index) => {
                const height = Math.max(1, peak * 52)
                return (
                  <rect
                    key={index}
                    x={(index * 192) / info.peaks.length}
                    y={32 - height / 2}
                    width={Math.max(1, 150 / info.peaks.length)}
                    height={height}
                  />
                )
              })}
            </svg>
            <div
              className="rk-sampler-slices"
              style={{ gridTemplateColumns: `repeat(${slices}, 1fr)` }}
              role="group"
              aria-label="Choose a slice"
            >
              {Array.from({ length: slices }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  className={index === selected ? 'rk-sampler-slice rk-sampler-slice-on' : 'rk-sampler-slice'}
                  data-beat={index % 4 === 0 ? 'yes' : 'no'}
                  aria-label={`Slice ${index + 1}`}
                  aria-pressed={index === selected}
                  onClick={() => onChange('slice', index)}
                >
                  <span>{index + 1}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <button
            type="button"
            className="rk-sampler-empty"
            disabled={busy || !loadSampleInto}
            onClick={() => file.current?.click()}
          >
            <strong>{busy ? 'Reading sample…' : 'Drop audio here'}</strong>
            <span>or choose a WAV, AIFF, MP3 or FLAC</span>
          </button>
        )}
        {dragging && <span className="rk-sampler-drop">Drop to load</span>}
      </div>

      <div className="rk-sampler-info">
        <div className="rk-sampler-file">
          <button
            type="button"
            className="rk-sampler-load"
            disabled={busy || !loadSampleInto}
            onClick={() => file.current?.click()}
            title={loadSampleInto ? `${info ? 'Replace' : 'Load'} audio file` : 'Not ready yet'}
          >
            {busy ? 'Loading…' : info ? 'Replace' : 'Load sample'}
          </button>
          <span>
            <strong title={info?.name}>{info?.name ?? 'No sample loaded'}</strong>
            {info && (
              <small>
                {info.source === 'break' ? 'factory break' : 'local file'} · {info.seconds.toFixed(2)}s
              </small>
            )}
          </span>
        </div>

        {info && (
          <div className="rk-sampler-bars" role="group" aria-label="Sample length in bars">
            <span>bars</span>
            {BAR_OPTIONS.map((bars) => (
              <button
                key={bars}
                type="button"
                className={info.bars === bars ? 'rk-sampler-bar rk-sampler-bar-on' : 'rk-sampler-bar'}
                aria-pressed={info.bars === bars}
                onClick={() => setBars(module.id, bars)}
              >
                {bars}
              </button>
            ))}
          </div>
        )}

        <input
          ref={file}
          type="file"
          accept="audio/*,.wav,.aif,.aiff,.flac,.mp3"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            // Let the same file be chosen twice in a row; browsers otherwise suppress the second change.
            event.target.value = ''
            void choose(chosen)
          }}
        />
      </div>

      <div className="rk-sampler-controls">
        <ParamControl
          def={param('slices')}
          value={value('slices')}
          onChange={(next) => {
            onChange('slices', next)
            if (selected >= next) onChange('slice', Math.max(0, next - 1))
          }}
          colour="var(--nine)"
          routed={routed?.('slices')}
        />
        <div className="rk-sampler-selected" data-routed={routed?.('slice') ? 'yes' : undefined}>
          <span>selected slice</span>
          <div>
            <button type="button" onClick={() => moveSlice(-1)} aria-label="Previous slice">
              ‹
            </button>
            <strong>
              {String(selected + 1).padStart(2, '0')}
              <small>/{String(slices).padStart(2, '0')}</small>
            </strong>
            <button type="button" onClick={() => moveSlice(1)} aria-label="Next slice">
              ›
            </button>
          </div>
        </div>
        <ParamControl
          def={param('start')}
          value={value('start')}
          onChange={(next) => onChange('start', next)}
          colour="var(--three)"
          routed={routed?.('start')}
        />
        <ParamControl
          def={param('loop')}
          value={value('loop')}
          onChange={(next) => onChange('loop', next)}
          routed={routed?.('loop')}
        />
        <ParamControl
          def={param('reverse')}
          value={value('reverse')}
          onChange={(next) => onChange('reverse', next)}
          routed={routed?.('reverse')}
        />
      </div>
    </>
  )
}
