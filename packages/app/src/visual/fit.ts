import type { PerspectiveCamera } from 'three'

/**
 * How far back to sit so a subject fills the frame.
 *
 * Every scene used to pick its distance with `portrait ? a : b`, which is two guesses
 * standing in for the thing that actually matters: a perspective camera's field of view is
 * VERTICAL, so the horizontal extent it can see is that times the aspect. Narrow the window
 * and width becomes the binding constraint; widen it and height does — and a distance
 * chosen for a 16:9 laptop leaves a third of a 1920×950 window empty above the subject,
 * because at that aspect there was never a width problem to back away from.
 *
 * Solving both constraints and taking the larger fits either way round, and keeps doing so
 * at aspects nobody tried.
 *
 * `halfWidth` and `halfHeight` are the subject's extent ON SCREEN in world units, not its
 * extent in space — a ring system seen almost edge on is as wide as its radius and a
 * fraction as tall, and using the radius for both would frame the empty sky above it.
 */
export function fitDistance(
  camera: PerspectiveCamera,
  halfWidth: number,
  halfHeight: number,
  /** How much of the frame the subject should take up. Under 1 leaves a margin. */
  fill = 0.9,
): number {
  const halfFov = Math.tan((camera.fov * Math.PI) / 360)
  const forHeight = halfHeight / halfFov
  const forWidth = halfWidth / (halfFov * camera.aspect)
  const want = Math.max(forHeight, forWidth) / fill

  // Never past the far plane. A tall phone — a real one is about 0.46 wide for its height,
  // rather than the 0.6 a desktop browser's phone preset gives you — makes the width term
  // enormous, and a wide subject can ask to be framed from further away than the canvas can
  // draw. The whole scene is then behind the far plane and the screen is simply black: no
  // error, no warning, nothing rendered at all.
  //
  // Cropping is the right failure. Being too close shows you part of something; being past
  // the far plane shows you nothing.
  const ceiling = camera.far - Math.max(halfWidth, halfHeight) * 1.6
  return Math.min(want, Math.max(1, ceiling))
}
