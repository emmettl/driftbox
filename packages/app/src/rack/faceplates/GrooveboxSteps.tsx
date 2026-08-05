import {
  bassStepAt,
  cyclePcfStep,
  cycleStep,
  pcfAt,
  toggleFlam,
  trackLength,
  type Pattern,
} from '@driftbox/engine'
import type { Focus } from './groovebox-focus.js'
import {
  bassStepLabel,
  bassStepState,
  pcfStateLabel,
  sectionName,
  stepState,
} from './groovebox-format.js'

interface Props {
  pattern: Pattern
  focus: Focus
  /** The absolute step indices on the shown page. */
  steps: number[]
  selected: number
  /** 909 only: whether a step click programs a flam rather than cycling the hit. */
  flamMode: boolean
  onSelect: (step: number) => void
  save: (next: Pattern, discrete?: boolean) => void
}

/**
 * The step grid, and the pattern-controlled filter row underneath it.
 *
 * Two grids of the same shape that mean different things per machine. A 303 step selects, because its
 * material is edited by the controls below; a drum step toggles in place. A drum lane may also be
 * shorter than the pattern it sits in, so the steps past its end are drawn and announced as outside the
 * lane rather than as silent ones you could turn on.
 */
export function GrooveboxSteps({
  pattern,
  focus,
  steps,
  selected,
  flamMode,
  onSelect,
  save,
}: Props) {
  const { bass, section, voice } = focus
  return (
    <>
      <div className="rk-groovebox-steps">
        {steps.map((step) => {
          if (bass) {
            const value = bassStepAt(pattern, section, step)
            return (
              <button
                type="button"
                key={step}
                data-state={bassStepState(value)}
                aria-pressed={selected === step}
                aria-label={`${sectionName(section)} step ${step + 1}: ${bassStepLabel(value)}`}
                onClick={() => onSelect(step)}
              >
                {step + 1}
              </button>
            )
          }

          const laneLength = voice ? trackLength(pattern, voice.id) : pattern.length
          const active = step < laneLength
          const value = active && voice ? pattern.tracks[voice.id]?.[step] ?? 0 : 0
          const flam =
            active && section === 'tr909' && voice
              ? pattern.flams?.[voice.id]?.[step] === true
              : false
          return (
            <button
              type="button"
              key={step}
              data-state={active ? stepState(value) : 'inactive'}
              data-flam={flam ? 'yes' : undefined}
              disabled={!active}
              aria-label={
                active
                  ? `${voice?.name ?? 'Drum'} step ${step + 1}: ${stepState(value)}${flam ? ', flam' : ''}`
                  : `${voice?.name ?? 'Drum'} step ${step + 1}: outside ${laneLength}-step lane`
              }
              onClick={() => {
                if (!voice) return
                save(
                  section === 'tr909' && flamMode
                    ? toggleFlam(pattern, voice.id, step)
                    : cycleStep(pattern, voice.id, step),
                )
              }}
            >
              {step + 1}
            </button>
          )
        })}
      </div>

      <div className="rk-groovebox-pcf" aria-label="Pattern-controlled filter steps">
        <strong>PCF</strong>
        <div className="rk-groovebox-steps">
          {steps.map((step) => {
            const value = pcfAt(pattern, step)
            return (
              <button
                key={step}
                type="button"
                data-state={stepState(value)}
                onClick={() => save(cyclePcfStep(pattern, step), true)}
                aria-label={`PCF step ${step + 1}: ${pcfStateLabel(value)}`}
                aria-pressed={value !== 0}
              >
                {step + 1}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
