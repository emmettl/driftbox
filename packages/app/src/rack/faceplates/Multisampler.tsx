import { useRef, useState } from 'react'
import {
  packMultisampleZones,
  unpackMultisampleZones,
  type MultisampleZone,
} from '@driftbox/rack'
import { ParamControl } from '../ParamControl.js'
import { midiNoteName } from '../multisample.js'
import { useRack } from '../store.js'
import type { FaceplateProps } from './types.js'

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

interface FieldProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}

function Field({ label, value, min, max, step = 1, suffix, onChange }: FieldProps) {
  return (
    <label className="rk-multi-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={step < 1 ? value.toFixed(2) : Math.round(value)}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
      />
      {suffix && <small>{suffix}</small>}
    </label>
  )
}

// A sample map is spatial information, so the faceplate is spatial too: horizontal is key, vertical is
// velocity, and every zone is a button. The selected recording then exposes the exact boundaries and loop
// points. PCM never enters React; only short display envelopes and the patch's nine-number zone records do.
export function Multisampler({ def, module, value, onChange, routed }: FaceplateProps) {
  const info = useRack((state) => state.multisamples[module.id]) ?? []
  const load = useRack((state) => state.loadMultisamplesInto)
  const setData = useRack((state) => state.setData)
  const file = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const zones = unpackMultisampleZones(module.data?.zones ?? [])
  const selectedIndex = Math.min(selected, Math.max(0, zones.length - 1))
  const zone = zones[selectedIndex]
  const sample = info[selectedIndex]
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!

  const choose = async (files: readonly File[]) => {
    if (!load || files.length === 0) return
    setBusy(true)
    try {
      await load(module.id, files)
      setSelected(0)
    } finally {
      setBusy(false)
    }
  }

  const edit = (change: (current: MultisampleZone) => MultisampleZone) => {
    if (!zone) return
    const next = zones.map((candidate, index) => index === selectedIndex ? change(candidate) : candidate)
    setData(module.id, 'zones', packMultisampleZones(next))
  }

  const editNote = (field: 'root' | 'low' | 'high', next: number) =>
    edit((current) => {
      const note = clamp(Math.round(next), 0, 127)
      if (field === 'low') return { ...current, low: Math.min(note, current.high) }
      if (field === 'high') return { ...current, high: Math.max(note, current.low) }
      return { ...current, root: note }
    })

  return (
    <>
      <header className="rk-title rk-multi-title">
        <span className="rk-name">Key Atlas</span>
        <span className="rk-multi-model">MS—128</span>
        <span className="rk-sampler-state" data-ready={info.length > 0 ? 'yes' : 'no'}>
          <i />
          {busy ? 'decoding' : info.length > 0 ? `${info.length} zones` : 'empty'}
        </span>
      </header>

      <div
        className="rk-multi-map"
        data-empty={zones.length === 0 ? 'yes' : 'no'}
        data-dragging={dragging ? 'yes' : 'no'}
        onDragEnter={(event) => {
          event.preventDefault()
          if (load) setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void choose([...event.dataTransfer.files])
        }}
      >
        {zones.length > 0 ? (
          <>
            <div className="rk-multi-octaves" aria-hidden="true">
              {Array.from({ length: 11 }, (_, octave) => <i key={octave} />)}
            </div>
            {zones.map((candidate, index) => {
              const left = (candidate.low / 128) * 100
              const width = ((candidate.high - candidate.low + 1) / 128) * 100
              const top = (1 - candidate.velocityHigh) * 100
              const height = Math.max(4, (candidate.velocityHigh - candidate.velocityLow) * 100)
              return (
                <button
                  key={index}
                  type="button"
                  className={index === selectedIndex ? 'rk-multi-zone rk-multi-zone-on' : 'rk-multi-zone'}
                  style={{ left: `${left}%`, width: `${width}%`, top: `${top}%`, height: `${height}%` }}
                  onClick={() => setSelected(index)}
                  aria-pressed={index === selectedIndex}
                  aria-label={`${info[index]?.name ?? `Zone ${index + 1}`}: ${midiNoteName(candidate.low)} to ${midiNoteName(candidate.high)}`}
                  title={`${info[index]?.name ?? `Zone ${index + 1}`} · root ${midiNoteName(candidate.root)}`}
                >
                  <i style={{ left: `${clamp(((candidate.root - candidate.low) / Math.max(1, candidate.high - candidate.low + 1)) * 100, 0, 100)}%` }} />
                  <span>{midiNoteName(candidate.root)}</span>
                </button>
              )
            })}
          </>
        ) : (
          <button
            type="button"
            className="rk-multi-empty"
            disabled={busy || !load}
            onClick={() => file.current?.click()}
          >
            <strong>{busy ? 'Mapping recordings…' : 'Drop an instrument set'}</strong>
            <span>names such as Piano_C3_pp.wav map themselves</span>
          </button>
        )}
        {dragging && <span className="rk-sampler-drop">Drop to map files</span>}
      </div>

      <div className="rk-multi-toolbar">
        <button type="button" disabled={busy || !load} onClick={() => file.current?.click()}>
          {busy ? 'Loading…' : info.length > 0 ? 'Replace set' : 'Load files'}
        </button>
        <input
          ref={file}
          type="file"
          accept="audio/*,.wav,.aif,.aiff,.flac,.mp3"
          multiple
          hidden
          onChange={(event) => {
            const chosen = event.target.files ? [...event.target.files] : []
            event.target.value = ''
            void choose(chosen)
          }}
        />
        {zone && (
          <>
            <button type="button" onClick={() => setSelected((selectedIndex - 1 + zones.length) % zones.length)} aria-label="Previous zone">‹</button>
            <strong title={sample?.name}>{sample?.name ?? `Zone ${selectedIndex + 1}`}</strong>
            <small>{sample ? `${sample.seconds.toFixed(2)}s · ${sample.sampleRate / 1000}kHz` : 'session audio unavailable'}</small>
            <button type="button" onClick={() => setSelected((selectedIndex + 1) % zones.length)} aria-label="Next zone">›</button>
          </>
        )}
      </div>

      {zone && (
        <div className="rk-multi-editor">
          <div className="rk-multi-fields">
            <Field label="root" value={zone.root} min={0} max={127} suffix={midiNoteName(zone.root)} onChange={(next) => editNote('root', next)} />
            <Field label="key low" value={zone.low} min={0} max={127} suffix={midiNoteName(zone.low)} onChange={(next) => editNote('low', next)} />
            <Field label="key high" value={zone.high} min={0} max={127} suffix={midiNoteName(zone.high)} onChange={(next) => editNote('high', next)} />
            <Field label="vel low" value={zone.velocityLow} min={0} max={1} step={0.01} onChange={(next) => edit((current) => ({ ...current, velocityLow: Math.min(next, current.velocityHigh) }))} />
            <Field label="vel high" value={zone.velocityHigh} min={0} max={1} step={0.01} onChange={(next) => edit((current) => ({ ...current, velocityHigh: Math.max(next, current.velocityLow) }))} />
          </div>
          <div className="rk-multi-loop">
            <label>
              <input type="checkbox" checked={zone.loop} onChange={(event) => edit((current) => ({ ...current, loop: event.target.checked }))} />
              sustain loop
            </label>
            <span>{Math.round(zone.loopStart * 100)}%</span>
            <input type="range" min={0} max={0.99} step={0.01} value={zone.loopStart} aria-label="Loop start" onChange={(event) => edit((current) => ({ ...current, loopStart: Math.min(Number(event.target.value), current.loopEnd - 0.01) }))} />
            <input type="range" min={0.01} max={1} step={0.01} value={zone.loopEnd} aria-label="Loop end" onChange={(event) => edit((current) => ({ ...current, loopEnd: Math.max(Number(event.target.value), current.loopStart + 0.01) }))} />
            <span>{Math.round(zone.loopEnd * 100)}%</span>
          </div>
          {sample && (
            <svg className="rk-multi-wave" viewBox="0 0 192 30" preserveAspectRatio="none" aria-hidden="true">
              {sample.peaks.map((peak, index) => <rect key={index} x={(index * 192) / sample.peaks.length} y={15 - peak * 12} width={Math.max(1, 160 / sample.peaks.length)} height={Math.max(1, peak * 24)} />)}
              {zone.loop && <rect className="rk-multi-loop-window" x={zone.loopStart * 192} y={0} width={(zone.loopEnd - zone.loopStart) * 192} height={30} />}
            </svg>
          )}
        </div>
      )}

      <div className="rk-multi-controls">
        {(['tune', 'attack', 'release', 'velocity', 'level'] as const).map((id) => (
          <ParamControl key={id} def={param(id)} value={value(id)} onChange={(next) => onChange(id, next)} colour={id === 'level' ? 'var(--nine)' : undefined} routed={routed?.(id)} />
        ))}
      </div>
    </>
  )
}
