import { useEffect } from 'react'
import { patternForClip, type ClipSlot } from '@driftbox/engine'
import { useBox } from '../store'

/**
 * Keep the grid on whatever section is playing.
 *
 * The editor used to open on whichever pattern was edited last, which for a first visit
 * means pattern one — so opening it during the fourth section of a song showed a grid with
 * no relationship to the sound coming out. Following the playhead means the grid is always
 * the thing you can hear, and every step lighting up is a step you can see.
 *
 * Its own animation frame rather than `usePlayhead`, and this matters: that hook re-renders
 * its owner on every STEP, sixteen times a bar. This only writes when the section changes,
 * which is a handful of times a song, so the cost is one `requestAnimationFrame` and no
 * renders in between.
 *
 * Touching a pattern turns following off — otherwise choosing something to edit would be
 * undone by the next bar, which is worse than not following at all. Changing song turns it
 * back on, since at that point nothing is being edited any more.
 */
export function useFollowPlayhead(): void {
  const engine = useBox((s) => s.engine)
  const running = useBox((s) => s.running)

  useEffect(() => {
    if (!engine || !running) return
    let frame = 0
    let lastTarget = ''
    const poll = () => {
      frame = requestAnimationFrame(poll)
      const { bar } = engine.position
      const { song, followPlayhead, editing, view, selectedBass } = useBox.getState()
      if (!followPlayhead) return
      const slot: ClipSlot = view === 'bass' ? (selectedBass as ClipSlot) : view
      // The sounding pattern can change because the bar moved OR because the editor
      // switched from (say) the 808 clip to the 909 clip inside the same section.
      const target = `${bar}:${slot}`
      const pattern = patternForClip(song, bar, slot)
      if (target === lastTarget && pattern?.id === editing) return
      lastTarget = target
      if (pattern && pattern.id !== editing) useBox.setState({ editing: pattern.id })
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [engine, running])
}
