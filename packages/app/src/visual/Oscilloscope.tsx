import { useEffect, useRef } from 'react'
import { dbPosition, decibelBands, measureLevel, smoothMeter, spectrumBands } from './meter.js'
import type { ScopeMode } from './scope'

// One canvas, several different instruments.
//
// Wave is the diagnostic oscilloscope, bars and waterfall read the frequency domain, X/Y is a
// delayed-mono phase portrait, stereo is a real left-against-right goniometer, and VU measures
// RMS energy with peak hold. Keeping them together means the editor and performance stage agree
// on what every mode means and share the same resize, persistence and no-audio behaviour.

interface Props {
  /**
   * The mix to inspect.
   *
   * Passed in rather than pulled from the sequencer's store so the rack can use the same component.
   * Stereo and VU make a non-audible branch from this node through a channel splitter while mounted;
   * the original analyser-to-speakers path is left untouched.
   */
  analyser: AnalyserNode | null | undefined
  mode?: ScopeMode
  /** Drawn behind traces and used for their glow. */
  colour?: string
  height?: number
  /** Fade the previous trace frame instead of clearing, like phosphor. */
  persistence?: number
  /** Fade to transparent rather than black so a scene remains visible underneath. */
  transparent?: boolean
  className?: string
}

export function Oscilloscope({
  analyser,
  mode = 'wave',
  colour = '#5ff0d0',
  height = 132,
  persistence = 0.28,
  transparent = false,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const samples = analyser ? new Uint8Array(analyser.fftSize) : new Uint8Array(1024)
    const spectrum = new Uint8Array(analyser ? analyser.frequencyBinCount : 1024)
    const spectrumDb = new Float32Array(spectrum.length)
    const barValues = new Float32Array(30)
    const waterfall = new Float32Array(72)
    const waterfallScale = new Float32Array(waterfall.length)
    const stereoLeft = new Float32Array(analyser ? analyser.fftSize : 1024)
    const stereoRight = new Float32Array(stereoLeft.length)
    // Ping-pong rather than drawing the visible canvas onto itself. Self-copy plus transparency is
    // surprisingly easy to turn into repeated source-over compositing, which makes a quiet history
    // converge to an opaque block as it scrolls.
    let waterfallRead = document.createElement('canvas')
    let waterfallWrite = document.createElement('canvas')
    let waterfallReadCtx = waterfallRead.getContext('2d')
    let waterfallWriteCtx = waterfallWrite.getContext('2d')

    // A normal AnalyserNode presents a useful view of the mix but not two separately readable channels.
    // Split only for the modes that ask for stereo, and disconnect this branch without disturbing the
    // analyser's existing connection to the destination.
    let splitter: ChannelSplitterNode | null = null
    let leftAnalyser: AnalyserNode | null = null
    let rightAnalyser: AnalyserNode | null = null
    if (analyser && (mode === 'stereo' || mode === 'vu')) {
      try {
        splitter = analyser.context.createChannelSplitter(2)
        leftAnalyser = analyser.context.createAnalyser()
        rightAnalyser = analyser.context.createAnalyser()
        leftAnalyser.fftSize = analyser.fftSize
        rightAnalyser.fftSize = analyser.fftSize
        analyser.connect(splitter)
        splitter.connect(leftAnalyser, 0)
        splitter.connect(rightAnalyser, 1)
      } catch {
        // A mono fallback still draws a truthful diagonal/paired meter. Old Web Audio implementations
        // should lose stereo detail rather than lose the entire display.
        if (splitter) {
          try {
            analyser.disconnect(splitter)
          } catch {
            // The failed connection may not have reached the graph.
          }
          splitter.disconnect()
        }
        splitter = null
        leftAnalyser = null
        rightAnalyser = null
      }
    }

    const readStereo = () => {
      if (leftAnalyser && rightAnalyser) {
        leftAnalyser.getFloatTimeDomainData(stereoLeft)
        rightAnalyser.getFloatTimeDomainData(stereoRight)
      } else if (analyser) {
        analyser.getFloatTimeDomainData(stereoLeft)
        stereoRight.set(stereoLeft)
      } else {
        stereoLeft.fill(0)
        stereoRight.fill(0)
      }
    }

    let frame = 0
    let dpr = 1
    let lastFrame = performance.now()
    let vuLeft = 0
    let vuRight = 0
    let heldLeft = 0
    let heldRight = 0
    let holdLeftUntil = 0
    let holdRightUntil = 0

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      waterfallRead.width = canvas.width
      waterfallRead.height = canvas.height
      waterfallWrite.width = canvas.width
      waterfallWrite.height = canvas.height
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!transparent) {
        ctx.fillStyle = '#060810'
        ctx.fillRect(0, 0, rect.width, rect.height)
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const clearFrame = (w: number, h: number) => {
      if (transparent) {
        ctx.clearRect(0, 0, w, h)
      } else {
        ctx.fillStyle = '#060810'
        ctx.fillRect(0, 0, w, h)
      }
    }

    const fadeFrame = (w: number, h: number) => {
      if (transparent) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - persistence})`
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      } else {
        ctx.fillStyle = `rgba(6, 8, 16, ${1 - persistence})`
        ctx.fillRect(0, 0, w, h)
      }
    }

    const drawWaterfall = (w: number, h: number) => {
      if (!waterfallReadCtx || !waterfallWriteCtx) {
        clearFrame(w, h)
        return
      }
      if (analyser) analyser.getFloatFrequencyData(spectrumDb)
      else spectrumDb.fill(-Infinity)
      decibelBands(spectrumDb, waterfall)

      // Shift in device pixels so one history column remains crisp on a high-density screen.
      const shift = Math.max(1, Math.round(dpr * 2))
      waterfallWriteCtx.clearRect(0, 0, waterfallWrite.width, waterfallWrite.height)
      if (waterfallRead.width > shift) {
        waterfallWriteCtx.drawImage(
          waterfallRead,
          shift,
          0,
          waterfallRead.width - shift,
          waterfallRead.height,
          0,
          0,
          waterfallWrite.width - shift,
          waterfallWrite.height,
        )
      }

      const bandHeight = waterfallWrite.height / waterfall.length
      // Robust per-column contrast. The 10th and 95th percentiles ignore one empty/high bin without
      // allocating a sorted array sixty times a second.
      waterfallScale.set(waterfall)
      waterfallScale.sort()
      const quiet = waterfallScale[Math.floor(waterfallScale.length * 0.1)]
      const loud = waterfallScale[Math.floor(waterfallScale.length * 0.95)]
      const spread = loud - quiet
      for (let band = 0; band < waterfall.length; band++) {
        const energy = waterfall[band]
        // A mastered drum mix has broadband energy everywhere. Contrast each column against its quiet
        // and loud percentiles so a hat, kick and resonant 303 line remain distinct instead of becoming
        // one turquoise wall.
        // The float decibel reading still matters: `energy` sets where the local contrast window sits.
        const intensity =
          spread < 0.01 ? 0 : Math.max(0, Math.min(1, (energy - quiet) / spread))
        if (intensity <= 0.03) continue
        waterfallWriteCtx.globalAlpha = Math.min(0.94, intensity ** 3.4 * (0.15 + loud * 0.8))
        waterfallWriteCtx.fillStyle =
          intensity > 0.82 ? '#fff0b0' : intensity > 0.58 ? '#ff8fcf' : colour
        // Bass at the foot, hats at the top: the same orientation as a conventional spectrogram.
        const y = waterfallWrite.height - (band + 1) * bandHeight
        waterfallWriteCtx.fillRect(
          waterfallWrite.width - shift,
          y,
          shift,
          bandHeight + Math.max(1, dpr),
        )
      }
      waterfallWriteCtx.globalAlpha = 1

      const previousCanvas = waterfallRead
      waterfallRead = waterfallWrite
      waterfallWrite = previousCanvas
      const previousContext = waterfallReadCtx
      waterfallReadCtx = waterfallWriteCtx
      waterfallWriteCtx = previousContext

      clearFrame(w, h)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(waterfallRead, 0, 0)
      ctx.restore()
    }

    const drawVuBar = (
      label: string,
      y: number,
      h: number,
      value: number,
      peak: number,
      w: number,
    ) => {
      const x = 25
      const width = Math.max(1, w - x - 9)
      const levelAt = dbPosition(value)
      const peakAt = dbPosition(peak)

      ctx.fillStyle = transparent ? 'rgba(3, 6, 12, 0.48)' : 'rgba(255,255,255,0.035)'
      ctx.fillRect(x, y, width, h)

      const fillSection = (from: number, to: number, fill: string) => {
        const end = Math.min(levelAt, to)
        if (end <= from) return
        ctx.fillStyle = fill
        ctx.fillRect(x + from * width, y + 2, (end - from) * width, Math.max(1, h - 4))
      }
      fillSection(0, 0.8, colour)
      fillSection(0.8, 0.94, '#ffc857')
      fillSection(0.94, 1, '#ff5577')

      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 11, y + h / 2)

      ctx.strokeStyle = peakAt >= 0.94 ? '#ff5577' : 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x + peakAt * width, y)
      ctx.lineTo(x + peakAt * width, y + h)
      ctx.stroke()
    }

    const drawVu = (w: number, h: number, now: number) => {
      clearFrame(w, h)
      readStereo()
      const left = measureLevel(stereoLeft)
      const right = measureLevel(stereoRight)
      const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000))
      lastFrame = now
      vuLeft = smoothMeter(vuLeft, left.rms, dt)
      vuRight = smoothMeter(vuRight, right.rms, dt)

      if (left.peak >= heldLeft) {
        heldLeft = left.peak
        holdLeftUntil = now + 700
      } else if (now > holdLeftUntil) {
        heldLeft = Math.max(0, heldLeft - dt * 0.8)
      }
      if (right.peak >= heldRight) {
        heldRight = right.peak
        holdRightUntil = now + 700
      } else if (now > holdRightUntil) {
        heldRight = Math.max(0, heldRight - dt * 0.8)
      }

      const barHeight = Math.max(12, Math.min(28, h * 0.2))
      const gap = Math.max(8, h * 0.09)
      const top = (h - barHeight * 2 - gap) / 2
      drawVuBar('L', top, barHeight, vuLeft, heldLeft, w)
      drawVuBar('R', top + barHeight + gap, barHeight, vuRight, heldRight, w)

      // Decibel landmarks. The bars themselves carry the colour; these stay quiet enough to remain
      // readable over a scene without turning the meter into another control panel.
      const x = 25
      const width = Math.max(1, w - x - 9)
      ctx.fillStyle = 'rgba(255,255,255,0.42)'
      ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (const db of [-60, -24, -12, -6, 0]) {
        const at = dbPosition(10 ** (db / 20))
        const px = x + at * width
        ctx.fillText(String(db), px, Math.max(8, top - 3))
      }
    }

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      if (w === 0 || h === 0) return

      if (mode === 'off') {
        clearFrame(w, h)
        return
      }
      if (mode === 'waterfall') {
        drawWaterfall(w, h)
        return
      }
      if (mode === 'vu') {
        drawVu(w, h, now)
        return
      }

      fadeFrame(w, h)

      if (mode === 'bars') {
        if (analyser) analyser.getByteFrequencyData(spectrum as Uint8Array<ArrayBuffer>)
        else spectrum.fill(0)
        spectrumBands(spectrum, barValues)
        const slot = w / barValues.length
        ctx.fillStyle = colour
        for (let band = 0; band < barValues.length; band++) {
          const bar = Math.max(1.5, Math.min(h * 0.8, barValues[band] * h * 0.55))
          ctx.fillRect(band * slot + slot * 0.16, h - bar, slot * 0.68, bar)
        }
        return
      }

      ctx.lineWidth = 1.6
      ctx.strokeStyle = colour
      ctx.shadowBlur = 12
      ctx.shadowColor = colour
      ctx.beginPath()

      if (mode === 'wave') {
        if (analyser) analyser.getByteTimeDomainData(samples)
        else samples.fill(128)
        // Trigger on the first upward zero crossing so a periodic waveform stands still.
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
      } else if (mode === 'xy') {
        if (analyser) analyser.getByteTimeDomainData(samples)
        else samples.fill(128)
        // Delayed mono: a sine becomes an ellipse and a decaying kick spirals inward.
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
      } else {
        // Real stereo: mono is a rising diagonal, inverse phase falls, and width opens the figure.
        readStereo()
        const size = Math.min(w, h) * 0.46
        const count = Math.min(stereoLeft.length, stereoRight.length)
        for (let i = 0; i < count; i++) {
          const x = w / 2 + stereoLeft[i] * size
          const y = h / 2 - stereoRight[i] * size
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
      }

      ctx.stroke()
      ctx.shadowBlur = 0

      ctx.strokeStyle = transparent ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      if (mode !== 'wave') {
        ctx.moveTo(w / 2, 0)
        ctx.lineTo(w / 2, h)
      }
      ctx.stroke()
    }

    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      if (analyser && splitter) {
        try {
          analyser.disconnect(splitter)
        } catch {
          // It may already have been disconnected while an AudioContext was being torn down.
        }
        splitter.disconnect()
      }
    }
  }, [analyser, mode, colour, persistence, transparent])

  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height }} />
}
