import { describe, expect, it } from 'vitest'
import { Rack } from './index.js'

// Where the live host thinks the music is.
//
// `host.browser.test.ts` covers the rest of `Rack`, because everything else about it needs a real
// AudioWorklet to mean anything — a plan reaching the audio thread, a param arriving, a node connecting.
// The position does not: it is arithmetic against `ctx.currentTime`, deliberately, for the reasons written
// at `Rack.beat`. So it is testable here against a clock a test can move, and it is worth testing here
// because it is the one piece of `Rack` a game reads every frame.
//
// **The stub is three members and cannot grow**, which is the condition `app/src/rack/breaks.ts` sets for
// stubbing a context at all: its warning is about stubbing an audio graph, where the stub gains a method
// every time the code under test touches one and what you end up proving is that the stub is complete.
// Nothing here renders. `start()` is never called, so no worklet is wanted and no node is built.

/** A context whose clock the test owns. */
function fakeContext(): BaseAudioContext & { now: number } {
  const gain = { connect() {}, disconnect() {} }
  // The clock is a closed-over variable rather than a property read through `this`, which inside an object
  // literal is typed as the literal itself and does not see its own fields.
  const clock = { now: 0 }
  const ctx = {
    sampleRate: 48000,
    get now() {
      return clock.now
    },
    set now(at: number) {
      clock.now = at
    },
    get currentTime() {
      return clock.now
    },
    createGain: () => gain,
  }
  return ctx as unknown as BaseAudioContext & { now: number }
}

describe('Rack.beat', () => {
  it('is zero before anything is playing, and stays there while stopped', () => {
    const ctx = fakeContext()
    const rack = new Rack(ctx)
    expect(rack.beat).toBe(0)
    ctx.now = 10
    expect(rack.beat).toBe(0)
  })

  it('advances at the tempo once running', () => {
    const ctx = fakeContext()
    const rack = new Rack(ctx)
    ctx.now = 5 // the context has been open a while; the transport has not
    rack.setTransport(120, true)

    ctx.now = 7
    expect(rack.beat).toBeCloseTo(4) // two seconds at 120
    ctx.now = 9
    expect(rack.beat).toBeCloseTo(8)
  })

  it('does not move the past when the tempo changes', () => {
    // The mistake this exists to prevent, and the reason the position is banked rather than recomputed:
    // multiplying total elapsed seconds by the new tempo would rewrite every beat already gone by, so a
    // score that switched sections on bar four would find bar four somewhere else.
    const ctx = fakeContext()
    const rack = new Rack(ctx)
    rack.setTransport(120, true)
    ctx.now = 2
    expect(rack.beat).toBeCloseTo(4)

    rack.setTransport(240, true)
    expect(rack.beat).toBeCloseTo(4) // the change itself moves nothing
    ctx.now = 3
    expect(rack.beat).toBeCloseTo(8) // four banked, and four more in the second at 240
  })

  it('holds where it stopped, and rewinds when it starts again', () => {
    // Both halves matter, and they mirror `Graph.setTransport`: pausing is not a rewind, and starting from
    // a stop is. The two sides must not disagree about where bar one is.
    const ctx = fakeContext()
    const rack = new Rack(ctx)
    rack.setTransport(120, true)
    ctx.now = 2
    rack.setTransport(120, false)
    expect(rack.beat).toBeCloseTo(4)

    ctx.now = 30 // a long pause
    expect(rack.beat).toBeCloseTo(4)

    rack.setTransport(120, true)
    expect(rack.beat).toBe(0)
    ctx.now = 31
    expect(rack.beat).toBeCloseTo(2)
  })

  it('answers the same question RackRenderer does, so one score drives either host', () => {
    // Not a claim about implementation — one counts frames and one reads a clock — but about the number a
    // score is quantised against. `Adaptive` is written once and driven from both.
    const ctx = fakeContext()
    const rack = new Rack(ctx)
    rack.setTransport(140, true)
    ctx.now = 3

    const beatsFromSeconds = (3 * 140) / 60
    expect(rack.beat).toBeCloseTo(beatsFromSeconds)
  })
})
