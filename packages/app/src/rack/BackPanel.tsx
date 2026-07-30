import { MODULES, type PatchCable } from '@driftbox/rack'
import { useCallback, useMemo, useRef, useState } from 'react'
import { cableMiddle, cablePath, type Point } from './cable.js'
import { jackAt, jacks, type Layout } from './layout.js'
import { useRack } from './store.js'

// The back of the rack. Jacks, and cables hanging between them.
//
// Everything here is laid out from the def rather than by hand, for every module without exception —
// including one whose front panel is hand-built, and including one this build has never heard of. That
// is what makes cables work universally, and it is the reason `faceplates/index.ts` only has an escape
// hatch for the front.
//
// The cables are an SVG in the same coordinate space as the modules, so nothing has to be measured and
// a resize is a CSS problem rather than a recalculation.

interface Props {
  layout: Layout
}

/** A cable being dragged, before it lands anywhere. */
interface Dragging {
  from: { module: string; port: string; kind: 'in' | 'out' }
  at: Point
}

export function BackPanel({ layout }: Props) {
  const patch = useRack((s) => s.patch)
  const connect = useRack((s) => s.connect)
  const disconnect = useRack((s) => s.disconnect)
  const notes = useRack((s) => s.notes)

  const all = useMemo(() => jacks(layout.placements, MODULES), [layout])
  const [dragging, setDragging] = useState<Dragging | null>(null)
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

  const finish = useCallback(
    (target?: { module: string; port: string; kind: 'in' | 'out' }) => {
      const drag = dragging
      setDragging(null)
      if (!drag || !target) return
      // A cable has one end in an outlet and one in an inlet, and it does not matter which was dragged
      // first — pulling from an input to an output is how anybody who has used a real rack does it half
      // the time.
      if (drag.from.kind === target.kind) return
      const [out, into] = drag.from.kind === 'out' ? [drag.from, target] : [target, drag.from]
      connect([out.module, out.port], [into.module, into.port])
    },
    [dragging, connect],
  )

  const delayed = new Set(
    notes.filter((note) => note.kind === 'delayed').map((note) => note.module),
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
        onPointerUp={() => finish()}
        onPointerLeave={() => finish()}
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

        {patch.cables.map((cable) => {
          const from = jackAt(all, cable.from[0], cable.from[1])
          const to = jackAt(all, cable.to[0], cable.to[1])
          if (!from || !to) return null
          const key = `${cable.from.join('.')}>${cable.to.join('.')}`
          // A cable the compiler had to delay to break a cycle is drawn differently. A patch that
          // behaves unlike its picture is worse than one that admits it — the compiler reports these
          // for exactly this purpose.
          const isDelayed = delayed.has(cable.to[0])
          const grab = cableMiddle(from, to)

          return (
            <g key={key} className={isDelayed ? 'rk-cable rk-cable-delayed' : 'rk-cable'}>
              <path className="rk-cable-shadow" d={cablePath(from, to)} />
              <path className="rk-cable-line" d={cablePath(from, to)} />
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
            </g>
          )
        })}

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
            className={jack.kind === 'in' ? 'rk-jack rk-jack-in' : 'rk-jack rk-jack-out'}
            onPointerDown={(event) => {
              event.stopPropagation()
              setDragging({ from: jack, at: { x: jack.x, y: jack.y } })
            }}
            onPointerUp={(event) => {
              event.stopPropagation()
              finish(jack)
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
