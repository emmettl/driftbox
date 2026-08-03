import { TRIM_MAX, TRIM_MIN, type PatchCable } from '@driftbox/rack'
import { useRef } from 'react'
import type { Jack } from './layout.js'
import { jackAt } from './layout.js'
import { useRack } from './store.js'

// A trim pot on every occupied inlet: how much of the cable arrives, and which way up.
//
// **Beside the unplug button and on the inlet**, for the reason `CableUnplugs` gives about itself — an
// outlet may fan out to several destinations, each wanting a different amount, while an inlet takes exactly
// one cable. So the inlet is the only place a trim has an unambiguous home, and it is also where the trim
// takes effect.
//
// **SVG rather than the shared `Knob`.** The back panel is one SVG in the layout's coordinate space, and
// dropping an HTML control into it means a `foreignObject`, which brings its own rendering and hit-testing
// problems for a control eleven pixels across. What is shared is the *idiom* rather than the component:
// vertical drag, shift for fine work, arrow keys, and `role="slider"` — the same gestures the faceplate
// knobs use, because a control that behaves differently from every other knob in the program is worse than
// one that looks slightly different.
//
// **Only drawn where a cable lands**, so an empty rack has no furniture on it. A patch with forty cables
// gets forty of these, which is why they are small and stay quiet until one is turned away from unity.

interface Props {
  all: Jack[]
  cables: PatchCable[]
}

/** Degrees of travel, matching the faceplate knobs. */
const SWEEP = 270
const RADIUS = 7

export function CableTrims({ all, cables }: Props) {
  const setTrim = useRack((s) => s.setTrim)
  const clearTrim = useRack((s) => s.clearTrim)
  const dragging = useRef<{ y: number; from: number } | null>(null)

  return cables.map((cable) => {
    const to = jackAt(all, cable.to[0], cable.to[1], 'in')
    if (!to) return null

    const key = `${cable.from.join('.')}>${cable.to.join('.')}`
    // Absent reads as unity, which is what it does. The control shows the same thing either way; the
    // difference is what it costs, and that is the graph's business rather than the picture's.
    const value = cable.trim ?? TRIM_MAX
    const engaged = cable.trim !== undefined && cable.trim !== TRIM_MAX
    const normalised = (value - TRIM_MIN) / (TRIM_MAX - TRIM_MIN)
    const angle = -SWEEP / 2 + normalised * SWEEP
    const label = `Trim on the cable from ${cable.from.join(' ')} into ${cable.to.join(' ')}`

    const move = (next: number) => setTrim(cable, Math.min(TRIM_MAX, Math.max(TRIM_MIN, next)))

    return (
      <g
        key={key}
        className={['rk-trim', engaged ? 'rk-trim-on' : ''].filter(Boolean).join(' ')}
        // Above the jack rather than beside it: the unplug button already has the space to the left, and
        // stacking them would put two controls under one fingertip.
        transform={`translate(${to.x - 18} ${to.y - 20})`}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={TRIM_MIN}
        aria-valuemax={TRIM_MAX}
        aria-valuenow={Number(value.toFixed(3))}
        onPointerDown={(event) => {
          // Stopped, or the back panel reads this as the start of a cable drag from the jack underneath.
          event.stopPropagation()
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = { y: event.clientY, from: value }
        }}
        onPointerMove={(event) => {
          const drag = dragging.current
          if (!drag) return
          event.stopPropagation()
          // Twice the faceplate knob's travel per pixel, because this range is two units wide rather than
          // one — so a trim and a knob move the same distance under the same drag.
          const scale = event.shiftKey ? 0.003 : 0.012
          move(drag.from + (drag.y - event.clientY) * scale)
        }}
        onPointerUp={(event) => {
          dragging.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          dragging.current = null
        }}
        // Back to no trim at all rather than to a trim of one: this is what frees the inlet buffer and the
        // param slot. Identical in sound, which is exactly why it has to be asked for.
        onDoubleClick={(event) => {
          event.stopPropagation()
          clearTrim(cable)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            // The back panel binds these to unplugging the cable at a jack. On the trim they mean the
            // smaller thing — take the trim off, keep the cable.
            event.preventDefault()
            event.stopPropagation()
            clearTrim(cable)
            return
          }
          const step = event.shiftKey ? 0.02 : 0.1
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault()
            move(value + step)
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault()
            move(value - step)
          }
        }}
      >
        <circle className="rk-trim-hit" r="12" />
        <circle className="rk-trim-body" r={RADIUS} />
        {/* The pointer, from the centre out. Straight up is unity; hard left is fully inverted, which is
            the half of the range a plain attenuator does not have. */}
        <line
          className="rk-trim-mark"
          x1="0"
          y1="0"
          x2="0"
          y2={-RADIUS}
          transform={`rotate(${angle})`}
        />
        <title>{`${label} — ${value.toFixed(2)}. Drag to turn, double-click to remove.`}</title>
      </g>
    )
  })
}
