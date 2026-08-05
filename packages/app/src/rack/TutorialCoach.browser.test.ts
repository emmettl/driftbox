import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { TutorialCoach } from './TutorialCoach.js'
import type { Tutorial, TutorialState } from './tutorials.js'

// `act` rather than `flushSync` for the renders, and the difference is the thing under test. The watcher
// is a passive effect, so `flushSync` paints the new props and returns *before* the tick has happened —
// every assertion below would read the checklist one state change out of date. `act` runs the effect and
// the render it schedules, which is what a real frame does.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The panel's two claims are both about *time*, and neither is checkable from the pure layer: a step ticks
// the first moment it holds, and it stays ticked afterwards. Latching is the load-bearing one — half the
// lessons ask you to turn the rack around and then turn back, so a checklist that re-read the live state
// every render would untick itself one instruction later. That is a rendered-over-time property, so it is
// measured by rendering it over time.

const BLANK: TutorialState = {
  patch: { modules: [], cables: [] },
  started: false,
  playing: false,
  flipped: false,
  automating: false,
  sounding: 0,
  automationOpen: false,
}

const TOUR: Tutorial = {
  id: 'test',
  name: 'Test tour',
  blurb: 'Three steps, each an obvious flag.',
  minutes: 1,
  steps: [
    {
      id: 'one',
      where: 'Header',
      title: 'Start the audio.',
      body: 'The first flag.',
      done: (state) => state.started,
    },
    {
      id: 'two',
      where: 'Tab',
      title: 'Turn the rack around.',
      body: 'The one that goes away again.',
      done: (state) => state.flipped,
    },
    {
      id: 'three',
      where: 'Header',
      title: 'Press play.',
      body: 'The last flag.',
      done: (state) => state.playing,
    },
  ],
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let finished: Mock<(id: string) => void>
let closed: Mock<() => void>

function show(state: TutorialState) {
  act(() =>
    root.render(
      createElement(TutorialCoach, {
        tutorial: TOUR,
        state,
        onClose: closed,
        onFinished: finished,
      }),
    ),
  )
}

/** The mark on each step's cell in the track: what the checklist believes right now. */
const marks = () =>
  [...host.querySelectorAll('.rk-coach-track li')].map((cell) => cell.getAttribute('data-mark'))

const instruction = () => host.querySelector('.rk-coach-body h2')?.textContent

function press(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes(label) || candidate.getAttribute('aria-label') === label,
  )!
  expect(button, label).toBeTruthy()
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  finished = vi.fn<(id: string) => void>()
  closed = vi.fn<() => void>()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('the guided-tour panel', () => {
  it('opens on the first step with nothing ticked', () => {
    show(BLANK)
    expect(instruction()).toBe('Start the audio.')
    expect(marks()).toEqual(['todo', 'todo', 'todo'])
    expect(finished).not.toHaveBeenCalled()
  })

  it('ticks a step and moves on when the rack satisfies it', () => {
    show(BLANK)
    show({ ...BLANK, started: true })
    expect(marks()).toEqual(['done', 'todo', 'todo'])
    expect(instruction()).toBe('Turn the rack around.')
  })

  it('keeps a step ticked after the rack stops satisfying it', () => {
    // The whole reason completion latches. Step two is "turn the rack around" and step three is on the
    // front, so `flipped` is false again a moment later — and a checklist that unticks behind you is not
    // a checklist.
    show(BLANK)
    show({ ...BLANK, started: true, flipped: true })
    expect(marks()).toEqual(['done', 'done', 'todo'])
    show({ ...BLANK, started: true, flipped: false })
    expect(marks()).toEqual(['done', 'done', 'todo'])
    expect(instruction()).toBe('Press play.')
  })

  it('credits a step done out of order rather than making it happen twice', () => {
    show(BLANK)
    show({ ...BLANK, playing: true })
    expect(marks()).toEqual(['todo', 'todo', 'done'])
    // And it does not drag the reader forwards to it: the outstanding step is still the one on screen.
    expect(instruction()).toBe('Start the audio.')
  })

  it('skips without claiming the step was done', () => {
    show(BLANK)
    press('Skip this step')
    expect(marks()).toEqual(['skipped', 'todo', 'todo'])
    expect(instruction()).toBe('Turn the rack around.')
  })

  it('reports a finish only when every step was genuinely done', () => {
    show(BLANK)
    press('Skip this step')
    show({ ...BLANK, flipped: true, playing: true })
    expect(finished).not.toHaveBeenCalled()
    expect(host.textContent).toContain('with 1 skipped')

    // And once the skipped one is satisfied too, the tour is finished for real — exactly once.
    show({ ...BLANK, started: true, flipped: true, playing: true })
    expect(finished).toHaveBeenCalledTimes(1)
    expect(finished).toHaveBeenCalledWith('test')
    show({ ...BLANK, started: true, flipped: true, playing: true, sounding: 2 })
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('folds away without losing the count, because the rack is what is in the way', () => {
    show({ ...BLANK, started: true })
    press('▾')
    expect(host.querySelector('.rk-coach-body')).toBeNull()
    expect(marks()).toEqual(['done', 'todo', 'todo'])
  })

  it('ends when asked', () => {
    show(BLANK)
    press('End the tour')
    expect(closed).toHaveBeenCalledTimes(1)
  })
})
