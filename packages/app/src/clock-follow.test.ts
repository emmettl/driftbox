import { ClockFollower, TICKS_PER_QUARTER } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import { clockLost, followClock } from './clock-follow.js'

// The rules about somebody else's transport, tested without one.
//
// Chrome refuses Web MIDI under automation — permission is denied whatever the driver grants — so
// the handler these rules would otherwise live inside cannot be exercised in a browser at all.
// Pulling them out leaves one untestable line of plumbing instead of an untestable feature.

const msPerTick = (bpm: number) => 60_000 / (bpm * TICKS_PER_QUARTER)

/** Run a clean stream through, returning every command it produced. */
function stream(bpm: number, count: number, from = 1000) {
  const follower = new ClockFollower()
  const current = { bpm: 120 }
  const commands = []
  for (let i = 0; i < count; i++) {
    const command = followClock({ message: 'tick' }, from + i * msPerTick(bpm), follower, current)
    if (command.bpm !== undefined) current.bpm = command.bpm
    commands.push(command)
  }
  return { follower, current, commands }
}

describe('following a tick', () => {
  it('says nothing while the estimate is still forming', () => {
    const { commands } = stream(120, 6)
    expect(commands.every((command) => command.bpm === undefined)).toBe(true)
  })

  it('arrives at the tempo the sender is running', () => {
    const { current } = stream(174, 96)
    expect(current.bpm).toBeCloseTo(174, 0)
  })

  it('stops writing once it has settled', () => {
    // Ticks arrive forty times a second and every applied tempo rebuilds the tempo-locked delay.
    // A steady clock must therefore go quiet rather than nudging the transport for ever.
    const { commands } = stream(120, 200)
    const late = commands.slice(150)
    expect(late.every((command) => command.bpm === undefined)).toBe(true)
  })

  it('still reports a tempo change worth having', () => {
    const { follower, current } = stream(120, 96)
    let applied: number | undefined
    const interval = msPerTick(140)
    for (let i = 0; i < 96; i++) {
      const command = followClock({ message: 'tick' }, 20_000 + i * interval, follower, current)
      if (command.bpm !== undefined) {
        current.bpm = command.bpm
        applied = command.bpm
      }
    }
    expect(applied).toBeCloseTo(140, 0)
  })

  it('tracks tempo even though the sender is not playing', () => {
    // Gear that streams clock continuously is the common case. Arriving at the right tempo before
    // play is pressed is the difference between starting together and starting a second late.
    const { current, follower } = stream(150, 96)
    expect(follower.state.running).toBe(false)
    expect(current.bpm).toBeCloseTo(150, 0)
  })
})

describe('following the transport', () => {
  it('rewinds on start and carries on from continue', () => {
    // A start means the top of the sender's song. Resuming from wherever the local transport
    // happened to be would be a bar out for the rest of the take.
    const follower = new ClockFollower()
    expect(followClock({ message: 'start' }, 0, follower, { bpm: 120 }).transport).toBe('start')
    expect(followClock({ message: 'continue' }, 0, follower, { bpm: 120 }).transport).toBe('resume')
    expect(followClock({ message: 'stop' }, 0, follower, { bpm: 120 }).transport).toBe('stop')
  })

  it('carries no tempo across a start, because the gap either side is not one', () => {
    const { follower, current } = stream(120, 96)
    const command = followClock({ message: 'start' }, 20_000, follower, current)
    expect(command.transport).toBe('start')
    expect(command.bpm).toBeUndefined()
  })

  it('notes a playhead move without touching the transport', () => {
    // A DAW sends this while stopped, before the continue that follows it.
    const follower = new ClockFollower()
    const command = followClock({ message: 'position', step: 32 }, 0, follower, { bpm: 120 })
    expect(command).toEqual({})
    expect(follower.step).toBe(32)
  })
})

describe('losing the clock', () => {
  it('hands the tempo back when the stream goes quiet', () => {
    // Nothing arrives to announce a pulled cable, a closed laptop or a quit DAW. Without this the
    // sequencer plays on at a tempo whose source no longer exists.
    const { follower } = stream(120, 48)
    expect(clockLost(follower, 1000 + 48 * msPerTick(120))).toEqual({})
    expect(clockLost(follower, 30_000)).toEqual({ release: true })
  })

  it('has nothing to hand back before a clock has ever arrived', () => {
    expect(clockLost(new ClockFollower(), 30_000)).toEqual({})
  })
})
