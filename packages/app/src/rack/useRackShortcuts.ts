import { useEffect, useRef } from 'react'
import { historyIntent, isFlipKey, isHelpKey } from './shortcuts.js'

/** What the four page-level keys do. The rules for *when* they apply are in `shortcuts.ts`. */
export interface RackShortcuts {
  onHelp: () => void
  onFlip: () => void
  onUndo: () => void
  onRedo: () => void
}

/**
 * One `keydown` listener for the whole page.
 *
 * It was three, each with its own copy of "unless somebody is typing", which is the rule that matters and
 * therefore the rule worth having in exactly one place. A ref carries the current handlers so that
 * re-rendering — which happens on every knob move — does not detach and reattach a window listener.
 */
export function useRackShortcuts(handlers: RackShortcuts): void {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isHelpKey(event)) {
        event.preventDefault()
        latest.current.onHelp()
        return
      }
      // Tab flips the rack, the way it does in Reason.
      if (isFlipKey(event)) {
        event.preventDefault()
        latest.current.onFlip()
        return
      }
      const history = historyIntent(event)
      if (!history) return
      // Kept off inputs by `historyIntent`, so a rename or a tempo field keeps the browser's own undo,
      // which is a different history about a different thing and would be very confusing to hijack.
      event.preventDefault()
      if (history === 'undo') latest.current.onUndo()
      else latest.current.onRedo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
