import { useCallback, useRef } from 'react'

// A knob, dragged vertically. Rotary controls that follow the mouse around a circle
// are fiddly and everybody hates them; every hardware editor settled on vertical drag
// and so has this. Shift slows it down for fine work.

interface Props {
  label: string
  value: number
  onChange: (value: number) => void
  /** Shown under the label while dragging — the real value, in real units. */
  format?: (value: number) => string
  colour?: string
}

const SWEEP = 270 // degrees of travel, leaving a gap at the bottom like a real knob

export function Knob({ label, value, onChange, format, colour = '#5ff0d0' }: Props) {
  const dragging = useRef<{ y: number; from: number } | null>(null)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      dragging.current = { y: event.clientY, from: value }
    },
    [value],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragging.current
      if (!drag) return
      const scale = event.shiftKey ? 0.0015 : 0.006
      const next = drag.from + (drag.y - event.clientY) * scale
      onChange(Math.max(0, Math.min(1, next)))
    },
    [onChange],
  )

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const angle = -SWEEP / 2 + value * SWEEP
  const radius = 15
  const circumference = 2 * Math.PI * radius
  const arc = (SWEEP / 360) * circumference

  return (
    <div className="knob">
      <div
        className="knob-dial"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onChange(0.5)}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(3))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.01 : 0.05
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(Math.min(1, value + step))
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(Math.max(0, value - step))
        }}
      >
        <svg viewBox="0 0 40 40">
          <circle
            cx="20"
            cy="20"
            r={radius}
            className="knob-track"
            strokeDasharray={`${arc} ${circumference}`}
            transform="rotate(135 20 20)"
          />
          <circle
            cx="20"
            cy="20"
            r={radius}
            className="knob-value"
            stroke={colour}
            strokeDasharray={`${arc * value} ${circumference}`}
            transform="rotate(135 20 20)"
          />
          <line
            x1="20"
            y1="20"
            x2="20"
            y2="8"
            className="knob-pointer"
            stroke={colour}
            transform={`rotate(${angle} 20 20)`}
          />
        </svg>
      </div>
      <span className="knob-label">{label}</span>
      {format && <span className="knob-readout">{format(value)}</span>}
    </div>
  )
}
