import { ParamControl } from '../ParamControl.js'
import { arpPreview } from './arp-display.js'
import type { FaceplateProps } from './types.js'

const CONTROL_IDS = [
  'source', 'chord', 'octaves', 'mode', 'gate', 'hold', 'shift', 'velocityMode', 'velocity',
] as const

export function Arp({ def, value, onChange, routed }: FaceplateProps) {
  const source = Math.max(0, Math.min(1, Math.round(value('source'))))
  const chord = Math.max(0, Math.min(7, Math.round(value('chord'))))
  const octaves = Math.max(1, Math.min(4, Math.round(value('octaves'))))
  const mode = Math.max(0, Math.min(5, Math.round(value('mode'))))
  const shift = Math.max(-3, Math.min(3, Math.round(value('shift'))))
  const hold = value('hold') >= 0.5
  const fixedVelocity = value('velocityMode') >= 0.5
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const sourceName = param('source').labels?.[source] ?? (source === 0 ? 'Root' : 'Played')
  const modeName = param('mode').labels?.[mode] ?? `Mode ${mode + 1}`
  const chordName = param('chord').labels?.[chord] ?? `Chord ${chord + 1}`
  const preview = arpPreview({ source, chord, octaves, mode, shift })

  return (
    <>
      <header className="rk-title rk-arp-title">
        <span className="rk-name">Arp Field</span>
        <span className="rk-arp-model">AP—64</span>
        <span className="rk-arp-readout">{sourceName} · {modeName} · {octaves} oct</span>
      </header>

      <div className="rk-arp-display" data-source={source === 0 ? 'root' : 'played'}>
        <div className="rk-arp-steps" role="list" aria-label={`${sourceName} ${modeName} arpeggio preview`}>
          {preview.map((step, index) => (
            <span
              key={index}
              role="listitem"
              className="rk-arp-step"
              data-octave={Math.max(-3, Math.min(3, step.octave))}
              aria-label={`Step ${index + 1}: ${step.description}`}
              title={step.description}
            >
              <i>{index + 1}</i>
              <b>{step.label}</b>
              <em>{step.octave === 0 ? 'root' : `${step.octave > 0 ? '+' : ''}${step.octave}×`}</em>
            </span>
          ))}
        </div>
        <div className="rk-arp-legend">
          <span>{source === 0 ? `${chordName} intervals` : 'held input lanes'}</span>
          <strong data-held={hold ? 'yes' : undefined}>{hold ? 'hold' : 'live'}</strong>
          <span>{fixedVelocity ? `${Math.round(value('velocity') * 100)}% velocity` : 'played velocity'}</span>
        </div>
      </div>

      <div className="rk-arp-controls">
        {CONTROL_IDS.map((id) => (
          <ParamControl
            key={id}
            def={param(id)}
            value={value(id)}
            onChange={(next) => onChange(id, next)}
            colour={id === 'source' || id === 'hold' ? 'var(--three)' : id === 'mode' ? 'var(--nine)' : undefined}
            routed={routed?.(id)}
          />
        ))}
      </div>
    </>
  )
}
