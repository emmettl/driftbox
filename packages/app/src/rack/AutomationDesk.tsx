import { MODULES } from '@driftbox/rack'
import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRack } from './store.js'
import { automationLaneViews } from './automation-desk.js'
import './AutomationDesk.css'

interface Props {
  onClose: () => void
}

/** One place to see and remove every rack-native parameter lane. */
export function AutomationDesk({ onClose }: Props) {
  const patch = useRack((state) => state.patch)
  const clearLane = useRack((state) => state.clearAutomation)
  const clearAll = useRack((state) => state.clearAllAutomation)
  const lanes = useMemo(() => automationLaneViews(patch, MODULES), [patch])
  const points = lanes.reduce((total, lane) => total + lane.pointCount, 0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="rk-auto-layer" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="rk-auto-desk" role="dialog" aria-modal="true" aria-labelledby="rk-auto-title">
        <header>
          <div>
            <span>Rack timeline</span>
            <h2 id="rk-auto-title">Automation</h2>
          </div>
          <button type="button" className="rk-auto-close" onClick={onClose} aria-label="Close automation desk">
            ×
          </button>
        </header>

        <p className="rk-auto-intro">
          Recorded rack knobs live here. Clear one lane or the complete take; rack undo restores either.
        </p>

        <div className="rk-auto-list">
          {lanes.length === 0 && (
            <p className="rk-auto-empty">No rack automation yet. Start audio, press ● Rec, play, and move a knob.</p>
          )}
          {lanes.map((lane) => (
            <div className="rk-auto-row" key={lane.key}>
              <span className="rk-auto-name">
                <strong>{lane.moduleName} · {lane.moduleId}</strong>
                <small>{lane.paramName} · {lane.curve}</small>
              </span>
              <svg
                className="rk-auto-curve"
                viewBox="0 0 180 38"
                role="img"
                aria-label={`${lane.paramName} automation from ${lane.from} to ${lane.to}`}
              >
                <path d={lane.path} />
                {lane.points.map((point, index) => (
                  <circle key={index} cx={point.x} cy={point.y} r="2.5" />
                ))}
              </svg>
              <span className="rk-auto-meta">
                {lane.pointCount} {lane.pointCount === 1 ? 'point' : 'points'}
                <small>{lane.from} → {lane.to}</small>
              </span>
              <button
                type="button"
                className="rk-auto-clear"
                onClick={() => clearLane(lane.moduleId, lane.paramId)}
                aria-label={`Clear ${lane.paramName} automation on ${lane.moduleName} ${lane.moduleId}`}
              >
                clear
              </button>
            </div>
          ))}
        </div>

        <footer>
          <span>{lanes.length} {lanes.length === 1 ? 'lane' : 'lanes'} · {points} points</span>
          <button type="button" disabled={lanes.length === 0} onClick={clearAll}>
            Clear all automation
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
