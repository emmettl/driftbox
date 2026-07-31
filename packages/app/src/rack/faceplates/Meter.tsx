import { ParamControl } from '../ParamControl.js'
import { useMeter } from '../meter.js'
import { meterLabel, meterPosition, waveformPoints } from './meter-display.js'
import type { FaceplateProps } from './types.js'

const LEDS = 18
const TICKS = [
  { db: -40, label: '−40' },
  { db: -20, label: '−20' },
  { db: -10, label: '−10' },
  { db: -5, label: '−5' },
  { db: 0, label: '0' },
  { db: 3, label: '+3' },
] as const

export function Meter({ def, module, value, onChange, routed }: FaceplateProps) {
  const reading = useMeter(module.id)
  const mode = Math.max(0, Math.min(2, Math.round(value('mode'))))
  const position = meterPosition(mode === 0 ? reading.envelope : reading.level)
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const needle = -50 + position * 100
  const lit = Math.round(position * LEDS)

  return (
    <>
      <header className="rk-title rk-meter-title">
        <span className="rk-name">Signal Bureau</span>
        <span className="rk-meter-model">VU—3</span>
        <span className={reading.peak > 1 ? 'rk-meter-clip rk-meter-clip-on' : 'rk-meter-clip'}>
          peak
        </span>
        <span className="rk-ports">{meterLabel(reading.level)}</span>
      </header>

      <div className="rk-meter-body">
        <div
          className={`rk-meter-display rk-meter-display-${mode}`}
          role="meter"
          aria-label={`${module.id} signal level`}
          aria-valuemin={-48}
          aria-valuemax={3}
          aria-valuenow={reading.level > 0 ? Math.max(-48, 20 * Math.log10(reading.level)) : -48}
        >
          {mode === 0 && (
            <div className="rk-meter-vu">
              <div className="rk-meter-vu-scale" aria-hidden="true">
                {TICKS.map((tick) => {
                  const angle = -50 + meterPosition(10 ** (tick.db / 20)) * 100
                  return (
                    <span
                      key={tick.db}
                      className={tick.db > 0 ? 'rk-meter-tick rk-meter-tick-hot' : 'rk-meter-tick'}
                      style={{ transform: `rotate(${angle}deg)` }}
                    >
                      <i />
                      <b style={{ transform: `rotate(${-angle}deg)` }}>{tick.label}</b>
                    </span>
                  )
                })}
              </div>
              <span
                className="rk-meter-needle"
                style={{ transform: `translateX(-50%) rotate(${needle}deg)` }}
                aria-hidden="true"
              />
              <span className="rk-meter-pivot" aria-hidden="true" />
              <span className="rk-meter-vu-mark">VU</span>
            </div>
          )}

          {mode === 1 && (
            <div className="rk-meter-leds" aria-hidden="true">
              {Array.from({ length: LEDS }, (_, index) => {
                const zone = index >= 16 ? 'red' : index >= 12 ? 'amber' : 'green'
                return (
                  <i
                    key={index}
                    data-zone={zone}
                    data-on={index < lit ? 'yes' : 'no'}
                  />
                )
              })}
              <span>−48</span>
              <span>−18</span>
              <span>−6</span>
              <span>+3</span>
            </div>
          )}

          {mode === 2 && (
            <div className="rk-meter-wave" aria-hidden="true">
              <svg viewBox="0 0 300 78" preserveAspectRatio="none">
                <line x1="0" y1="39" x2="300" y2="39" />
                <polyline points={waveformPoints(reading.waveform)} />
              </svg>
              <span className="rk-meter-wave-readout">{meterLabel(reading.peak)} peak</span>
            </div>
          )}
        </div>

        <div className="rk-meter-controls">
          <ParamControl
            def={param('mode')}
            value={value('mode')}
            onChange={(next) => onChange('mode', next)}
            routed={routed?.('mode')}
          />
          <ParamControl
            def={param('gain')}
            value={value('gain')}
            onChange={(next) => onChange('gain', next)}
            colour="var(--nine)"
            routed={routed?.('gain')}
          />
          <ParamControl
            def={param('release')}
            value={value('release')}
            onChange={(next) => onChange('release', next)}
            colour="var(--three)"
            routed={routed?.('release')}
          />
        </div>
      </div>
    </>
  )
}
