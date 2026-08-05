import type { Patch } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import {
  TUTORIALS,
  audible,
  fed,
  finishTour,
  finishedTours,
  has,
  hasAny,
  paramMoved,
  patched,
  trimmed,
  tutorialById,
  type Store,
  type TutorialState,
} from './tutorials.js'

// A tour is only worth having if its steps are true statements about the rack, and every way of getting
// that wrong is quiet. A predicate that can never hold leaves somebody stuck on step three doing exactly
// what they were told; one that already holds ticks itself the moment the panel opens and teaches nothing.
// Neither shows up as an error, so both are checked here instead — which is the whole reason the lessons
// are data and the predicates are pure.

const patch = (patch: Partial<Patch>): Patch => ({ modules: [], cables: [], ...patch })

/** A rack that has just been opened: nothing added, nothing started, nothing running. */
const BLANK: TutorialState = {
  patch: patch({}),
  started: false,
  playing: false,
  flipped: false,
  automating: false,
  sounding: 0,
  automationOpen: false,
}

const state = (over: Partial<TutorialState>): TutorialState => ({ ...BLANK, ...over })

describe('reading the patch', () => {
  it('finds a module type, and any of several', () => {
    const p = patch({ modules: [{ id: 'a', type: 'ladder' }] })
    expect(has(p, 'ladder')).toBe(true)
    expect(has(p, 'svf')).toBe(false)
    expect(hasAny(p, ['svf', 'ladder'])).toBe(true)
    expect(hasAny(p, ['svf', 'vco'])).toBe(false)
  })

  it('matches a cable by the types at its ends, not by ids', () => {
    // The reason these are by type at all: the ids belong to whoever is taking the tour. They added the
    // module, so it is `ladder-3` and no step written in advance could have known that.
    const p = patch({
      modules: [
        { id: 'lfo-7', type: 'lfo' },
        { id: 'ladder-3', type: 'ladder' },
      ],
      cables: [{ from: ['lfo-7', 'bi'], to: ['ladder-3', 'cutoff'] }],
    })
    expect(patched(p, 'lfo')).toBe(true)
    expect(patched(p, 'lfo', 'ladder')).toBe(true)
    expect(patched(p, 'lfo', 'ladder', 'cutoff')).toBe(true)
    expect(patched(p, 'lfo', 'ladder', 'in')).toBe(false)
    expect(patched(p, 'adsr', 'ladder')).toBe(false)
    expect(fed(p, 'ladder', 'cutoff')).toBe(true)
    expect(fed(p, 'ladder', 'in')).toBe(false)
  })

  it('follows a chain all the way to an Out before calling it audible', () => {
    const chain = patch({
      modules: [
        { id: 'v', type: 'voice' },
        { id: 'd', type: 'delay' },
        { id: 'o', type: 'out' },
      ],
      cables: [
        { from: ['v', 'out'], to: ['d', 'in'] },
        { from: ['d', 'out'], to: ['o', 'in'] },
      ],
    })
    expect(audible(chain, 'voice')).toBe(true)
    expect(audible(chain, 'delay')).toBe(true)
  })

  it('is not fooled by a chain that stops short', () => {
    // "Plugged into something" is not the question anybody means. This is the commonest real silence in
    // the rack and the one a step has to be able to tell apart from success.
    const dangling = patch({
      modules: [
        { id: 'v', type: 'voice' },
        { id: 'd', type: 'delay' },
        { id: 'o', type: 'out' },
      ],
      cables: [{ from: ['v', 'out'], to: ['d', 'in'] }],
    })
    expect(audible(dangling, 'voice')).toBe(false)
    expect(audible(dangling, 'delay')).toBe(false)
  })

  it('terminates on a feedback loop rather than hanging the panel', () => {
    // Cycles are legal here — the compiler inserts a one-block delay to make them runnable — so a walk
    // without a visited set would spin for ever inside a render.
    const loop = patch({
      modules: [
        { id: 'a', type: 'delay' },
        { id: 'b', type: 'reverb' },
      ],
      cables: [
        { from: ['a', 'out'], to: ['b', 'in'] },
        { from: ['b', 'out'], to: ['a', 'in'] },
      ],
    })
    expect(audible(loop, 'delay')).toBe(false)
  })

  it('knows a knob has moved only when it differs from the def', () => {
    const def = patch({ modules: [{ id: 'l', type: 'ladder', params: { cutoff: 800 } }] })
    expect(paramMoved(def, 'ladder')).toBe(false)
    const moved = patch({ modules: [{ id: 'l', type: 'ladder', params: { cutoff: 420 } }] })
    expect(paramMoved(moved, 'ladder')).toBe(true)
    expect(paramMoved(moved, 'ladder', 'cutoff')).toBe(true)
    expect(paramMoved(moved, 'ladder', 'resonance')).toBe(false)
    expect(paramMoved(moved, 'svf')).toBe(false)
  })

  it('ignores the params the host writes rather than the player', () => {
    // The MIDI module's note and gate move every time a key goes down. A step reading "move a knob" that
    // ticked because somebody played a note would be measuring the wrong thing entirely.
    const played = patch({ modules: [{ id: 'm', type: 'midi', params: { note: 64, gate: 1 } }] })
    expect(paramMoved(played, 'midi')).toBe(false)
    const transposed = patch({ modules: [{ id: 'm', type: 'midi', params: { transpose: 12 } }] })
    expect(paramMoved(transposed, 'midi')).toBe(true)
  })

  it('treats an absent trim as unity, because that is what absent means', () => {
    expect(trimmed(patch({ modules: [{ id: 'a', type: 'ladder' }] }))).toBe(false)
    expect(
      trimmed(patch({ modules: [{ id: 'a', type: 'ladder', inputTrims: { cutoff: 1 } }] })),
    ).toBe(false)
    expect(
      trimmed(patch({ modules: [{ id: 'a', type: 'ladder', inputTrims: { cutoff: 0.3 } }] })),
    ).toBe(true)
    expect(
      trimmed(patch({ modules: [{ id: 'a', type: 'ladder', inputTrims: { cutoff: -1 } }] })),
    ).toBe(true)
  })
})

describe('the lessons as a set', () => {
  it('have unique ids, and unique step ids within each', () => {
    expect(new Set(TUTORIALS.map((tour) => tour.id)).size).toBe(TUTORIALS.length)
    for (const tour of TUTORIALS) {
      const ids = tour.steps.map((step) => step.id)
      expect(new Set(ids).size, tour.id).toBe(ids.length)
    }
  })

  it('say enough on every step to be followed without the guide open', () => {
    for (const tour of TUTORIALS) {
      expect(tour.steps.length, tour.id).toBeGreaterThanOrEqual(3)
      expect(tour.blurb.length, tour.id).toBeGreaterThan(20)
      expect(tour.minutes, tour.id).toBeGreaterThan(0)
      for (const step of tour.steps) {
        expect(step.title.length, `${tour.id}/${step.id}`).toBeGreaterThan(8)
        expect(step.body.length, `${tour.id}/${step.id}`).toBeGreaterThan(40)
        // The `where` is a chip beside the instruction, not a sentence. Long ones wrap the panel.
        expect(step.where.length, `${tour.id}/${step.id}`).toBeLessThanOrEqual(14)
      }
    }
  })

  it('starts every tour with nothing already ticked', () => {
    // A step satisfied by an untouched rack is a step that teaches nothing and, worse, makes the panel
    // look like it is guessing. Cheap to write by accident: `!has(...)`, an inverted flag, a default that
    // moved underneath a `paramMoved`.
    for (const tour of TUTORIALS) {
      for (const step of tour.steps) {
        expect(step.done(BLANK), `${tour.id}/${step.id}`).toBe(false)
      }
    }
  })

  it('finds one by id, and nothing by a wrong one', () => {
    expect(tutorialById('first-sound')?.name).toBe('A sound of your own')
    expect(tutorialById('nonesuch')).toBeUndefined()
  })
})

// Each tour, with the work it asks for actually done. This is the half that catches a step nobody can
// satisfy: the fixture is written from the instruction text, so if the two disagree the test fails rather
// than a person doing exactly as they were told and watching nothing happen.
const FINISHED: Record<string, TutorialState> = {
  'first-sound': state({
    started: true,
    flipped: true,
    sounding: 1,
    patch: patch({
      modules: [
        { id: 'voice-1', type: 'voice', params: { cutoff: 640 } },
        { id: 'midi-1', type: 'midi' },
        { id: 'out-1', type: 'out' },
      ],
      cables: [
        { from: ['midi-1', 'pitch'], to: ['voice-1', 'pitch'] },
        { from: ['midi-1', 'gate'], to: ['voice-1', 'gate'] },
        { from: ['voice-1', 'out'], to: ['out-1', 'in'] },
      ],
    }),
  }),
  'patch-by-hand': state({
    flipped: true,
    patch: patch({
      modules: [
        { id: 'voice-1', type: 'voice' },
        { id: 'ladder-1', type: 'ladder', params: { cutoff: 380 } },
        { id: 'out-1', type: 'out' },
      ],
      cables: [
        { from: ['voice-1', 'out'], to: ['ladder-1', 'in'] },
        { from: ['ladder-1', 'out'], to: ['out-1', 'in'] },
      ],
    }),
  }),
  'make-it-move': state({
    patch: patch({
      modules: [
        { id: 'lfo-1', type: 'lfo', params: { rate: 0.4, shape: 2 } },
        { id: 'ladder-1', type: 'ladder', inputTrims: { cutoff: 0.35 } },
      ],
      cables: [{ from: ['lfo-1', 'bi'], to: ['ladder-1', 'cutoff'] }],
    }),
  }),
  'sequence-it': state({
    playing: true,
    patch: patch({
      modules: [
        { id: 'seq-1', type: 'seq', params: { pitch2: 7 } },
        { id: 'transport-1', type: 'transport' },
        { id: 'voice-1', type: 'voice' },
      ],
      cables: [
        { from: ['transport-1', 'sixteenth'], to: ['seq-1', 'clock'] },
        { from: ['seq-1', 'pitch'], to: ['voice-1', 'pitch'] },
        { from: ['seq-1', 'gate'], to: ['voice-1', 'gate'] },
      ],
    }),
  }),
  macros: state({
    patch: patch({
      modules: [
        { id: 'combi-1', type: 'combi', params: { rotary1: 74 } },
        { id: 'ladder-1', type: 'ladder' },
        { id: 'delay-1', type: 'delay' },
      ],
      modulation: [
        { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 120, max: 6000 },
        { from: ['combi-1', 'rotary2'], to: ['delay-1', 'feedback'], min: 0, max: 0.8 },
      ],
    }),
  }),
  'record-a-move': state({
    started: true,
    playing: true,
    automating: true,
    automationOpen: true,
    patch: patch({
      modules: [{ id: 'ladder-1', type: 'ladder' }],
      automation: [
        { target: ['ladder-1', 'cutoff'], points: [{ at: 0, value: 400 }] },
      ],
    }),
  }),
}

describe.each(TUTORIALS.map((tour) => [tour.id, tour] as const))('the %s tour', (id, tour) => {
  it('can be finished by doing what it asks for', () => {
    const done = FINISHED[id]
    expect(done, `${id} has no fixture — add one when adding a tour`).toBeDefined()
    for (const step of tour.steps) {
      expect(step.done(done), `${id}/${step.id}`).toBe(true)
    }
  })
})

describe('remembering which tours are done', () => {
  const fake = (): Store & { seen: Record<string, string> } => {
    const seen: Record<string, string> = {}
    return {
      seen,
      getItem: (key) => seen[key] ?? null,
      setItem: (key, value) => {
        seen[key] = value
      },
    }
  }

  it('starts empty and remembers what finished', () => {
    const store = fake()
    expect(finishedTours(store).size).toBe(0)
    expect([...finishTour('first-sound', store)]).toEqual(['first-sound'])
    expect(finishedTours(store).has('first-sound')).toBe(true)
    finishTour('macros', store)
    expect(finishedTours(store).size).toBe(2)
  })

  it('drops an id this build no longer has', () => {
    // A renamed lesson would otherwise leave a permanent ghost in the count, and the shelf would say four
    // of six done for ever.
    const store = fake()
    store.setItem('driftbox.rack.tours.v1', JSON.stringify(['macros', 'a-tour-from-2019']))
    expect([...finishedTours(store)]).toEqual(['macros'])
  })

  it('survives junk, and no storage at all', () => {
    // Private browsing, a full quota, or somebody's leftovers under our key. Never knowing is better than
    // never rendering — every other store in this app takes the same line.
    const store = fake()
    store.setItem('driftbox.rack.tours.v1', 'not json')
    expect(finishedTours(store).size).toBe(0)
    store.setItem('driftbox.rack.tours.v1', JSON.stringify({ nope: true }))
    expect(finishedTours(store).size).toBe(0)
    expect(finishedTours(null).size).toBe(0)
    expect(() => finishTour('macros', null)).not.toThrow()
  })
})
