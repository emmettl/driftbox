import { useEffect, useRef, useState } from 'react'
import { renderVoiceOffline, type Voice, type VoiceParams } from '../engine'

// The shape of the sound you are currently dialling in, drawn from the real thing.
//
// The voice is rendered through an OfflineAudioContext — the same synthesis code the
// live engine runs, on a throwaway context that renders faster than real time — and
// the samples that come out are drawn directly. So this is not an illustration of what
// the kick ought to look like; it is the kick. Lengthen the decay and the tail here
// gets longer, because it is the same signal.

interface Props {
  voice: Voice
  params: VoiceParams
  colour?: string
  height?: number
}

export function VoiceWaveform({ voice, params, colour = '#ff7ad9', height = 66 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [samples, setSamples] = useState<Float32Array | null>(null)

  useEffect(() => {
    let cancelled = false
    // Debounced: dragging a knob fires this on every pointer move, and each render
    // spins up a context. A frame or two of lag is invisible and costs nothing.
    const timer = setTimeout(() => {
      renderVoiceOffline(voice, params, 1, 22050)
        .then((data) => {
          if (!cancelled) setSamples(data)
        })
        .catch(() => {
          /* No OfflineAudioContext (or a hostile browser) — the panel just stays blank. */
        })
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [voice, params])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Redraw on resize, not only when the samples change. The first paint happens
    // before the flex layout has given this canvas a width, so measuring once sizes
    // the backing store to a single pixel and nothing is ever visible again.
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint(ctx, rect.width, rect.height, samples, colour)
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [samples, colour])

  return <canvas ref={canvasRef} className="voice-wave" style={{ width: '100%', height }} />
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  samples: Float32Array | null,
  colour: string,
): void {
  ctx.clearRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()

  if (!samples || samples.length === 0) return

  // Min/max per column rather than point sampling: a drum hit is mostly transient, and
  // naive decimation walks straight past the peak that defines it.
  const columns = Math.floor(w)
  const perColumn = samples.length / columns
  ctx.fillStyle = colour
  for (let c = 0; c < columns; c++) {
    const from = Math.floor(c * perColumn)
    const to = Math.min(samples.length, Math.floor((c + 1) * perColumn))
    let min = 0
    let max = 0
    for (let i = from; i < to; i++) {
      if (samples[i] < min) min = samples[i]
      if (samples[i] > max) max = samples[i]
    }
    const top = h / 2 - max * (h / 2) * 0.94
    const bottom = h / 2 - min * (h / 2) * 0.94
    ctx.fillRect(c, top, 1, Math.max(1, bottom - top))
  }
}
