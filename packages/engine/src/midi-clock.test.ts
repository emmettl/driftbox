import { describe, expect, it } from 'vitest'
import {
  ClockFollower,
  clockBytes,
  parseClock,
  scheduleClockStart,
  scheduleClockStep,
  TICKS_PER_QUARTER,
  TICKS_PER_STEP,
} from './midi-clock.js'

// The estimator, fed streams that are deliberately worse than a real one.
//
// This is the half of MIDI clock worth testing, and the reason the arithmetic was kept away from
// anything that touches `navigator`: a real clock cannot be made to jitter on demand, drop its
// fourteenth tick, or stall for a second in the middle of a bar, and all three are ordinary things
// for it to do. Here they are three lines each.
//
// The jitter figures below are not invented. Web MIDI delivers on the main thread, so a tick's
// timestamp is a message queued behind whatever else that thread was doing; a couple of
// milliseconds is a quiet moment and ten is a garbage collection.

const msPerTick = (bpm: number) => 60_000 / (bpm * TICKS_PER_QUARTER)

/** A deterministic wobble. Seeded rather than `Math.random` for the same reason the engine's noise
 *  is: a test that fails one run in some unknown number is worse than no test. */
function jitter(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 0x1_0000_0000) * 2 - 1
  }
}

/** Feed `count` ticks at `bpm`, each displaced by up to `spread` milliseconds. */
function play(
  follower: ClockFollower,
  bpm: number,
  count: number,
  spread = 0,
  seed = 0x1234567,
  from = 1000,
): number {
  const noise = jitter(seed)
  const interval = msPerTick(bpm)
  let time = from
  for (let i = 0; i < count; i++) {
    time = from + i * interval
    follower.tick(time + noise() * spread)
  }
  return time + interval
}

describe('parseClock', () => {
  it('reads the four single-byte messages', () => {
    // The detail that stops this working when it is bolted onto an existing handler: these are one
    // byte, and a dispatcher that rejects anything shorter than two throws every tick away before
    // looking at it. Which is exactly what this app's did.
    expect(parseClock([0xf8])).toEqual({ message: 'tick' })
    expect(parseClock([0xfa])).toEqual({ message: 'start' })
    expect(parseClock([0xfb])).toEqual({ message: 'continue' })
    expect(parseClock([0xfc])).toEqual({ message: 'stop' })
  })

  it('reads a song position as two seven-bit halves, little end first', () => {
    // MIDI beats are sixteenth notes, not quarters. Bar 2 of 4/4 is step 16.
    expect(parseClock([0xf2, 16, 0])).toEqual({ message: 'position', step: 16 })
    // 129 = 1 + (1 << 7), which is the case a naive `data[1] | data[2]` gets wrong.
    expect(parseClock([0xf2, 1, 1])).toEqual({ message: 'position', step: 129 })
    // The top of its range, where a sign error or a missing mask shows up.
    expect(parseClock([0xf2, 0x7f, 0x7f])).toEqual({ message: 'position', step: 16_383 })
  })

  it('ignores everything else, including a truncated position', () => {
    expect(parseClock([0x90, 60, 100])).toBeNull()
    expect(parseClock([0xb0, 1, 64])).toBeNull()
    expect(parseClock([0xfe])).toBeNull()
    expect(parseClock([])).toBeNull()
    expect(parseClock([0xf2, 16])).toBeNull()
  })
})

describe('clock output', () => {
  it('starts at the top with Start and elsewhere with position then Continue', () => {
    expect(scheduleClockStart(0, 1)).toEqual([{ message: 'start', time: 1 }])
    expect(scheduleClockStart(129, 2)).toEqual([
      { message: 'position', step: 129, time: 2 },
      { message: 'continue', time: 2 },
    ])
  })

  it('places six evenly spaced ticks across every sixteenth', () => {
    const ticks = scheduleClockStep(10, 0.125)
    expect(ticks).toHaveLength(TICKS_PER_STEP)
    expect(ticks[0]).toEqual({ message: 'tick', time: 10 })
    for (let index = 1; index < ticks.length; index++) {
      expect(ticks[index].time - ticks[index - 1].time).toBeCloseTo(0.125 / TICKS_PER_STEP, 12)
    }
  })

  it('encodes real-time messages and 14-bit song positions', () => {
    expect(clockBytes({ message: 'tick' })).toEqual([0xf8])
    expect(clockBytes({ message: 'start' })).toEqual([0xfa])
    expect(clockBytes({ message: 'continue' })).toEqual([0xfb])
    expect(clockBytes({ message: 'stop' })).toEqual([0xfc])
    expect(clockBytes({ message: 'position', step: 129 })).toEqual([0xf2, 1, 1])
    expect(clockBytes({ message: 'position', step: 99_999 })).toEqual([0xf2, 0x7f, 0x7f])
  })
})

describe('the tempo estimate', () => {
  it('says nothing until it has seen enough ticks', () => {
    // Half a beat. Reporting from one interval means the first thing a host does is lurch to a
    // tempo drawn from a single jittery gap, and then settle — worse than a twelfth of a second
    // of waiting and starting correct.
    const follower = new ClockFollower()
    const after = play(follower, 120, 6)
    expect(follower.state.bpm).toBeNull()
    play(follower, 120, 48, 0, 0x1234567, after)
    expect(follower.state.bpm).not.toBeNull()
  })

  it('reads a clean stream exactly', () => {
    const follower = new ClockFollower()
    play(follower, 128, 48)
    expect(follower.state.bpm).toBeCloseTo(128, 6)
  })

  it.each([90, 120, 128, 174])('reads %ibpm through 2ms of jitter', (bpm) => {
    // The measurement that decides whether this is usable. Half a beat per minute is the point at
    // which a tempo stops being audibly unstable against another instrument.
    const follower = new ClockFollower()
    play(follower, bpm, 96, 2)
    expect(follower.state.bpm).toBeCloseTo(bpm, 0)
    expect(Math.abs(follower.state.bpm! - bpm)).toBeLessThan(0.5)
  })

  it('shrugs off the occasional stalled tick', () => {
    // The realistic bad case, and the one worth being good at: the thread is mostly responsive and
    // then something blocks it. A garbage collection is fifteen milliseconds, most of a tick at
    // 120bpm, and it happens to one tick in twenty rather than to all of them.
    const follower = new ClockFollower()
    const noise = jitter(0x5eed)
    const interval = msPerTick(120)
    for (let i = 0; i < 96; i++) {
      const spike = i % 19 === 0 ? 15 : 0
      follower.tick(1000 + i * interval + noise() * 1 + spike)
    }
    expect(Math.abs(follower.state.bpm! - 120)).toBeLessThan(1)
  })

  it('holds up even when jitter approaches half a tick', () => {
    // Ten milliseconds of noise on every single tick — half the interval at 120bpm — where
    // deciding whether a tick was dropped or merely late is genuinely ambiguous because both look
    // identical. Before the outlier-rejecting refit this read sixteen beats per minute out, and
    // then seven; it now stays within two, on a stream far worse than anything real.
    const follower = new ClockFollower()
    play(follower, 120, 96, 10)
    expect(Math.abs(follower.state.bpm! - 120)).toBeLessThan(2)
  })

  it('beats dividing one interval, which is the whole reason it exists', () => {
    // The comparison that justifies the file. Same stream, same jitter: the naive estimate off the
    // last gap against the fitted slope. This is not close.
    const spread = 2
    const noise = jitter(0x99)
    const interval = msPerTick(120)
    const follower = new ClockFollower()
    let previous = 0
    let naiveWorst = 0
    for (let i = 0; i < 96; i++) {
      const time = 1000 + i * interval + noise() * spread
      follower.tick(time)
      if (i > 0) {
        const naive = 60_000 / ((time - previous) * TICKS_PER_QUARTER)
        naiveWorst = Math.max(naiveWorst, Math.abs(naive - 120))
      }
      previous = time
    }
    expect(naiveWorst).toBeGreaterThan(10)
    expect(Math.abs(follower.state.bpm! - 120)).toBeLessThan(0.5)
  })

  it('follows a tempo that actually changes', () => {
    // A window long enough to reject jitter is also long enough to lag. Two beats gets there
    // inside a second, which is faster than anybody turns a tempo knob.
    const follower = new ClockFollower()
    const after = play(follower, 120, 96, 1)
    play(follower, 140, 96, 1, 0x1234567, after)
    expect(follower.state.bpm).toBeCloseTo(140, 0)
  })

  it('does not halve the tempo when a tick goes missing', () => {
    // The failure this guards is loud: one dropped tick reads as a double-length interval, which
    // is a stream at half speed. The gap is rounded to a whole number of ticks instead.
    const clean = new ClockFollower()
    play(clean, 120, 96)

    const dropped = new ClockFollower()
    const interval = msPerTick(120)
    for (let i = 0; i < 96; i++) {
      if (i % 17 === 0 && i > 0) continue
      dropped.tick(1000 + i * interval)
    }
    expect(dropped.state.bpm).toBeCloseTo(120, 1)
  })

  it('treats a long silence as a new stream rather than a slow tick', () => {
    // A sender that stops without saying so, or a backgrounded tab draining its queue in a burst.
    // Fitting across that gap describes a tempo nobody played.
    const follower = new ClockFollower()
    play(follower, 120, 48)
    expect(follower.state.bpm).toBeCloseTo(120, 6)

    follower.tick(60_000)
    expect(follower.state.bpm).toBeNull()

    play(follower, 174, 48, 0, 0x1234567, 61_000)
    expect(follower.state.bpm).toBeCloseTo(174, 6)
  })

  it('reports the clock lost when nothing has arrived', () => {
    // Nothing arrives to say the cable was pulled, so the host has to ask.
    const follower = new ClockFollower()
    play(follower, 120, 48, 0, 0x1234567, 1000)
    expect(follower.lost(1000 + 48 * msPerTick(120))).toBe(false)
    expect(follower.lost(5000)).toBe(true)
  })

  it('has nothing to say about a clock it has never heard', () => {
    expect(new ClockFollower().lost(10_000)).toBe(false)
  })
})

describe('the transport', () => {
  it('is not running until the sender says so, but tempo is tracked anyway', () => {
    // Plenty of gear sends clock continuously and only starts the transport on play. A follower
    // that ignored ticks until then would have to measure the tempo from scratch at the one moment
    // it matters.
    const follower = new ClockFollower()
    play(follower, 120, 48)
    expect(follower.state.running).toBe(false)
    expect(follower.state.bpm).toBeCloseTo(120, 6)
  })

  it('counts position only while running, and from the top on start', () => {
    const follower = new ClockFollower()
    play(follower, 120, 48)
    expect(follower.state.ticks).toBe(0)

    follower.start()
    play(follower, 120, 24, 0, 0x1234567, 10_000)
    expect(follower.state.ticks).toBe(24)
    expect(follower.step).toBe(4)
  })

  it('keeps its place on continue and returns to the top on start', () => {
    const follower = new ClockFollower()
    follower.start()
    play(follower, 120, 48, 0, 0x1234567, 1000)
    follower.stop()
    const held = follower.state.ticks

    follower.continue_()
    expect(follower.state.ticks).toBe(held)

    follower.start()
    expect(follower.state.ticks).toBe(0)
  })

  it('re-measures the tempo across a stop, because the gap is not a tempo', () => {
    const follower = new ClockFollower()
    follower.start()
    play(follower, 120, 48, 0, 0x1234567, 1000)
    follower.continue_()
    expect(follower.state.bpm).toBeNull()
  })

  it('goes where a song position points', () => {
    // What makes starting from the middle of somebody's song land in the right place.
    const follower = new ClockFollower()
    follower.start()
    follower.locate(32)
    expect(follower.step).toBe(32)
    expect(follower.state.ticks).toBe(32 * 6)
  })

  it('extrapolates its running position between ticks', () => {
    const follower = new ClockFollower()
    follower.start()
    play(follower, 120, 48, 0, 0x1234567, 1000)

    const lastTick = 1000 + 47 * msPerTick(120)
    expect(follower.positionAt(lastTick)).toBeCloseTo(48, 6)
    expect(follower.positionAt(lastTick + msPerTick(120) / 2)).toBeCloseTo(48.5, 6)
  })

  it('does not invent a phase before the sender is running', () => {
    const follower = new ClockFollower()
    play(follower, 120, 48)
    expect(follower.positionAt(3000)).toBeNull()
  })

  it('refuses a negative position rather than counting backwards', () => {
    const follower = new ClockFollower()
    follower.locate(-4)
    expect(follower.step).toBe(0)
  })
})
