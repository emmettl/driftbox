import { describe, expect, it } from 'vitest'
import { COMBI_CONTROLS, COMBI_MODULE, COMBI_ROTARY_MAX, CombiProcessor } from './combi.js'

// The Combinator's own arithmetic. Most of what makes it a Combinator is in `modulation.ts` — this is the
// half that reaches the audio thread, which is the part Reason's version did not have at all.

const FRAMES = 128

const run = (values: Partial<Record<string, number>>) => {
  const outlets = COMBI_MODULE.outlets.map(() => new Float32Array(FRAMES).fill(-999))
  const params = COMBI_MODULE.params.map(
    (param) => new Float32Array(FRAMES).fill(values[param.id] ?? param.default),
  )
  new CombiProcessor().process([], outlets, params, FRAMES)
  return (id: string) => outlets[COMBI_MODULE.outlets.findIndex((port) => port.id === id)]
}

describe('combi', () => {
  it('has as many outlets as controls, rotaries first', () => {
    // Load-bearing: the processor works out which half is which from `outlets.length / 2`, because a class
    // serialised into an AudioWorkletGlobalScope cannot read a constant at module scope. Inserting a
    // control at the front should fail here rather than quietly turn a rotary into a gate.
    expect(COMBI_MODULE.outlets.length).toBe(COMBI_CONTROLS * 2)
    expect(COMBI_MODULE.params.length).toBe(COMBI_CONTROLS * 2)
    for (let i = 0; i < COMBI_CONTROLS; i++) {
      expect(COMBI_MODULE.outlets[i].id).toBe(`rotary${i + 1}`)
      expect(COMBI_MODULE.params[i].id).toBe(`rotary${i + 1}`)
      expect(COMBI_MODULE.outlets[COMBI_CONTROLS + i].id).toBe(`button${i + 1}`)
      expect(COMBI_MODULE.params[COMBI_CONTROLS + i].id).toBe(`button${i + 1}`)
    }
  })

  it('takes no cables in, because a rotary is something a person turns', () => {
    // A CV inlet writing a rotary would be a second writer on a param the host owns — the exact fight
    // `ParamDef.hidden` documents for the MIDI module.
    expect(COMBI_MODULE.inlets).toEqual([])
  })

  it('sends a rotary out as 0..1', () => {
    expect(run({ rotary1: 0 })('rotary1')[0]).toBe(0)
    expect(run({ rotary1: COMBI_ROTARY_MAX })('rotary1')[0]).toBe(1)
    expect(run({ rotary1: 64 })('rotary1')[0]).toBeCloseTo(64 / 127, 6)
  })

  it('clamps a rotary that arrives outside its range', () => {
    // Params are clamped by `compile`, so this is belt and braces — but an outlet is the one thing in the
    // rack that can be patched at a filter's cutoff, and a 3.0 arriving there is somebody's afternoon.
    expect(run({ rotary1: -50 })('rotary1')[0]).toBe(0)
    expect(run({ rotary1: 500 })('rotary1')[0]).toBe(1)
  })

  it('sends a button out as a gate, not as a ramp', () => {
    expect(run({ button1: 0 })('button1')[0]).toBe(0)
    expect(run({ button1: 1 })('button1')[0]).toBe(1)
    // Halfway is off. The param is `stepped` so the Graph never ramps it, but a value between the two can
    // still arrive from a patch written by hand, and a gate has to be one or the other.
    expect(run({ button1: 0.4 })('button1')[0]).toBe(0)
  })

  it('keeps its controls independent', () => {
    const out = run({ rotary1: 0, rotary2: COMBI_ROTARY_MAX, button1: 1, button2: 0 })
    expect(out('rotary1')[0]).toBe(0)
    expect(out('rotary2')[0]).toBe(1)
    expect(out('button1')[0]).toBe(1)
    expect(out('button2')[0]).toBe(0)
  })

  it('is one panel however many voices the patch has', () => {
    // Eight copies would be eight identical ones, and a routing writes a param — which `Rack.setParam`
    // already spreads across every voice.
    expect(COMBI_MODULE.poly).toBe(false)
  })
})
