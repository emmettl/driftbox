import { useSyncExternalStore } from 'react'

// What a parameter is doing right now, when something other than the knob is driving it.
//
// **Derived here rather than reported from the audio thread, and that is the whole design.** The obvious
// build is to grow the meter channel — the worklet already sends readings at animation rate — and it would
// work. It is worse for three reasons: it grows the message ABI, which `docs/RACK.md` says to resist; it
// puts a few hundred floats a second on `postMessage` for something purely visual; and it can *disagree*
// with what is playing, because the reading would be a sample of the past while the schedule is the future.
//
// The host already has the lane and the playhead that produced the scheduled value. Reading the same lane
// at the same position is the same arithmetic that decided what the audio thread was told, so the knob and
// the sound cannot drift — they are the same number, computed twice.
//
// **One store per module, on the `meter.ts` pattern**, so only the modules that actually have automation
// re-render. Putting these in the document store would re-render the whole chassis at animation rate and,
// worse, park ephemeral values beside the ones that autosave.
//
// It is deliberately *not* a general "current value of everything" channel. The only driver a faceplate
// cannot already see is a lane: a Combinator routing moves the patch, a learned CC goes through `setParam`,
// and the MIDI module's note, gate and velocity are `hidden` and never drawn at all.

/** Live values by module id, then param id. Absent means nothing is driving anything on that module. */
const values = new Map<string, Record<string, number>>()
const listeners = new Map<string, Set<() => void>>()

function notify(moduleId: string): void {
  for (const listener of listeners.get(moduleId) ?? []) listener()
}

/**
 * Replace the whole picture with what is driven now.
 *
 * Whole-picture rather than per-param, because a module that has *stopped* being driven has to be told:
 * a knob left showing the last automated value after the transport stopped would read as a knob somebody
 * had moved, and saving then would bake it in.
 *
 * Compares before it notifies. This runs on every animation frame, and a subscriber woken sixty times a
 * second to be handed the number it already had is the difference between a rack that idles and one that
 * warms the room.
 */
export function publishLive(next: Map<string, Record<string, number>>): void {
  for (const [moduleId, params] of next) {
    const before = values.get(moduleId)
    if (before && same(before, params)) continue
    values.set(moduleId, params)
    notify(moduleId)
  }
  for (const moduleId of [...values.keys()]) {
    if (next.has(moduleId)) continue
    values.delete(moduleId)
    notify(moduleId)
  }
}

function same(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

/** Nothing is being driven. For a transport that stopped, and for a test that must not inherit a run. */
export function clearLive(): void {
  publishLive(new Map())
}

export function liveSnapshot(moduleId: string): Record<string, number> | undefined {
  return values.get(moduleId)
}

export function subscribeLive(moduleId: string, listener: () => void): () => void {
  const forModule = listeners.get(moduleId) ?? new Set<() => void>()
  forModule.add(listener)
  listeners.set(moduleId, forModule)
  return () => {
    forModule.delete(listener)
    if (forModule.size === 0) listeners.delete(moduleId)
  }
}

/**
 * What is driving this module's params right now, or undefined.
 *
 * `undefined` is the same object every time, which `useSyncExternalStore` requires — returning a fresh
 * `{}` for an undriven module would hand React a new snapshot on every call and re-render for ever. This
 * app has had that bug once already, in a store selector.
 */
export function useLive(moduleId: string): Record<string, number> | undefined {
  return useSyncExternalStore(
    (listener) => subscribeLive(moduleId, listener),
    () => liveSnapshot(moduleId),
    () => undefined,
  )
}
