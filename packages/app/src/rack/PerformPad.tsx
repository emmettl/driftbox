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
  /** The rack's Back/Front switch still means something while the rack itself is hidden. */
  flipped: boolean
}

interface Point {
  x: number
  y: number
}

export function PerformPad({ kaoss, flipped }: Props) {
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
      data-side={flipped ? 'back' : 'front'}
      role="application"
      aria-label={`Performance filter, ${flipped ? 'back' : 'front'} side. Drag across for cutoff, up for resonance.`}
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
      {/* There is no patch panel behind an insert that lives outside the rack graph. A switch that visibly
          does nothing is still broken, though, so the pad has a deliberately unserious back side instead:
          the little creature living behind it. Purely decorative and pointer-transparent, leaving the
          filter exactly as playable as it is on the front. */}
      {flipped && (
        <div className="rk-pad-mascot" aria-hidden="true">
          <svg viewBox="0 0 240 220">
            <g className="rk-pad-mascot-dancer">
              <path className="rk-pad-mascot-wire" d="M84 74 C54 45 45 23 65 13 C82 5 87 28 74 38" />
              <path className="rk-pad-mascot-wire" d="M156 74 C186 45 195 23 175 13 C158 5 153 28 166 38" />
              <path className="rk-pad-mascot-arm" d="M78 105 C47 94 38 73 23 77" />
              <path className="rk-pad-mascot-arm" d="M162 105 C193 94 202 73 217 77" />
              <path
                className="rk-pad-mascot-body"
                d="M120 53 C82 53 62 82 68 125 C72 158 91 176 120 176 C149 176 168 158 172 125 C178 82 158 53 120 53 Z"
              />
              <circle className="rk-pad-mascot-eye" cx="101" cy="105" r="8" />
              <circle className="rk-pad-mascot-eye" cx="139" cy="105" r="8" />
              <path className="rk-pad-mascot-mouth" d="M101 132 Q120 147 139 132" />
              <path className="rk-pad-mascot-leg" d="M102 170 Q91 195 73 198" />
              <path className="rk-pad-mascot-leg" d="M138 170 Q149 195 167 198" />
            </g>
          </svg>
          <strong>backstage creature</strong>
          <span>still filtering · now vibing</span>
        </div>
      )}
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
