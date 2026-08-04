import { MODULES } from '@driftbox/rack'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRack } from './store.js'
import { automationLaneViews, automationPosition } from './automation-desk.js'
import './AutomationDesk.css'

interface Props {
  onClose: () => void
}

/** One place to inspect and edit every rack-native parameter lane. */
export function AutomationDesk({ onClose }: Props) {
  const patch = useRack((state) => state.patch)
  const clearLane = useRack((state) => state.clearAutomation)
  const clearAll = useRack((state) => state.clearAllAutomation)
  const updatePoint = useRack((state) => state.updateAutomationPoint)
  const addPoint = useRack((state) => state.addAutomationPoint)
  const movePoint = useRack((state) => state.moveAutomationPoint)
  const removePoint = useRack((state) => state.removeAutomationPoint)
  const setCurve = useRack((state) => state.setAutomationCurve)
  const [editing, setEditing] = useState<string | null>(null)
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
          Recorded rack knobs live here. Open a lane to place points, shape its curve, or remove them.
          Rack undo restores every change.
        </p>

        <div className="rk-auto-list">
          {lanes.length === 0 && (
            <p className="rk-auto-empty">No rack automation yet. Start audio, press ● Rec, play, and move a knob.</p>
          )}
          {lanes.map((lane) => {
            const open = editing === lane.key
            return (
              <Fragment key={lane.key}>
                <div className="rk-auto-row">
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
                    {lane.points.map((point) => (
                      <circle key={point.at} cx={point.x} cy={point.y} r="2.5" />
                    ))}
                  </svg>
                  <span className="rk-auto-meta">
                    {lane.pointCount} {lane.pointCount === 1 ? 'point' : 'points'}
                    <small>{lane.from} → {lane.to}</small>
                  </span>
                  <span className="rk-auto-actions">
                    <button
                      type="button"
                      className="rk-auto-edit"
                      onClick={() => setEditing(open ? null : lane.key)}
                      aria-expanded={open}
                      aria-controls={`rk-auto-editor-${lane.key}`}
                      aria-label={`${open ? 'Close' : 'Edit'} ${lane.paramName} automation on ${lane.moduleName} ${lane.moduleId}`}
                    >
                      {open ? 'done' : 'edit'}
                    </button>
                    <button
                      type="button"
                      className="rk-auto-clear"
                      onClick={() => clearLane(lane.moduleId, lane.paramId)}
                      aria-label={`Clear ${lane.paramName} automation on ${lane.moduleName} ${lane.moduleId}`}
                    >
                      clear
                    </button>
                  </span>
                </div>
                {open && (
                  <div className="rk-auto-editor" id={`rk-auto-editor-${lane.key}`}>
                    <div className="rk-auto-curve-choice">
                      <span>Curve</span>
                      <button
                        type="button"
                        aria-pressed={lane.curve === 'linear'}
                        disabled={lane.stepped}
                        onClick={() => setCurve(lane.moduleId, lane.paramId, 'linear')}
                      >
                        Linear
                      </button>
                      <button
                        type="button"
                        aria-pressed={lane.curve === 'hold'}
                        onClick={() => setCurve(lane.moduleId, lane.paramId, 'hold')}
                      >
                        Hold
                      </button>
                      {lane.stepped && <small>Stepped controls stay on hold.</small>}
                    </div>
                    <div className="rk-auto-points" aria-label={`${lane.paramName} automation points`}>
                      <div className="rk-auto-point-head" aria-hidden="true">
                        <span>Position</span>
                        <span>Value</span>
                      </div>
                      {lane.points.map((point) => (
                        <div className="rk-auto-point" key={`${point.at}:${point.value}`}>
                          <input
                            type="text"
                            inputMode="decimal"
                            defaultValue={point.position}
                            aria-label={`Position for ${lane.paramName} point at ${point.position}`}
                            onBlur={(event) => {
                              const position = automationPosition(event.currentTarget.value)
                              if (position === null) {
                                event.currentTarget.value = point.position
                              } else {
                                movePoint(lane.moduleId, lane.paramId, point.at, position)
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                          />
                          <input
                            type="number"
                            defaultValue={point.value}
                            min={lane.min}
                            max={lane.max}
                            step={lane.stepped ? 1 : 'any'}
                            aria-label={`Value at ${point.position} for ${lane.paramName}`}
                            onBlur={(event) => {
                              const value = event.currentTarget.valueAsNumber
                              if (Number.isFinite(value)) {
                                updatePoint(lane.moduleId, lane.paramId, point.at, value)
                              } else {
                                event.currentTarget.value = String(point.value)
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => removePoint(lane.moduleId, lane.paramId, point.at)}
                            aria-label={`Remove ${lane.paramName} point at ${point.position}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="rk-auto-add-point"
                        onClick={() => {
                          const last = lane.points[lane.points.length - 1]
                          if (last) addPoint(lane.moduleId, lane.paramId, last.at + 1, last.value)
                        }}
                      >
                        + Add point after {lane.to}
                      </button>
                    </div>
                  </div>
                )}
              </Fragment>
            )
          })}
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
