import { MODULES, type PatchCable } from '@driftbox/rack'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  cableMiddle,
  cablePath,
  cablePoint,
  swingAngle,
  swingSeed,
  type Point,
} from './cable.js'
import { sizeFor } from './faceplates/index.js'
import {
  SNAP,
  dropIndex,
  type Jack,
  jackAt,
  jacks,
  layout as rackLayout,
  nearestJack,
  reordered,
  type Layout,
  type ModuleDragGeometry,
  withDraggedPlacement,
} from './layout.js'
import { useRack } from './store.js'
import { useCableJiggle } from './useCableJiggle.js'
import { useSwing } from './useSwing.js'

// The back of the rack. Jacks, and cables hanging between them.
//
// Everything here is laid out from the def rather than by hand, for every module without exception —
// including one whose front panel is hand-built, and including one this build has never heard of. That
// is what makes cables work universally, and it is the reason `faceplates/index.ts` only has an escape
// hatch for the front.
//
// The cables are an SVG in the same coordinate space as the modules, so nothing has to be measured and
// a resize is a CSS problem rather than a recalculation.
//
// They also SWING when the rack turns, which is not a garnish — it is the single detail that made
// Reason's back panel feel like an object rather than a diagram, and it is cheap: one pendulum angle per
// cable, from `swingAngle`, over the second and a half after a flip. Each cable's period comes from its
// own sag, so they do not move in lockstep. See `cable.ts` for why that is the whole trick.

interface Props {
  layout: Layout
}

interface CablePathsProps {
  all: Jack[]
  cables: PatchCable[]
  delayed: Set<string>
  /** Cables whose source is stereo and whose destination is not, keyed as `from>to`. */
  folded: Set<string>
  swing: ReturnType<typeof useSwing>
  jiggle?: { module: string; angle: number }
  disconnect?: (cable: PatchCable) => void
}

/** The drawn leads, kept separate from the panel furniture so their geometry has one implementation. */
export function CablePaths({
  all,
  cables,
  delayed,
  folded,
  swing,
  jiggle,
  disconnect,
}: CablePathsProps) {
  return cables.map((cable) => {
    const from = jackAt(all, cable.from[0], cable.from[1], 'out')
    const to = jackAt(all, cable.to[0], cable.to[1], 'in')
    if (!from || !to) return null
    const key = `${cable.from.join('.')}>${cable.to.join('.')}`
    const isDelayed = delayed.has(cable.to[0])
    // Keyed by the cable rather than by its destination module, unlike `delayed`. A fold is a fact about
    // one connection — a module can take a stereo pair on one inlet and a folded one on another — whereas a
    // delayed cable is reported against the module the compiler had to run out of order.
    const isFolded = folded.has(key)
    const seed = swingSeed(key)
    const flipAngle =
      swing.elapsed === null
        ? 0
        : swingAngle(swing.elapsed, from, to, swing.direction, seed)
    const attached =
      jiggle && (cable.from[0] === jiggle.module || cable.to[0] === jiggle.module)
    // Leads fixed to the moving bay share its overall lag, while their stable seed keeps the bundle
    // from behaving like one rigid ribbon.
    const angle = flipAngle + (attached ? jiggle.angle * (0.8 + seed * 0.4) : 0)
    const grab = cableMiddle(from, to, angle)
    const d = cablePath(from, to, angle)

    return (
      <g
        key={key}
        className={['rk-cable', isDelayed ? 'rk-cable-delayed' : '', isFolded ? 'rk-cable-folded' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <path className="rk-cable-shadow" d={d} />
        <path className="rk-cable-line" d={d} />
        {disconnect && (
          <circle
            className="rk-cable-grab"
            cx={grab.x}
            cy={grab.y}
            r="11"
            onPointerDown={(event) => {
              event.stopPropagation()
              disconnect(cable)
            }}
          >
            <title>{`${cable.from.join('.')} → ${cable.to.join('.')}${
              isFolded ? ' — mono: the left channel only' : ''
            } — click to unpatch`}</title>
          </circle>
        )}
      </g>
    )
  })
}

interface CableUnplugsProps {
  all: Jack[]
  cables: PatchCable[]
  disconnect: (cable: PatchCable) => void
}

/**
 * One visible unplug control per cable, beside the inlet it occupies.
 *
 * Outlets may fan out to several destinations, so putting controls there would stack several buttons
 * on one jack. An inlet accepts exactly one cable, which gives every lead one stable, unambiguous place
 * to be removed. These sit above the jacks in the SVG rather than inside `CablePaths`: the drawn cable
 * belongs below the panel furniture, while a button has to remain visible and clickable above it.
 */
export function CableUnplugs({ all, cables, disconnect }: CableUnplugsProps) {
  return cables.map((cable) => {
    const from = jackAt(all, cable.from[0], cable.from[1], 'out')
    const to = jackAt(all, cable.to[0], cable.to[1], 'in')
    if (!from || !to) return null

    const key = `${cable.from.join('.')}>${cable.to.join('.')}`
    const label = `Unplug ${from.module} ${from.name} from ${to.module} ${to.name}`

    return (
      <g
        key={key}
        className="rk-cable-unplug"
        transform={`translate(${to.x - 18} ${to.y})`}
        role="button"
        tabIndex={0}
        aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          disconnect(cable)
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' &&
            event.key !== ' ' &&
            event.key !== 'Delete' &&
            event.key !== 'Backspace'
          ) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          disconnect(cable)
        }}
      >
        <circle className="rk-cable-unplug-hit" r="13" />
        <circle className="rk-cable-unplug-button" r="7" />
        <path className="rk-cable-unplug-icon" d="M -2.5 -2.5 L 2.5 2.5 M 2.5 -2.5 L -2.5 2.5" />
        <title>{label}</title>
      </g>
    )
  })
}

interface SmokeParticle extends Point {
  delay: number
  drift: number
  rise: number
  radiusX: number
  radiusY: number
}

interface CableEvaporation {
  id: number
  key: string
  d: string
  smoke: SmokeParticle[]
}

interface CableEvaporationsProps {
  items: CableEvaporation[]
  finished: (id: number) => void
}

/**
 * The visual afterlife of a cable that has already left the patch.
 *
 * This layer owns no document state: each item is a snapshot of the old curve, retained just long
 * enough for CSS to fray it and lift smoke from it. The group animation is the clock; its end removes
 * the snapshot from React state.
 */
export function CableEvaporations({ items, finished }: CableEvaporationsProps) {
  return items.map((item) => (
    <g
      key={item.id}
      className="rk-cable-evaporation"
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) finished(item.id)
      }}
    >
      <path className="rk-cable-evaporation-glow" d={item.d} />
      <path className="rk-cable-evaporation-line" d={item.d} />
      {item.smoke.map((particle, index) => (
        <ellipse
          key={index}
          className="rk-cable-smoke"
          cx={particle.x}
          cy={particle.y}
          rx={particle.radiusX}
          ry={particle.radiusY}
          style={
            {
              '--rk-smoke-delay': `${particle.delay}ms`,
              '--rk-smoke-drift': `${particle.drift}px`,
              '--rk-smoke-rise': `${particle.rise}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </g>
  ))
}

function evaporation(cable: PatchCable, all: Jack[], id: number): CableEvaporation | null {
  const from = jackAt(all, cable.from[0], cable.from[1], 'out')
  const to = jackAt(all, cable.to[0], cable.to[1], 'in')
  if (!from || !to) return null

  const key = `${cable.from.join('.')}>${cable.to.join('.')}`
  const smoke = Array.from({ length: 15 }, (_, index): SmokeParticle => {
    const point = cablePoint(from, to, 0.04 + index * 0.066)
    const seed = swingSeed(`${key}:smoke:${index}`)
    const radiusX = 2.5 + seed * 2.8
    return {
      ...point,
      delay: index * 13 + seed * 32,
      drift: (seed - 0.5) * 52,
      rise: -36 - seed * 44,
      radiusX,
      radiusY: radiusX * (1.25 + seed * 0.5),
    }
  })

  return { id, key, d: cablePath(from, to), smoke }
}

/** A cable being dragged, before it lands anywhere. */
interface CableDragging {
  from: Jack
  at: Point
}

interface ModuleDragging extends ModuleDragGeometry {
  index: number
}

interface InputTrimProps {
  jack: Jack
  value: number
  onChange: (value: number) => void
}

const clampTrim = (value: number) => Math.max(-1, Math.min(1, value))
const trimText = (value: number) => `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}×`

/** The small bipolar pot beside every rear inlet. Audio and CV are intentionally the same signal here. */
function InputTrim({ jack, value, onChange }: InputTrimProps) {
  const drag = useRef<{ y: number; from: number } | null>(null)
  const angle = -135 + ((value + 1) / 2) * 270
  const change = (next: number) => onChange(Math.round(clampTrim(next) * 100) / 100)

  return (
    <g
      // Marked when it is away from unity, which is the only state in which it is doing anything. A pot
      // sits beside every inlet whether or not anybody has touched it, so without a mark the only way to
      // find the one attenuating something is to read all of them.
      className={value === 1 ? 'rk-input-trim' : 'rk-input-trim rk-input-trim-on'}
      transform={`translate(${jack.x + 84} ${jack.y})`}
      role="slider"
      tabIndex={0}
      aria-label={`${jack.module} ${jack.name} input trim`}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={value}
      aria-valuetext={trimText(value)}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, from: value }
      }}
      onPointerMove={(event) => {
        event.stopPropagation()
        const held = drag.current
        if (!held) return
        const scale = event.shiftKey ? 0.005 : 0.02
        change(held.from + (held.y - event.clientY) * scale)
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={(event) => {
        event.stopPropagation()
        drag.current = null
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        change(1)
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.01 : 0.05
        let next: number | null = null
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = value + step
        if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = value - step
        if (event.key === 'Home') next = -1
        if (event.key === 'End') next = 1
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        change(next)
      }}
    >
      <circle className="rk-input-trim-hit" r="12" />
      <circle className="rk-input-trim-track" r="7" />
      <line
        className="rk-input-trim-pointer"
        x1="0"
        y1="-2"
        x2="0"
        y2="-6"
        transform={`rotate(${angle})`}
      />
      <title>{`${jack.module}.${jack.port} input trim ${trimText(value)}; double-click for unity`}</title>
    </g>
  )
}

export function BackPanel({ layout }: Props) {
  const patch = useRack((s) => s.patch)
  const connect = useRack((s) => s.connect)
  const disconnect = useRack((s) => s.disconnect)
  const notes = useRack((s) => s.notes)
  const flipped = useRack((s) => s.flipped)
  const select = useRack((s) => s.select)
  const dropModule = useRack((s) => s.dropModule)
  const inputTrimValue = useRack((s) => s.inputTrimValue)
  const setInputTrim = useRack((s) => s.setInputTrim)

  /** How long ago the rack was spun, and which way. Null between flips, and the cables hang still. */
  const swing = useSwing(flipped)

  const all = useMemo(() => jacks(layout.placements, MODULES), [layout])
  const nextEvaporation = useRef(0)
  const [evaporations, setEvaporations] = useState<CableEvaporation[]>([])
  const unplug = useCallback(
    (cable: PatchCable) => {
      const item = evaporation(cable, all, ++nextEvaporation.current)
      if (item) {
        // A repeated keyboard event should restart one disappearance, not manufacture a smoke stack.
        setEvaporations((current) => [...current.filter((entry) => entry.key !== item.key), item])
      }
      // Audio and history change now. The animation above is only the old geometry saying goodbye.
      disconnect(cable)
    },
    [all, disconnect],
  )
  const [cableDrag, setCableDrag] = useState<CableDragging | null>(null)
  const [moduleDrag, setModuleDrag] = useState<ModuleDragging | null>(null)
  /** Latest pointer position outside React's continuous-event batching, so every jiggle kick is a delta. */
  const modulePoint = useRef<Point | null>(null)
  const jiggle = useCableJiggle()
  /**
   * The jack picked with the keyboard, waiting for its other end.
   *
   * Patching by dragging is unavailable to anybody who cannot drag, and a modular whose whole point is the
   * cables is a poor thing to make mouse-only. Two presses instead of one gesture: Enter on a jack arms it,
   * Enter on a compatible one completes the cable, Escape lets go. Delete on a patched inlet pulls its cable
   * out. It shares `connect` with the drag, so there is one definition of what a legal cable is.
   */
  const [armed, setArmed] = useState<Jack | null>(null)
  const surface = useRef<SVGSVGElement | null>(null)

  /** Pointer position in design units rather than screen pixels, so the live cable lines up with the
   *  jacks it is being dragged between whatever the zoom is. */
  const toDesign = useCallback((event: React.PointerEvent): Point => {
    const svg = surface.current
    if (!svg) return { x: 0, y: 0 }
    const box = svg.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) / box.width) * layout.width,
      y: ((event.clientY - box.top) / box.height) * layout.height,
    }
  }, [layout.width, layout.height])

  /** `join` is defined below because it needs `connect`; the drag needs it here. A ref rather than
   *  reordering the file, because the reading order — drag, then keyboard, then the shared join — is the
   *  order somebody would want to read it in. */
  const joinRef = useRef<(a: Jack, b: Jack) => boolean>(() => false)

  /** The jack a drop would land on: nearest of the opposite kind, within a snap radius. */
  const dropTarget = useCallback(
    (drag: CableDragging | null, at: Point) =>
      drag ? nearestJack(all, at, SNAP, drag.from.kind === 'out' ? 'in' : 'out') : undefined,
    [all],
  )

  const finishCable = useCallback(
    (at?: Point) => {
      const drag = cableDrag
      setCableDrag(null)
      if (!drag || !at) return
      const target = dropTarget(drag, at)
      if (!target) return
      // A cable has one end in an outlet and one in an inlet, and it does not matter which was dragged
      // first — pulling from an input to an output is how anybody who has used a real rack does it half
      // the time.
      joinRef.current(drag.from, target)
    },
    [cableDrag, dropTarget],
  )

  const over = cableDrag ? dropTarget(cableDrag, cableDrag.at) : undefined

  /** Join two jacks, whichever order they were picked in. Shared by the drag and the keyboard. */
  const join = useCallback(
    (a: Jack, b: Jack) => {
      if (a.kind === b.kind) return false
      const [out, into] = a.kind === 'out' ? [a, b] : [b, a]
      connect([out.module, out.port], [into.module, into.port])
      return true
    },
    [connect],
  )

  joinRef.current = join

  const onJackKey = useCallback(
    (event: React.KeyboardEvent, jack: Jack) => {
      if (event.key === 'Escape') {
        setArmed(null)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // A cable's `to` is an inlet and its `from` is an outlet, so each end is only a candidate for a
        // jack of the matching kind. Without that, deleting from `Arp`'s pitch *inlet* would unplug a
        // cable leaving its pitch *outlet*, because both ends read as the same port id.
        const attached = patch.cables.find(
          (cable) =>
            (jack.kind === 'in' && cable.to[0] === jack.module && cable.to[1] === jack.port) ||
            (jack.kind === 'out' && cable.from[0] === jack.module && cable.from[1] === jack.port),
        )
        if (attached) {
          event.preventDefault()
          unplug(attached)
        }
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (!armed) {
        setArmed(jack)
        return
      }
      if (armed.module === jack.module && armed.port === jack.port && armed.kind === jack.kind) {
        setArmed(null)
        return
      }
      if (join(armed, jack)) setArmed(null)
    },
    [armed, join, patch.cables, unplug],
  )

  /**
   * The rear preview uses the same reordered module list as the front. Its final extra step is replacing
   * the dragged module's proposed slot with the pointer-following geometry; `jacks` then moves every
   * socket on that bay, and the cable renderer inherits those endpoints without any DOM measurement.
   */
  const draggedId = moduleDrag?.id
  const draggedIndex = moduleDrag?.index
  const preview = useMemo(() => {
    if (!draggedId || draggedIndex === undefined || draggedIndex < 0) return layout
    const from = patch.modules.findIndex((module) => module.id === draggedId)
    const modules = reordered(patch.modules, from, draggedIndex)
    return modules === patch.modules ? layout : rackLayout(modules, sizeFor(MODULES))
  }, [draggedId, draggedIndex, layout, patch.modules])
  const displayedPlacements = useMemo(
    () =>
      moduleDrag
        ? withDraggedPlacement(preview.placements, moduleDrag)
        : preview.placements,
    [moduleDrag, preview.placements],
  )
  const visibleJacks = useMemo(
    () => jacks(displayedPlacements, MODULES),
    [displayedPlacements],
  )
  const renderedPlacements = useMemo(
    () =>
      moduleDrag
        ? [
            ...displayedPlacements.filter((placement) => placement.id !== moduleDrag.id),
            ...displayedPlacements.filter((placement) => placement.id === moduleDrag.id),
          ]
        : displayedPlacements,
    [displayedPlacements, moduleDrag],
  )
  const renderedJacks = useMemo(
    () =>
      moduleDrag
        ? [
            ...visibleJacks.filter((jack) => jack.module !== moduleDrag.id),
            ...visibleJacks.filter((jack) => jack.module === moduleDrag.id),
          ]
        : visibleJacks,
    [moduleDrag, visibleJacks],
  )
  const ghostSlot = draggedId
    ? preview.placements.find((placement) => placement.id === draggedId)
    : undefined
  const visibleArmed = armed
    ? jackAt(visibleJacks, armed.module, armed.port, armed.kind) ?? armed
    : null

  const delayed = new Set(
    notes.flatMap((note) => (note.kind === 'delayed' && note.module ? [note.module] : [])),
  )
  // A stereo outlet reaching a mono inlet loses its right channel. The compiler decides it and says so;
  // drawing it is the other half of that bargain, and it is the same one the delayed cables strike.
  const folded = new Set(
    notes.flatMap((note) =>
      note.kind === 'mono-fold' && note.cable
        ? [`${note.cable.from.join('.')}>${note.cable.to.join('.')}`]
        : [],
    ),
  )

  return (
    <div
      className="rk-back"
      data-dragging={cableDrag ? `${cableDrag.from.module}.${cableDrag.from.port}` : ''}
      data-module-dragging={moduleDrag?.id ?? ''}
    >
      <svg
        ref={surface}
        className="rk-wires"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        onPointerMove={(event) => {
          if (moduleDrag) {
            const at = toDesign(event)
            jiggle.kick(modulePoint.current ?? moduleDrag.at, at)
            modulePoint.current = at
            setModuleDrag({
              ...moduleDrag,
              at,
              index: dropIndex(layout.placements, at),
            })
            return
          }
          if (cableDrag) setCableDrag({ ...cableDrag, at: toDesign(event) })
        }}
        onPointerUp={(event) => {
          if (moduleDrag) {
            dropModule(moduleDrag.id, dropIndex(layout.placements, toDesign(event)))
            window.getSelection()?.removeAllRanges()
            setModuleDrag(null)
            modulePoint.current = null
            jiggle.reset()
            return
          }
          finishCable(toDesign(event))
        }}
        // Not onPointerLeave: with the pointer captured to this element the cable can be dragged outside
        // it and back, and cancelling on leave made a drag that strayed over the header die silently.
        onPointerCancel={() => {
          if (moduleDrag) {
            setModuleDrag(null)
            modulePoint.current = null
            jiggle.reset()
            return
          }
          finishCable()
        }}
      >
        {ghostSlot && (
          <rect
            className="rk-back-drag-slot"
            x={ghostSlot.x + 4}
            y={ghostSlot.y + 4}
            width={ghostSlot.width - 8}
            height={ghostSlot.height - 8}
            rx="10"
          />
        )}

        {/* The panel itself: one rectangle per module, so the back has the same divisions as the front
            and it is obvious which jacks belong to which module. The bay background is its drag handle;
            jacks and cable grabs sit above it and stop propagation for their own gestures. */}
        {renderedPlacements.map((placement) => (
          <g key={placement.id}>
            <rect
              className={moduleDrag?.id === placement.id ? 'rk-bay rk-bay-ghost' : 'rk-bay'}
              x={placement.x + 4}
              y={placement.y + 4}
              width={placement.width - 8}
              height={placement.height - 8}
              rx="10"
              role="button"
              aria-label={`Drag ${placement.id} to reorder`}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                surface.current?.setPointerCapture(event.pointerId)
                select(placement.id)
                const at = toDesign(event)
                modulePoint.current = at
                setModuleDrag({
                  id: placement.id,
                  index: -1,
                  at,
                  grab: { x: at.x - placement.x, y: at.y - placement.y },
                  width: placement.width,
                  height: placement.height,
                })
              }}
            />
            <text className="rk-bay-name" x={placement.x + 14} y={placement.y + 21}>
              {MODULES[placement.type]?.name ?? placement.type}
            </text>
            <text
              className="rk-bay-id"
              x={placement.x + placement.width - 14}
              y={placement.y + 21}
              textAnchor="end"
            >
              {placement.id}
            </text>
          </g>
        ))}

        {/* A cable the compiler had to delay to break a cycle is drawn differently. A patch that
            behaves unlike its picture is worse than one that admits it — the compiler reports these
            for exactly this purpose. */}
        <CablePaths
          all={visibleJacks}
          cables={patch.cables}
          delayed={delayed}
          folded={folded}
          swing={swing}
          jiggle={moduleDrag ? { module: moduleDrag.id, angle: jiggle.angle } : undefined}
          disconnect={unplug}
        />

        <CableEvaporations
          items={evaporations}
          finished={(id) =>
            setEvaporations((current) => current.filter((item) => item.id !== id))
          }
        />

        {visibleArmed && (
          <circle className="rk-armed-halo" cx={visibleArmed.x} cy={visibleArmed.y} r="15" />
        )}

        {cableDrag && (
          <path
            className="rk-cable-line rk-cable-live"
            d={cablePath(
              jackAt(all, cableDrag.from.module, cableDrag.from.port, cableDrag.from.kind) ??
              cableDrag.at,
              cableDrag.at,
            )}
          />
        )}

        {renderedJacks.map((jack) => (
          <g
            // Kind included: a port id is unique down one column, not across both, and `Arp` has
            // `pitch` on each side. Keyed on the pair alone, React saw two children claiming one key.
            key={`${jack.kind}:${jack.module}.${jack.port}`}
            className={[
              'rk-jack',
              jack.kind === 'in' ? 'rk-jack-in' : 'rk-jack-out',
              // One jack, two channels. Drawn with a second ring rather than a second hole, because it is
              // one connection: a stereo cable is dragged, snapped and pulled out exactly like a mono one.
              jack.stereo ? 'rk-jack-stereo' : '',
              // The jack a release would land on, highlighted. Feedback rather than decoration: with
              // snapping, where the cable ends is not always exactly where the pointer is, and on a
              // touchscreen the finger is covering the answer.
              over && over.module === jack.module && over.port === jack.port && over.kind === jack.kind
                ? 'rk-jack-over'
                : '',
              armed &&
              armed.module === jack.module &&
              armed.port === jack.port &&
              armed.kind === jack.kind
                ? 'rk-jack-armed'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
            tabIndex={0}
            role="button"
            aria-label={`${jack.module} ${jack.name} ${jack.stereo ? 'stereo ' : ''}${jack.kind === 'in' ? 'input' : 'output'}${
              armed ? `, press Enter to patch from ${armed.module} ${armed.name}` : ''
            }`}
            onKeyDown={(event) => onJackKey(event, jack)}
            onPointerDown={(event) => {
              event.stopPropagation()
              // Capture to the SVG, not to the jack. Everything after this — every move and the release —
              // then arrives at one element with usable coordinates, which is what makes the drag behave
              // the same for a mouse and a finger.
              surface.current?.setPointerCapture(event.pointerId)
              setCableDrag({ from: jack, at: { x: jack.x, y: jack.y } })
            }}
          >
            {/* An invisible target wider than the jack it sits on. A 10px ring is fine for a mouse and
                hopeless for a thumb, and the drag has to start reliably or patching feels broken. */}
            <circle className="rk-jack-hit" cx={jack.x} cy={jack.y} r="16" />
            <circle className="rk-jack-ring" cx={jack.x} cy={jack.y} r="10" />
            {jack.stereo && (
              <circle className="rk-jack-collar" cx={jack.x} cy={jack.y} r="13.5" />
            )}
            <circle className="rk-jack-hole" cx={jack.x} cy={jack.y} r="4" />
            <text
              className="rk-jack-label"
              x={jack.kind === 'in' ? jack.x + 16 : jack.x - 16}
              y={jack.y + 4}
              textAnchor={jack.kind === 'in' ? 'start' : 'end'}
            >
              {jack.name}
            </text>
            <title>{`${jack.module}.${jack.port} ${jack.kind}`}</title>
          </g>
        ))}

        {renderedJacks
          .filter((jack) => jack.kind === 'in')
          .map((jack) => (
            <InputTrim
              key={`trim:${jack.module}.${jack.port}`}
              jack={jack}
              value={inputTrimValue(jack.module, jack.port)}
              onChange={(value) => setInputTrim(jack.module, jack.port, value)}
            />
          ))}

        <CableUnplugs all={visibleJacks} cables={patch.cables} disconnect={unplug} />
      </svg>
    </div>
  )
}

export type { PatchCable }
