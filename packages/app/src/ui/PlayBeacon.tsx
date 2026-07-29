import { useEffect, useRef } from 'react'

// Particles falling toward the play button, while nothing is playing.
//
// The app opens on a phone into full-screen visuals, and until you press play it is a
// picture — beautiful, and completely silent, with no indication that it is an instrument.
// The play button was a circle in a corner. This is the arrow pointing at it.
//
// It stops the moment something is playing. A permanent effect is decoration; one that
// exists only while there is something to say is an instruction.

interface Particle {
  /** Angle and distance from the button, in its own polar space. */
  angle: number
  radius: number
  speed: number
  size: number
  life: number
}

const COUNT = 60
/** Where they are born, as a multiple of the button's radius. Far enough that the stream
 *  reads as coming from the room rather than leaking out of the button. */
const SPAWN = 9
const BUTTON_RADIUS = 31

export function PlayBeacon({ active, target }: { active: boolean; target: React.RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])

  useEffect(() => {
    if (!active) return
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return

    const spawn = (): Particle => ({
      angle: Math.random() * Math.PI * 2,
      radius: BUTTON_RADIUS * (SPAWN * (0.55 + Math.random() * 0.45)),
      // Slower particles start further out, so the stream has depth rather than moving
      // as one ring.
      speed: 34 + Math.random() * 52,
      size: 0.7 + Math.random() * 1.9,
      life: 0,
    })

    particles.current = Array.from({ length: COUNT }, () => {
      const p = spawn()
      // Staggered on the first frame, or the whole field arrives at once and it pulses
      // like a heartbeat instead of streaming.
      p.radius = BUTTON_RADIUS + Math.random() * (BUTTON_RADIUS * SPAWN)
      return p
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

      // The button's real position, read each frame — it moves with the safe-area inset
      // and when the device rotates, and hardcoding it would strand the particles.
      const box = target.current?.getBoundingClientRect()
      if (!box) return
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2

      for (const p of particles.current) {
        p.radius -= p.speed * dt
        // A slow curl on the way in, so they spiral rather than falling straight — a
        // straight line to a target looks like a diagram.
        p.angle += dt * 0.55 * (1 - p.radius / (BUTTON_RADIUS * SPAWN))
        p.life += dt

        if (p.radius <= BUTTON_RADIUS * 0.9) Object.assign(p, spawn())

        const x = cx + Math.cos(p.angle) * p.radius
        const y = cy + Math.sin(p.angle) * p.radius

        // Brightest just before arrival, and faded right out at the spawn edge so
        // nothing pops into existence.
        const near = 1 - (p.radius - BUTTON_RADIUS) / (BUTTON_RADIUS * SPAWN)
        const alpha = Math.max(0, Math.min(1, near * near)) * 0.85

        context.beginPath()
        context.fillStyle = `rgba(95, 240, 208, ${alpha})`
        context.arc(x, y, p.size * (0.5 + near), 0, Math.PI * 2)
        context.fill()
      }
    }

    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      context.clearRect(0, 0, element.clientWidth, element.clientHeight)
    }
  }, [active, target])

  if (!active) return null
  return <canvas ref={canvas} className="play-beacon" aria-hidden />
}
