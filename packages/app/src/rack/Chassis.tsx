import { MODULES, routedParams } from '@driftbox/rack'
import { faceplateFor, sizeFor } from './faceplates/index.js'
import {
  dragBounds,
  dropIndex,
  layout as rackLayout,
  reordered,
  type Layout,
  type ModuleDragGeometry,
} from './layout.js'
import { useRack } from './store.js'
import { useCallback, useMemo, useRef, useState } from 'react'

// The front of the rack: a vertical stack of faceplates, positioned from the layout.
//
// Absolute positioning from computed coordinates rather than flow layout, because the back panel has to
// line up with the front exactly — a jack has to sit behind the module it belongs to — and the only way
// to guarantee that is for both to be placed from the same numbers. See the comment at the top of
// `layout.ts`.

interface Props {
  layout: Layout
}

interface Point {
  x: number
  y: number
}

interface Dragging extends ModuleDragGeometry {
  index: number
}

export function Chassis({ layout }: Props) {
  const patch = useRack((s) => s.patch)
  const selected = useRack((s) => s.selected)
  const select = useRack((s) => s.select)
  const setParam = useRack((s) => s.setParam)
  const paramValue = useRack((s) => s.paramValue)
  const removeModule = useRack((s) => s.removeModule)
  const duplicateModule = useRack((s) => s.duplicateModule)
  const setBypassed = useRack((s) => s.setBypassed)
  const moveModule = useRack((s) => s.moveModule)
  const dropModule = useRack((s) => s.dropModule)

  /**
   * The module being dragged, and where it would land.
   *
   * **The handle is the title bar, not the whole module.** Dragging from anywhere would fight every knob
   * on the faceplate — a knob's own pointer handler captures the pointer, so the two would race, and the
   * one that lost would be whichever happened to be deeper in the tree. A title bar is also where a
   * person reaches for a thing they mean to move.
   */
  const [drag, setDrag] = useState<Dragging | null>(null)
  const surface = useRef<HTMLDivElement | null>(null)

  /** Pointer position in design units rather than screen pixels, so the preview lines up with the layout at
   *  any zoom. The same conversion the back panel does for cables, and for the same reason. */
  const toDesign = useCallback((event: React.PointerEvent): Point => {
    const box = surface.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - box.left) / box.width) * layout.width,
      y: ((event.clientY - box.top) / box.height) * layout.height,
    }
  }, [layout.height, layout.width])

  /**
   * The rack previews the proposed order underneath the lifted faceplate.
   *
   * The same pure layout function used by the committed rack produces this temporary geometry, so the
   * target slot cannot promise a horizontal pairing that the drop then fails to make. The real faceplate
   * is rendered separately at `drag.at`, continuously following the pointer instead of snapping between
   * these discrete slots.
   */
  const draggedId = drag?.id
  const draggedIndex = drag?.index
  const preview = useMemo(() => {
    if (!draggedId || draggedIndex === undefined || draggedIndex < 0) return layout
    const from = patch.modules.findIndex((module) => module.id === draggedId)
    const modules = reordered(patch.modules, from, draggedIndex)
    return modules === patch.modules ? layout : rackLayout(modules, sizeFor(MODULES))
    // Pointer coordinates deliberately are not dependencies: they move the ghost, not the proposed rack.
  }, [draggedId, draggedIndex, layout, patch.modules])

  // Which knobs a Combinator is driving. Derived once for the whole rack rather than per faceplate: it is
  // a fact about the patch, and asking each module to scan the routing list would be quadratic in a rack
  // that could have forty of them.
  const routed = useMemo(() => routedParams(patch), [patch])
  const ghostSlot = draggedId
    ? preview.placements.find((placement) => placement.id === draggedId)
    : undefined

  return (
    <div
      className="rk-face"
      ref={surface}
      data-dragging={drag ? drag.id : ''}
      onPointerMove={(event) => {
        if (!drag) return
        const at = toDesign(event)
        const index = dropIndex(layout.placements, at)
        setDrag({ ...drag, at, index })
      }}
      onPointerUp={(event) => {
        if (!drag) return
        dropModule(drag.id, dropIndex(layout.placements, toDesign(event)))
        // Safari can occasionally keep a native selection alive after a captured pointer crosses
        // faceplate text. The grip prevents that default below; clearing here is the last line of
        // defence for a selection the browser had already started before capture took effect.
        window.getSelection()?.removeAllRanges()
        setDrag(null)
      }}
      // Not onPointerLeave: with the pointer captured the drag can stray outside and come back, and
      // cancelling on leave killed a cable drag that wandered over the header. Same lesson, same fix.
      onPointerCancel={() => setDrag(null)}
    >
      {ghostSlot && (
        <div
          className="rk-drag-slot"
          aria-hidden="true"
          style={{
            left: ghostSlot.x,
            top: ghostSlot.y,
            width: ghostSlot.width,
            height: ghostSlot.height,
          }}
        />
      )}
      {preview.placements.map((placement) => {
        const module = patch.modules.find((m) => m.id === placement.id)
        const def = MODULES[placement.type]
        if (!module) return null

        const Faceplate = faceplateFor(placement.type)
        const isSelected = selected === placement.id
        const bounds = drag?.id === placement.id ? dragBounds(drag) : null
        const isGhost = bounds !== null
        const position = bounds
          ? {
              left: 0,
              top: 0,
              width: bounds.width,
              height: bounds.height,
              transform: `translate3d(${bounds.x}px, ${bounds.y}px, 0) scale(0.985)`,
            }
          : {
              left: placement.x,
              top: placement.y,
              width: placement.width,
              height: placement.height,
            }

        return (
          <section
            key={placement.id}
            className={[
              'rk-module',
              isSelected ? 'rk-module-on' : '',
              // Dimmed rather than hidden, and it keeps its knobs: a bypassed module is still a module you
              // are setting up, and half of why you bypass one is to compare it against itself.
              module.bypassed ? 'rk-module-bypassed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-span={placement.span}
            data-drag-ghost={isGhost ? 'true' : undefined}
            style={position}
            onPointerDown={() => select(placement.id)}
          >
            {/* The drag handle, over the faceplate's own title strip. A transparent overlay rather than
                asking every faceplate to wire one up: the registry's whole promise is that a module needs
                no UI work, and requiring a handle would have quietly broken the generic fallback. */}
            <div
              className="rk-grip"
              role="button"
              tabIndex={-1}
              aria-label={`Drag ${placement.id} to reorder`}
              title="Drag to reorder"
              onPointerDown={(event) => {
                // Text selection is a pointerdown default action. Cancel it before capture rather than
                // relying only on `user-select`: Safari can otherwise select the title beneath this
                // transparent grip while the faceplate is moving.
                event.preventDefault()
                event.stopPropagation()
                surface.current?.setPointerCapture(event.pointerId)
                select(placement.id)
                const at = toDesign(event)
                setDrag({
                  id: placement.id,
                  index: -1,
                  at,
                  grab: {
                    x: at.x - placement.x,
                    y: at.y - placement.y,
                  },
                  width: placement.width,
                  height: placement.height,
                })
              }}
            />
            {def ? (
              <Faceplate
                def={def}
                module={module}
                value={(paramId) => paramValue(placement.id, paramId)}
                onChange={(paramId, value) => setParam(placement.id, paramId, value)}
                routed={(paramId) => routed.get(placement.id)?.has(paramId) ?? false}
              />
            ) : (
              // A module type this build does not have. The patch keeps it and the compiler keeps it as
              // a placeholder that reads as silence — so the faceplate says so rather than pretending
              // the module is missing, because saving over it would destroy somebody's patch.
              <div className="rk-unknown">
                {/* A type imported from VCV Rack carries where it came from — `vcv:Bogaudio/Wavefolder` — so it
                    reads as "a Rack module we do not have" rather than as a corrupt patch. Shown split up,
                    because the raw slug uppercased by the title style is unreadable. */}
                <span className="rk-name">
                  {module.type.startsWith('vcv:') ? module.type.slice(4).split('/').pop() : module.type}
                </span>
                <span className="rk-ports">
                  {module.type.startsWith('vcv:')
                    ? `${module.type.slice(4).split('/')[0]} · from VCV Rack, not played`
                    : 'not in this build — kept, not played'}
                </span>
              </div>
            )}

            {module.bypassed && <span className="rk-bypass-flag">bypassed</span>}

            {isSelected && (
              <div className="rk-module-tools">
                <button type="button" onClick={() => moveModule(placement.id, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" onClick={() => moveModule(placement.id, 1)} aria-label="Move down">
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setBypassed(placement.id, !module.bypassed)}
                  aria-label="Bypass"
                  aria-pressed={module.bypassed === true}
                  title="Bypass — out of circuit, its input passed straight through"
                >
                  ⏻
                </button>
                {/* Next to Remove rather than next to the arrows: both of these change what is in the
                    rack, while the arrows only change where it sits. */}
                <button
                  type="button"
                  onClick={() => duplicateModule(placement.id)}
                  aria-label="Duplicate"
                  title="Duplicate — a copy with the same settings, unpatched"
                >
                  ⧉
                </button>
                <button type="button" onClick={() => removeModule(placement.id)} aria-label="Remove">
                  ✕
                </button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
