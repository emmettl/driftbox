import { describe, expect, it } from 'vitest'
import { MONITOR_MAX_DELAY, outputLatencyOf } from './monitor.js'

// The arithmetic of the monitor tap. Everything here is a number a browser handed over, and the
// point of every case is that a bad one must not be allowed to reach a `delayTime` — where the
// consequences are not a wrong picture but no picture, because a NaN delay silences an analyser.

describe('outputLatencyOf', () => {
  it('prefers outputLatency, which is the number that answers the question', () => {
    // Buffer to speaker. baseLatency is the graph's own processing latency and a different,
    // smaller thing, so a context reporting both must not be read as the smaller one.
    expect(outputLatencyOf({ outputLatency: 0.18, baseLatency: 0.01 })).toBe(0.18)
  })

  it('falls back to baseLatency where that is all there is', () => {
    // At least the right sign and the right order of magnitude, which beats no compensation.
    expect(outputLatencyOf({ baseLatency: 0.012 })).toBe(0.012)
  })

  it('is zero for a context with neither, which is what an offline render is', () => {
    // No device, nothing to be late. The same code path rather than a branch at the call site.
    expect(outputLatencyOf({})).toBe(0)
    expect(outputLatencyOf(null)).toBe(0)
    expect(outputLatencyOf(undefined)).toBe(0)
  })

  it('refuses a number that is not one', () => {
    // A suspended context can report 0, one that never ran can report undefined, and an
    // implementation with a broken estimate can report anything at all. NaN in a delayTime is
    // an analyser that reads silence for ever.
    expect(outputLatencyOf({ outputLatency: Number.NaN })).toBe(0)
    expect(outputLatencyOf({ outputLatency: Number.POSITIVE_INFINITY })).toBe(0)
    expect(outputLatencyOf({ outputLatency: -0.2 })).toBe(0)
  })

  it('clamps to what the delay line can actually hold', () => {
    // A DelayNode's maxDelayTime is fixed at construction, so a larger request would not be
    // honoured — it would be silently truncated by the node, which is the same answer arrived at
    // less predictably.
    expect(outputLatencyOf({ outputLatency: 2 })).toBe(MONITOR_MAX_DELAY)
  })

  it('leaves a real Bluetooth latency alone', () => {
    // The case the whole thing exists for. 300ms is the high end of what anybody measures, and it
    // must survive the clamp intact or the compensation is partial and nobody would notice.
    expect(outputLatencyOf({ outputLatency: 0.3 })).toBe(0.3)
  })
})
