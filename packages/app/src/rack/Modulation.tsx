import { COMBI_CONTROLS, MODULES, routeValue, sourcePosition, type ModRoute } from '@driftbox/rack'
import { useEffect } from 'react'
import { useRack } from './store.js'

// The Combinator's routing list: which control moves which knob, and between what.
//
// **In a panel rather than on the back of the rack**, which is where Reason puts it, and the reason is
// worth writing down because the back panel was the obvious place. `BackPanel.tsx` is one SVG in design
// units — that is what lets cables be drawn without measuring the DOM and tested without a browser — and a
// routing list is text, selects and number fields. Putting it there means `foreignObject`, which is the
// one part of SVG that browsers disagree about, and a module whose height depends on how many routings it
// has, which is exactly the height-arithmetic trap `faceplates/index.ts` records having fallen into once
// already.
//
// The panel is better on its own terms as well. Routings are the one thing in this rack you edit by
// reading rather than by dragging, and it works on a phone, where the back of a rack does not.
//
// **Source, target, min, max — and no more.** That is Reason's row exactly. Everything anybody wanted to
// add to it (a curve, a scale, a second source) is a thing the rack can already do with a cable and an
// Offset, and the Combinator's value is that it is the simple one.

/** Params a routing may aim at: anything visible. Hidden params are written by the host — the MIDI
 *  module's note — and a routing at one would be a second writer, which `applyModulation` refuses. */
const targetsOf = (type: string) => (MODULES[type]?.params ?? []).filter((param) => !param.hidden)

export function Modulation() {
  const patch = useRack((s) => s.patch)
  const editing = useRack((s) => s.editingRoutes)
  const editRoutes = useRack((s) => s.editRoutes)
  const addRoute = useRack((s) => s.addRoute)
  const setRoute = useRack((s) => s.setRoute)
  const removeRoute = useRack((s) => s.removeRoute)

  const combi = patch.modules.find((module) => module.id === editing)

  // A Combinator can be deleted, or a whole patch loaded, while its panel is open. Closing on the way past
  // rather than rendering nothing: leaving `editingRoutes` pointing at a module that is gone would reopen
  // the panel the moment somebody added a module with the same id back.
  useEffect(() => {
    if (editing && !combi) editRoutes(null)
  }, [editing, combi, editRoutes])

  if (!combi) return null

  const def = MODULES[combi.type]
  const controls = def?.params.filter((param) => !param.hidden) ?? []

  /** Every routing in the patch, with the index the store addresses it by, narrowed to this Combinator. */
  const rows = (patch.modulation ?? [])
    .map((route, index) => ({ route, index }))
    .filter((entry) => entry.route.from[0] === combi.id)

  /**
   * Somewhere sensible for a new routing to point.
   *
   * A filter cutoff if there is one, because that is what nine out of ten first routings are for and
   * landing on it means the first turn of the rotary does something obviously musical. Otherwise the first
   * routable param of the first other module — anything but nothing, because a routing panel whose "add"
   * button produces an empty row teaches nobody what a routing is.
   */
  const defaultTarget = (): [string, string] | null => {
    for (const wanted of ['cutoff', 'freq', 'gain', 'level']) {
      for (const module of patch.modules) {
        if (module.id === combi.id) continue
        if (targetsOf(module.type).some((param) => param.id === wanted)) return [module.id, wanted]
      }
    }
    for (const module of patch.modules) {
      if (module.id === combi.id) continue
      const first = targetsOf(module.type)[0]
      if (first) return [module.id, first.id]
    }
    return null
  }

  const target = (route: ModRoute) => {
    const module = patch.modules.find((candidate) => candidate.id === route.to[0])
    const param = module ? targetsOf(module.type).find((p) => p.id === route.to[1]) : undefined
    return { module, param }
  }

  return (
    <div className="rk-mod" role="group" aria-label={`Modulation routing for ${combi.id}`}>
      <div className="rk-mod-head">
        <strong>Modulation routing</strong>
        <span className="rk-hint">{combi.id}</span>
        <button type="button" onClick={() => editRoutes(null)} aria-label="Close routing">
          ✕
        </button>
      </div>

      {rows.length === 0 && (
        <p className="rk-hint">
          Nothing routed yet. A routing points one rotary or button at one knob anywhere in the rack — the
          knob then moves when the rotary does, between the two ends you set here.
        </p>
      )}

      {rows.length > 0 && (
        <div className="rk-mod-rows">
          <span className="rk-mod-label">Source</span>
          <span className="rk-mod-label">Target</span>
          <span className="rk-mod-label">Min</span>
          <span className="rk-mod-label">Max</span>
          <span />

          {rows.map(({ route, index }) => {
            const { module, param } = target(route)
            // What this routing is putting on its target right now. Live rather than computed on save,
            // because seeing the number move as the rotary turns is what makes min and max legible — and
            // it is the same arithmetic the audio thread will get, from the same function.
            const position = sourcePosition(patch, MODULES, route.from)
            const now = param && position !== null ? routeValue(route, position, param) : null

            return (
              // `display: contents` comes from the stylesheet rather than from here, so the narrow-screen
              // media query can turn it off. Inline, it wins over any rule and the phone layout could not
              // stop the five cells of each row flowing into a two-column grid — which interleaved the
              // rows, putting one routing's source next to the previous one's maximum.
              <div key={index} className="rk-mod-row">
                <select
                  aria-label={`Routing ${index + 1} source`}
                  value={route.from[1]}
                  onChange={(event) => setRoute(index, { from: [combi.id, event.target.value] })}
                >
                  {controls.map((control) => (
                    <option key={control.id} value={control.id}>
                      {control.name}
                    </option>
                  ))}
                </select>

                <span className="rk-mod-target">
                  <select
                    aria-label={`Routing ${index + 1} target module`}
                    value={route.to[0]}
                    onChange={(event) => {
                      // Changing the module has to change the param too: the old param id almost certainly
                      // does not exist on the new module, and a routing pointing at nothing is silently
                      // inert. Landing on the new module's first param is at least honest.
                      const first = targetsOf(
                        patch.modules.find((m) => m.id === event.target.value)?.type ?? '',
                      )[0]
                      setRoute(index, {
                        to: [event.target.value, first?.id ?? route.to[1]],
                        // The old range was in the old param's units — a cutoff's 8000 is nonsense on a
                        // resonance knob. Cleared, so the new routing sweeps its target end to end.
                        min: undefined,
                        max: undefined,
                      })
                    }}
                  >
                    {patch.modules
                      .filter((candidate) => targetsOf(candidate.type).length > 0)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.id}
                        </option>
                      ))}
                    {/* A target this build cannot resolve — a param from a newer version of a module, or a
                        placeholder. Kept and shown rather than silently retargeted; the patch keeps it too. */}
                    {!module && <option value={route.to[0]}>{route.to[0]} (not here)</option>}
                  </select>

                  <select
                    aria-label={`Routing ${index + 1} target parameter`}
                    value={route.to[1]}
                    onChange={(event) =>
                      setRoute(index, {
                        to: [route.to[0], event.target.value],
                        min: undefined,
                        max: undefined,
                      })
                    }
                  >
                    {module &&
                      targetsOf(module.type).map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    {!param && <option value={route.to[1]}>{route.to[1]} (unknown)</option>}
                  </select>
                </span>

                {/* Placeholder text rather than a value, when an end is absent: absence means "the target's
                    own limit", and writing the number in would freeze it against a module that later
                    widened its range. */}
                <input
                  type="number"
                  aria-label={`Routing ${index + 1} minimum`}
                  className="rk-mod-end"
                  value={route.min ?? ''}
                  placeholder={param ? String(round(param.min)) : ''}
                  onChange={(event) =>
                    setRoute(index, { min: event.target.value === '' ? undefined : Number(event.target.value) })
                  }
                />
                <input
                  type="number"
                  aria-label={`Routing ${index + 1} maximum`}
                  className="rk-mod-end"
                  value={route.max ?? ''}
                  placeholder={param ? String(round(param.max)) : ''}
                  onChange={(event) =>
                    setRoute(index, { max: event.target.value === '' ? undefined : Number(event.target.value) })
                  }
                />

                <span className="rk-mod-tail">
                  <span className="rk-mod-now" title="What this routing is putting on its target right now">
                    {now === null ? '—' : round(now)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove routing ${index + 1}`}
                    onClick={() => removeRoute(index)}
                  >
                    ✕
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="rk-mod-foot">
        <button
          type="button"
          className="rk-primary"
          disabled={!defaultTarget()}
          title={
            defaultTarget()
              ? undefined
              : 'Nothing else in the rack has a knob to drive — add a module first'
          }
          onClick={() => {
            const to = defaultTarget()
            // The first free control, so pressing Add four times gives four different rotaries rather than
            // four routings stacked on one — which would silently fight, last-wins, and look broken.
            const used = new Set(rows.map((entry) => entry.route.from[1]))
            const free =
              controls.find((control) => !used.has(control.id))?.id ??
              controls[0]?.id ??
              'rotary1'
            if (to) addRoute([combi.id, free], to)
          }}
        >
          Add routing
        </button>
        <span className="rk-hint">
          {COMBI_CONTROLS} rotaries and {COMBI_CONTROLS} buttons · a later routing wins a shared target
        </span>
      </div>
    </div>
  )
}

/** Enough digits to be useful and few enough to fit the column. A cutoff is whole numbers; a resonance is
 *  not, and showing 0.72 as 1 would make the panel look broken. */
const round = (value: number): number =>
  Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100
