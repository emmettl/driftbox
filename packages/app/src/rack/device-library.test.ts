import { MODULES } from '@driftbox/rack'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteDevicePatch,
  freshDevicePatchName,
  listDevicePatches,
  saveDevicePatch,
  type Store,
} from './device-library.js'

// Storage nobody can be stopped from editing, read on every render of every faceplate. The claims worth
// pinning are that it survives rubbish, that it never hands a module a value its knob could not produce,
// and that saving twice does not quietly destroy the first one.

function memory(initial?: string): Store {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set('driftbox.devicepatches.v1', initial)
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

let store: Store

beforeEach(() => {
  store = memory()
})

describe('saving and reading back', () => {
  it('keeps a patch for the device it was saved against', () => {
    saveDevicePatch('ladder', 'Mine', { cutoff: 400, resonance: 0.8 }, store)
    expect(listDevicePatches('ladder', store)).toMatchObject([
      { type: 'ladder', name: 'Mine', params: { cutoff: 400, resonance: 0.8 } },
    ])
    expect(listDevicePatches('svf', store)).toEqual([])
  })

  it('replaces a patch of the same name rather than shelving two', () => {
    // What a save button means when the name is already on the shelf. The document library takes the
    // same line.
    saveDevicePatch('ladder', 'Mine', { cutoff: 400 }, store)
    saveDevicePatch('ladder', 'Mine', { cutoff: 900 }, store)
    const list = listDevicePatches('ladder', store)
    expect(list).toHaveLength(1)
    expect(list[0].params.cutoff).toBe(900)
  })

  it('lets two devices both have a Warm', () => {
    // Ids are unique per type, not globally, because a patch is only ever offered against its own device.
    saveDevicePatch('ladder', 'Warm', { cutoff: 700 }, store)
    saveDevicePatch('drive', 'Warm', { drive: 3 }, store)
    expect(listDevicePatches('ladder', store)).toHaveLength(1)
    expect(listDevicePatches('drive', store)).toHaveLength(1)
  })

  it('refuses a name of nothing', () => {
    expect(saveDevicePatch('ladder', '   ', { cutoff: 400 }, store)).toBe(false)
    expect(listDevicePatches('ladder', store)).toEqual([])
  })

  it('deletes one without touching the other device', () => {
    saveDevicePatch('ladder', 'Mine', { cutoff: 400 }, store)
    saveDevicePatch('drive', 'Mine', { drive: 8 }, store)
    expect(deleteDevicePatch('ladder', 'mine', store)).toBe(true)
    expect(listDevicePatches('ladder', store)).toEqual([])
    expect(listDevicePatches('drive', store)).toHaveLength(1)
  })

  it('reports a delete that removed nothing', () => {
    expect(deleteDevicePatch('ladder', 'nope', store)).toBe(false)
  })
})

describe('what it hands a module', () => {
  it('completes a stored patch against the def', () => {
    // The audio thread hears about a param because the patch changed. A knob the stored patch never
    // mentioned would be left wherever the last preset put it, and the panel would disagree with it.
    saveDevicePatch('ladder', 'Mine', { cutoff: 400 }, store)
    const params = listDevicePatches('ladder', store)[0].params
    expect(Object.keys(params).sort()).toEqual(['cutoff', 'resonance'])
    expect(params.resonance).toBe(MODULES.ladder.params.find((p) => p.id === 'resonance')!.default)
  })

  it('clamps a value the knob could not have produced', () => {
    // A patch written when a param had a wider range, or edited by hand in the devtools console. Nothing
    // downstream is written to expect a cutoff past the module's own limit.
    const max = MODULES.ladder.params.find((p) => p.id === 'cutoff')!.max
    saveDevicePatch('ladder', 'Wild', { cutoff: max * 10, resonance: -4 }, store)
    const params = listDevicePatches('ladder', store)[0].params
    expect(params.cutoff).toBe(max)
    expect(params.resonance).toBe(0)
  })

  it('keeps a patch for a device this build does not have', () => {
    // Kept rather than dropped, for the same reason the compiler keeps an unknown module: the build that
    // wrote it may well be opened again, and silently deleting somebody's work is not a repair.
    saveDevicePatch('wavefolder', 'Mine', { fold: 3 }, store)
    expect(listDevicePatches('wavefolder', store)).toHaveLength(1)
  })
})

describe('surviving what it may be handed', () => {
  it('reads nothing out of nothing', () => {
    expect(listDevicePatches('ladder', memory())).toEqual([])
  })

  it('reads nothing out of rubbish', () => {
    expect(listDevicePatches('ladder', memory('not json'))).toEqual([])
    expect(listDevicePatches('ladder', memory('{"nope":1}'))).toEqual([])
  })

  it('skips a malformed entry and keeps the rest', () => {
    const text = JSON.stringify([
      { id: 'ok', type: 'ladder', name: 'Good', params: { cutoff: 400 } },
      { id: '', type: 'ladder', name: 'No id', params: {} },
      { id: 'noname', type: 'ladder', name: '  ', params: {} },
      { id: 'notparams', type: 'ladder', name: 'Bad', params: [1, 2] },
      'string',
      null,
    ])
    expect(listDevicePatches('ladder', memory(text)).map((p) => p.name)).toEqual(['Good'])
  })

  it('drops a stored init, because Init is synthesised', () => {
    // A stored one would appear in the bank twice under the same id, and the second would shadow the way
    // back to the defaults.
    const text = JSON.stringify([{ id: 'init', type: 'ladder', name: 'Init', params: {} }])
    expect(listDevicePatches('ladder', memory(text))).toEqual([])
  })

  it('drops a param that is not a number', () => {
    const text = JSON.stringify([
      { id: 'x', type: 'ladder', name: 'X', params: { cutoff: 'loud', resonance: 0.5 } },
    ])
    const params = listDevicePatches('ladder', memory(text))[0].params
    expect(params.cutoff).toBe(MODULES.ladder.params.find((p) => p.id === 'cutoff')!.default)
    expect(params.resonance).toBe(0.5)
  })

  it('survives storage that refuses to be written to', () => {
    // Private browsing, or a quota that is already full. A save that cannot happen says so rather than
    // throwing on the way to a render.
    const full: Store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(saveDevicePatch('ladder', 'Mine', { cutoff: 400 }, full)).toBe(false)
  })

  it('survives having no storage at all', () => {
    expect(listDevicePatches('ladder', null)).toEqual([])
    expect(saveDevicePatch('ladder', 'Mine', { cutoff: 400 }, null)).toBe(false)
  })
})

describe('naming the next one', () => {
  it('leaves a free name alone', () => {
    expect(freshDevicePatchName('ladder', 'Mine', store)).toBe('Mine')
  })

  it('steps past a taken one, so a second save does not destroy the first', () => {
    saveDevicePatch('ladder', 'Mine', { cutoff: 400 }, store)
    expect(freshDevicePatchName('ladder', 'Mine', store)).toBe('Mine 2')
    saveDevicePatch('ladder', 'Mine 2', { cutoff: 500 }, store)
    expect(freshDevicePatchName('ladder', 'Mine', store)).toBe('Mine 3')
  })

  it('only counts the same device as taken', () => {
    saveDevicePatch('drive', 'Mine', { drive: 3 }, store)
    expect(freshDevicePatchName('ladder', 'Mine', store)).toBe('Mine')
  })

  it('names an unnamed one', () => {
    expect(freshDevicePatchName('ladder', '   ', store)).toBe('Patch')
  })
})
