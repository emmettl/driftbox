// Where the finger is, for the 3D scenes.
//
// A plain mutable module object rather than store state, deliberately. The pad reports at
// pointer rate — 120Hz on a ProMotion screen — and the scenes read it inside `useFrame`.
// Routing that through React would mean a render per pointer move, competing with the
// audio scheduler for the main thread, to deliver a number that a render loop is about to
// read anyway. Nothing here needs reactivity: both ends run every frame regardless.

export const touch = {
  /** 0..1 across the screen, left to right. */
  x: 0.5,
  /** 0..1 up the screen, bottom to top. */
  y: 0.5,
  /** Whether a finger is currently down. */
  down: false,
  /**
   * How much the scene should be warped, 0..1.
   *
   * Not the same as `down`: it eases in and out so the geometry does not snap back the
   * instant a finger lifts. The scenes decay it themselves each frame.
   */
  energy: 0,
  /** Monotonic id for the press currently being reported. */
  gesture: 0,
  /** Monotonic id for the latest pointer-rate position sample. */
  serial: 0,
}

export interface TouchSample {
  x: number
  y: number
  gesture: number
  serial: number
}

// A scene normally needs only the latest position. An authored scene needs the path.
// Keeping a short pointer-rate history here means a 120Hz pencil stroke is not reduced
// to whatever positions a 60Hz render loop happened to observe, and a quick flick that
// begins and ends between two frames is not lost entirely.
const HISTORY = 512
const samples: TouchSample[] = []
const NO_SAMPLES: readonly TouchSample[] = []

export function setTouch(x: number, y: number): void {
  if (!touch.down) touch.gesture++
  touch.x = x
  touch.y = y
  touch.down = true
  touch.serial++
  samples.push({ x, y, gesture: touch.gesture, serial: touch.serial })
  if (samples.length > HISTORY) samples.splice(0, samples.length - HISTORY)
  ensureTicking()
}

export function endTouch(): void {
  touch.down = false
}

/**
 * Pointer positions newer than `serial`, oldest first.
 *
 * Consumers keep their own cursor: reading does not remove samples, because a second
 * authored layer should not be able to starve the first one by running earlier in a
 * frame. The history is bounded, so an inactive consumer catches up to at most the last
 * few seconds rather than retaining the whole performance.
 */
export function touchSamplesAfter(serial: number): readonly TouchSample[] {
  if (serial >= touch.serial) return NO_SAMPLES
  return samples.filter((sample) => sample.serial > serial)
}

/**
 * Advance `energy` on its own animation frame, rather than from the scenes.
 *
 * It has to own its clock. The first version eased it inside each scene's `useFrame`,
 * which is correct for a scene with one object and wrong for one with seven — Lifeforms
 * called it eight times a frame and the warp decayed eight times too fast. Whose job it
 * is to advance shared state should not depend on how many meshes happen to read it.
 *
 * Starts on the first touch and stops once it has settled, so an idle app is not holding
 * an animation frame open for nothing.
 */
let ticking = false
let last = 0

function tick(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  const target = touch.down ? 1 : 0
  const rate = touch.down ? 6 : 1.8
  touch.energy += (target - touch.energy) * Math.min(1, dt * rate)

  if (touch.down || touch.energy > 0.001) {
    requestAnimationFrame(tick)
  } else {
    touch.energy = 0
    ticking = false
  }
}

function ensureTicking(): void {
  if (ticking) return
  ticking = true
  last = performance.now()
  requestAnimationFrame(tick)
}
