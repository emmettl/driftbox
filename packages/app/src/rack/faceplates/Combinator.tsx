import { COMBI_CONTROLS, COMBI_ROTARY_MAX, MODULES } from '@driftbox/rack'
import { Knob } from '../../ui/Knob.js'
import { useRack } from '../store.js'
import { bindingsFor, describeBinding } from '../cc.js'
import type { FaceplateProps } from './types.js'

// Reason's Combinator front panel: four rotaries, four buttons, and a way through to what they drive.
//
// Hand-built for the reason the registry's escape hatch exists at all — the generic faceplate would draw
// eight controls in a grid and be *correct*, and it would say nothing about the only question anybody has
// about a Combinator, which is **what does this rotary do?** A macro control whose destinations are
// invisible is a knob you are afraid to turn.
//
// So each rotary carries the count of what it drives, and the panel opens onto the routing list. This is
// the third faceplate to reach into the store, and the reason is the same one the Sampler and the MIDI
// module have: what it needs to show is not a param of its own.
//
// **A routed knob elsewhere in the rack is marked, not disabled.** Reason lets you grab one too, and the
// routing simply takes it back on the next gesture. Disabling would be defensible and is worse: it makes a
// perfectly good control dead, and it hides the fact that the routing is what moved it.
//
// **Each rotary also carries its MIDI learn chip**, and that is what finishes the device. A Combinator is a
// performance idea — one gesture moving a dozen parameters — and performing it with a mouse is one gesture
// at a time. The chip is three states in one control because there is only room for one: it says `learn`,
// then `turn one…` while armed, then the controller it was taught. Shift-click forgets, which needs a way
// in or a mistaken binding is permanent — re-learning cannot unbind. See `cc.ts`.

export function Combinator({ def, module, value, onChange }: FaceplateProps) {
  const routes = useRack((s) => s.patch.modulation)
  const modules = useRack((s) => s.patch.modules)
  const cables = useRack((s) => s.patch.cables)
  const editing = useRack((s) => s.editingRoutes)
  const editRoutes = useRack((s) => s.editRoutes)
  // Selected as the array, filtered below. A selector that builds a new object every call hands zustand a
  // different snapshot each render and loops for ever — this app has had that bug once already.
  const ccBindings = useRack((s) => s.ccBindings)
  const ccLearning = useRack((s) => s.ccLearning)
  const startCcLearn = useRack((s) => s.startCcLearn)
  const cancelCcLearn = useRack((s) => s.cancelCcLearn)
  const clearCcBinding = useRack((s) => s.clearCcBinding)

  const param = (id: string) => def.params.find((p) => p.id === id)!
  const open = editing === module.id

  const bound = bindingsFor(ccBindings, module.id)
  const arming = (id: string) => ccLearning?.module === module.id && ccLearning.param === id
  /**
   * Arm a control, or disarm it, or forget what it learned.
   *
   * One control does all three because there is only room for one, and the states are mutually exclusive:
   * shift-click forgets, a click on an armed control disarms, anything else arms. Forgetting needs a way in
   * or a mistaken binding is permanent, and re-learning is not the same thing — it cannot unbind.
   */
  const onLearn = (id: string, forget: boolean) => {
    if (forget) {
      clearCcBinding(module.id, id)
      return
    }
    if (arming(id)) cancelCcLearn()
    else startCcLearn(module.id, id)
  }

  const mine = (routes ?? []).filter((route) => route.from[0] === module.id)

  /** How many parameters this control drives. The only thing a rotary can say about itself. */
  const drives = (controlId: string) => mine.filter((route) => route.from[1] === controlId).length

  /**
   * Whether a *cable* leaves this control, which is the other half of what it can be doing.
   *
   * Without it a rotary patched to a filter's CV inlet and routed at nothing reads as "—", which is a
   * faceplate saying a live control does nothing. Every control here has an outlet of the same id, so the
   * two are the same lookup.
   */
  const patched = (controlId: string) =>
    cables.some((cable) => cable.from[0] === module.id && cable.from[1] === controlId)

  /** What a control is doing, in four characters. Routings counted, a cable acknowledged, both said. */
  const doing = (controlId: string) => {
    const count = drives(controlId)
    const wired = patched(controlId)
    if (count > 0) return wired ? `→ ${count} +` : `→ ${count}`
    return wired ? 'patched' : '—'
  }

  /**
   * `ladder-1 · Cutoff` for a routing's destination, in the words the target's own faceplate uses.
   *
   * Reason's Combinator has a strip under each rotary you write the destination on by hand. This is that,
   * filled in automatically — which is better, because a hand-written label is wrong the moment the routing
   * changes and this one cannot be.
   */
  const describe = (to: readonly [string, string]) => {
    const target = modules.find((candidate) => candidate.id === to[0])
    const name = target ? MODULES[target.type]?.params.find((p) => p.id === to[1])?.name : undefined
    return `${to[0]} · ${name ?? to[1]}`
  }

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Combinator</span>
        <span className="rk-ports">
          {mine.length === 0 ? 'no routing' : `${mine.length} routing${mine.length === 1 ? '' : 's'}`}
        </span>
      </header>

      <div className="rk-combi">
        <div className="rk-combi-row">
          {Array.from({ length: COMBI_CONTROLS }, (_, index) => {
            const id = `rotary${index + 1}`
            const live = drives(id) > 0 || patched(id)
            return (
              <div key={id} className="rk-combi-control">
                {/* The app's Knob rather than a ParamControl, because a rotary is the one control here
                    whose range is not worth showing: 0..127 is a MIDI number, and what matters is how far
                    round it is. So it is formatted as a percentage and labelled by what it drives. */}
                <Knob
                  label={`Rotary ${index + 1}`}
                  value={value(id) / COMBI_ROTARY_MAX}
                  colour="var(--three)"
                  onChange={(next) => onChange(id, Math.round(next * COMBI_ROTARY_MAX))}
                  format={() => `${Math.round((value(id) / COMBI_ROTARY_MAX) * 100)}%`}
                />
                <span className="rk-combi-count" data-wired={live ? 'yes' : 'no'}>
                  {doing(id)}
                </span>
                <button
                  type="button"
                  className="rk-combi-cc"
                  data-state={arming(id) ? 'arming' : bound.has(id) ? 'bound' : 'free'}
                  aria-pressed={arming(id)}
                  title={
                    bound.has(id)
                      ? `${describeBinding(bound.get(id)!)} — click to relearn, shift-click to forget`
                      : 'Click, then turn a knob on your controller'
                  }
                  onClick={(event) => onLearn(id, event.shiftKey)}
                >
                  {arming(id) ? 'turn one…' : bound.has(id) ? describeBinding(bound.get(id)!) : 'learn'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="rk-combi-row rk-combi-buttons">
          {Array.from({ length: COMBI_CONTROLS }, (_, index) => {
            const id = `button${index + 1}`
            const on = Math.round(value(id)) === 1
            const count = drives(id)
            const live = count > 0 || patched(id)
            return (
              <button
                key={id}
                type="button"
                className={on ? 'rk-combi-button rk-combi-button-on' : 'rk-combi-button'}
                aria-pressed={on}
                // The def already names these "Button 1"; the visible label is the number alone, because
                // four cells wide is not enough for the word and the group is unmistakable.
                aria-label={param(id).name}
                title={
                  count === 0
                    ? patched(id)
                      ? 'Patched, but not routed to any parameter'
                      : 'Not routed to anything yet'
                    : `Drives ${count} parameter${count === 1 ? '' : 's'}`
                }
                onClick={() => onChange(id, on ? 0 : 1)}
              >
                <span>{index + 1}</span>
                {live && <span className="rk-combi-dot" />}
              </button>
            )
          })}
        </div>

        {/* The programmer strip: what each control is currently wired to, in full.
            It also fills the module. A Combinator is five rows tall because it has eight jacks on the
            back, and its controls only need three — leaving exactly the "two knobs and 90px of nothing
            under them" hole `layout.ts` records having to fix once already. Filling it with the one thing
            a macro panel cannot otherwise say is a better answer than shrinking the module. */}
        <ul className="rk-combi-map">
          {mine.length === 0 && (
            <li className="rk-combi-empty">Nothing routed — open Modulation to wire a rotary up.</li>
          )}
          {mine.map((route, index) => (
            <li key={index}>
              <span className="rk-combi-src">
                {/* "R1" and "B1" rather than the full name: four characters is what fits, and the group is
                    unmistakable next to the knobs they name. */}
                {route.from[1].startsWith('button')
                  ? `B${route.from[1].slice(6)}`
                  : `R${route.from[1].slice(6)}`}
              </span>
              <span className="rk-combi-dest">{describe(route.to)}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="rk-combi-open"
          aria-expanded={open}
          // Toggling rather than only opening, so the same control closes it — and it is the only way back
          // out on a touchscreen where the panel covers the rack.
          onClick={() => editRoutes(open ? null : module.id)}
        >
          {open ? 'Close routing' : 'Modulation…'}
        </button>
      </div>
    </>
  )
}
