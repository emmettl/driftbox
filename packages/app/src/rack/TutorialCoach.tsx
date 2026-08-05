import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayBeacon } from '../ui/PlayBeacon.js'
import { useMedia } from '../ui/useFirstRun.js'
import { spotlightRef } from './spotlight.js'
import type { Tutorial, TutorialState } from './tutorials.js'
import './TutorialCoach.css'

// The panel a guided tour is read from.
//
// It owns two things and deliberately no more: **which step you are on, and which steps have been done**.
// Everything else — what a step means, whether it is satisfied — is `tutorials.ts`, evaluated fresh against
// the live rack. This file cannot make a tour say something untrue about the patch, because it never
// decides anything about the patch.
//
// **Completion latches.** A step ticks the first moment it holds and stays ticked. Without that, half the
// lessons would un-tick themselves a second later: turning the rack around is done by `flipped`, and the
// next instruction is usually "turn back". A checklist that unticks behind you is not a checklist.
//
// **Skip is always available, and it does not lie.** It marks a step passed rather than done, and the tour
// says so at the end — because the one thing worse than being stuck on step three is a tour that quietly
// pretends you did it.
//
// It is an aside rather than a modal, and that is the whole design. A modal would cover the rack the tour
// is asking you to touch. A named place to look ("Back panel", "Add module") costs nothing and survives
// the rack being rearranged.
//
// **And then the particles.** The app already had an answer to "which button" and it was written for this
// exact problem one screen over: `PlayBeacon` streams particles into a control that wants pressing, and
// its own note says why it stops — "a permanent effect is decoration; one that stops when you have learnt
// the thing is an instruction". A tour step is that sentence with a smaller scope. So the current step
// gets a stream, the ones before and after do not, and it goes out when the tour does.
//
// **One at a time, and not on every step.** Two streams would be two destinations, which is what the
// groovebox uses them for and is the opposite of an instruction. Steps whose target is the keyboard across
// the whole bottom of the screen, or "any knob", have no `spotlight` at all — an arrow drawn to something
// unmissable is the decoration this is trying not to be. And it is off entirely under
// `prefers-reduced-motion`, where the words have to carry it alone.

/** The rack's own teal, so the stream reads as part of the panel that sent it. */
const TEAL = '95, 240, 208'

interface Props {
  tutorial: Tutorial
  state: TutorialState
  onClose: () => void
  /** Called once, the first time every step of this tour has been ticked rather than skipped. */
  onFinished: (id: string) => void
}

type Mark = 'todo' | 'done' | 'skipped'

export function TutorialCoach({ tutorial, state, onClose, onFinished }: Props) {
  const [marks, setMarks] = useState<Mark[]>(() => tutorial.steps.map(() => 'todo'))
  const [at, setAt] = useState(0)
  const [collapsed, setCollapsed] = useState(false)

  // Mirrored in a ref so the watcher below can depend on the rack alone. Listing `marks` as a dependency
  // would re-run it on every tick it had just caused — the loop this panel is one line away from at all
  // times — and computing the next marks outside the state updater keeps the completion callback out of a
  // function React is entitled to call twice.
  const held = useRef(marks)
  held.current = marks
  const current = useRef(at)
  current.current = at
  const finished = useRef(onFinished)
  finished.current = onFinished
  const announced = useRef(false)

  // A fresh tour starts fresh, including one restarted from the help dialog after being completed.
  useEffect(() => {
    const clean: Mark[] = tutorial.steps.map(() => 'todo')
    held.current = clean
    setMarks(clean)
    setAt(0)
    announced.current = false
  }, [tutorial])

  // The watcher. Every step is re-evaluated, not only the current one — somebody who does step four while
  // reading step two has done step four, and a tour that made them do it again would be arguing with them.
  //
  // A skipped step is re-evaluated too, and that is not a detail. Skipping is how you get past a step you
  // do not want *yet*; coming back to it ten minutes later and having the tour refuse to notice would make
  // the skip a permanent verdict, and a tour that had been skipped through once could never afterwards
  // report itself finished however much of it you went on to do. Only `done` is final.
  useEffect(() => {
    const before = held.current
    let changed = false
    const after: Mark[] = tutorial.steps.map((step, index) => {
      if (before[index] === 'done' || !step.done(state)) return before[index]
      changed = true
      return 'done'
    })
    if (!changed) return

    held.current = after
    setMarks(after)

    // Move to the first thing still outstanding. Never backwards: passing over a step is the person's
    // choice to make, and dragging them back to it would take that choice away every time.
    const next = after.findIndex((mark) => mark === 'todo')
    if (next < 0) setAt(tutorial.steps.length)
    else if (next > current.current) setAt(next)

    if (!announced.current && after.every((mark) => mark === 'done')) {
      announced.current = true
      finished.current(tutorial.id)
    }
  }, [state, tutorial])

  const advance = (mark: Mark) => {
    const after = [...held.current]
    if (after[at] === 'todo') after[at] = mark
    held.current = after
    setMarks(after)
    const next = after.findIndex((entry, index) => index > at && entry === 'todo')
    setAt(next >= 0 ? next : tutorial.steps.length)
  }

  const stillness = useMedia('(prefers-reduced-motion: reduce)')

  const done = marks.filter((mark) => mark === 'done').length
  const skipped = marks.filter((mark) => mark === 'skipped').length
  const over = at >= tutorial.steps.length
  const step = over ? null : tutorial.steps[at]

  // Rebuilt only when the step's aim changes, so the beacon's particle field survives a re-render — it is
  // keyed on the target list, and a new key restarts every particle from the outside.
  const aim = step?.spotlight?.join('|') ?? ''
  const beacons = useMemo(
    () =>
      aim === '' || stillness
        ? []
        : [
            {
              key: aim,
              target: spotlightRef(aim.split('|')),
              tint: TEAL,
              count: 44,
              spawn: 5,
              // Capped in pixels, because these targets are not all one size: a step points at a 100px
              // header button and, one step later, at a 300px card in the picker. Five radii is a halo
              // round the first and half a window round the second.
              reach: 260,
            },
          ],
    [aim, stillness],
  )

  return (
    <>
      <PlayBeacon className="rk-coach-beacon" targets={beacons} />
      <aside
        className="rk-coach"
        data-collapsed={collapsed ? 'yes' : 'no'}
        aria-label={`Guided tour: ${tutorial.name}`}
      >
        <header className="rk-coach-head">
          <div>
            <span>Guided tour</span>
            <strong>{tutorial.name}</strong>
          </div>
          <button
            type="button"
            className="rk-coach-fold"
            onClick={() => setCollapsed((shut) => !shut)}
            aria-expanded={!collapsed}
          >
            {collapsed ? '▴' : '▾'}
          </button>
          <button type="button" className="rk-coach-close" onClick={onClose} aria-label="End the tour">
            ×
          </button>
        </header>

        {/* The count stays visible when the body is folded away, because the reason to fold it is that the
            rack is in the way — not that you have stopped caring how far along you are. */}
        <ol className="rk-coach-track" aria-label={`${done} of ${tutorial.steps.length} steps done`}>
          {tutorial.steps.map((entry, index) => (
            <li
              key={entry.id}
              data-mark={marks[index]}
              data-current={index === at ? 'yes' : 'no'}
              title={entry.title}
            />
          ))}
        </ol>

        {!collapsed && (
          // Polite rather than assertive: a step ticking is worth hearing about, and worth hearing about
          // after whatever the rack itself just said.
          <div className="rk-coach-body" aria-live="polite">
            {step ? (
              <>
                <span className="rk-coach-where">{step.where}</span>
                <h2>{step.title}</h2>
                <p>{step.body}</p>
                <div className="rk-coach-actions">
                  <button type="button" onClick={() => advance('skipped')}>
                    Skip this step
                  </button>
                  <span className="rk-coach-count">
                    {done + skipped + 1} / {tutorial.steps.length}
                  </span>
                </div>
                <p className="rk-coach-note">
                  This ticks itself when you have done it. Nothing here presses anything for you.
                </p>
              </>
            ) : (
              <>
                <span className="rk-coach-where">Finished</span>
                <h2>{skipped === 0 ? 'All done.' : `Done, with ${skipped} skipped.`}</h2>
                <p>
                  {skipped === 0
                    ? 'Every step of this one happened in your rack rather than in a video. Take another from ? Help, or carry on from here.'
                    : 'The skipped steps are still worth coming back for — a tour can be restarted from ? Help at any point.'}
                </p>
                <div className="rk-coach-actions">
                  <button type="button" className="rk-primary" onClick={onClose}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
