import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearLive, liveSnapshot, publishLive, subscribeLive } from './live.js'

// The store behind a knob that moves on its own.
//
// Small, but every property here is load-bearing at animation rate: it is read sixty times a second, and
// the difference between waking a subscriber only on a change and waking it always is the difference
// between a rack that idles and one that does not.

afterEach(clearLive)

const of = (entries: Record<string, Record<string, number>>) =>
  new Map(Object.entries(entries))

describe('publishing what is driven', () => {
  it('hands a module its values', () => {
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    expect(liveSnapshot('ladder-1')).toEqual({ cutoff: 900 })
  })

  it('says nothing about a module nothing is driving', () => {
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    expect(liveSnapshot('vco-1')).toBeUndefined()
  })

  it('forgets a module that has stopped being driven', () => {
    // The case a per-param API would have got wrong. A knob left showing its last automated value after
    // the lane ended reads as a knob somebody moved, and saving then would bake it in.
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    publishLive(of({ 'vco-1': { tune: 7 } }))
    expect(liveSnapshot('ladder-1')).toBeUndefined()
    expect(liveSnapshot('vco-1')).toEqual({ tune: 7 })
  })

  it('is empty again once cleared', () => {
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    clearLive()
    expect(liveSnapshot('ladder-1')).toBeUndefined()
  })
})

describe('waking subscribers', () => {
  it('tells a module when its values change', () => {
    const woken = vi.fn()
    subscribeLive('ladder-1', woken)
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    expect(woken).toHaveBeenCalledTimes(1)
  })

  it('does not wake it again for the values it already had', () => {
    // The whole reason `publishLive` compares. This runs on every animation frame, and a lane holding
    // still between points is the common case — a subscriber woken sixty times a second to be handed the
    // number it already has is pure heat.
    const woken = vi.fn()
    subscribeLive('ladder-1', woken)
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    expect(woken).toHaveBeenCalledTimes(1)
  })

  it('wakes it when a param is added or removed, not only when one changes', () => {
    // Same key count, different keys, would slip past a comparison that only checked length.
    const woken = vi.fn()
    subscribeLive('ladder-1', woken)
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    publishLive(of({ 'ladder-1': { resonance: 900 } }))
    expect(woken).toHaveBeenCalledTimes(2)
  })

  it('wakes a module when it stops being driven', () => {
    // Otherwise the knob keeps the last automated value on screen for ever.
    const woken = vi.fn()
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    subscribeLive('ladder-1', woken)
    publishLive(new Map())
    expect(woken).toHaveBeenCalledTimes(1)
  })

  it('leaves other modules alone', () => {
    const woken = vi.fn()
    subscribeLive('vco-1', woken)
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    expect(woken).not.toHaveBeenCalled()
  })

  it('stops waking a subscriber that has gone', () => {
    const woken = vi.fn()
    subscribeLive('ladder-1', woken)()
    publishLive(of({ 'ladder-1': { cutoff: 900 } }))
    expect(woken).not.toHaveBeenCalled()
  })
})
