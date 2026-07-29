import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transport, type StepEvent } from './transport'
import { LOOKAHEAD_SECONDS, TICK_MS, secondsPerStep } from './timing'

// The transport only ever reads `currentTime` off its context, so it can be driven by a
// fake clock and checked exactly — no audio device, no waiting in real time.
//
// Worth testing directly because two of its properties are invisible from anywhere else:
// that it emits STRAIGHT times (swing is applied per voice further downstream), and that
// it asks for the length of the bar about to start rather than the length of bar zero.
// Get the second one wrong and a chain of mixed-length patterns plays every one of them
// at whatever length happened to be first — which sounds like a bug in the patterns.

class FakeClock {
  currentTime = 0
  advance(seconds: number) {
    this.currentTime += seconds
  }
}

/** Run the transport forward, letting its fallback timer fire as the clock moves. */
function run(
  clock: FakeClock,
  seconds: number,
) {
  const ticks = Math.ceil((seconds * 1000) / TICK_MS)
  for (let i = 0; i < ticks; i++) {
    clock.advance(TICK_MS / 1000)
    vi.advanceTimersByTime(TICK_MS)
  }
}

let clock: FakeClock
let events: StepEvent[]

beforeEach(() => {
  vi.useFakeTimers()
  clock = new FakeClock()
  events = []
})

afterEach(() => {
  vi.useRealTimers()
})

function start(barLength: (bar: number) => number, bpm = 120): Transport {
  const transport = new Transport(clock as unknown as BaseAudioContext, {
    barLength,
    onStep: (event) => events.push(event),
  })
  transport.bpm = bpm
  transport.start()
  return transport
}

describe('the times it emits', () => {
  it('are straight, whatever the song swings', () => {
    // The transport has no swing at all any more. It cannot: swing is per voice, and it
    // has no idea which voice is about to be played.
    const transport = start(() => 4)
    run(clock, 1)
    transport.stop()

    const step = secondsPerStep(120)
    const gaps = events.slice(1).map((e, i) => e.time - events[i].time)
    for (const gap of gaps) expect(gap).toBeCloseTo(step, 9)
  })

  it('carry the step duration, so a caller can work out its own offset', () => {
    const transport = start(() => 4, 96)
    run(clock, 0.5)
    transport.stop()

    expect(events.length).toBeGreaterThan(0)
    for (const event of events) expect(event.stepSeconds).toBeCloseTo(secondsPerStep(96), 9)
  })

  it('are always in the future when they are scheduled', () => {
    // The whole reason for the lookahead. A time in the past is a hit that never sounds.
    const transport = start(() => 16)
    let seen = 0
    for (let i = 0; i < 40; i++) {
      clock.advance(TICK_MS / 1000)
      vi.advanceTimersByTime(TICK_MS)
      // Only the ones scheduled on this tick. Events from earlier ticks are legitimately
      // in the past by now — that is what having played them means.
      for (const event of events.slice(seen)) {
        expect(event.time).toBeGreaterThan(clock.currentTime)
      }
      seen = events.length
    }
    transport.stop()
  })

  it('never look further ahead than the lookahead window', () => {
    const transport = start(() => 16)
    run(clock, 2)
    transport.stop()

    for (const event of events) {
      expect(event.time - LOOKAHEAD_SECONDS).toBeLessThanOrEqual(clock.currentTime + 0.001)
    }
  })
})

describe('bar lengths', () => {
  it('asks for the length of the bar about to start, not bar zero', () => {
    const asked: number[] = []
    const transport = start((bar) => {
      asked.push(bar)
      return 4
    })
    run(clock, 2)
    transport.stop()

    expect(asked[0]).toBe(0)
    // It has moved past bar 0, so it must have asked about later bars too.
    expect(Math.max(...asked)).toBeGreaterThan(0)
  })

  it('plays a chain of mixed-length patterns at each pattern.s own length', () => {
    // Bar 0 is 4 steps, every bar after it is 2. If the length were read once, every
    // bar would be 4 and the second pattern would run at the wrong length forever.
    const transport = start((bar) => (bar === 0 ? 4 : 2))
    run(clock, 3)
    transport.stop()

    const bar0 = events.filter((e) => e.bar === 0)
    const bar1 = events.filter((e) => e.bar === 1)
    const bar2 = events.filter((e) => e.bar === 2)

    expect(bar0).toHaveLength(4)
    expect(bar1).toHaveLength(2)
    expect(bar2).toHaveLength(2)
    expect(bar1.map((e) => e.index)).toEqual([0, 1])
  })

  it('counts steps continuously across bars of different lengths', () => {
    const transport = start((bar) => (bar === 0 ? 3 : 5))
    run(clock, 3)
    transport.stop()

    expect(events.map((e) => e.absolute)).toEqual(events.map((_, i) => i))
  })
})

describe('starting and stopping', () => {
  it('starts from the top every time', () => {
    const transport = start(() => 4)
    run(clock, 1)
    transport.stop()

    events.length = 0
    transport.start()
    run(clock, 0.2)
    transport.stop()

    expect(events[0]).toMatchObject({ absolute: 0, index: 0, bar: 0 })
  })

  it('emits nothing once stopped', () => {
    const transport = start(() => 4)
    run(clock, 0.5)
    transport.stop()

    const count = events.length
    run(clock, 2)
    expect(events).toHaveLength(count)
  })

  it('does not try to catch up after the clock ran away', () => {
    // A suspended tab. Firing every missed step at once would dump a minute of hits into
    // the graph in one go; it skips forward to now instead.
    const transport = start(() => 16)
    run(clock, 0.2)
    const before = events.length

    clock.advance(60)
    vi.advanceTimersByTime(TICK_MS)
    transport.stop()

    // 60 seconds at 120bpm is nearly 2000 steps. The guard caps one tick at 64, and the
    // next tick finds the clock has run away and skips forward rather than grinding
    // through the backlog — so the total stays bounded instead of scaling with the gap.
    const caught = events.length - before
    expect(caught).toBeLessThanOrEqual(64)
    expect(caught).toBeLessThan(200)
  })
})
