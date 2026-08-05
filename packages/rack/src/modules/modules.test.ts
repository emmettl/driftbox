import { describe, expect, it } from 'vitest'
import { MODULES, MODULE_LIST } from './index.js'
import { channelCount, slotCount } from '../stereo.js'
import type { ModuleDef, Processor } from '../types.js'

// One suite that holds every module to the rules in `types.ts`, rather than sixteen suites each
// remembering to check the same six things.
//
// This is the highest-value test file in the package, because the rules it enforces are the ones a
// new module breaks by accident and that nothing else notices. A module that forgets to write its
// last outlet leaves the previous block's audio in the tail and sounds like a faint stutter. A
// module that writes to an inlet corrupts every other unconnected inlet in the patch. A module that
// captures a module-scope constant throws a ReferenceError on the audio thread and nowhere else.
//
// Every module added from here gets all of it for free by being in MODULE_LIST.

const SR = 44100
const FRAMES = 128

const deps = (def: ModuleDef): Record<string, unknown> => ({ ...def.deps })

/** No bulk data in the contract suite: every module has to work without any, because a patch can be built before
 *  a sample is loaded into it. A module that needed data to produce output would fail "writes every sample of
 *  every outlet" here, which is the right place to find out. */
const NO_DATA = { get: () => undefined }

function construct(def: ModuleDef, id = 'a-module'): Processor {
  return new def.processor(SR, deps(def), id, NO_DATA)
}

/** What each slot is called, so a failure names the channel rather than an index — `out (L)`, not `1`. */
function slotNames(ports: readonly ModuleDef['inlets'][number][]): string[] {
  return ports.flatMap((port) =>
    channelCount(port) === 2 ? [`${port.id} (L)`, `${port.id} (R)`] : [port.id],
  )
}

/** Buffers for one call: inlets holding a recognisable signal, outlets pre-filled with a value no
 *  module would produce, params at their defaults. */
function buffers(def: ModuleDef, fill = 0.25) {
  // Sized by SLOTS rather than by ports: a stereo port owns two buffers and its processor indexes them as
  // two. Getting this wrong would hand a stereo module one array where it expects two, and the failure
  // would be an undefined read inside the audio thread rather than a test that says so.
  const inlets = Array.from({ length: slotCount(def.inlets) }, () => new Float32Array(FRAMES).fill(fill))
  const outlets = Array.from({ length: slotCount(def.outlets) }, () =>
    new Float32Array(FRAMES).fill(-999),
  )
  const params = def.params.map((p) => new Float32Array(FRAMES).fill(p.default))
  return { inlets, outlets, params }
}

describe.each(MODULE_LIST.map((def) => [def.type, def] as const))('%s', (_type, def) => {
  it('has a coherent def', () => {
    expect(def.type).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(def.version).toBeGreaterThanOrEqual(1)
    expect(def.name).not.toBe('')
    // A module with no outlets can never be heard and can never be patched onward, so it could
    // only ever be a placeholder for something unfinished.
    expect(def.outlets.length).toBeGreaterThan(0)

    for (const ports of [def.inlets, def.outlets]) {
      const ids = ports.flatMap((port) => [port.id, ...(port.aliases?.map((alias) => alias.id) ?? [])])
      expect(new Set(ids).size).toBe(ids.length)
      for (const port of ports) {
        expect(port.id).not.toBe('')
        for (const alias of port.aliases ?? []) {
          expect(alias.id).not.toBe('')
          if (alias.channel !== undefined) expect(port.stereo).toBe(true)
        }
      }
    }
    expect(new Set(def.params.map((p) => p.id)).size).toBe(def.params.length)
  })

  it('has params whose defaults are inside their own range', () => {
    for (const param of def.params) {
      expect(param.min).toBeLessThan(param.max)
      expect(param.default).toBeGreaterThanOrEqual(param.min)
      expect(param.default).toBeLessThanOrEqual(param.max)
      // A stepped param whose range is not whole numbers cannot land on its own values.
      if (param.stepped) {
        expect(Number.isInteger(param.min)).toBe(true)
        expect(Number.isInteger(param.max)).toBe(true)
        expect(Number.isInteger(param.default)).toBe(true)
      }
    }
  })

  it('writes every sample of every outlet', () => {
    // Buffers are reused across blocks and never cleared, so a partial write leaves the previous
    // block's audio in the tail — a faint stutter at the block rate, and nothing else would catch
    // it because the first block sounds correct.
    const { inlets, outlets, params } = buffers(def)
    construct(def).process(inlets, outlets, params, FRAMES)
    for (const [index, outlet] of outlets.entries()) {
      expect(
        firstBad(outlet, (x) => x !== -999 && Number.isFinite(x)),
        `${slotNames(def.outlets)[index]} was left unwritten`,
      ).toBe(-1)
    }
  })

  it('never writes to an inlet', () => {
    // Inlet buffers are shared: one outlet feeding three inlets is one buffer read three times, and
    // an unconnected inlet is the graph's single zero buffer. A module that wrote to one would
    // invent a signal for every unconnected inlet in the patch at once.
    const { inlets, outlets, params } = buffers(def)
    const before = inlets.map((buffer) => [...buffer])
    construct(def).process(inlets, outlets, params, FRAMES)
    for (const [index, inlet] of inlets.entries()) {
      expect([...inlet], `${slotNames(def.inlets)[index]} was modified`).toEqual(before[index])
    }
  })

  it('never writes to a param buffer', () => {
    // Same reasoning: the Graph owns those buffers and refills them only when the knob moves, so a
    // module that scribbled on one would change its own parameter permanently.
    const { inlets, outlets, params } = buffers(def)
    const before = params.map((buffer) => [...buffer])
    construct(def).process(inlets, outlets, params, FRAMES)
    for (const [index, param] of params.entries()) {
      expect([...param], `${def.params[index].id} was modified`).toEqual(before[index])
    }
  })

  it('stays finite at both ends of every param, and with hostile inlets', () => {
    // Params arrive clamped by `compile`, but the ends of the range are exactly where a `tan` or a
    // reciprocal blows up, and an inlet is not clamped by anything at all — a cable from another
    // module's output can carry any value the patch produced.
    for (const extreme of ['min', 'max'] as const) {
      for (const signal of [0, 1, -1, 8, -8]) {
        const inlets = Array.from({ length: slotCount(def.inlets) }, () =>
          new Float32Array(FRAMES).fill(signal),
        )
        const outlets = Array.from({ length: slotCount(def.outlets) }, () => new Float32Array(FRAMES))
        const params = def.params.map((p) => new Float32Array(FRAMES).fill(p[extreme]))
        const processor = construct(def)
        // Several blocks, because a feedback path inside a module takes more than one to diverge.
        for (let block = 0; block < 8; block++) {
          processor.process(inlets, outlets, params, FRAMES)
        }
        for (const outlet of outlets) {
          expect(
            firstBad(outlet, Number.isFinite),
            `${def.type} went non-finite at ${extreme} params with inlets at ${signal}`,
          ).toBe(-1)
        }
      }
    }
  })

  it('is deterministic', () => {
    // Two instances with the same ID given the same input must agree, or none of the tests above
    // prove anything and a shared patch is not a shared sound. The id is why: anything random here
    // seeds from it rather than from `Math.random` or an instance counter, so rebuilding a graph
    // reproduces the noise instead of changing it.
    const run = () => {
      const { inlets, outlets, params } = buffers(def, 0.3)
      const processor = construct(def)
      const collected: number[][] = []
      for (let block = 0; block < 4; block++) {
        processor.process(inlets, outlets, params, FRAMES)
        collected.push(outlets.map((o) => [...o]).flat())
      }
      return collected
    }
    expect(run()).toEqual(run())
  })

  it('still works when serialised into a scope of its own', () => {
    // `worklet.ts` ships every one of these to the audio thread as `Class.toString()`, and an
    // AudioWorkletGlobalScope shares no scope with this module. If any of them grows a reference to
    // an import, a module constant, or a compiler helper emitted alongside it, this throws a
    // ReferenceError here rather than going silent in the browser on the first patch.
    const Rebuilt = new Function(
      `"use strict"; return ${def.processor.toString()}`,
    )() as typeof def.processor

    const original = buffers(def, 0.4)
    const copy = buffers(def, 0.4)
    construct(def).process(original.inlets, original.outlets, original.params, FRAMES)
    new Rebuilt(SR, deps(def), 'a-module', NO_DATA).process(
      copy.inlets,
      copy.outlets,
      copy.params,
      FRAMES,
    )

    expect(copy.outlets.map((o) => [...o])).toEqual(original.outlets.map((o) => [...o]))
  })

  it('declares every dep its processor asks for', () => {
    // A dep looked up by a key the def does not declare is `undefined`, and `new undefined()` is a
    // TypeError on the audio thread at the moment the patch loads.
    const asked = [...def.processor.toString().matchAll(/deps\.(\w+)/g)].map((m) => m[1])
    for (const name of asked) {
      expect(Object.keys(def.deps ?? {}), `${def.type} uses deps.${name}`).toContain(name)
    }
  })
})

/** The first index where `ok` fails, or −1. One assertion per array rather than one per sample —
 *  see the comment on the same helper in `modules/svf.test.ts`. */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

describe('the registry', () => {
  it('is keyed by type with nothing missing or duplicated', () => {
    expect(Object.keys(MODULES)).toHaveLength(MODULE_LIST.length)
    for (const def of MODULE_LIST) expect(MODULES[def.type]).toBe(def)
  })

  it('describes every module it ships', () => {
    // `blurb`, `group` and `logo` are optional on the type, because a module from somewhere else is merely
    // undescribed rather than broken without them. The shipped set is held to a higher bar: the picker
    // is a gallery now, and a module with nothing to say about itself is a blank card in it — which is
    // worse than the flat list of names it replaced, because the space it takes up promises an answer.
    for (const def of MODULE_LIST) {
      expect(def.group, def.type).toBeTruthy()
      expect(def.blurb, def.type).toBeTruthy()
      expect(def.logo?.paths.length, def.type).toBeGreaterThan(0)
      for (const path of def.logo!.paths) {
        expect(path.trim(), def.type).not.toBe('')
        expect(path, def.type).not.toMatch(/[<>]/)
      }
      // Two short sentences, not a manual. Anything much longer stops being read.
      expect(def.blurb!.length, def.type).toBeLessThan(190)
      expect(def.blurb!.endsWith('.'), def.type).toBe(true)
    }
  })

  it('gives the non-obvious devices a real guide rather than a longer catalogue blurb', () => {
    const guided = [
      'groovebox',
      'multisampler',
      'sampler',
      'alligator',
      'vocoder',
      'looper',
      'combi',
      'arranger',
      'tracker',
      'arp',
      'scale-player',
      'note-echo',
      // Not because it is complicated to patch — it is an oscillator — but because Position and PM both
      // behave unlike anything else on the Sources shelf, and a device whose two best features read as
      // ordinary knobs is exactly the case a generated control reference cannot cover.
      'wavetable',
      // Thirty-nine knobs, and the three that matter are not knobs at all: where a send sits in the
      // channel strip, what solo means on a module that is not the mix, and why a return goes one way.
      'line-mixer',
    ]

    for (const type of guided) {
      const guide = MODULES[type].guide
      expect(guide, type).toBeTruthy()
      expect(guide!.overview.length, `${type} overview`).toBeGreaterThan(80)
      expect(guide!.concepts.length, `${type} concepts`).toBeGreaterThanOrEqual(2)
      expect(guide!.firstPatch.length, `${type} first patch`).toBeGreaterThanOrEqual(3)
      for (const concept of guide!.concepts) {
        expect(concept.title.trim(), type).not.toBe('')
        expect(concept.body.length, `${type}: ${concept.title}`).toBeGreaterThan(60)
      }
    }
  })

  it('keeps each group together and in one place in the list', () => {
    // The picker walks the list once and starts a shelf whenever the group changes, so a module out of
    // group order would silently open a second "Filters" heading further down. Cheaper to hold the list
    // to the order than to make the picker sort and lose the deliberate order *within* each group.
    const seen: string[] = []
    for (const def of MODULE_LIST) {
      if (seen[seen.length - 1] === def.group) continue
      expect(seen, `${def.type} reopens the ${def.group} group`).not.toContain(def.group)
      seen.push(def.group!)
    }
    expect(seen[0]).toBe('Sources')
    expect(seen[seen.length - 1]).toBe('Mixing')
  })

  it('has exactly one terminal module', () => {
    // More than one is legal — `compile` sums them — but more than one in the shipped set would
    // mean two modules both claiming to be the output, which is a design mistake rather than a
    // patching choice.
    expect(MODULE_LIST.filter((def) => def.terminal)).toEqual([MODULES.out])
  })

  it('keeps the sequencer param layout the processor assumes', () => {
    // `SeqProcessor` reads params[2 + n] for pitches and params[10 + n] for gates. Inserting a
    // param at the front would transpose every saved sequence, silently.
    const params = MODULES.seq.params
    expect(params[0].id).toBe('length')
    expect(params[1].id).toBe('glide')
    for (let n = 0; n < 8; n++) {
      expect(params[2 + n].id).toBe(`pitch${n + 1}`)
      expect(params[10 + n].id).toBe(`gate${n + 1}`)
    }
    expect(params).toHaveLength(18)
  })

  it('keeps the mixer channel layout the processor assumes', () => {
    // `MixerProcessor` reads inlets[n] for signals and inlets[n + 4] for their level CVs.
    const inlets = MODULES.mixer.inlets
    for (let n = 0; n < 4; n++) {
      expect(inlets[n].id).toBe(`in${n + 1}`)
      expect(inlets[n + 4].id).toBe(`cv${n + 1}`)
    }
  })
})
