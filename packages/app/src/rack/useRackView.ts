import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { initialRackView, nextRackView, type RackView } from './view.js'

/**
 * Three views of one instrument, rather than a modal performance page.
 *
 * `split` is the useful middle ground: the rack moves aside but stays live while the performance pad
 * occupies the neighbouring bay. One state machine also makes the header button's Rack → Split → Pad
 * cycle explicit instead of coordinating two booleans that could describe an impossible view.
 *
 * It is also where a wide window starts, so that the pad is something you arrive at rather than something
 * you have to go looking for — `view.ts` holds that decision and the width it needs.
 */
export interface RackViewState {
  rackView: RackView
  /** True in split and pad alike: the pad is on screen and the header says so. */
  performing: boolean
  /**
   * Whether this view was arrived at or merely opened on.
   *
   * The split entrance keyframes describe a movement — the rack sliding left to make room, the pad
   * arriving beside it — and there is no such movement when split is where the page came up. Playing them
   * anyway would make the first paint look like something had just happened when nothing had.
   */
  viewCycled: boolean
  cycleRackView: () => void
  /** The scrollable split grid, whose offset survives a trip through full-pad mode. */
  performanceSpace: RefObject<HTMLDivElement | null>
}

/**
 * `onCycle` runs inside the same synchronous update as the view change — panels that make no sense in the
 * next view close in the same frame, so a view transition never snapshots a palette mid-flight.
 */
export function useRackView(onCycle: () => void): RackViewState {
  const [rackView, setRackView] = useState<RackView>(() =>
    initialRackView(typeof window === 'undefined' ? 0 : window.innerWidth),
  )
  const [viewCycled, setViewCycled] = useState(false)
  const performanceSpace = useRef<HTMLDivElement>(null)

  /**
   * Move between the three arrangements with one shared-element transition when the browser can do it.
   *
   * Split → Pad is the important case: the browser snapshots the *same* pad before and after the state
   * change, so its real 480px square grows into the full performance surface instead of one pad fading out
   * while another fades in. Pad → Rack has no shared surface, but the named old pad and new rack let CSS
   * choreograph a hand-off. Rack → Split keeps its existing lightweight CSS entrance.
   */
  const cycleRackView = useCallback(() => {
    const next = nextRackView(rackView)
    const update = () => {
      setRackView(next)
      setViewCycled(true)
      onCycle()
    }

    if (
      rackView === 'rack' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      !document.startViewTransition
    ) {
      update()
      return
    }

    const motion = `${rackView}-${next}`
    const root = document.documentElement
    root.dataset.rackViewTransition = motion
    const transition = document.startViewTransition(() => flushSync(update))
    void transition.finished
      .finally(() => {
        if (root.dataset.rackViewTransition === motion) delete root.dataset.rackViewTransition
      })
      .catch(() => {})
  }, [onCycle, rackView])

  /* The split grid is horizontally scrollable on narrow screens. Its DOM node survives all three views,
     so a trip through full-pad mode otherwise remembers the pad-side scroll offset and reopens split with
     the rack entirely off-screen. A layout effect restores the rack bay before the new frame is painted. */
  useLayoutEffect(() => {
    if (rackView === 'split' && performanceSpace.current) performanceSpace.current.scrollLeft = 0
  }, [rackView])

  return {
    rackView,
    performing: rackView !== 'rack',
    viewCycled,
    cycleRackView,
    performanceSpace,
  }
}
