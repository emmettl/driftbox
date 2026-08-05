import { useEffect, useRef, type RefObject } from 'react'
import './PlayBeacon.css'

// Particles falling toward a button that wants pressing.
//
// The app opens on a phone into full-screen visuals, and until you press play it is a
// picture — beautiful, and completely silent, with no indication that it is an instrument.
// The play button was a circle in a corner. This is the arrow pointing at it.
//
// It points at more than one button now, because the desktop has the same problem in a
// different shape: the console opens on a wall of grids and knobs, and the two things you
// want first — start it, and then go and look at it — are a 40px square in one corner and
// a pill six controls along. Each stream is tinted like the button it lands on, so two
// running at once read as two destinations rather than as weather.
//
// Every stream exists only while there is something to say — while the transport is
// stopped, or until you have found vibes once. A permanent effect is decoration; one that
// stops when you have learnt the thing is an instruction.

export interface BeaconTarget {
  /** Stable across renders. The particle field is rebuilt when this set changes. */
  key: string
  target: RefObject<HTMLElement | null>
  /** The stream's colour, so it matches the button it is pointing at. */
  tint: string
  count?: number
  /** Where particles are born, as a multiple of the button's radius. */
  spawn?: number
  /**
   * A cap on that distance in pixels, for a caller whose targets are not all one size.
   *
   * The multiple is right when every target is a button: it makes one stream suit a 62px play circle and
   * a 40px one without being told which. It stops being right the moment the same stream has to point at
   * a 40px button and at a 300px-wide card in a picker — five radii is 260px for one and 800px for the
   * other, and at 800px the particles are spread over the whole window and read as weather rather than as
   * an arrow. Whichever is nearer wins, so a caller with uniform targets never notices this exists.
   */
  reach?: number
}

interface Particle {
  /** Which target this one is falling into. */
  at: number
  /** Angle, and distance in multiples of that button's radius. Kept relative because the
   *  button is not measured until the first frame and can resize under us. */
  angle: number
  radius: number
  /** Pixels per second, converted against the measured radius each frame. */
  speed: number
  size: number
}

const COUNT = 60
/** Far enough out that the stream reads as coming from the room rather than leaking from
 *  the button. */
const SPAWN = 9

/** The circle that circumscribes the button. Measured rather than given, so one stream
 *  suits a 62px play circle and a 40px one without being told which. */
function radiusOf(box: DOMRect): number {
  return Math.hypot(box.width, box.height) / 2
}

/** How far out this target's particles are born, in multiples of its own radius. */
function reachOf(target: BeaconTarget | undefined, button: number): number {
  const radii = target?.spawn ?? SPAWN
  return target?.reach ? Math.min(radii, target.reach / button) : radii
}

export function PlayBeacon({ targets, className }: { targets: BeaconTarget[]; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Read inside the loop rather than closed over, so a tint or a count can change without
  // restarting the field.
  const live = useRef(targets)
  live.current = targets
  // Rebuilding on every render would restart the particles constantly; this restarts them
  // only when the set of buttons being pointed at actually changes.
  const signature = targets.map((t) => t.key).join('|')

  useEffect(() => {
    if (!signature) return
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return

    const spawn = (at: number): Particle => {
      const target = live.current[at]
      // Measured here as well as in the draw loop, because a pixel cap cannot be applied without knowing
      // how big the thing being pointed at is, and a particle is born before the loop has looked.
      const box = target?.target.current?.getBoundingClientRect()
      const reach = reachOf(target, box ? radiusOf(box) : 1)
      return {
        at,
        angle: Math.random() * Math.PI * 2,
        radius: reach * (0.55 + Math.random() * 0.45),
        // Slower particles start further out, so the stream has depth rather than moving
        // as one ring.
        speed: 34 + Math.random() * 52,
        size: 0.7 + Math.random() * 1.9,
      }
    }

    const particles: Particle[] = []
    live.current.forEach((t, at) => {
      for (let i = 0; i < (t.count ?? COUNT); i++) {
        const p = spawn(at)
        // Staggered on the first frame, or the whole field arrives at once and it pulses
        // like a heartbeat instead of streaming.
        p.radius = 1 + Math.random() * (t.spawn ?? SPAWN)
        particles.push(p)
      }
    })

    let frame = 0
    let last = performance.now()

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = element.clientWidth
      const height = element.clientHeight
      if (element.width !== width * ratio || element.height !== height * ratio) {
        element.width = width * ratio
        element.height = height * ratio
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      // The buttons' real positions, read each frame — they move with the safe-area inset,
      // when the device rotates, and when the transport bar rewraps. Hardcoding any of it
      // would strand the particles.
      const boxes = live.current.map((t) => t.target.current?.getBoundingClientRect() ?? null)
      // Both are viewport coordinates; the canvas is not always at the origin.
      const frameBox = element.getBoundingClientRect()

      for (const p of particles) {
        const t = live.current[p.at]
        const box = boxes[p.at]
        if (!t || !box) continue
        const button = radiusOf(box)
        const reach = reachOf(t, button)

        p.radius -= (p.speed / button) * dt
        // A slow curl on the way in, so they spiral rather than falling straight — a
        // straight line to a target looks like a diagram.
        p.angle += dt * 0.55 * (1 - p.radius / reach)

        if (p.radius <= 0.9) Object.assign(p, spawn(p.at))

        const cx = box.left + box.width / 2 - frameBox.left
        const cy = box.top + box.height / 2 - frameBox.top
        const x = cx + Math.cos(p.angle) * p.radius * button
        const y = cy + Math.sin(p.angle) * p.radius * button

        // Brightest just before arrival, and faded right out at the spawn edge so nothing
        // pops into existence.
        //
        // Clamped here rather than only on the alpha, and both halves of that mattered once the reach
        // could change under a particle already in flight — which is exactly what a pixel cap does when
        // the stream moves from a header button to a card three times the size. A particle outside the
        // new reach has a negative `near`: squared, that made the *most distant* particles the brightest,
        // and the radius it was drawn at went negative and threw out of the animation frame.
        const near = Math.max(0, Math.min(1, 1 - (p.radius - 1) / reach))

        context.beginPath()
        context.fillStyle = `rgba(${t.tint}, ${near * near * 0.85})`
        context.arc(x, y, p.size * (0.5 + near), 0, Math.PI * 2)
        context.fill()
      }
    }

    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      context.clearRect(0, 0, element.clientWidth, element.clientHeight)
    }
  }, [signature])

  if (!targets.length) return null
  return <canvas ref={canvas} className={`play-beacon${className ? ` ${className}` : ''}`} aria-hidden />
}
