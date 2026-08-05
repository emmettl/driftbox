import { useEffect, useRef, type RefObject } from 'react'
import { openingPatch, useRack, type Opening } from './store.js'

/**
 * Whatever we were opened with: a shared link, the last session, or the starter patch.
 *
 * The preset is kept so that pressing play can render the break it was written around. Only a *fresh*
 * arrival has one — a shared link or a saved session is somebody's work, and swapping it for a demo
 * because that makes a better first impression would be the worst thing this page could do.
 *
 * Returned as the ref rather than as state: the only later reader is the Start gesture, asking which break
 * this page arrived wanting, and nothing on screen changes when the answer arrives.
 */
export function useOpeningPatch(
  onIntendedBreak: (id: string) => void,
): RefObject<Opening | null> {
  const load = useRack((s) => s.load)
  const setName = useRack((s) => s.setName)
  const opening = useRef<Opening | null>(null)
  // Held in a ref rather than listed as a dependency. This effect must run exactly once — re-running it
  // would re-open the page over whatever somebody had since edited — and a caller passing an inline
  // callback should not be able to cause that.
  const intendedBreak = useRef(onIntendedBreak)
  intendedBreak.current = onIntendedBreak

  useEffect(() => {
    void openingPatch().then((result) => {
      opening.current = result
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

  return opening
}
