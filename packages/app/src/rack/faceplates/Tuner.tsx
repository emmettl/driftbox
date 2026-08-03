import { ParamControl } from '../ParamControl.js'
import { useMeter } from '../meter.js'
import { tunerDisplay } from './tuner-display.js'
import type { FaceplateProps } from './types.js'

export function Tuner({ def, module, value, onChange, routed }: FaceplateProps) {
  const reading = useMeter(module.id)
  const display = tunerDisplay(reading.frequency ?? 0, value('reference'), reading.clarity ?? 0)
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const cents = display.cents
  const centsLabel = `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}¢`
  const inTune = display.detected && Math.abs(cents) <= 5

  return (
    <>
      <header className="rk-title rk-tuner-title">
        <span className="rk-name">Chromatic Tuner</span>
        <span className="rk-tuner-model">CT—40</span>
        <span className="rk-ports">55–2000 Hz</span>
      </header>

      <div className="rk-tuner-body">
        <div
          className="rk-tuner-display"
          data-detected={display.detected ? 'yes' : 'no'}
          data-tuned={inTune ? 'yes' : 'no'}
          role="meter"
          aria-label={`${module.id} tuning error`}
          aria-valuemin={-50}
          aria-valuemax={50}
          aria-valuenow={display.detected ? Math.round(cents) : 0}
          aria-valuetext={display.detected ? `${display.note}${display.octave} ${centsLabel}` : 'No signal'}
        >
          <div className="rk-tuner-note" aria-hidden="true">
            <strong>{display.note}</strong>
            <sup>{display.octave ?? ''}</sup>
          </div>
          <div className="rk-tuner-readout">
            {display.detected ? `${display.frequency.toFixed(1)} Hz` : 'NO SIGNAL'}
          </div>
          <div className="rk-tuner-scale" aria-hidden="true">
            {[-50, -25, 0, 25, 50].map((tick) => (
              <i key={tick} style={{ left: `${tick + 50}%` }}>
                <span>{tick > 0 ? `+${tick}` : tick}</span>
              </i>
            ))}
            <b style={{ left: `${cents + 50}%` }} />
          </div>
          <div className="rk-tuner-cents">{display.detected ? centsLabel : '—'}</div>
        </div>

        <div className="rk-tuner-controls">
          <ParamControl
            def={param('reference')}
            value={value('reference')}
            onChange={(next) => onChange('reference', next)}
            colour="var(--nine)"
            routed={routed?.('reference')}
          />
          <ParamControl
            def={param('mute')}
            value={value('mute')}
            onChange={(next) => onChange('mute', next)}
            routed={routed?.('mute')}
          />
        </div>
      </div>
    </>
  )
}
