import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { MODULES } from '../modules/index.js'
import { decodePatch, encodePatch } from '../patch-io.js'
import { PATCHES, patchPresetById } from './index.js'

// A shipped patch that does not work is worse than no shipped patch: it is the first thing anybody sees, and
// a dangling cable or a param that no longer exists reads as the whole rack being broken. Every one of them
// is compiled here against the real registry, and the compiler's own notes are the assertion — it reports
// exactly the mistakes a hand-written patch makes.

describe.each(PATCHES.map((preset) => [preset.id, preset] as const))('the %s patch', (_id, preset) => {
  it('is a fresh object every time it is built', () => {
    // Same reasoning as `clonePatterns` in the engine: two calls handing back the same objects means
    // anything that edited one would edit the shipped patch permanently, and `reset` would restore the
    // corrupted version. Nothing mutates a patch today; "safe as long as nobody writes to it" is not a
    // property worth relying on.
    const a = preset.build()
    const b = preset.build()
    expect(a).not.toBe(b)
    expect(a.modules[0]).not.toBe(b.modules[0])
    expect(a).toEqual(b)
  })

  it('compiles with nothing dropped, nothing missing and nothing left over', () => {
    const plan = compile(preset.build(), MODULES)
    const complain = (kind: string) =>
      plan.notes.filter((note) => note.kind === kind).map((note) => note.detail)

    expect(complain('dropped-cable')).toEqual([])
    expect(complain('placeholder')).toEqual([])
    expect(complain('duplicate-module')).toEqual([])
    expect(complain('replaced-cable')).toEqual([])
  })

  it('reaches the output', () => {
    // A patch with no terminal module, or one whose chain never arrives at it, is silent — which is the one
    // failure a listener would blame on the rack rather than on the patch.
    const plan = compile(preset.build(), MODULES)
    expect(plan.outputs.length).toBeGreaterThan(0)
    expect(plan.nodes.length).toBeGreaterThan(1)
  })

  it('only sets params that exist, within their ranges', () => {
    for (const module of preset.build().modules) {
      const def = MODULES[module.type]
      expect(def, module.type).toBeDefined()
      for (const [id, value] of Object.entries(module.params ?? {})) {
        const param = def.params.find((p) => p.id === id)
        expect(param, `${module.type}.${id}`).toBeDefined()
        expect(value, `${module.type}.${id}`).toBeGreaterThanOrEqual(param!.min)
        expect(value, `${module.type}.${id}`).toBeLessThanOrEqual(param!.max)
      }
    }
  })

  it('round-trips through the patch format unchanged', () => {
    expect(decodePatch(encodePatch(preset.build()))).toEqual(preset.build())
  })

  it('has a name and a blurb worth showing', () => {
    expect(preset.name).not.toBe('')
    expect(preset.blurb.length).toBeGreaterThan(10)
    expect(preset.blurb.length).toBeLessThan(60)
  })
})

describe('the patch library', () => {
  it('has unique ids and names', () => {
    expect(new Set(PATCHES.map((p) => p.id)).size).toBe(PATCHES.length)
    expect(new Set(PATCHES.map((p) => p.name)).size).toBe(PATCHES.length)
  })

  it('finds a preset by id, and nothing by a wrong one', () => {
    expect(patchPresetById('acid')?.name).toBe('Acid')
    expect(patchPresetById('nonesuch')).toBeUndefined()
  })

  it('demonstrates a range rather than four of the same thing', () => {
    // The point of shipping four. If they all had a sequencer and an oscillator they would be four settings
    // of one instrument, which is the opposite of what a modular is for.
    const uses = (id: string, type: string) =>
      patchPresetById(id)!.build().modules.some((m) => m.type === type)

    expect(uses('drone', 'seq')).toBe(false)
    expect(uses('generative', 'seq')).toBe(false)
    expect(uses('percussion', 'vco')).toBe(false)
    expect(uses('acid', 'seq')).toBe(true)

    // And between them they exercise most of the rack.
    const covered = new Set(PATCHES.flatMap((p) => p.build().modules.map((m) => m.type)))
    expect(covered.size).toBeGreaterThanOrEqual(12)
  })
})
