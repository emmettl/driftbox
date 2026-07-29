import { useCallback, useEffect, useRef, useState } from 'react'
import { kaossReadout } from '@driftbox/engine'
import { useBox } from '../store'

// The visualiser, as a control surface.
//
// The whole screen is the pad. Not a small square in a corner with the visuals behind it
// — putting your hand on the picture and hearing the record duck is the entire idea, and
// a 200px widget would be a filter with a diagram next to it instead.
//
// Across is cutoff, up is resonance, as every Kaoss pad since the KP1. Momentary: it
// glides back to open when you let go.

interface Point {
  x: number
  y: number
}

export function KaossPad() {
  const engine = useBox((s) => s.engine)
  const init = useBox((s) => s.init)
  const [point, setPoint] = useState<Point | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  // The trail. Kept in a ref and drawn from an animation frame rather than in state,
  // because a pointer at 120Hz on a ProMotion screen would otherwise be 120 React
  // renders a second competing with the audio scheduler for the main thread.
  const trail = useRef<{ x: number; y: number; at: number }[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)

  const positionOf = useCallback((event: React.PointerEvent): Point => {
    const box = surface.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      // Flipped: up is more, which is what a hand expects and the opposite of how the
      // DOM counts.
      y: Math.max(0, Math.min(1, 1 - (event.clientY - box.top) / box.height)),
    }
  }, [])

  const move = useCallback(
    (event: React.PointerEvent) => {
      const next = positionOf(event)
      setPoint(next)
      trail.current.push({ ...next, at: performance.now() })
      engine?.kaoss.set(next.x, next.y)
    },
    [engine, positionOf],
  )

  // Drawing the trail. Separate from React entirely.
  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const element = canvas.current
      const context = element?.getContext('2d')
      if (!element || !context) return

      const { width, height } = element
      context.clearRect(0, 0, width, height)

      const now = performance.now()
      // Anything older than a second is gone; the trail is a sense of movement, not a
      // record of where you have been.
      trail.current = trail.current.filter((p) => now - p.at < 1000)

      for (const p of trail.current) {
        const age = (now - p.at) / 1000
        const radius = 6 + age * 44
        const alpha = (1 - age) * 0.32
        const gradient = context.createRadialGradient(
          p.x * width,
          (1 - p.y) * height,
          0,
          p.x * width,
          (1 - p.y) * height,
          radius,
        )
        gradient.addColorStop(0, `rgba(255, 176, 46, ${alpha})`)
        gradient.addColorStop(1, 'rgba(255, 176, 46, 0)')
        context.fillStyle = gradient
        context.beginPath()
        context.arc(p.x * width, (1 - p.y) * height, radius, 0, Math.PI * 2)
        context.fill()
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  // Match the canvas to its box, accounting for the screen's pixel ratio.
  useEffect(() => {
    const element = canvas.current
    const box = surface.current
    if (!element || !box) return
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      element.width = box.clientWidth * ratio
      element.height = box.clientHeight * ratio
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const readout = point ? kaossReadout(point.x, point.y) : null

  return (
    <div
      ref={surface}
      className={`kaoss${point ? ' held' : ''}`}
      // touch-action: none in CSS stops the browser claiming the gesture for a scroll or
      // a pinch. Without it iOS eats the drag entirely and the pad does nothing.
      onPointerDown={(event) => {
        // Audio contexts start suspended, and on iOS the ONLY way to start one is inside
        // a user gesture. Somebody who opens the visuals and puts a finger down should
        // get sound, not silence with a working filter on top of it.
        init()
        event.currentTarget.setPointerCapture(event.pointerId)
        move(event)
      }}
      onPointerMove={(event) => {
        if (point) move(event)
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        setPoint(null)
        engine?.kaoss.release()
      }}
      onPointerCancel={() => {
        // A cancelled pointer — a system gesture, a call arriving — must release the
        // filter. Leaving it shut is how you end up with a mix that is inexplicably
        // muffled and no finger anywhere near the screen.
        setPoint(null)
        engine?.kaoss.release()
      }}
    >
      <canvas ref={canvas} className="kaoss-trail" />

      {/* The crosshair, only while held. */}
      {point && (
        <>
          <div className="kaoss-axis kaoss-axis-x" style={{ top: `${(1 - point.y) * 100}%` }} />
          <div className="kaoss-axis kaoss-axis-y" style={{ left: `${point.x * 100}%` }} />
          <div
            className="kaoss-dot"
            style={{ left: `${point.x * 100}%`, top: `${(1 - point.y) * 100}%` }}
          />
        </>
      )}

      {readout && (
        <div className="kaoss-readout">
          {readout.mode === 'open'
            ? 'open'
            : `${readout.mode === 'low' ? 'lowpass' : 'highpass'} ${Math.round(readout.hz)}Hz · res ${Math.round((readout.q / 12) * 100)}`}
        </div>
      )}
    </div>
  )
}
