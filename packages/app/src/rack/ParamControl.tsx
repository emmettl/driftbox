import type { ParamDef } from '@driftbox/rack'
import { Knob } from '../ui/Knob.js'

// A control for one param, whatever kind of param it is.
//
// The app's `Knob` is reused rather than reimplemented — it already has the vertical-drag behaviour,
// the shift-for-fine gesture, the keyboard handling and the ARIA slider role, and a second knob that
// felt different from the first one would be worse than no second knob. What it does not have is any
// notion of a range: it is 0..1 in and 0..1 out, because every knob in the sequencer is. Rack params
// have real units — Hz, seconds, semitones — so this normalises on the way in and denormalises on the
// way out.
//
// A **stepped** param gets a different control entirely. A waveform selector is not a knob with three
// positions, it is a choice, and dragging vertically to pick between "saw" and "pulse" is a gesture
// nobody would guess at. `ParamDef.stepped` already exists to keep the audio thread from interpolating
// across the changeover, and it turns out to be exactly the right signal for this too — the same flag
// answers both questions because they are the same question.

interface Props {
  def: ParamDef
  value: number
  onChange: (value: number) => void
  colour?: string
  /** Overrides `def.labels`, for a hand-built faceplate that wants different words. Most do not — the
   *  def is the better place for them, because then the generic faceplate gets them too. */
  options?: readonly string[]
  /** Something other than this knob is driving it — a Combinator rotary, or a recorded lane playing back.
   *  Marked, never disabled — see `FaceplateProps.routed`. */
  routed?: boolean
}

export function ParamControl({ def, value, onChange, colour, options, routed }: Props) {
  const mark = routed
    ? { 'data-routed': 'yes', title: `${def.name} is driven by something other than this knob` }
    : undefined

  if (def.stepped) {
    const count = Math.round(def.max - def.min) + 1
    const names = options ?? def.labels
    const label = (index: number) => names?.[index] ?? String(def.min + index)
    const current = Math.max(0, Math.min(count - 1, Math.round(value) - def.min))

    // Up to three positions get buttons, because three named choices read instantly and a saw/pulse/tri
    // selector is the clearest control on the VCO. Past three they cannot fit a cell — the Quantizer's
    // root has twelve — and a control that changes the grid's width takes the height arithmetic with it.
    // So more than three becomes a stepper, which is the same size whether it has four positions or forty.
    if (count <= 3) {
      return (
        <div className="rk-select" {...mark}>
          <div className="rk-select-options" role="radiogroup" aria-label={def.name}>
            {Array.from({ length: count }, (_, index) => (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={index === current}
                className={index === current ? 'rk-option rk-option-on' : 'rk-option'}
                onClick={() => onChange(def.min + index)}
              >
                {label(index)}
              </button>
            ))}
          </div>
          <span className="rk-cell-label">{def.name}</span>
        </div>
      )
    }

    const step = (by: number) =>
      onChange(def.min + Math.max(0, Math.min(count - 1, current + by)))

    return (
      <div className="rk-select" {...mark}>
        {/* The value above the arrows rather than between them. Side by side, "Dorian" is wider than a
            cell and the Quantizer's two steppers overlapped each other — and a control that escapes its
            cell takes the height arithmetic with it. Stacked, the widest label in the rack fits. */}
        <div className="rk-stepper" role="group" aria-label={def.name}>
          <span className="rk-stepper-value">{label(current)}</span>
          <div className="rk-stepper-arrows">
            <button type="button" onClick={() => step(-1)} aria-label={`${def.name} down`}>
              ‹
            </button>
            <button type="button" onClick={() => step(1)} aria-label={`${def.name} up`}>
              ›
            </button>
          </div>
        </div>
        <span className="rk-cell-label">{def.name}</span>
      </div>
    )
  }

  const span = def.max - def.min
  const normalised = span === 0 ? 0 : (value - def.min) / span

  // Wrapped rather than given to the Knob, because the Knob is shared with the sequencer and a routing is
  // a rack idea. One div, and the mark is CSS.
  return (
    <div className="rk-param" {...mark}>
      <Knob
        label={def.name}
        value={Math.max(0, Math.min(1, normalised))}
        colour={colour}
        onChange={(next) => onChange(def.min + next * span)}
        format={() => display(def, value)}
      />
    </div>
  )
}

/**
 * A param value, in words.
 *
 * Guessed from the range rather than declared, which is a deliberate limitation: `ParamDef` has no
 * unit field, and adding one would mean every module author choosing a unit string before there was a
 * faceplate to show it. The ranges are distinctive enough — nothing else in the rack runs from 20 to
 * 18000 — and when this stops being enough, the fix is a `unit` field and not a longer guess.
 */
function display(def: ParamDef, value: number): string {
  if (def.max > 1000) {
    return value >= 1000 ? `${(value / 1000).toFixed(2)}k` : `${Math.round(value)}`
  }
  if (def.max <= 10 && def.min >= 0.0001 && def.max / Math.max(def.min, 1e-6) > 100) {
    // A range spanning three orders of magnitude inside ten is a time in seconds.
    return value < 0.1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`
  }
  if (def.min <= -12 && def.max >= 12) return `${value > 0 ? '+' : ''}${Math.round(value)}`
  return value.toFixed(2)
}
