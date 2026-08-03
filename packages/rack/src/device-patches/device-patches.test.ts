import { describe, expect, it } from 'vitest'
import { MODULES } from '../modules/index.js'
import {
  DEVICE_PATCHES,
  completeParams,
  devicePatchesFor,
  initDevicePatch,
} from './index.js'

// A bank of knob settings is data, and data written by hand goes wrong quietly: a param renamed on the def
// leaves a patch silently setting nothing, and a value outside a knob's range is clamped somewhere far from
// here. None of that fails loudly at runtime, so it has to fail here.

describe('the factory bank', () => {
  it('names a module type that exists', () => {
    for (const patch of DEVICE_PATCHES) {
      expect(MODULES[patch.type], `${patch.type}/${patch.id}`).toBeDefined()
    }
  })

  it('only sets params its device actually has', () => {
    // The failure this exists for: a def renames `cut` to `cutoff` and every patch touching it goes on
    // loading, setting a key nothing reads, leaving the real knob at its default. Silent, and it looks
    // like the browser is broken rather than the data.
    for (const patch of DEVICE_PATCHES) {
      const def = MODULES[patch.type]
      const known = new Set(def.params.map((param) => param.id))
      for (const id of Object.keys(patch.params)) {
        expect(known.has(id), `${patch.type}/${patch.id}: ${id}`).toBe(true)
      }
    }
  })

  it('stays inside every knob it sets', () => {
    for (const patch of DEVICE_PATCHES) {
      const def = MODULES[patch.type]
      for (const [id, value] of Object.entries(patch.params)) {
        const param = def.params.find((candidate) => candidate.id === id)!
        expect(Number.isFinite(value), `${patch.type}/${patch.id}: ${id}`).toBe(true)
        expect(value, `${patch.type}/${patch.id}: ${id}`).toBeGreaterThanOrEqual(param.min)
        expect(value, `${patch.type}/${patch.id}: ${id}`).toBeLessThanOrEqual(param.max)
      }
    }
  })

  it('lands a stepped param on a step', () => {
    // A shape knob at 1.5 is not a shape. The processors round, so this would not crash — it would just
    // mean the preset played something other than what its name says.
    for (const patch of DEVICE_PATCHES) {
      const def = MODULES[patch.type]
      for (const [id, value] of Object.entries(patch.params)) {
        const param = def.params.find((candidate) => candidate.id === id)!
        if (!param.stepped) continue
        expect(Number.isInteger(value), `${patch.type}/${patch.id}: ${id}`).toBe(true)
      }
    }
  })

  it('gives each device unique patch ids, and leaves init alone', () => {
    // Unique per type rather than globally — two devices may both have a `warm`, because a patch is only
    // ever offered against the device it belongs to. `init` is reserved: it is synthesised, and an
    // authored one would appear twice in the bank with the same id.
    const seen = new Map<string, Set<string>>()
    for (const patch of DEVICE_PATCHES) {
      expect(patch.id, `${patch.type}/${patch.id}`).not.toBe('init')
      const forType = seen.get(patch.type) ?? new Set<string>()
      expect(forType.has(patch.id), `${patch.type}/${patch.id}`).toBe(false)
      forType.add(patch.id)
      seen.set(patch.type, forType)
    }
  })

  it('gives each device unique patch names, so the browser reads as a list', () => {
    const seen = new Map<string, Set<string>>()
    for (const patch of DEVICE_PATCHES) {
      expect(patch.name.trim()).not.toBe('')
      const forType = seen.get(patch.type) ?? new Set<string>()
      expect(forType.has(patch.name), `${patch.type}: ${patch.name}`).toBe(false)
      forType.add(patch.name)
      seen.set(patch.type, forType)
    }
  })

  it('says something, rather than restating the defaults', () => {
    // A patch identical to Init is a row in the browser that does nothing. Cheap to write by accident
    // when a default moves underneath one.
    for (const patch of DEVICE_PATCHES) {
      const def = MODULES[patch.type]
      const moved = Object.entries(patch.params).some(([id, value]) => {
        const param = def.params.find((candidate) => candidate.id === id)!
        return param.default !== value
      })
      expect(moved, `${patch.type}/${patch.id}`).toBe(true)
    }
  })
})

describe('completing a patch against its device', () => {
  it('states every knob, not only the ones the patch mentions', () => {
    // The reason this function exists. The host pushes params by diffing the patch, so a knob a patch
    // does not mention is a knob the audio thread is never told about — it keeps what the last patch
    // left there. Loading Init after Acid would leave the resonance up while the panel drew it down.
    const def = MODULES.ladder
    const complete = completeParams(def, { cutoff: 500 })
    expect(Object.keys(complete).sort()).toEqual(['cutoff', 'resonance'])
    expect(complete.cutoff).toBe(500)
    expect(complete.resonance).toBe(def.params.find((p) => p.id === 'resonance')!.default)
  })

  it('leaves out the params the host writes rather than the user', () => {
    // The MIDI module's note, gate and velocity are performance, not settings. Baking the last note
    // played into a preset and re-sounding it on load is not what a browser is for.
    const def = MODULES.midi
    expect(def.params.some((param) => param.hidden)).toBe(true)
    const complete = completeParams(def)
    for (const param of def.params) {
      expect(param.id in complete, param.id).toBe(!param.hidden)
    }
  })

  it('ignores a value that is not a number', () => {
    // Device patches come out of localStorage, which anybody can edit and an older build may have
    // written differently. A NaN reaching a param would silence the module it landed in.
    const def = MODULES.ladder
    const complete = completeParams(def, { cutoff: Number.NaN })
    expect(complete.cutoff).toBe(def.params.find((p) => p.id === 'cutoff')!.default)
  })
})

describe('every device having a bank', () => {
  it('gives one to every module in the registry, Init first', () => {
    // Derived rather than authored, so adding a module stays a class, a def and a test — and it arrives
    // with a working browser and a way back to its defaults.
    for (const def of Object.values(MODULES)) {
      const bank = devicePatchesFor(def)
      expect(bank.length, def.type).toBeGreaterThan(0)
      expect(bank[0].id, def.type).toBe('init')
      expect(bank.every((patch) => patch.type === def.type), def.type).toBe(true)
    }
  })

  it('makes Init the defaults, so it cannot go stale when one moves', () => {
    const def = MODULES.voice
    const init = initDevicePatch(def)
    for (const param of def.params) {
      if (param.hidden) continue
      expect(init.params[param.id], param.id).toBe(param.default)
    }
  })

  it('offers a device only its own patches', () => {
    const ladder = devicePatchesFor(MODULES.ladder)
    expect(ladder.some((patch) => patch.name === 'Acid')).toBe(true)
    expect(ladder.some((patch) => patch.name === 'Hall')).toBe(false)
  })
})
