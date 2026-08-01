import { SONGS } from '@driftbox/engine'
import { PATCHES, embedGrooveboxSong, type Patch } from '@driftbox/rack'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteDocument,
  freshName,
  listDocuments,
  loadDocument,
  loadSong,
  renameDocument,
  savePatch,
  saveSong,
  type Store,
} from './document-library.js'

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
const song = () => SONGS[0].build()
const patch = () => PATCHES[0].build()

beforeEach(() => {
  store = memory()
})

describe('one typed document shelf', () => {
  it('stores songs and patches together, newest first', () => {
    expect(savePatch('Rack', patch(), store)).toBe(true)
    expect(saveSong('Tune', song(), store)).toBe(true)
    expect(listDocuments(store).map(({ name, kind }) => [name, kind])).toEqual([
      ['Tune', 'song'],
      ['Rack', 'patch'],
    ])
  })

  it('records compatibility without decoding the document while listing', () => {
    saveSong('Tune', song(), store)
    savePatch('Native', { modules: [], cables: [] }, store)
    savePatch('Portable', embedGrooveboxSong(song()), store)
    expect(listDocuments(store).map(({ name, compatibility }) => [name, compatibility])).toEqual([
      ['Portable', 'groovebox-compatible'],
      ['Native', 'rack-native'],
      ['Tune', 'groovebox-compatible'],
    ])
  })

  it('loads a document as its real type', () => {
    saveSong('Tune', song(), store)
    savePatch('Rack', patch(), store)
    expect(loadDocument('Tune', store)).toEqual({ kind: 'song', song: song() })
    expect(loadDocument('Rack', store)).toEqual({ kind: 'patch', patch: patch() })
  })

  it('can recover the retained song from a compatible rack document', () => {
    savePatch('Portable', embedGrooveboxSong(song()), store)
    expect(loadSong('Portable', store)).toEqual(song())
  })

  it('will not flatten the retained song out of a rack-extended document', () => {
    const extended = embedGrooveboxSong(song(), {
      modules: [{ id: 'osc', type: 'vco' }],
      cables: [],
    })
    savePatch('Extended', extended, store)
    expect(loadSong('Extended', store)).toBeNull()
  })

  it('uses one name namespace, replacing the prior document deliberately', () => {
    saveSong('Mine', song(), store)
    const replacement: Patch = { modules: [], cables: [] }
    savePatch('Mine', replacement, store)
    expect(listDocuments(store)).toHaveLength(1)
    expect(loadDocument('Mine', store)).toEqual({ kind: 'patch', patch: replacement })
  })
})

describe('migration from the patch shelf', () => {
  it('lists legacy patches when the shared shelf has not been written', () => {
    store.data.set(
      'driftbox.patches.v1',
      JSON.stringify([{ name: 'Old rack', text: JSON.stringify({ v: 1, patch: patch() }) }]),
    )
    expect(listDocuments(store).map(({ name, kind }) => [name, kind])).toEqual([
      ['Old rack', 'patch'],
    ])
  })

  it('carries legacy patches into the shared shelf on the first new save', () => {
    store.data.set(
      'driftbox.patches.v1',
      JSON.stringify([{ name: 'Old rack', text: JSON.stringify({ v: 1, patch: patch() }) }]),
    )
    saveSong('New tune', song(), store)
    expect(listDocuments(store).map(({ name, kind }) => [name, kind])).toEqual([
      ['New tune', 'song'],
      ['Old rack', 'patch'],
    ])
    expect(store.data.has('driftbox.documents.v1')).toBe(true)
  })
})

describe('shared management', () => {
  beforeEach(() => {
    savePatch('Rack', patch(), store)
    saveSong('Tune', song(), store)
  })

  it('renames either kind without changing its place', () => {
    expect(renameDocument('Rack', 'System', store)).toBe(true)
    expect(listDocuments(store).map(({ name }) => name)).toEqual(['Tune', 'System'])
  })

  it('refuses to rename over any other document kind', () => {
    expect(renameDocument('Rack', 'Tune', store)).toBe(false)
    expect(listDocuments(store)).toHaveLength(2)
  })

  it('deletes either kind and leaves the other alone', () => {
    expect(deleteDocument('Tune', store)).toBe(true)
    expect(listDocuments(store).map(({ name }) => name)).toEqual(['Rack'])
  })

  it('chooses a free name across both kinds', () => {
    expect(freshName('Tune', store)).toBe('Tune 2')
  })
})

describe('unavailable or damaged storage', () => {
  it('fails soft when storage is absent or full', () => {
    expect(listDocuments(null)).toEqual([])
    expect(saveSong('Tune', song(), null)).toBe(false)
    store.fail = true
    expect(savePatch('No room', patch(), store)).toBe(false)
  })

  it('ignores malformed entries without losing usable neighbours', () => {
    store.data.set(
      'driftbox.documents.v1',
      JSON.stringify([
        null,
        { name: 'bad', kind: 'thing', compatibility: 'rack-native', text: '{}' },
        {
          name: 'kept',
          kind: 'song',
          compatibility: 'rack-native',
          text: 'not decoded while listing',
        },
      ]),
    )
    expect(listDocuments(store)).toEqual([
      {
        name: 'kept',
        kind: 'song',
        compatibility: 'groovebox-compatible',
        text: 'not decoded while listing',
      },
    ])
    expect(loadDocument('kept', store)).toBeNull()
  })
})
