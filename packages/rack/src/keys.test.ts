import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { MODULES } from './modules/index.js'
import { decodePatch, encodePatch } from './patch-io.js'
import type { Patch, Registry } from './types.js'

// Module and port names come out of a patch file, so they can be anything at all.
//
// The first version of `compile.ts` keyed its port map by joining the two halves with a
// separator, which collides: `["a b", "c"]` and `["a", "b c"]` join to the same string, and one
// module's inlet would quietly be wired to another's outlet. It avoided that by accident — the
// separator was a raw NUL byte rather than the space the source appeared to contain, which
// worked, explained nothing, and made two files binary as far as git was concerned. `git diff`
// showed "Bin 11569 -> 13158 bytes" instead of a diff.
//
// Both halves of that are pinned here, because a NUL in a string literal compiles, runs, and
// passes every other test in this package.

const NUL = String.fromCharCode(0)

const REGISTRY: Registry = {
  ...MODULES,
  // An id containing a space, and a port containing a space. Their naively joined keys are both
  // "a b c".
  'space-in-id': {
    ...MODULES.vco,
    type: 'space-in-id',
    inlets: [],
    outlets: [{ id: 'c', name: 'C' }],
    params: [],
  },
  'space-in-port': {
    ...MODULES.vco,
    type: 'space-in-port',
    inlets: [],
    outlets: [{ id: 'b c', name: 'B C' }],
    params: [],
  },
}

const PATCH: Patch = {
  modules: [
    { id: 'a b', type: 'space-in-id' },
    { id: 'a', type: 'space-in-port' },
    { id: 'out', type: 'out' },
  ],
  cables: [{ from: ['a b', 'c'], to: ['out', 'in'] }],
}

describe('names that could collide', () => {
  it('gives two ambiguous ports different buffers', () => {
    const plan = compile(PATCH, REGISTRY)
    const spaceInId = plan.nodes.find((n) => n.id === 'a b')!.outlets[0]
    const spaceInPort = plan.nodes.find((n) => n.id === 'a')!.outlets[0]

    expect(spaceInId).toBeGreaterThan(0)
    expect(spaceInPort).toBeGreaterThan(0)
    expect(spaceInId).not.toBe(spaceInPort)
  })

  it('routes the cable to the port it actually names', () => {
    const plan = compile(PATCH, REGISTRY)
    expect(plan.nodes.find((n) => n.id === 'out')!.inlets[0]).toBe(
      plan.nodes.find((n) => n.id === 'a b')!.outlets[0],
    )
    expect(plan.notes.filter((n) => n.kind === 'dropped-cable')).toEqual([])
  })

  it('routes the other direction just as precisely', () => {
    const plan = compile(
      { ...PATCH, cables: [{ from: ['a', 'b c'], to: ['out', 'in'] }] },
      REGISTRY,
    )
    expect(plan.nodes.find((n) => n.id === 'out')!.inlets[0]).toBe(
      plan.nodes.find((n) => n.id === 'a')!.outlets[0],
    )
    expect(plan.notes.filter((n) => n.kind === 'dropped-cable')).toEqual([])
  })

  it('round-trips a name holding a quote, a bracket or a NUL', () => {
    // JSON keys mean the separator question does not arise for any input, including the byte the
    // old separator was.
    const awkward: Patch = {
      modules: [
        { id: '"quoted"', type: 'vco' },
        { id: `["a","b"]`, type: 'vco' },
        { id: `has${NUL}nul`, type: 'vco' },
        { id: 'out', type: 'out' },
      ],
      cables: [
        { from: ['"quoted"', 'out'], to: ['out', 'in'] },
        { from: ['["a","b"]', 'out'], to: [`has${NUL}nul`, 'pitch'] },
      ],
    }
    expect(decodePatch(encodePatch(awkward))).toEqual(awkward)

    const plan = compile(awkward, MODULES)
    expect(plan.notes.filter((n) => n.kind === 'dropped-cable')).toEqual([])
    expect(plan.nodes.map((n) => n.id)).toContain(`has${NUL}nul`)
  })

  it('keeps the compiler and the patch reader readable to git', () => {
    // A NUL is legal inside a string literal, so the only symptom is `git diff` refusing to
    // show the file. There is no other way to notice.
    expect(compile.toString()).not.toContain(NUL)
    expect(decodePatch.toString()).not.toContain(NUL)
    expect(encodePatch.toString()).not.toContain(NUL)
  })
})
