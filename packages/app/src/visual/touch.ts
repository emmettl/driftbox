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
}

export function setTouch(x: number, y: number): void {
  touch.x = x
  touch.y = y
  touch.down = true
  ensureTicking()
}

export function endTouch(): void {
  touch.down = false
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
