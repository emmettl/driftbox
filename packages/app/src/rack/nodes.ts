import type { DriftboxEngine } from '@driftbox/engine'
import type { Rack } from '@driftbox/rack'
import { useMemo, useRef, type RefObject } from 'react'

/**
 * The two live audio objects the rack page owns, in one place.
 *
 * Refs rather than state, because nothing about them is drawn: a `Rack` is an AudioWorkletNode and a
 * `DriftboxEngine` is a scheduler, and re-rendering because one of them exists would be a render nobody
 * asked for. What the screen needs to know — that audio has started, that there is an analyser to draw —
 * is separate state, deliberately narrower than these.
 *
 * They are shared because the page's concerns genuinely overlap: a note played on the keyboard reaches
 * the hosted engine's 303s, a sample loaded from disk reaches the rack graph, and the transport moves
 * both. Passing this one memoised object down means each hook below can be a file rather than a section
 * of a two-thousand-line component, and none of them has to own an object another one also needs.
 */
export interface RackNodes {
  /** The rack graph, once `start()` has resolved. Null before the first gesture. */
  rack: RefObject<Rack | null>
  /** The retained song playing beside the rack graph, through the same final performance bus. */
  groovebox: RefObject<DriftboxEngine | null>
}

export function useRackNodes(): RackNodes {
  const rack = useRef<Rack | null>(null)
  const groovebox = useRef<DriftboxEngine | null>(null)
  // Memoised so that every hook taking this can list it as a dependency without re-running each render.
  return useMemo(() => ({ rack, groovebox }), [])
}
