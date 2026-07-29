import { useEffect, useState } from 'react'
import { useBox } from '../store'

/**
 * Where the playhead is, read from the engine each frame.
 *
 * Deliberately not counted in React. The sequencer schedules ahead of the audio clock,
 * so "which step was most recently scheduled" is always a little in the future — if
 * the UI highlighted that, the light would run ahead of the sound by up to the
 * lookahead window, which is very visible at slow tempos. Asking the transport where
 * it is now, on the audio clock, keeps the light on the beat you can hear.
 */
export function usePlayhead(): { bar: number; index: number } | null {
  const engine = useBox((s) => s.engine)
  const running = useBox((s) => s.running)
  const [position, setPosition] = useState<{ bar: number; index: number } | null>(null)

  useEffect(() => {
    if (!engine || !running) {
      setPosition(null)
      return
    }
    let frame = 0
    let lastIndex = -1
    let lastBar = -1
    const poll = () => {
      frame = requestAnimationFrame(poll)
      const next = engine.position
      // Only re-render when the step actually changes — sixteen renders a bar, not
      // sixty a second.
      if (next.index !== lastIndex || next.bar !== lastBar) {
        lastIndex = next.index
        lastBar = next.bar
        setPosition({ ...next })
      }
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [engine, running])

  return position
}
