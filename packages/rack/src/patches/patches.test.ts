import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { applyModulation } from '../modulation.js'
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

  it('demonstrates a range rather than one instrument with several settings', () => {
    // If every patch had a sequencer and an oscillator this would be a bank of settings, which is the
    // opposite of what a modular is for.
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

describe('the patches built on a break', () => {
  // A Sampler with no data is silent, so these two things have to agree or the patch arrives broken — which
  // is the same "silent no-op" failure the Stop button and the breaks picker both shipped with once.

  const needing = PATCHES.filter((preset) => preset.needsBreak)

  it('exist at all, because that is the point of phase D', () => {
    expect(needing.length).toBeGreaterThan(0)
  })

  it('have somewhere to put the break they ask for', () => {
    for (const preset of needing) {
      const patch = preset.build()
      const samplers = patch.modules.filter((m) => m.type === 'sampler')
      expect(samplers.length, preset.id).toBeGreaterThan(0)
      // `needsBreak` makes the catalogue readable; `break` is the document metadata that survives a save,
      // download or shared URL. If they diverge the first play works and every reopened copy loses its drums.
      expect(patch.break, preset.id).toBe(preset.needsBreak)
    }
  })

  it('are at a tempo the break can be rendered to', () => {
    // A break only slices cleanly at the tempo it was rendered at, so a patch that names one has to state a
    // tempo for the host to render against. Undefined would silently mean 120.
    for (const preset of needing) {
      const { tempo } = preset.build()
      expect(tempo, preset.id).toBeGreaterThanOrEqual(160)
      expect(tempo, preset.id).toBeLessThanOrEqual(180)
    }
  })
})

describe('the patterns inside the patches', () => {
  it('only put data in slots the module actually reads', () => {
    // Data is addressed by string, so a typo is silence rather than an error — `lane5` on a four-lane
    // Tracker or `repeat` on an Arranger would simply never be read.
    const slots: Record<string, RegExp> = {
      tracker: /^lane[1-4]$/,
      arranger: /^(patterns|repeats)$/,
    }
    for (const preset of PATCHES) {
      for (const module of preset.build().modules) {
        if (!module.data) continue
        expect(slots[module.type], `${preset.id}/${module.id}`).toBeDefined()
        for (const slot of Object.keys(module.data)) {
          expect(slot, `${preset.id}/${module.id}`).toMatch(slots[module.type])
        }
      }
    }
  })

  it('writes no more than eight complete patterns to a tracker bank', () => {
    // Patterns are stored end to end. Before banks existed this test allowed only `length` values, which
    // quietly prevented a shipped patch from using the feature the Tracker's faceplate already exposed.
    // A partial final pattern is legal while editing, but not in a preset: it is an invisible short bar.
    for (const preset of PATCHES) {
      for (const module of preset.build().modules) {
        if (module.type !== 'tracker' || !module.data) continue
        const length = module.params?.length ?? 16
        const patterns =
          (MODULES.tracker.params.find((param) => param.id === 'pattern')?.max ?? 7) + 1
        for (const [slot, values] of Object.entries(module.data)) {
          expect(values.length, `${preset.id}/${module.id}/${slot}`).toBeLessThanOrEqual(
            length * patterns,
          )
          expect(values.length, `${preset.id}/${module.id}/${slot}`).toBeGreaterThan(0)
          expect(values.length % length, `${preset.id}/${module.id}/${slot}`).toBe(0)
        }
      }
    }
  })

  it('keeps a slice lane inside the sampler’s slice count', () => {
    // The Unit-mode trick only holds while the two agree. A lane value above the slice count still plays —
    // the Sampler wraps — but it plays a different slice than the one written, which is the sort of wrong
    // that is impossible to see in the source.
    for (const preset of PATCHES) {
      const patch = preset.build()
      const sampler = patch.modules.find((m) => m.type === 'sampler')
      if (!sampler) continue
      const slices = sampler.params?.slices ?? 16
      for (const module of patch.modules) {
        if (module.type !== 'tracker' || !module.data) continue
        // Whichever lanes are in Unit mode are the ones feeding a slice inlet.
        for (let lane = 1; lane <= 4; lane++) {
          if (module.params?.[`unit${lane}`] !== 1) continue
          for (const value of module.data[`lane${lane}`] ?? []) {
            expect(value, `${preset.id} lane${lane}`).toBeLessThanOrEqual(slices)
            expect(value, `${preset.id} lane${lane}`).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })

  it('has something to say on every lane it declares', () => {
    // A lane of nothing but rests is a lane somebody meant to write and did not.
    for (const preset of PATCHES) {
      for (const module of preset.build().modules) {
        if (module.type !== 'tracker' || !module.data) continue
        for (const [slot, values] of Object.entries(module.data)) {
          expect(values.some((v) => v !== 0), `${preset.id}/${slot}`).toBe(true)
        }
      }
    }
  })
})

describe('the hero song', () => {
  const hero = () => patchPresetById('pressure-system')!.build()

  it('opens with every Combinator target already settled', () => {
    // Loading runs all routes once. If a target is even a floating-point whisker away from its routed value,
    // the stored copy differs from the catalogue and can no longer recover its title after a reload.
    const patch = hero()
    expect(applyModulation(patch, MODULES)).toBe(patch)
  })

  it('is an arrangement, not a one-bar patch', () => {
    const patch = hero()
    const arranger = patch.modules.find((module) => module.type === 'arranger')
    expect(arranger).toBeDefined()
    expect(arranger?.data?.patterns.length).toBeGreaterThanOrEqual(8)
    expect(arranger?.data?.repeats.reduce((sum, bars) => sum + bars, 0)).toBeGreaterThanOrEqual(32)

    const trackers = patch.modules.filter((module) => module.type === 'tracker')
    expect(trackers.length).toBeGreaterThanOrEqual(2)
    for (const tracker of trackers) {
      expect(Math.max(...Object.values(tracker.data ?? {}).map((lane) => lane.length))).toBe(
        (tracker.params?.length ?? 16) * 8,
      )
    }
  })

  it('puts the rack-native signature devices in the composition', () => {
    const types = new Set(hero().modules.map((module) => module.type))
    for (const type of ['sampler', 'arranger', 'combi', 'alligator', 'vocoder', 'compressor']) {
      expect(types, type).toContain(type)
    }
  })

  it('has playable macro routing rather than an ornamental Combinator', () => {
    const routes = hero().modulation ?? []
    const controls = new Set(routes.map((route) => route.from.join('.')))
    for (let rotary = 1; rotary <= 4; rotary++) {
      expect(controls).toContain(`combi-1.rotary${rotary}`)
    }
    expect(routes.length).toBeGreaterThanOrEqual(12)
  })
})
