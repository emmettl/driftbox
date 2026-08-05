import { describe, expect, it } from 'vitest'
import { consoleBeacons, type BeaconContext } from './beacons.js'
import type { Lesson } from './useFirstRun.js'

// Five conditions built up by pushing onto an array mid-render, every one of them a rule about not
// nagging somebody. The failure is silent in both directions: a beacon that never appears teaches
// nobody, and one that will not go away is the app talking over you.

const context = (over: Partial<BeaconContext> = {}): BeaconContext => ({
  roomy: true,
  stillness: false,
  performing: false,
  running: false,
  learnt: new Set<Lesson>(),
  ...over,
})

describe('a first visit on a desktop', () => {
  it('points at both of the things the console never says out loud', () => {
    expect(consoleBeacons(context())).toEqual(['play', 'vibes'])
  })
})

describe('what stops the nagging', () => {
  it('drops the play beacon once this browser has played something', () => {
    expect(consoleBeacons(context({ learnt: new Set<Lesson>(['played']) }))).toEqual(['vibes'])
  })

  it('drops the vibes beacon once this browser has been there', () => {
    expect(consoleBeacons(context({ learnt: new Set<Lesson>(['vibed']) }))).toEqual(['play'])
  })

  it('says nothing once both are learnt', () => {
    expect(consoleBeacons(context({ learnt: new Set<Lesson>(['played', 'vibed']) }))).toEqual([])
  })

  it('is not confused by the rack lesson sharing the same box', () => {
    // `toured` is the rack's, recorded against the person rather than the patch. It is not about
    // either of these buttons.
    expect(consoleBeacons(context({ learnt: new Set<Lesson>(['toured']) }))).toEqual([
      'play',
      'vibes',
    ])
  })
})

describe('the play beacon has one condition the other does not', () => {
  it('goes away while the transport is running, learnt or not', () => {
    // Pointing at a play button during playback is pointing at the thing that just happened.
    expect(consoleBeacons(context({ running: true }))).toEqual(['vibes'])
  })

  it('comes back when the transport stops, if it was never learnt', () => {
    expect(consoleBeacons(context({ running: false }))).toContain('play')
  })

  it('does not come back once it has been learnt', () => {
    expect(
      consoleBeacons(context({ running: false, learnt: new Set<Lesson>(['played']) })),
    ).not.toContain('play')
  })
})

describe('when the console says nothing at all', () => {
  it('stays quiet on a narrow screen', () => {
    // These land on a 40px button in a room already full of controls; on a phone they land on the
    // controls beside it.
    expect(consoleBeacons(context({ roomy: false }))).toEqual([])
  })

  it('respects a request for reduced motion', () => {
    // A stream of particles across a working editor is exactly what that setting is for.
    expect(consoleBeacons(context({ stillness: true }))).toEqual([])
  })

  it('stays off the stage, which has its own single beacon', () => {
    expect(consoleBeacons(context({ performing: true }))).toEqual([])
  })

  it('is quiet for every one of those reasons independently', () => {
    for (const off of [{ roomy: false }, { stillness: true }, { performing: true }]) {
      expect(consoleBeacons(context(off))).toEqual([])
    }
  })
})
