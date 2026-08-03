import { ParamControl } from '../ParamControl.js'
import { useMeter } from '../meter.js'
import { loopTime } from './looper-display.js'
import { waveformPoints } from './meter-display.js'
import type { FaceplateProps } from './types.js'

const MODES = ['STOP', 'REC', 'PLAY', 'DUB'] as const

export function Looper({ def, module, value, onChange, routed }: FaceplateProps) {
  const reading = useMeter(module.id)
  const mode = Math.max(0, Math.min(3, Math.round(value('mode'))))
  const position = Math.max(0, Math.min(1, reading.loopPosition ?? 0))
  const seconds = reading.loopSeconds ?? 0
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!

  return (
    <>
      <header className="rk-title rk-looper-title">
        <span className="rk-name">Loop Station</span>
        <span className="rk-looper-model">LS—30</span>
        <span className="rk-ports">stereo · session</span>
      </header>

      <div className="rk-looper-body">
        <div className="rk-looper-screen" data-mode={mode}>
          <svg viewBox="0 0 300 54" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="27" x2="300" y2="27" />
            <polyline points={waveformPoints(reading.waveform)} />
            {seconds > 0 && <line className="rk-looper-head" x1={position * 300} y1="0" x2={position * 300} y2="54" />}
          </svg>
          <span className="rk-looper-state">{MODES[mode]}</span>
          <span className="rk-looper-time">{loopTime(seconds)}</span>
          <span className="rk-looper-limit">30s MAX</span>
        </div>

        <div className="rk-looper-transport" role="group" aria-label="Looper transport">
          {MODES.map((label, index) => (
            <button
              key={label}
              type="button"
              data-mode={index}
              aria-pressed={mode === index}
              onClick={() => onChange('mode', index)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="rk-looper-clear"
            onClick={() => onChange('clear', value('clear') >= 0.5 ? 0 : 1)}
          >
            CLEAR
          </button>
        </div>

        <div className="rk-looper-controls">
          <ParamControl
            def={param('feedback')}
            value={value('feedback')}
            onChange={(next) => onChange('feedback', next)}
            colour="var(--three)"
            routed={routed?.('feedback')}
          />
          <ParamControl
            def={param('dry')}
            value={value('dry')}
            onChange={(next) => onChange('dry', next)}
            routed={routed?.('dry')}
          />
          <ParamControl
            def={param('loop')}
            value={value('loop')}
            onChange={(next) => onChange('loop', next)}
            colour="var(--nine)"
            routed={routed?.('loop')}
          />
        </div>
      </div>
    </>
  )
}
