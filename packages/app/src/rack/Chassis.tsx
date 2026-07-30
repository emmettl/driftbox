import { MODULES, routedParams } from '@driftbox/rack'
import { faceplateFor } from './faceplates/index.js'
import { dropIndex, type Layout } from './layout.js'
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

export function Chassis({ layout }: Props) {
  const patch = useRack((s) => s.patch)
  const selected = useRack((s) => s.selected)
  const select = useRack((s) => s.select)
  const setParam = useRack((s) => s.setParam)
  const paramValue = useRack((s) => s.paramValue)
  const removeModule = useRack((s) => s.removeModule)
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
  const [drag, setDrag] = useState<{ id: string; index: number } | null>(null)
  const surface = useRef<HTMLDivElement | null>(null)

  /** Pointer position in design units rather than screen pixels, so the drop lines up with the layout at
   *  any zoom. The same conversion the back panel does for cables, and for the same reason. */
  const toDesignY = useCallback((event: React.PointerEvent): number => {
    const box = surface.current?.getBoundingClientRect()
    if (!box || box.height === 0) return 0
    return ((event.clientY - box.top) / box.height) * layout.height
  }, [layout.height])


  // Which knobs a Combinator is driving. Derived once for the whole rack rather than per faceplate: it is
  // a fact about the patch, and asking each module to scan the routing list would be quadratic in a rack
  // that could have forty of them.
  const routed = useMemo(() => routedParams(patch), [patch])

  return (
    <div
      className="rk-face"
      ref={surface}
      data-dragging={drag ? drag.id : ''}
      onPointerMove={(event) => {
        if (!drag) return
        const index = dropIndex(layout.placements, toDesignY(event))
        if (index !== drag.index) setDrag({ ...drag, index })
      }}
      onPointerUp={(event) => {
        if (!drag) return
        dropModule(drag.id, dropIndex(layout.placements, toDesignY(event)))
        setDrag(null)
      }}
      // Not onPointerLeave: with the pointer captured the drag can stray outside and come back, and
      // cancelling on leave killed a cable drag that wandered over the header. Same lesson, same fix.
      onPointerCancel={() => setDrag(null)}
    >
      {/* Where it would land. A drag with no feedback is a guess, and this rack's rows are not all the
          same height — so "between these two" is genuinely not obvious from the pointer alone. Placed
          from the same numbers as everything else, so it cannot disagree with where the drop actually
          goes: both read `dropIndex` against `layout.placements`. */}
      {drag && drag.index >= 0 && (
        <div
          className="rk-drop"
          style={{
            top:
              drag.index >= layout.placements.length
                ? layout.height
                : layout.placements[drag.index].y,
          }}
        />
      )}
      {layout.placements.map((placement) => {
        const module = patch.modules.find((m) => m.id === placement.id)
        const def = MODULES[placement.type]
        if (!module) return null

        const Faceplate = faceplateFor(placement.type)
        const isSelected = selected === placement.id

        return (
          <section
            key={placement.id}
            className={isSelected ? 'rk-module rk-module-on' : 'rk-module'}
            data-span={placement.span}
            style={{
              left: placement.x,
              top: placement.y,
              width: placement.width,
              height: placement.height,
            }}
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
                event.stopPropagation()
                surface.current?.setPointerCapture(event.pointerId)
                select(placement.id)
                setDrag({ id: placement.id, index: -1 })
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

            {isSelected && (
              <div className="rk-module-tools">
                <button type="button" onClick={() => moveModule(placement.id, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" onClick={() => moveModule(placement.id, 1)} aria-label="Move down">
                  ↓
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
