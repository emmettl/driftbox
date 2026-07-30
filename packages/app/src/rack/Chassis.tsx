import { MODULES } from '@driftbox/rack'
import { faceplateFor } from './faceplates/index.js'
import type { Layout } from './layout.js'
import { useRack } from './store.js'

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

  return (
    <div className="rk-face">
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
            {def ? (
              <Faceplate
                def={def}
                module={module}
                value={(paramId) => paramValue(placement.id, paramId)}
                onChange={(paramId, value) => setParam(placement.id, paramId, value)}
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
