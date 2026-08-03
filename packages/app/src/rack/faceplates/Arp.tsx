import { ARP_PATTERN_STEPS } from '@driftbox/rack'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import { arpInsertPreview } from './arp-display.js'
import type { FaceplateProps } from './types.js'

const CONTROL_IDS = [
  'enable',
  'source', 'chord', 'octaves', 'mode', 'gate', 'hold', 'shift', 'velocityMode', 'velocity',
  'timing', 'division', 'rate', 'patternLength',
  'insert',
  'singleRepeat',
  'shuffle',
] as const

export function Arp({ def, module, value, onChange, routed }: FaceplateProps) {
  const setData = useRack((state) => state.setData)
  const source = Math.max(0, Math.min(1, Math.round(value('source'))))
  const enabled = value('enable') >= 0.5
  const chord = Math.max(0, Math.min(7, Math.round(value('chord'))))
  const octaves = Math.max(1, Math.min(4, Math.round(value('octaves'))))
  const mode = Math.max(0, Math.min(5, Math.round(value('mode'))))
  const shift = Math.max(-3, Math.min(3, Math.round(value('shift'))))
  const hold = value('hold') >= 0.5
  const fixedVelocity = value('velocityMode') >= 0.5
  const timing = Math.max(0, Math.min(2, Math.round(value('timing'))))
  const division = Math.max(0, Math.min(15, Math.round(value('division'))))
  const rate = Math.max(0.1, Math.min(250, value('rate')))
  const patternLength = Math.max(1, Math.min(ARP_PATTERN_STEPS, Math.round(value('patternLength'))))
  const insert = Math.max(0, Math.min(4, Math.round(value('insert'))))
  const singleRepeat = value('singleRepeat') >= 0.5
  const shuffle = value('shuffle') >= 0.5
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const sourceName = param('source').labels?.[source] ?? (source === 0 ? 'Root' : 'Played')
  const modeName = param('mode').labels?.[mode] ?? `Mode ${mode + 1}`
  const chordName = param('chord').labels?.[chord] ?? `Chord ${chord + 1}`
  const stored = module.data?.pattern ?? []
  const pattern = Array.from(
    { length: ARP_PATTERN_STEPS },
    (_, index) => stored[index] === undefined ? 1 : stored[index],
  )
  const figure = arpInsertPreview({ source, chord, octaves, mode, shift, insert })
  let figureStep = 0
  const preview = pattern.map((enabled) => {
    const step = figure[Math.min(figure.length - 1, figureStep)]
    if (enabled >= 0.5) figureStep++
    return step
  })
  const timingName = timing === 0
    ? 'external clock'
    : timing === 1
      ? `${param('division').labels?.[division] ?? `division ${division + 1}`} tempo${shuffle ? ' · shuffle' : ''}`
      : `${rate < 10 ? rate.toFixed(1) : Math.round(rate)} Hz`
  const insertName = param('insert').labels?.[insert] ?? `Insert ${insert}`

  const toggle = (index: number) => {
    const next = [...pattern]
    next[index] = next[index] >= 0.5 ? 0 : 1
    setData(module.id, 'pattern', next)
  }

  return (
    <>
      <header className="rk-title rk-arp-title">
        <span className="rk-name">Arp Field</span>
        <span className="rk-arp-model">AP—64</span>
        <span className="rk-arp-readout">
          {enabled ? `${sourceName} · ${modeName} · ${timingName}` : `${sourceName} · converter`}
        </span>
      </header>

      <div className="rk-arp-display" data-source={source === 0 ? 'root' : 'played'}>
        <div className="rk-arp-steps" role="group" aria-label={`${sourceName} ${modeName} rhythm pattern`}>
          {preview.map((step, index) => {
            const enabled = pattern[index] >= 0.5
            const active = index < patternLength
            const description = `Step ${index + 1} ${enabled ? 'enabled' : 'muted'}: ${step.description}`
            return (
              <button
                key={index}
                type="button"
                className={enabled ? 'rk-arp-step rk-arp-step-on' : 'rk-arp-step'}
                data-active={active ? 'yes' : 'no'}
                data-octave={Math.max(-3, Math.min(3, step.octave))}
                disabled={!active}
                aria-pressed={enabled}
                aria-label={description}
                title={description}
                onClick={() => toggle(index)}
              >
                <i>{index + 1}</i>
                <b>{enabled ? step.label : '—'}</b>
                <em>{enabled ? (step.octave === 0 ? 'root' : `${step.octave > 0 ? '+' : ''}${step.octave}×`) : 'rest'}</em>
              </button>
            )
          })}
        </div>
        <div className="rk-arp-legend">
          <span>{source === 0 ? `${chordName} intervals` : 'held input lanes'}</span>
          <strong data-held={hold ? 'yes' : undefined}>
            {!enabled ? 'bypass' : hold ? 'hold' : !singleRepeat ? 'single once' : insert === 0 ? 'live' : `insert ${insertName}`}
          </strong>
          <span>{patternLength} steps · {fixedVelocity ? `${Math.round(value('velocity') * 100)}% fixed` : 'played velocity'}</span>
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
