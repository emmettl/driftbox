import { PATCHES, type Patch } from '@driftbox/rack'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deletePatch,
  freshName,
  listPatches,
  loadPatch,
  renamePatch,
  savePatch,
  type Store,
} from './library.js'

// Storage is a parameter, so all of this runs in Node against a plain Map. That is the whole reason it is a
// parameter — a library nobody can test is a library that quietly loses somebody's patches.

function memory(): Store & { data: Map<string, string>; fail?: boolean } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      if (this.fail) throw new Error('quota')
      data.set(key, value)
    },
  }
}

let store: ReturnType<typeof memory>
const acid = () => PATCHES[0].build()

beforeEach(() => {
  store = memory()
})

describe('saving and loading by name', () => {
  it('round-trips a patch', () => {
    expect(savePatch('Mine', acid(), store)).toBe(true)
    expect(loadPatch('Mine', store)).toEqual(acid())
  })

  it('lists what has been saved, newest first', () => {
    // The order somebody looks in for the patch they just saved.
    savePatch('One', acid(), store)
    savePatch('Two', acid(), store)
    expect(listPatches(store).map((p) => p.name)).toEqual(['Two', 'One'])
  })

  it('replaces a patch saved under a name already in use', () => {
    savePatch('Mine', acid(), store)
    const edited: Patch = { modules: [{ id: 'a', type: 'vco' }], cables: [] }
    savePatch('Mine', edited, store)
    expect(listPatches(store)).toHaveLength(1)
    expect(loadPatch('Mine', store)).toEqual(edited)
  })

  it('trims a name, and refuses one that is only spaces', () => {
    expect(savePatch('  Spaced  ', acid(), store)).toBe(true)
    expect(listPatches(store)[0].name).toBe('Spaced')
    expect(savePatch('   ', acid(), store)).toBe(false)
  })

  it('is null for a name that was never saved', () => {
    expect(loadPatch('nothing', store)).toBeNull()
  })

  it('says so when storage refuses the write', () => {
    // Unlike the autosave, a save somebody asked for by name is one they will expect to find again — so the
    // caller has to be able to tell them it did not happen.
    store.fail = true
    expect(savePatch('Mine', acid(), store)).toBe(false)
  })

  it('survives having no storage at all', () => {
    // Private browsing, or a blocked third-party context. A missing library, not a broken page.
    expect(listPatches(null)).toEqual([])
    expect(loadPatch('Mine', null)).toBeNull()
    expect(savePatch('Mine', acid(), null)).toBe(false)
    expect(deletePatch('Mine', null)).toBe(false)
  })
})

describe('deleting and renaming', () => {
  beforeEach(() => {
    savePatch('One', acid(), store)
    savePatch('Two', acid(), store)
  })

  it('deletes one and leaves the rest', () => {
    expect(deletePatch('One', store)).toBe(true)
    expect(listPatches(store).map((p) => p.name)).toEqual(['Two'])
  })

  it('reports a delete that matched nothing', () => {
    expect(deletePatch('Three', store)).toBe(false)
    expect(listPatches(store)).toHaveLength(2)
  })

  it('renames without changing the order', () => {
    expect(renamePatch('One', 'Uno', store)).toBe(true)
    expect(listPatches(store).map((p) => p.name)).toEqual(['Two', 'Uno'])
    expect(loadPatch('Uno', store)).toEqual(acid())
  })

  it('refuses to rename over an existing patch', () => {
    // The one operation in a library nobody forgives is the one that silently destroys something.
    expect(renamePatch('One', 'Two', store)).toBe(false)
    expect(listPatches(store)).toHaveLength(2)
    expect(loadPatch('One', store)).not.toBeNull()
  })

  it('refuses an empty new name, or renaming to itself', () => {
    expect(renamePatch('One', '   ', store)).toBe(false)
    expect(renamePatch('One', 'One', store)).toBe(false)
  })
})

describe('reading a library somebody else wrote', () => {
  it('ignores entries it cannot understand', () => {
    store.data.set(
      'driftbox.patches.v1',
      JSON.stringify([null, 7, { name: '' }, { name: 'ok', text: '{}' }, { text: 'no name' }]),
    )
    expect(listPatches(store).map((p) => p.name)).toEqual(['ok'])
  })

  it('keeps the first of two entries sharing a name', () => {
    // A duplicate name makes every operation ambiguous and there is no repair but picking one.
    store.data.set(
      'driftbox.patches.v1',
      JSON.stringify([
        { name: 'same', text: '{"v":1,"patch":{"modules":[],"cables":[]}}' },
        { name: 'same', text: '{}' },
      ]),
    )
    expect(listPatches(store)).toHaveLength(1)
  })

  it('ignores a library that is not a list, or not JSON', () => {
    for (const junk of ['{}', 'null', '7', 'not json at all', '']) {
      store.data.set('driftbox.patches.v1', junk)
      expect(listPatches(store)).toEqual([])
    }
  })

  it('is null rather than a throw for a saved entry that is not a patch', () => {
    store.data.set('driftbox.patches.v1', JSON.stringify([{ name: 'bad', text: 'garbage' }]))
    expect(listPatches(store)).toHaveLength(1)
    expect(loadPatch('bad', store)).toBeNull()
  })
})

describe('picking a name that is free', () => {
  it('uses the one asked for when nothing has it', () => {
    expect(freshName('Acid', store)).toBe('Acid')
  })

  it('numbers upward past what is taken', () => {
    savePatch('Acid', acid(), store)
    expect(freshName('Acid', store)).toBe('Acid 2')
    savePatch('Acid 2', acid(), store)
    expect(freshName('Acid', store)).toBe('Acid 3')
  })

  it('falls back to something rather than nothing', () => {
    expect(freshName('  ', store)).toBe('Patch')
  })
})
