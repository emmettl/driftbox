import { TRACKER_LANES } from '@driftbox/rack'
import { useRef, useState } from 'react'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import type { FaceplateProps } from './types.js'

// Somewhere to write a pattern.
//
// **Until this existed you could not enter a note in the rack at all.** Every pattern came from a shipped
// chunk or a preset, lived in `PatchModule.data`, and had no way in or out — the Tracker fell back to the
// generic faceplate, which draws params, and a pattern is not params. That is a strange gap for an
// instrument, and a fatal one for the ambition of shipping songs people can start from: a song you cannot
// edit is a recording.
//
// It is also the first faceplate that edits `data` rather than a param, which is why it reaches into the
// store — the same reason the Sampler does. `setLane` explains why an edit is deliberately not structural.
//
// **The grid shows one bar at a time.** A lane runs to 64 steps and the module is 480 design units wide, so
// all of them at once is seven units per cell, which is not a target anybody can hit. Sixteen is a bar, it
// is the default length, and it is what the pattern is written in — so longer patterns page rather than
// shrink. Paging is honest about the arithmetic where squeezing would not be.
//
// **A cell holds a number, not a switch.** That is what makes this a tracker rather than a step grid: lane
// values are semitones, or slice indices when the lane's Unit is set. So a click toggles between rest and
// something audible, and a vertical drag sets the value — the same gesture the Knob uses, because a second
// way to mean "change this number" would be one too many.

/** What a click writes into an empty cell. A fifth above the root reads as musical rather than as a mistake,
 *  and on a Unit lane it is slice 7 of 16, which is somewhere in the middle of a break. */
const DEFAULT_STEP = 7

/** How many steps are visible at once. One bar of sixteenths. */
const PAGE = 16

export function Tracker({ def, module, value, onChange, routed }: FaceplateProps) {
  const setLane = useRack((s) => s.setLane)
  const patch = useRack((s) => s.patch)
  const [page, setPage] = useState(0)
  /** Where a vertical drag started, so the value follows the pointer rather than jumping. */
  const drag = useRef<{ lane: number; step: number; from: number; y: number } | null>(null)

  const param = (id: string) => def.params.find((p) => p.id === id)!
  const length = Math.round(value('length'))
  const pages = Math.max(1, Math.ceil(length / PAGE))
  const at = Math.min(page, pages - 1)

  const data = patch.modules.find((m) => m.id === module.id)?.data
  const lane = (index: number): number[] => data?.[`lane${index + 1}`] ?? []

  /** Write one step, padding the lane out to the pattern's length so a short array does not swallow it. */
  const write = (index: number, step: number, next: number) => {
    const values = [...lane(index)]
    while (values.length < length) values.push(0)
    values[step] = next
    setLane(module.id, index, values)
  }

  const steps = Array.from({ length: PAGE }, (_, i) => at * PAGE + i).filter((s) => s < length)

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Tracker</span>
        <span className="rk-ports">
          {length} steps{pages > 1 ? ` · bar ${at + 1}/${pages}` : ''}
        </span>
      </header>

      <div className="rk-controls">
        <ParamControl
          def={param('length')}
          value={value('length')}
          onChange={(v) => onChange('length', v)}
          routed={routed?.('length')}
        />
        {Array.from({ length: TRACKER_LANES }, (_, i) => (
          <ParamControl
            key={`mute${i}`}
            def={param(`mute${i + 1}`)}
            value={value(`mute${i + 1}`)}
            onChange={(v) => onChange(`mute${i + 1}`, v)}
            routed={routed?.(`mute${i + 1}`)}
          />
        ))}
      </div>

      <div className="rk-steps">
        {pages > 1 && (
          <div className="rk-steps-pager">
            {Array.from({ length: pages }, (_, p) => (
              <button
                key={p}
                type="button"
                className={p === at ? 'rk-page rk-page-on' : 'rk-page'}
                aria-label={`Bar ${p + 1}`}
                aria-pressed={p === at}
                onClick={() => setPage(p)}
              >
                {p + 1}
              </button>
            ))}
          </div>
        )}

        {Array.from({ length: TRACKER_LANES }, (_, index) => {
          const values = lane(index)
          const unit = Math.round(value(`unit${index + 1}`)) === 1
          const muted = Math.round(value(`mute${index + 1}`)) === 1
          return (
            <div key={index} className={muted ? 'rk-lane rk-lane-muted' : 'rk-lane'}>
              <span className="rk-lane-tag">{unit ? 'U' : 'S'}{index + 1}</span>
              {steps.map((step) => {
                const held = values[step] ?? 0
                return (
                  <button
                    key={step}
                    type="button"
                    className={held ? 'rk-step rk-step-on' : 'rk-step'}
                    // Every fourth cell marked, because a bar you cannot count is a bar you cannot edit.
                    data-beat={step % 4 === 0 ? 'yes' : 'no'}
                    aria-label={`Lane ${index + 1} step ${step + 1}${held ? `, ${held}` : ', rest'}`}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      drag.current = { lane: index, step, from: held, y: event.clientY }
                    }}
                    onPointerMove={(event) => {
                      const d = drag.current
                      if (!d || d.lane !== index || d.step !== step) return
                      // Four pixels per unit: fine enough to land on a semitone, coarse enough that a
                      // click does not become a drag by accident.
                      const moved = Math.round((d.y - event.clientY) / 4)
                      if (moved === 0) return
                      const next = Math.max(0, Math.min(48, d.from + moved))
                      if (next !== (values[step] ?? 0)) write(index, step, next)
                    }}
                    onPointerUp={(event) => {
                      const d = drag.current
                      drag.current = null
                      // A press that never moved is a click, and a click toggles. Worked out here rather
                      // than with a separate onClick, because onClick fires after a drag as well and would
                      // undo whatever the drag had just set.
                      if (!d || Math.abs(d.y - event.clientY) >= 4) return
                      write(index, step, held ? 0 : DEFAULT_STEP)
                    }}
                  >
                    {held || ''}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </>
  )
}
