import { useEffect, useRef } from 'react'
import { openingPatch, useRack } from './store.js'

/**
 * Adopt whatever we were opened with: a shared link, the last session, or the starter patch.
 *
 * Only a *fresh* arrival carries a preset identity — a shared link or a saved session is somebody's work,
 * and swapping it for a demo because that makes a better first impression would be the worst thing this
 * page could do.
 *
 * It returns nothing, and that is the point. It used to hand back a ref so the Start gesture could ask
 * which break the page *arrived* wanting; Start now renders the break the current document names, because
 * the two are the same value for the patch that opened and the opening one belongs to somebody else's
 * document the instant a different one is loaded.
 */
export function useOpeningPatch(onIntendedBreak: (id: string) => void): void {
  const load = useRack((s) => s.load)
  const setName = useRack((s) => s.setName)
  // Held in a ref rather than listed as a dependency. This effect must run exactly once — re-running it
  // would re-open the page over whatever somebody had since edited — and a caller passing an inline
  // callback should not be able to cause that.
  const intendedBreak = useRef(onIntendedBreak)
  intendedBreak.current = onIntendedBreak

  useEffect(() => {
    void openingPatch().then((result) => {
      load(result.patch)
      // A shipped patch is a named piece of work, not an anonymous graph. This matters most in Perform
      // mode, where the rack is hidden: before this, the hero demo's only visible identity became the
      // sample it happened to load, which made a complete song read like a break preset.
      if (result.preset) setName(result.preset.name)
      // Recorded before anything is played, so an export straight off the page still has its drums.
      const wanted = result.patch.break ?? result.preset?.needsBreak
      if (wanted) intendedBreak.current(wanted)
    })
  }, [load, setName])
}
