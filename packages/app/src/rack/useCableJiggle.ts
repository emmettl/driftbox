import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point } from './cable.js'

// A small damped spring for the patch leads attached to a module being moved.
//
// The cable endpoints already follow their jacks. This supplies the bit the eye expects in the middle:
// the slack lags behind a movement, crosses back through rest, and settles. It runs only while there is
// energy in the spring, following the same rule as the flip swing rather than leaving a permanent rAF loop.

const SPRING = 34
const DAMPING = 6.5
const MAX_ANGLE = 0.75
const MAX_SPEED = 5

/** Turn pointer displacement into angular velocity. The minus sign makes the cable lag the hand. */
export function jiggleImpulse(from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return 0
  // Horizontal movement sets the side of the swing. A purely vertical move still needs some life,
  // while a diagonal must not accidentally cancel itself into a rigid lead.
  const direction = Math.sign(dx || dy)
  const movement = dx + direction * Math.abs(dy) * 0.35
  return -movement * 0.08
}

export function useCableJiggle(): {
  angle: number
  kick: (from: Point, to: Point) => void
  reset: () => void
} {
  const [value, setValue] = useState(0)
  const angle = useRef(0)
  const velocity = useRef(0)
  const frame = useRef<number | null>(null)
  const previousTime = useRef(0)

  const reset = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    previousTime.current = 0
    angle.current = 0
    velocity.current = 0
    setValue(0)
  }, [])

  const step = useCallback(function animate(now: number) {
    const elapsed = previousTime.current === 0 ? 0 : (now - previousTime.current) / 1000
    const dt = Math.min(elapsed, 0.04)
    previousTime.current = now

    velocity.current += -SPRING * angle.current * dt
    velocity.current *= Math.exp(-DAMPING * dt)
    angle.current = Math.max(
      -MAX_ANGLE,
      Math.min(MAX_ANGLE, angle.current + velocity.current * dt),
    )

    if (Math.abs(angle.current) < 0.002 && Math.abs(velocity.current) < 0.015) {
      angle.current = 0
      velocity.current = 0
      frame.current = null
      setValue(0)
      return
    }

    setValue(angle.current)
    frame.current = requestAnimationFrame(animate)
  }, [])

  const kick = useCallback(
    (from: Point, to: Point) => {
      if (
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return
      }
      velocity.current = Math.max(
        -MAX_SPEED,
        Math.min(MAX_SPEED, velocity.current + jiggleImpulse(from, to)),
      )
      if (frame.current !== null) return
      previousTime.current = performance.now()
      frame.current = requestAnimationFrame(step)
    },
    [step],
  )

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return { angle: value, kick, reset }
}
