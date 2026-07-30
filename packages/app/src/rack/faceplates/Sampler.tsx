import { useRef, useState } from 'react'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import type { FaceplateProps } from './types.js'

// Hand-built for one reason: **what is loaded in here?**
//
// That is the first question anybody has about a sampler, and — exactly like the MIDI module's "is my
// keyboard connected" — it is the one thing a faceplate generated from the def could never answer. The
// loaded break is not a param anybody turns; it is session state that arrived from outside the patch. So
// this reaches into the store for it, which is why it is the second faceplate that does and the reason is
// the same one.
//
// It exists now rather than later because a patch can have **two** Samplers. Before this there was nowhere
// to say which one a file was meant for, and loading a break pushed it into all of them — fine while there
// was one, wrong the moment there were two.
//
// The bar count is a control rather than a readout, and that is the one thing worth explaining. A file's
// tempo cannot be measured, only assumed: the same audio is one bar at 87bpm or two at 174. `guessBars`
// picks the reading closest to what the patch is already playing, which is right nearly always — and when
// it is wrong it is wrong by exactly a factor of two, which is instantly audible and one click to correct.

export function Sampler({ def, module, value, onChange }: FaceplateProps) {
  const info = useRack((s) => s.samples[module.id])
  const loadSampleInto = useRack((s) => s.loadSampleInto)
  const setBars = useRack((s) => s.setSampleBars)
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const param = (id: string) => def.params.find((p) => p.id === id)!

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Sampler</span>
        <span className="rk-ports">
          {info ? `${info.bars} bar${info.bars === 1 ? '' : 's'}` : 'empty'}
        </span>
      </header>

      <div className="rk-sample">
        <button
          type="button"
          className="rk-sample-load"
          disabled={busy || !loadSampleInto}
          onClick={() => file.current?.click()}
          title={loadSampleInto ? 'Load an audio file into this sampler' : 'Not ready yet'}
        >
          {busy ? 'Loading…' : 'Load…'}
        </button>
        <span className="rk-sample-name" title={info?.name}>
          {info ? info.name : 'no sample'}
        </span>
        {info && (
          // Only when there is something loaded: halving the bar count of nothing is not a thing anybody
          // wants to be offered.
          <span className="rk-sample-bars">
            <button
              type="button"
              onClick={() => setBars(module.id, Math.max(1, info.bars / 2))}
              disabled={info.bars <= 1}
              aria-label="Half as many bars"
            >
              ÷2
            </button>
            <button
              type="button"
              onClick={() => setBars(module.id, Math.min(8, info.bars * 2))}
              disabled={info.bars >= 8}
              aria-label="Twice as many bars"
            >
              ×2
            </button>
          </span>
        )}
        <input
          ref={file}
          type="file"
          accept="audio/*"
          hidden
          onChange={async (event) => {
            const chosen = event.target.files?.[0]
            // Cleared straight away so the same file can be chosen twice in a row — otherwise `change`
            // never fires the second time and it looks like the button stopped working.
            event.target.value = ''
            if (!chosen || !loadSampleInto) return
            setBusy(true)
            try {
              await loadSampleInto(module.id, chosen)
            } finally {
              setBusy(false)
            }
          }}
        />
      </div>

      <div className="rk-controls">
        {def.params.map((p) => (
          <ParamControl
            key={p.id}
            def={param(p.id)}
            value={value(p.id)}
            onChange={(v) => onChange(p.id, v)}
          />
        ))}
      </div>
    </>
  )
}
