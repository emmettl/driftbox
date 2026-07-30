import { kaossReadout, type Kaoss } from '@driftbox/engine'
import { useCallback, useEffect, useRef, useState } from 'react'

// The Kaoss pad, across the rack's master.
//
// An **insert after the rack's output**, not a module, and `kaoss.ts` in the engine already argues why: the
// fun of a Kaoss pad is that the whole record ducks away and comes back, drums included. Wired to one
// module's cutoff it would be a filter with a diagram next to it. It also means it costs nothing on the
// audio thread — two BiquadFilterNodes outside the worklet, which is where a filter across a whole mix
// belongs anyway.
//
// The `Kaoss` class itself is the engine's, unchanged. What is not reusable is `ui/KaossPad.tsx`, which is
// welded to the sequencer's store, its scene list and its visualiser — so this is a second surface over the
// same audio, rather than a shared component pretending two pages are one.
//
// Across is cutoff, up is resonance, as every one of these since the KP1: the only layout anybody's hands
// already know. Momentary, so it glides back to open when you let go — `release` explains why latching is a
// trap.

interface Props {
  /** Absent until audio has started, because there is no filter to move yet. */
  kaoss: Kaoss | null
}

interface Point {
  x: number
  y: number
}

export function PerformPad({ kaoss }: Props) {
  const surface = useRef<HTMLDivElement>(null)
  const [point, setPoint] = useState<Point | null>(null)

  /** Where the pointer is, 0..1 from the BOTTOM left — which is the orientation the readout assumes. */
  const positionOf = useCallback((event: React.PointerEvent): Point => {
    const box = surface.current?.getBoundingClientRect()
    if (!box) return { x: 0.5, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      // Inverted: up is more resonance, and screen y grows downward.
      y: Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height)),
    }
  }, [])

  const move = useCallback(
    (at: Point) => {
      setPoint(at)
      kaoss?.set(at.x, at.y)
    },
    [kaoss],
  )

  const lift = useCallback(() => {
    setPoint(null)
    kaoss?.release()
  }, [kaoss])

  // A pointer that goes away without a pointerup — the tab hidden, the window blurred — would otherwise
  // leave the filter half-shut with nothing holding it there, which is exactly the stuck-filter failure the
  // momentary design exists to avoid.
  useEffect(() => {
    window.addEventListener('blur', lift)
    return () => {
      window.removeEventListener('blur', lift)
      lift()
    }
  }, [lift])

  const readout = point ? kaossReadout(point.x, point.y) : null

  return (
    <div
      ref={surface}
      className="rk-pad"
      data-held={point ? 'yes' : 'no'}
      role="application"
      aria-label="Performance filter. Drag across for cutoff, up for resonance."
      onPointerDown={(event) => {
        event.preventDefault()
        surface.current?.setPointerCapture(event.pointerId)
        move(positionOf(event))
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0) return
        move(positionOf(event))
      }}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      {/* Drawn from the point rather than from the filter, so the dot is under the finger even while the
          filter is still gliding towards it. */}
      {point && (
        <span
          className="rk-pad-dot"
          style={{ left: `${point.x * 100}%`, top: `${(1 - point.y) * 100}%` }}
        />
      )}
      <span className="rk-pad-axis rk-pad-axis-x">cutoff</span>
      <span className="rk-pad-axis rk-pad-axis-y">resonance</span>
      <span className="rk-pad-readout">
        {readout === null
          ? kaoss
            ? 'open'
            : 'start audio to play the filter'
          : readout.mode === 'open'
            ? 'open'
            : `${readout.mode === 'low' ? 'LP' : 'HP'} ${Math.round(readout.hz)}Hz · Q ${readout.q.toFixed(1)}`}
      </span>
    </div>
  )
}
