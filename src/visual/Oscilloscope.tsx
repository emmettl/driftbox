import { useEffect, useRef } from 'react'
import { useBox } from '../store'

// The oscilloscope. Two modes, both drawn straight from the analyser's time-domain
// data rather than from an FFT — this shows the waveform itself, so a kick reads as
// the shape it actually is: a steep transient and a long settling sine.
//
// It is genuinely diagnostic and not only decorative. A voice that clips shows up as a
// flattened top; a choke that clicks shows as a vertical step; a hat with too much
// resonance shows as a tail that will not sit down.

export type ScopeMode = 'wave' | 'xy'

interface Props {
  mode?: ScopeMode
  /** Drawn behind the trace, and used for the glow. */
  colour?: string
  height?: number
  /** Fade the previous frame instead of clearing, which leaves a phosphor trail. */
  persistence?: number
  /** Fade to transparent rather than to black, so the scene behind shows through.
   *  Used in performance mode, where an opaque band across the sun looks like a bug. */
  transparent?: boolean
  className?: string
}

export function Oscilloscope({
  mode = 'wave',
  colour = '#5ff0d0',
  height = 132,
  persistence = 0.28,
  transparent = false,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engine = useBox((s) => s.engine)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const analyser = engine?.analyser
    const samples = analyser ? new Uint8Array(analyser.fftSize) : new Uint8Array(1024)
    let frame = 0

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      if (w === 0 || h === 0) return

      // Phosphor persistence: fade the last frame rather than clearing it, so the
      // trace leaves a trail the way a CRT does. Over the scene we fade the alpha
      // channel instead of painting black, or the panel becomes an opaque band.
      if (transparent) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - persistence})`
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      } else {
        ctx.fillStyle = `rgba(6, 8, 16, ${1 - persistence})`
        ctx.fillRect(0, 0, w, h)
      }

      if (analyser) analyser.getByteTimeDomainData(samples)
      else samples.fill(128)

      ctx.lineWidth = 1.6
      ctx.strokeStyle = colour
      ctx.shadowBlur = 12
      ctx.shadowColor = colour
      ctx.beginPath()

      if (mode === 'wave') {
        // Trigger on the first upward zero crossing, so a periodic waveform stands
        // still instead of sliding across the screen every frame.
        let start = 0
        for (let i = 1; i < samples.length / 2; i++) {
          if (samples[i - 1] < 128 && samples[i] >= 128) {
            start = i
            break
          }
        }
        const count = Math.floor(samples.length / 2)
        for (let i = 0; i < count; i++) {
          const value = (samples[start + i] - 128) / 128
          const x = (i / (count - 1)) * w
          const y = h / 2 - value * (h / 2) * 0.92
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
      } else {
        // Vectorscope: plot the signal against a delayed copy of itself. A sine draws
        // an ellipse, noise fills the square, and a kick spirals inward as it decays.
        const lag = 24
        const size = Math.min(w, h) * 0.46
        const count = samples.length - lag
        for (let i = 0; i < count; i++) {
          const a = (samples[i] - 128) / 128
          const b = (samples[i + lag] - 128) / 128
          const x = w / 2 + a * size
          const y = h / 2 - b * size
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
      }

      ctx.stroke()
      ctx.shadowBlur = 0

      // Centre line, under the trace.
      ctx.strokeStyle = transparent ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()
    }

    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [engine, mode, colour, persistence, transparent])

  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height }} />
}
