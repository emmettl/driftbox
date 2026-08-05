import type { Lesson } from './useFirstRun.js'

// Which first-run beacons the console should be showing.
//
// Out of `App.tsx` because it was five conditions built up by pushing onto an array mid-render, and every
// one of them is a rule about not nagging somebody. A hint that keeps arriving after you have learnt the
// thing is not a hint, it is a fault — and the failure is silent in both directions: a beacon that never
// appears teaches nobody, and one that will not go away is the app talking over you.

/** The two things the console never said out loud: that it makes a sound, and that vibes mode exists. */
export type BeaconKey = 'play' | 'vibes'

export interface BeaconContext {
  /** Wide enough that particles land on a button rather than across the controls beside it. */
  roomy: boolean
  /** Whether this browser has asked for reduced motion. */
  stillness: boolean
  /** Whether performance mode is open, which has beacons of its own. */
  performing: boolean
  running: boolean
  learnt: ReadonlySet<Lesson>
}

/**
 * The beacons to draw, in the order they are drawn.
 *
 * The play beacon has one condition the vibes beacon does not: it goes away while the transport is
 * running, whether or not this browser has ever played anything. Pointing at a play button during
 * playback is pointing at the thing that just happened.
 */
export function consoleBeacons(context: BeaconContext): BeaconKey[] {
  // Not on a phone, not against somebody's motion preference, and not over the stage — which is a
  // different screen with its own single beacon on its own play button.
  if (!context.roomy || context.stillness || context.performing) return []
  const keys: BeaconKey[] = []
  if (!context.running && !context.learnt.has('played')) keys.push('play')
  if (!context.learnt.has('vibed')) keys.push('vibes')
  return keys
}
