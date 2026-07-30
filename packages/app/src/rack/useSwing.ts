import { useEffect, useRef, useState } from 'react'
import { SWING_MS } from './cable.js'

// The clock behind the cable swing: how long ago the rack was spun, and which way.
//
// Split out of `BackPanel` because it is the only stateful part of the effect and it has one job worth
// stating on its own — to run animation frames while a swing is in flight and NOT otherwise. A back
// panel with thirty cables re-renders its whole SVG on every frame of the swing, which is fine for a
// second and a half and would be indefensible as a permanent rAF loop.
//
// The angle itself is not computed here. It is per-cable, because each cable's period comes from its
// own length — see `swingAngle`. All this provides is the elapsed time every cable reads off.

export interface SwingState {
  /** Milliseconds since the rack was spun, or null when everything is at rest. */
  elapsed: number | null
  /** Which way it turned: +1 or −1. */
  direction: number
}

const AT_REST: SwingState = { elapsed: null, direction: 1 }

/**
 * Track the swing following each change of `flipped`.
 *
 * Keyed on the flip rather than started by an event, so it fires however the rack was turned — the
 * button, the Tab key, or a patch load that happens to arrive on the other side.
 *
 * Honours `prefers-reduced-motion`, which is not box-ticking here: this is a decorative loop of
 * moving objects across the whole panel, and it is exactly what that preference is for. Reduced
 * motion gets the resting cables, which is what the panel looked like before any of this.
 */
export function useSwing(flipped: boolean): SwingState {
  const [state, setState] = useState<SwingState>(AT_REST)
  /** The first render is a mount, not a flip. Without this the cables swing on page load. */
  const previous = useRef(flipped)

  useEffect(() => {
    if (previous.current === flipped) return
    const direction = flipped ? 1 : -1
    previous.current = flipped

    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    const start = performance.now()
    let frame = requestAnimationFrame(function step(now: number) {
      const elapsed = now - start
      if (elapsed >= SWING_MS) {
        // Snapped to rest rather than left at whatever the last frame happened to be, so the cables
        // finish hanging straight down every time instead of a hair off it.
        setState(AT_REST)
        return
      }
      setState({ elapsed, direction })
      frame = requestAnimationFrame(step)
    })
    return () => {
      cancelAnimationFrame(frame)
      // A flip during a swing restarts it, and the abandoned one must not leave the cables leaning.
      setState(AT_REST)
    }
  }, [flipped])

  return state
}
