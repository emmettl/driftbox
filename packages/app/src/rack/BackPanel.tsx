import { MODULES, type PatchCable } from '@driftbox/rack'
import { useCallback, useMemo, useRef, useState } from 'react'
import { cableMiddle, cablePath, swingAngle, swingSeed, type Point } from './cable.js'
import { SNAP, type Jack, jackAt, jacks, nearestJack, type Layout } from './layout.js'
import { useRack } from './store.js'
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
  swing: ReturnType<typeof useSwing>
  disconnect?: (cable: PatchCable) => void
}

/** The drawn leads, kept separate from the panel furniture so their geometry has one implementation. */
export function CablePaths({ all, cables, delayed, swing, disconnect }: CablePathsProps) {
  return cables.map((cable) => {
    const from = jackAt(all, cable.from[0], cable.from[1])
    const to = jackAt(all, cable.to[0], cable.to[1])
    if (!from || !to) return null
    const key = `${cable.from.join('.')}>${cable.to.join('.')}`
    const isDelayed = delayed.has(cable.to[0])
    const angle =
      swing.elapsed === null
        ? 0
        : swingAngle(swing.elapsed, from, to, swing.direction, swingSeed(key))
    const grab = cableMiddle(from, to, angle)
    const d = cablePath(from, to, angle)

    return (
      <g key={key} className={isDelayed ? 'rk-cable rk-cable-delayed' : 'rk-cable'}>
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
            <title>{`${cable.from.join('.')} → ${cable.to.join('.')} — click to unpatch`}</title>
          </circle>
        )}
      </g>
    )
  })
}

/** A cable being dragged, before it lands anywhere. */
interface Dragging {
  from: Jack
  at: Point
}

export function BackPanel({ layout }: Props) {
  const patch = useRack((s) => s.patch)
  const connect = useRack((s) => s.connect)
  const disconnect = useRack((s) => s.disconnect)
  const notes = useRack((s) => s.notes)
  const flipped = useRack((s) => s.flipped)

  /** How long ago the rack was spun, and which way. Null between flips, and the cables hang still. */
  const swing = useSwing(flipped)

  const all = useMemo(() => jacks(layout.placements, MODULES), [layout])
  const [dragging, setDragging] = useState<Dragging | null>(null)
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
    (drag: Dragging | null, at: Point) =>
      drag ? nearestJack(all, at, SNAP, drag.from.kind === 'out' ? 'in' : 'out') : undefined,
    [all],
  )

  const finish = useCallback(
    (at?: Point) => {
      const drag = dragging
      setDragging(null)
      if (!drag || !at) return
      const target = dropTarget(drag, at)
      if (!target) return
      // A cable has one end in an outlet and one in an inlet, and it does not matter which was dragged
      // first — pulling from an input to an output is how anybody who has used a real rack does it half
      // the time.
      joinRef.current(drag.from, target)
    },
    [dragging, dropTarget],
  )

  const over = dragging ? dropTarget(dragging, dragging.at) : undefined

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
        const attached = patch.cables.find(
          (cable) =>
            (cable.to[0] === jack.module && cable.to[1] === jack.port) ||
            (cable.from[0] === jack.module && cable.from[1] === jack.port),
        )
        if (attached) {
          event.preventDefault()
          disconnect(attached)
        }
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (!armed) {
        setArmed(jack)
        return
      }
      if (armed.module === jack.module && armed.port === jack.port) {
        setArmed(null)
        return
      }
      if (join(armed, jack)) setArmed(null)
    },
    [armed, join, patch.cables, disconnect],
  )

  const delayed = new Set(
    notes.flatMap((note) => (note.kind === 'delayed' && note.module ? [note.module] : [])),
  )

  return (
    <div className="rk-back" data-dragging={dragging ? `${dragging.from.module}.${dragging.from.port}` : ''}>
      <svg
        ref={surface}
        className="rk-wires"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        onPointerMove={(event) => {
          if (dragging) setDragging({ ...dragging, at: toDesign(event) })
        }}
        onPointerUp={(event) => finish(toDesign(event))}
        // Not onPointerLeave: with the pointer captured to this element the cable can be dragged outside
        // it and back, and cancelling on leave made a drag that strayed over the header die silently.
        onPointerCancel={() => finish()}
      >
        {/* The panel itself: one rectangle per module, so the back has the same divisions as the front
            and it is obvious which jacks belong to which module. */}
        {layout.placements.map((placement) => (
          <rect
            key={placement.id}
            className="rk-bay"
            x={placement.x + 4}
            y={placement.y + 4}
            width={placement.width - 8}
            height={placement.height - 8}
            rx="10"
          />
        ))}

        {/* A cable the compiler had to delay to break a cycle is drawn differently. A patch that
            behaves unlike its picture is worse than one that admits it — the compiler reports these
            for exactly this purpose. */}
        <CablePaths
          all={all}
          cables={patch.cables}
          delayed={delayed}
          swing={swing}
          disconnect={disconnect}
        />

        {armed && (
          <circle className="rk-armed-halo" cx={armed.x} cy={armed.y} r="15" />
        )}

        {dragging && (
          <path
            className="rk-cable-line rk-cable-live"
            d={cablePath(
              jackAt(all, dragging.from.module, dragging.from.port) ?? dragging.at,
              dragging.at,
            )}
          />
        )}

        {all.map((jack) => (
          <g
            key={`${jack.module}.${jack.port}`}
            className={[
              'rk-jack',
              jack.kind === 'in' ? 'rk-jack-in' : 'rk-jack-out',
              // The jack a release would land on, highlighted. Feedback rather than decoration: with
              // snapping, where the cable ends is not always exactly where the pointer is, and on a
              // touchscreen the finger is covering the answer.
              over && over.module === jack.module && over.port === jack.port ? 'rk-jack-over' : '',
              armed && armed.module === jack.module && armed.port === jack.port ? 'rk-jack-armed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            tabIndex={0}
            role="button"
            aria-label={`${jack.module} ${jack.name} ${jack.kind === 'in' ? 'input' : 'output'}${
              armed ? `, press Enter to patch from ${armed.module} ${armed.name}` : ''
            }`}
            onKeyDown={(event) => onJackKey(event, jack)}
            onPointerDown={(event) => {
              event.stopPropagation()
              // Capture to the SVG, not to the jack. Everything after this — every move and the release —
              // then arrives at one element with usable coordinates, which is what makes the drag behave
              // the same for a mouse and a finger.
              surface.current?.setPointerCapture(event.pointerId)
              setDragging({ from: jack, at: { x: jack.x, y: jack.y } })
            }}
          >
            {/* An invisible target wider than the jack it sits on. A 10px ring is fine for a mouse and
                hopeless for a thumb, and the drag has to start reliably or patching feels broken. */}
            <circle className="rk-jack-hit" cx={jack.x} cy={jack.y} r="16" />
            <circle className="rk-jack-ring" cx={jack.x} cy={jack.y} r="10" />
            <circle className="rk-jack-hole" cx={jack.x} cy={jack.y} r="4" />
            <text
              className="rk-jack-label"
              x={jack.kind === 'in' ? jack.x + 16 : jack.x - 16}
              y={jack.y + 4}
              textAnchor={jack.kind === 'in' ? 'start' : 'end'}
            >
              {jack.name}
            </text>
            <title>{`${jack.module}.${jack.port}`}</title>
          </g>
        ))}
      </svg>
    </div>
  )
}

export type { PatchCable }
