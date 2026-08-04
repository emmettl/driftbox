import { MODULES } from '@driftbox/rack'
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useRack } from './store.js'
import {
  automationDrawPoint,
  automationLaneGeometry,
  automationLaneViews,
  automationPosition,
  type AutomationLaneView,
} from './automation-desk.js'
import './AutomationDesk.css'

const PENCIL_WIDTH = 720
const PENCIL_HEIGHT = 120
type AutomationTool = 'pencil' | 'eraser'

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
  const drawPoint = useRack((state) => state.drawAutomationPoint)
  const erasePoint = useRack((state) => state.eraseAutomationPoint)
  const beginGesture = useRack((state) => state.beginAutomationGesture)
  const movePoint = useRack((state) => state.moveAutomationPoint)
  const removePoint = useRack((state) => state.removeAutomationPoint)
  const setCurve = useRack((state) => state.setAutomationCurve)
  const [editing, setEditing] = useState<string | null>(null)
  const [tool, setTool] = useState<AutomationTool>('pencil')
  const pencilGesture = useRef(0)
  const pencilLast = useRef<{ lane: string; at: number; value: number } | null>(null)
  const pencilLane = useRef<AutomationLaneView | null>(null)
  const lanes = useMemo(() => automationLaneViews(patch, MODULES), [patch])
  const points = lanes.reduce((total, lane) => total + lane.pointCount, 0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const drawFromPointer = (
    lane: AutomationLaneView,
    event: ReactPointerEvent<SVGSVGElement>,
    gesture: number,
    activeTool: AutomationTool,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const point = automationDrawPoint(
      lane,
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    )
    const previous = pencilLast.current
    const distance = previous?.lane === lane.key ? Math.abs(point.at - previous.at) : 0
    if (activeTool === 'eraser') {
      if (previous?.lane === lane.key && distance > 0) {
        const direction = Math.sign(point.at - previous.at)
        for (let offset = 1; offset <= distance; offset++) {
          erasePoint(lane.moduleId, lane.paramId, previous.at + direction * offset, gesture)
        }
      } else {
        erasePoint(lane.moduleId, lane.paramId, point.at, gesture)
      }
    } else if (previous?.lane === lane.key && distance > 1) {
      const direction = Math.sign(point.at - previous.at)
      for (let offset = 1; offset <= distance; offset++) {
        const ratio = offset / distance
        drawPoint(
          lane.moduleId,
          lane.paramId,
          previous.at + direction * offset,
          previous.value + (point.value - previous.value) * ratio,
          gesture,
        )
      }
    } else {
      drawPoint(lane.moduleId, lane.paramId, point.at, point.value, gesture)
    }
    pencilLast.current = { lane: lane.key, ...point }
  }

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
            const pencil = open
              ? automationLaneGeometry(
                  lane.points,
                  lane.curve,
                  lane.end,
                  lane.low,
                  lane.high,
                  PENCIL_WIDTH,
                  PENCIL_HEIGHT,
                )
              : null
            const gridId = `rk-auto-grid-${lane.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
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
                    <div className="rk-auto-pencil-wrap">
                      <div className="rk-auto-tool-row">
                        <span className="rk-auto-tools" role="group" aria-label="Automation drawing tool">
                          <button
                            type="button"
                            aria-pressed={tool === 'pencil'}
                            onClick={() => setTool('pencil')}
                          >
                            Pencil
                          </button>
                          <button
                            type="button"
                            aria-pressed={tool === 'eraser'}
                            onClick={() => setTool('eraser')}
                          >
                            Eraser
                          </button>
                        </span>
                        <small>
                          {tool === 'pencil' ? 'Drag to draw' : 'Drag across points to remove'} · sixteenth-note snap
                        </small>
                      </div>
                      <svg
                        className={`rk-auto-pencil${tool === 'eraser' ? ' erasing' : ''}`}
                        viewBox={`0 0 ${PENCIL_WIDTH} ${PENCIL_HEIGHT}`}
                        role="img"
                        aria-label={`${tool === 'pencil' ? 'Draw' : 'Erase'} ${lane.paramName} automation`}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return
                          event.preventDefault()
                          pencilGesture.current = beginGesture()
                          pencilLast.current = null
                          pencilLane.current = lane
                          event.currentTarget.setPointerCapture(event.pointerId)
                          drawFromPointer(lane, event, pencilGesture.current, tool)
                        }}
                        onPointerMove={(event) => {
                          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                          drawFromPointer(pencilLane.current ?? lane, event, pencilGesture.current, tool)
                        }}
                        onPointerUp={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId)
                          }
                          pencilLast.current = null
                          pencilLane.current = null
                        }}
                        onPointerCancel={() => {
                          pencilLast.current = null
                          pencilLane.current = null
                        }}
                      >
                        <defs>
                          <pattern
                            id={gridId}
                            width={(PENCIL_WIDTH - 8) / lane.end}
                            height={PENCIL_HEIGHT}
                            patternUnits="userSpaceOnUse"
                          >
                            <path d={`M 0 0 V ${PENCIL_HEIGHT}`} />
                          </pattern>
                          <pattern
                            id={`${gridId}-bars`}
                            width={((PENCIL_WIDTH - 8) / lane.end) * 16}
                            height={PENCIL_HEIGHT}
                            patternUnits="userSpaceOnUse"
                          >
                            <path d={`M 0 0 V ${PENCIL_HEIGHT}`} />
                          </pattern>
                        </defs>
                        <rect className="rk-auto-pencil-bg" width={PENCIL_WIDTH} height={PENCIL_HEIGHT} />
                        <rect className="rk-auto-pencil-steps" x="4" width={PENCIL_WIDTH - 8} height={PENCIL_HEIGHT} fill={`url(#${gridId})`} />
                        <rect className="rk-auto-pencil-bars" x="4" width={PENCIL_WIDTH - 8} height={PENCIL_HEIGHT} fill={`url(#${gridId}-bars)`} />
                        <path className="rk-auto-pencil-path" d={pencil?.path} />
                        {pencil?.points.map((point) => (
                          <circle key={point.at} cx={point.x} cy={point.y} r="4" />
                        ))}
                      </svg>
                      <span className="rk-auto-pencil-range">
                        <small>{lane.high}</small>
                        <small>{lane.low}</small>
                      </span>
                    </div>
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
