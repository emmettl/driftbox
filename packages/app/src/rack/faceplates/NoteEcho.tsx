import { NOTE_ECHO_STEPS } from '@driftbox/rack'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import type { FaceplateProps } from './types.js'

const IDS = ['sync', 'time', 'division', 'repeats', 'pitch', 'velocity', 'gate', 'dry'] as const

// The generic panel can operate Note Echo, but it cannot show the thing somebody listens for: the rhythm
// made by enabled and muted repeats. This panel keeps those seventeen portable data values visible while
// still reaching every declared param, so its display can never turn into a parallel implementation.
export function NoteEcho({ def, module, value, onChange, routed }: FaceplateProps) {
  const setData = useRack((state) => state.setData)
  const repeats = Math.max(1, Math.min(16, Math.round(value('repeats'))))
  const pitch = Math.round(value('pitch'))
  const velocity = value('velocity')
  const sync = Math.round(value('sync')) === 1
  const division = Math.max(0, Math.min(7, Math.round(value('division'))))
  const time = Math.round(value('time'))
  const stored = module.data?.steps ?? []
  const steps = Array.from({ length: NOTE_ECHO_STEPS }, (_, index) => stored[index] === undefined ? 1 : stored[index])
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const interval = sync ? param('division').labels?.[division] ?? `step ${division + 1}` : `${time}ms`

  const toggle = (index: number) => {
    const next = [...steps]
    next[index] = next[index] >= 0.5 ? 0 : 1
    setData(module.id, 'steps', next)
  }

  return (
    <>
      <header className="rk-title rk-echo-title">
        <span className="rk-name">Echo Matrix</span>
        <span className="rk-echo-model">NE—16</span>
        <span className="rk-echo-readout">{repeats} repeats · {interval}</span>
      </header>

      <div className="rk-echo-display">
        <div className="rk-echo-scale" aria-hidden="true"><i /><i /><i /></div>
        <div className="rk-echo-steps" role="group" aria-label="Enabled note echoes">
          {steps.map((enabled, index) => {
            const active = index <= repeats
            const amount = index === 0 ? 1 : Math.max(0, Math.min(1, 1 + (velocity - 1) * index))
            const semitones = pitch * index
            const description = index === 0
              ? `Dry note ${enabled >= 0.5 ? 'enabled' : 'muted'}`
              : `Repeat ${index} ${enabled >= 0.5 ? 'enabled' : 'muted'}, ${semitones >= 0 ? '+' : ''}${semitones} semitones, ${Math.round(amount * 100)}% velocity`
            return (
              <button
                key={index}
                type="button"
                className={enabled >= 0.5 ? 'rk-echo-step rk-echo-step-on' : 'rk-echo-step'}
                data-active={active ? 'yes' : 'no'}
                disabled={!active}
                aria-pressed={enabled >= 0.5}
                aria-label={description}
                title={description}
                onClick={() => toggle(index)}
              >
                <i style={{ height: `${Math.max(3, amount * 44)}px` }} />
                <span>{index === 0 ? 'D' : index}</span>
              </button>
            )
          })}
        </div>
        <div className="rk-echo-legend">
          <span>velocity slope</span>
          <strong>{pitch > 0 ? '+' : ''}{pitch} st / repeat</strong>
          <span>click a pulse to mute</span>
        </div>
      </div>

      <div className="rk-echo-controls">
        {IDS.map((id) => (
          <ParamControl
            key={id}
            def={param(id)}
            value={value(id)}
            onChange={(next) => onChange(id, next)}
            colour={id === 'pitch' ? 'var(--three)' : id === 'velocity' ? 'var(--nine)' : undefined}
            routed={routed?.(id)}
          />
        ))}
      </div>
    </>
  )
}
