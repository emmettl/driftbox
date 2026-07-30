import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneAudio } from '../audio'
import { ease, readBands, readLevels } from '../levels'
import { touch } from '../touch'

// Graphic Lab: three kinds of flat music graphic sharing one printing press.
//
// This deliberately does not construct a place. The WebGL canvas only carries one
// screen-sized texture; every mark inside it is made in two dimensions, like a sleeve,
// a flyer or a broadcast frame. The three systems are an exploration rather than three
// half-scenes: leave it alone and it changes edition every ten seconds, or drag across
// the screen to move directly between A, B and C.

const BANDS = 16
const EDITION_SECONDS = 10
const MAX_TEXTURE_EDGE = 1280
const DISPLAY_FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif'
const TEXT_FONT = '"Helvetica Neue", Arial, sans-serif'

interface Frame {
  width: number
  height: number
  time: number
  bass: number
  high: number
  bands: Float32Array
  title: string
  section: string
  bpm: number
  bar: number
  step: number
}

function hash(value: number): number {
  return Math.abs(Math.sin(value * 91.733 + 17.17) * 43758.5453) % 1
}

function setFont(
  context: CanvasRenderingContext2D,
  size: number,
  weight = 900,
  family = DISPLAY_FONT,
): void {
  context.font = `${weight} ${Math.max(1, Math.round(size))}px ${family}`
}

function fittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  colour: string,
): void {
  setFont(context, size)
  const measured = Math.max(1, context.measureText(text).width)
  const scale = Math.min(1, width / measured)
  context.save()
  context.translate(x, y)
  context.scale(scale, 1)
  context.fillStyle = colour
  context.fillText(text, 0, 0)
  context.restore()
}

function trackedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): void {
  let cursor = x
  for (const character of text) {
    context.fillText(character, cursor, y)
    cursor += context.measureText(character).width + tracking
  }
}

function rule(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): void {
  context.fillStyle = colour
  context.fillRect(x, y, width, height)
}

function spectrum(
  context: CanvasRenderingContext2D,
  bands: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
  gap = 0.18,
): void {
  const lane = width / bands.length
  context.fillStyle = colour
  for (let index = 0; index < bands.length; index++) {
    const value = 0.06 + Math.min(1, bands[index] * 1.55)
    const barHeight = height * value
    context.fillRect(x + lane * index, y + height - barHeight, lane * (1 - gap), barHeight)
  }
}

function paperGrain(context: CanvasRenderingContext2D, frame: Frame, colour: string): void {
  context.fillStyle = colour
  const amount = Math.floor((frame.width * frame.height) / 4200)
  for (let index = 0; index < amount; index++) {
    const x = hash(index * 2.13) * frame.width
    const y = hash(index * 5.71) * frame.height
    const size = 0.5 + hash(index * 8.9) * 1.7
    context.fillRect(x, y, size, size)
  }
}

function cropMarks(context: CanvasRenderingContext2D, frame: Frame, colour: string): void {
  const inset = Math.max(15, frame.width * 0.022)
  const length = Math.max(10, frame.width * 0.018)
  context.strokeStyle = colour
  context.lineWidth = Math.max(1, frame.width / 900)
  context.beginPath()
  for (const x of [inset, frame.width - inset]) {
    context.moveTo(x - length, inset)
    context.lineTo(x + length, inset)
    context.moveTo(x, inset - length)
    context.lineTo(x, inset + length)
    context.moveTo(x - length, frame.height - inset)
    context.lineTo(x + length, frame.height - inset)
    context.moveTo(x, frame.height - inset - length)
    context.lineTo(x, frame.height - inset + length)
  }
  context.stroke()
}

function titleLines(title: string): [string, string] {
  const words = title.trim().split(/\s+/)
  if (words.length > 1) {
    const middle = Math.ceil(words.length / 2)
    return [words.slice(0, middle).join(' '), words.slice(middle).join(' ')]
  }
  const middle = Math.ceil(title.length / 2)
  return [title.slice(0, middle), title.slice(middle)]
}

function pressEdition(context: CanvasRenderingContext2D, frame: Frame): void {
  const { width: w, height: h } = frame
  const paper = '#eee9dc'
  const blue = '#1749d2'
  const red = '#ee3d24'
  const ink = '#14130f'
  const margin = w * 0.055
  const pulse = frame.bass * h * 0.022
  const portrait = w < h * 0.72

  context.fillStyle = paper
  context.fillRect(0, 0, w, h)
  rule(context, 0, 0, w, h * 0.105, blue)
  rule(context, margin, h * 0.145, w - margin * 2, Math.max(2, h * 0.007), ink)

  context.fillStyle = paper
  setFont(context, h * 0.022, 700, TEXT_FONT)
  trackedText(context, portrait ? 'DBX / EDITION A' : 'DRIFTBOX / TYPE PRESS / EDITION A', margin, h * 0.068, w * 0.003)
  context.textAlign = 'right'
  context.fillText(`${String(frame.bar + 1).padStart(2, '0')} : ${String(frame.step + 1).padStart(2, '0')}`, w - margin, h * 0.068)
  context.textAlign = 'left'

  // Two physical inks, slightly out of register when the top end gets busy.
  const register = 2 + frame.high * 10
  context.save()
  context.beginPath()
  context.rect(0, h * 0.15, w, h * 0.48)
  context.clip()
  if (portrait) {
    const [first, second] = titleLines(frame.title.toUpperCase())
    for (const [index, line] of [first, second].entries()) {
      const baseline = h * (0.36 + index * 0.215)
      fittedText(context, line, margin + register, baseline + pulse, w * 0.89, h * 0.215, red)
      fittedText(context, line, margin - register, baseline - pulse, w * 0.89, h * 0.215, blue)
      context.globalCompositeOperation = 'multiply'
      fittedText(context, line, margin, baseline, w * 0.89, h * 0.215, ink)
      context.globalCompositeOperation = 'source-over'
    }
  } else {
    fittedText(context, frame.title.toUpperCase(), margin + register, h * 0.43 + pulse, w * 0.91, h * 0.29, red)
    fittedText(context, frame.title.toUpperCase(), margin - register, h * 0.405 - pulse, w * 0.91, h * 0.29, blue)
    context.globalCompositeOperation = 'multiply'
    fittedText(context, frame.title.toUpperCase(), margin, h * 0.418, w * 0.91, h * 0.29, ink)
  }
  context.restore()

  const sectionY = h * (portrait ? 0.63 : 0.605)
  rule(context, 0, sectionY, w, h * 0.095, ink)
  context.fillStyle = paper
  setFont(context, h * 0.055)
  context.fillText(frame.section.toUpperCase(), margin, sectionY + h * 0.066)
  context.textAlign = 'right'
  setFont(context, h * 0.023, 700, TEXT_FONT)
  context.fillText(`${frame.bpm} BPM / STEREO`, w - margin, sectionY + h * 0.058)
  context.textAlign = 'left'

  spectrum(context, frame.bands, margin, h * 0.745, w - margin * 2, h * 0.15, blue, 0.3)
  rule(context, margin, h * 0.925, w * 0.18, h * 0.012, red)
  rule(context, margin + w * 0.19, h * 0.925, w * 0.71, h * 0.012, ink)

  context.fillStyle = ink
  setFont(context, h * 0.016, 600, TEXT_FONT)
  context.fillText(portrait ? 'A / TYPE PRESS' : 'A / STRICT TYPE, OVERPRINT, SPECTRUM AS RULE', margin, h * 0.975)
  context.textAlign = 'right'
  context.fillText(portrait ? 'A · B · C' : 'DRAG HORIZONTAL → A · B · C', w - margin, h * 0.975)
  context.textAlign = 'left'

  cropMarks(context, frame, 'rgba(20, 19, 15, 0.65)')
  paperGrain(context, frame, 'rgba(20, 19, 15, 0.08)')
}

function flyerEdition(context: CanvasRenderingContext2D, frame: Frame): void {
  const { width: w, height: h } = frame
  const black = '#11100e'
  const cream = '#f1e8cc'
  const yellow = '#f4df1d'
  const pink = '#ff3d91'
  const margin = w * 0.045
  const kick = frame.bass * h * 0.035
  const portrait = w < h * 0.72

  context.fillStyle = yellow
  context.fillRect(0, 0, w, h)

  // A halftone field: frequency lanes run left-to-right, high energy makes the dots
  // swell until neighbouring dots print into each other.
  const spacing = Math.max(13, Math.round(w / 70))
  context.fillStyle = black
  for (let y = -spacing; y < h + spacing; y += spacing) {
    for (let x = -spacing; x < w + spacing; x += spacing) {
      const band = Math.min(BANDS - 1, Math.floor((x / w) * BANDS))
      const energy = frame.bands[Math.max(0, band)] ?? 0
      const wave = 0.5 + 0.5 * Math.sin(x * 0.025 + y * 0.018 - frame.time * 3)
      const radius = spacing * (0.07 + energy * 0.25 + wave * 0.08)
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }

  context.save()
  context.translate(w * 0.5, h * (portrait ? 0.31 : 0.29))
  context.rotate(-0.045 + frame.high * 0.018)
  rule(context, -w * 0.58, -h * (portrait ? 0.23 : 0.17), w * 1.16, h * (portrait ? 0.46 : 0.34), cream)
  if (portrait) {
    const [first, second] = titleLines(frame.title.toUpperCase())
    for (const [index, line] of [first, second].entries()) {
      const baseline = h * (-0.015 + index * 0.19)
      fittedText(context, line, -w * 0.48 + frame.high * 8, baseline + kick, w * 0.96, h * 0.18, pink)
      context.globalCompositeOperation = 'multiply'
      fittedText(context, line, -w * 0.48 - frame.high * 8, baseline - kick, w * 0.96, h * 0.18, black)
      context.globalCompositeOperation = 'source-over'
    }
  } else {
    fittedText(context, frame.title.toUpperCase(), -w * 0.48 + frame.high * 8, h * 0.09 + kick, w * 0.96, h * 0.235, pink)
    context.globalCompositeOperation = 'multiply'
    fittedText(context, frame.title.toUpperCase(), -w * 0.48 - frame.high * 8, h * 0.075 - kick, w * 0.96, h * 0.235, black)
  }
  context.restore()

  context.save()
  context.translate(w * 0.12, h * 0.6)
  context.rotate(0.025)
  rule(context, 0, 0, w * 0.76, h * 0.115, black)
  context.fillStyle = cream
  setFont(context, h * 0.07)
  context.fillText(frame.section.toUpperCase(), w * 0.025, h * 0.082)
  context.restore()

  // Photocopied repetition—the label becomes texture before it becomes information.
  context.save()
  context.beginPath()
  context.rect(0, h * 0.7, w, h * 0.22)
  context.clip()
  setFont(context, h * 0.047)
  for (let row = 0; row < 6; row++) {
    const slip = Math.sin(frame.time * 2.1 + row * 1.7) * frame.high * w * 0.045
    context.fillStyle = row % 2 ? black : pink
    context.fillText(`DRIFTBOX ${frame.bpm} BPM DRIFTBOX ${frame.bpm} BPM`, -w * 0.08 + slip, h * (0.735 + row * 0.045))
  }
  context.restore()

  rule(context, margin, h * 0.93, w - margin * 2, h * 0.045, black)
  context.fillStyle = yellow
  setFont(context, h * 0.018, 700, TEXT_FONT)
  context.fillText(portrait ? 'B / XEROX' : `B / XEROX NIGHT / BAR ${String(frame.bar + 1).padStart(2, '0')}`, margin * 1.35, h * 0.96)
  context.textAlign = 'right'
  context.fillText(portrait ? 'DOT / TEAR' : 'INK / DOT / REPEAT / TEAR', w - margin * 1.35, h * 0.96)
  context.textAlign = 'left'

  cropMarks(context, frame, black)
  paperGrain(context, frame, 'rgba(17, 16, 14, 0.16)')
}

function broadcastEdition(context: CanvasRenderingContext2D, frame: Frame): void {
  const { width: w, height: h } = frame
  const blue = '#0b32ad'
  const white = '#f5f3e9'
  const orange = '#ff4c1f'
  const black = '#0b0b11'
  const margin = w * 0.045
  const phase = (frame.time * 0.12) % 1

  context.fillStyle = blue
  context.fillRect(0, 0, w, h)

  context.strokeStyle = 'rgba(245, 243, 233, 0.18)'
  context.lineWidth = 1
  for (let x = 0; x <= w; x += w / 12) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, h)
    context.stroke()
  }
  for (let y = 0; y <= h; y += h / 8) {
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(w, y)
    context.stroke()
  }

  rule(context, 0, h * 0.055, w * (0.2 + phase * 0.8), h * 0.035, orange)
  rule(context, w * (0.84 - phase * 0.4), h * 0.105, w * 0.5, h * 0.012, white)

  context.fillStyle = white
  setFont(context, h * 0.024, 700, TEXT_FONT)
  trackedText(context, 'DBX / LIVE SIGNAL', margin, h * 0.165, w * 0.0025)
  context.textAlign = 'right'
  context.fillText(`CH ${String((frame.bar % 12) + 1).padStart(2, '0')}`, w - margin, h * 0.165)
  context.textAlign = 'left'

  const monogram = frame.title
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 3) || 'DBX'
  context.save()
  context.beginPath()
  context.rect(0, h * 0.18, w, h * 0.49)
  context.clip()
  const jump = frame.bass * h * 0.03
  fittedText(context, monogram.toUpperCase(), margin, h * 0.61 + jump, w * 0.92, h * 0.54, white)

  // Signal slips are hard horizontal copies, not a soft digital "glitch" effect.
  for (let slice = 0; slice < 5; slice++) {
    const y = h * (0.25 + hash(slice * 8.3) * 0.34)
    const sliceHeight = h * (0.012 + hash(slice * 3.1) * 0.025)
    const shift = (hash(slice * 7.7 + Math.floor(frame.time * 8)) - 0.5) * frame.high * w * 0.24
    context.drawImage(context.canvas, 0, y, w, sliceHeight, shift, y, w, sliceHeight)
  }
  context.restore()

  rule(context, 0, h * 0.68, w, h * 0.12, orange)
  context.fillStyle = black
  setFont(context, h * 0.074)
  context.fillText(frame.section.toUpperCase(), margin, h * 0.765)

  const seconds = Math.floor(frame.time)
  const timecode = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame.bar + 1).padStart(2, '0')}:${String(frame.step + 1).padStart(2, '0')}`
  context.fillStyle = white
  setFont(context, h * 0.044, 700, TEXT_FONT)
  context.fillText(timecode, margin, h * 0.88)
  context.textAlign = 'right'
  context.fillText(`${frame.bpm}.00`, w - margin, h * 0.88)
  context.textAlign = 'left'

  spectrum(context, frame.bands, margin, h * 0.91, w - margin * 2, h * 0.045, white, 0.45)
  context.fillStyle = white
  setFont(context, h * 0.015, 700, TEXT_FONT)
  context.fillText('C / BROADCAST ID / AUDIO-LOCKED TRANSMISSION', margin, h * 0.985)
  context.textAlign = 'right'
  context.fillText('DRAG HORIZONTAL → A · B · C', w - margin, h * 0.985)
  context.textAlign = 'left'
}

function draw(context: CanvasRenderingContext2D, frame: Frame, edition: number): void {
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.textBaseline = 'alphabetic'
  context.textAlign = 'left'
  context.imageSmoothingEnabled = true

  if (edition === 0) pressEdition(context, frame)
  else if (edition === 1) flyerEdition(context, frame)
  else broadcastEdition(context, frame)
}

export function GraphicLab() {
  const { gl } = useThree()
  const startedAt = useRef(performance.now())
  const elapsed = useRef(0)
  const rawBands = useRef(new Float32Array(BANDS))
  const smoothBands = useRef(new Float32Array(BANDS))
  const bass = useRef(0)
  const high = useRef(0)

  const surface = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    return { canvas, texture }
  }, [])

  const uniforms = useMemo(() => ({ uGraphic: { value: surface.texture } }), [surface])

  useEffect(
    () => () => {
      surface.texture.dispose()
    },
    [surface],
  )

  useFrame((_, dt) => {
    elapsed.current += Math.min(dt, 0.05)
    const levels = readLevels(sceneAudio.analyser)
    readBands(sceneAudio.analyser, rawBands.current)
    bass.current = ease(bass.current, levels.bass, dt, 4.2)
    high.current = ease(high.current, levels.high, dt, 6.5)
    for (let index = 0; index < BANDS; index++) {
      smoothBands.current[index] = ease(
        smoothBands.current[index],
        rawBands.current[index],
        dt,
        5.2,
      )
    }

    // Read the element, not R3F's cached viewport. The browser can change dimensions
    // without remounting this canvas (rotation and split-screen do exactly that), and a
    // stale landscape size stretched into a portrait element turns type into noodles.
    const cssWidth = gl.domElement.clientWidth
    const cssHeight = gl.domElement.clientHeight
    const scale = Math.min(1, MAX_TEXTURE_EDGE / Math.max(cssWidth, cssHeight))
    const width = Math.max(2, Math.round(cssWidth * scale))
    const height = Math.max(2, Math.round(cssHeight * scale))
    if (surface.canvas.width !== width || surface.canvas.height !== height) {
      surface.canvas.width = width
      surface.canvas.height = height
    }
    const context = surface.canvas.getContext('2d')
    if (!context) return

    // Wall time chooses the edition. Render time can be throttled when the tab is in the
    // background; coming back should reveal the next poster, not freeze the sequence at
    // the frame where the browser stopped painting.
    const sceneSeconds = (performance.now() - startedAt.current) / 1000
    const automatic = Math.floor(sceneSeconds / EDITION_SECONDS) % 3
    const edition =
      touch.down || touch.energy > 0.18
        ? Math.min(2, Math.floor(Math.max(0, Math.min(0.999, touch.x)) * 3))
        : automatic
    const visualStep = Math.floor(elapsed.current * (sceneAudio.bpm / 60) * 4)

    draw(
      context,
      {
        width,
        height,
        time: elapsed.current,
        bass: bass.current,
        high: high.current,
        bands: smoothBands.current,
        title: 'DRIFTBOX',
        section: ['TYPE PRESS', 'XEROX NIGHT', 'LIVE SIGNAL'][edition],
        bpm: Math.round(sceneAudio.bpm),
        bar: Math.floor(visualStep / 16),
        step: visualStep % 16,
      },
      edition,
    )
    surface.texture.needsUpdate = true
  })

  return (
    <mesh frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `}
        fragmentShader={`
          uniform sampler2D uGraphic;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(uGraphic, vUv);
          }
        `}
      />
    </mesh>
  )
}
