import type { Patch } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import {
  dataKey,
  needsRebuild,
  NO_HISTORY,
  paramKey,
  remember,
  stepBack,
  stepForward,
  type History,
} from './history.js'

/** A patch distinguishable from the others by one number, which is all these rules care about. */
const at = (tempo: number): Patch => ({ modules: [{ id: 'vco-1', type: 'vco' }], cables: [], tempo })

/** Wind a history forward through a list of `[patch left behind, key]` edits. */
const through = (steps: [Patch, string | null][], limit?: number): History =>
  steps.reduce(
    (history, [patch, key]) => remember(history, patch, key, limit),
    NO_HISTORY as History,
  )

describe('recording', () => {
  it('keeps one entry per edit', () => {
    const history = through([
      [at(1), null],
      [at(2), null],
    ])
    expect(history.past.map((entry) => entry.patch.tempo)).toEqual([1, 2])
  })

  it('collapses consecutive edits that share a key, keeping the older snapshot', () => {
    // The whole point: `setParam` fires on every pointer move, so one drag of one knob has to be one
    // undo — and it has to land where the drag STARTED, not one move back into it.
    const key = paramKey('ladder-1', 'cutoff')
    const history = through([
      [at(1), key],
      [at(2), key],
      [at(3), key],
    ])
    expect(history.past).toHaveLength(1)
    expect(history.past[0].patch.tempo).toBe(1)
  })

  it('does not collapse two different knobs', () => {
    const history = through([
      [at(1), paramKey('ladder-1', 'cutoff')],
      [at(2), paramKey('ladder-1', 'resonance')],
    ])
    expect(history.past).toHaveLength(2)
  })

  it('does not collapse the same knob either side of another edit', () => {
    const cutoff = paramKey('ladder-1', 'cutoff')
    const history = through([
      [at(1), cutoff],
      [at(2), null],
      [at(3), cutoff],
    ])
    expect(history.past.map((entry) => entry.patch.tempo)).toEqual([1, 2, 3])
  })

  it('never collapses structural edits, however identical they look', () => {
    const history = through([
      [at(1), null],
      [at(2), null],
      [at(3), null],
    ])
    expect(history.past).toHaveLength(3)
  })

  it('keeps a lane drag to one step', () => {
    const key = dataKey('tracker-1', 'lane1')
    expect(through([[at(1), key], [at(2), key], [at(3), key]]).past).toHaveLength(1)
  })

  it('drops the oldest step past the limit', () => {
    const history = through(
      [
        [at(1), null],
        [at(2), null],
        [at(3), null],
      ],
      2,
    )
    // The oldest goes. Dropping the newest would make undo stop working exactly when it is being used
    // hardest, which is the opposite of a limit's purpose.
    expect(history.past.map((entry) => entry.patch.tempo)).toEqual([2, 3])
  })

  it('abandons the redo stack on any fresh edit', () => {
    const back = stepBack(through([[at(1), null]]), at(2))!
    expect(back.history.future).toHaveLength(1)
    expect(remember(back.history, at(1), null).future).toHaveLength(0)
  })

  it('abandons the redo stack even when the fresh edit coalesces', () => {
    // A coalesced edit returns early, and the first version returned the history unchanged — which left
    // a redo entry describing a future that had just been made unreachable.
    const key = paramKey('ladder-1', 'cutoff')
    const back = stepBack(through([[at(1), key]]), at(2))!
    expect(remember(back.history, at(2), key).future).toHaveLength(0)
  })
})

describe('stepping', () => {
  it('gives back nothing at either end, rather than throwing', () => {
    expect(stepBack(NO_HISTORY, at(1))).toBeNull()
    expect(stepForward(NO_HISTORY, at(1))).toBeNull()
  })

  it('restores the previous patch and offers the current one forward', () => {
    const back = stepBack(through([[at(1), null]]), at(2))!
    expect(back.patch.tempo).toBe(1)
    expect(back.history.past).toHaveLength(0)

    const forward = stepForward(back.history, back.patch)!
    expect(forward.patch.tempo).toBe(2)
    expect(forward.history.past).toHaveLength(1)
    expect(forward.history.future).toHaveLength(0)
  })

  it('walks all the way back and all the way forward again', () => {
    let history = through([
      [at(1), null],
      [at(2), null],
      [at(3), null],
    ])
    let patch = at(4)

    const seen: (number | undefined)[] = []
    for (let step = stepBack(history, patch); step; step = stepBack(history, patch)) {
      ;({ history, patch } = step)
      seen.push(patch.tempo)
    }
    expect(seen).toEqual([3, 2, 1])

    const again: (number | undefined)[] = []
    for (let step = stepForward(history, patch); step; step = stepForward(history, patch)) {
      ;({ history, patch } = step)
      again.push(patch.tempo)
    }
    expect(again).toEqual([2, 3, 4])
  })

  it('keeps a coalesced gesture one step in both directions', () => {
    const key = paramKey('ladder-1', 'cutoff')
    const history = through([
      [at(1), key],
      [at(2), key],
    ])
    const back = stepBack(history, at(3))!
    expect(back.patch.tempo).toBe(1)
    expect(stepForward(back.history, back.patch)!.patch.tempo).toBe(3)
  })
})

describe('deciding whether the graph has to be rebuilt', () => {
  const patch = (over: Partial<Patch>): Patch => ({
    modules: [
      { id: 'vco-1', type: 'vco' },
      { id: 'out-1', type: 'out' },
    ],
    cables: [{ from: ['vco-1', 'out'], to: ['out-1', 'in'] }],
    ...over,
  })

  it('says no for the same patch', () => {
    const one = patch({})
    expect(needsRebuild(one, one)).toBe(false)
  })

  it('says no for a knob', () => {
    // The reason this function exists. A restore knows nothing about the edit it reverses, and
    // rebuilding for an undone knob would reset every oscillator's phase and every filter's history.
    expect(
      needsRebuild(
        patch({ modules: [{ id: 'vco-1', type: 'vco', params: { tune: 0.2 } }, { id: 'out-1', type: 'out' }] }),
        patch({ modules: [{ id: 'vco-1', type: 'vco', params: { tune: 0.8 } }, { id: 'out-1', type: 'out' }] }),
      ),
    ).toBe(false)
  })

  it('says no for pattern data, which reaches the thread as a message and survives a rebuild', () => {
    expect(
      needsRebuild(
        patch({ modules: [{ id: 'vco-1', type: 'vco', data: { lane1: [1, 2] } }, { id: 'out-1', type: 'out' }] }),
        patch({ modules: [{ id: 'vco-1', type: 'vco', data: { lane1: [3, 4] } }, { id: 'out-1', type: 'out' }] }),
      ),
    ).toBe(false)
  })

  it('says no for a retained groovebox song, which belongs to a hosted engine', () => {
    expect(needsRebuild(patch({ groovebox: 'one' }), patch({ groovebox: 'two' }))).toBe(false)
  })

  it('says yes for a module added or removed', () => {
    expect(needsRebuild(patch({}), patch({ modules: [{ id: 'out-1', type: 'out' }] }))).toBe(true)
  })

  it('says yes for a module whose type changed under the same id', () => {
    expect(
      needsRebuild(
        patch({}),
        patch({ modules: [{ id: 'vco-1', type: 'svf' }, { id: 'out-1', type: 'out' }] }),
      ),
    ).toBe(true)
  })

  it('says yes for a reorder, because the module list is the layout', () => {
    expect(
      needsRebuild(
        patch({}),
        patch({ modules: [{ id: 'out-1', type: 'out' }, { id: 'vco-1', type: 'vco' }] }),
      ),
    ).toBe(true)
  })

  it('says yes for a cable moved to another port', () => {
    expect(
      needsRebuild(patch({}), patch({ cables: [{ from: ['vco-1', 'sub'], to: ['out-1', 'in'] }] })),
    ).toBe(true)
  })

  it('says yes for the voice count', () => {
    expect(needsRebuild(patch({}), patch({ voices: 4 }))).toBe(true)
  })
})
