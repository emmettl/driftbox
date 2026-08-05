import { GROOVEBOX_SECTIONS, type GrooveboxSection } from '@driftbox/engine'
import { GROOVEBOX_PORTS, type Patch } from '@driftbox/rack'
import { describe, expect, it, vi } from 'vitest'
import {
  clampBar,
  clampLoop,
  grooveboxTransport,
  routeGrooveboxSources,
  type GrooveboxLoop,
} from './groovebox-host.js'

// Both halves of hosting a song were only reachable by starting audio in a browser, which meant they were
// only reachable by hand. The routing rule is the one that decides whether a machine is heard through its
// original mix or through the rack, and getting it wrong in either direction is silence or a double.

/** A stand-in for the hosted engine that records where each machine was pointed. */
function recorder() {
  const routed = new Map<GrooveboxSection, AudioNode | null>()
  const tapped = new Map<GrooveboxSection, AudioNode | null>()
  return {
    routed,
    tapped,
    routeSection: (section: GrooveboxSection, destination: AudioNode | null) => {
      routed.set(section, destination)
    },
    tapSection: (section: GrooveboxSection, destination: AudioNode | null) => {
      tapped.set(section, destination)
    },
  }
}

/** Host inputs, identified by index rather than pretending to be real audio nodes. */
const inputs = { input: (index: number) => `input-${index}` as unknown as AudioNode }

const patchRouting = (...cables: Patch['cables']): Patch => ({
  modules: [
    { id: 'song', type: 'groovebox' },
    { id: 'out', type: 'out' },
  ],
  cables,
})

describe('routing the machines of a retained song', () => {
  it('leaves an unpatched machine in its own mix, with a silent tap for its meter', () => {
    const hosted = recorder()
    routeGrooveboxSources(hosted, inputs, patchRouting())

    for (const section of GROOVEBOX_SECTIONS) {
      // Nothing is diverted, and every machine still reaches the rack so its front-panel meter moves.
      expect(hosted.routed.get(section)).toBeNull()
      expect(hosted.tapped.get(section)).toBe(`input-${GROOVEBOX_PORTS[section].input}`)
    }
  })

  it('diverts exactly the cabled machine, and taps it no longer', () => {
    const hosted = recorder()
    routeGrooveboxSources(
      hosted,
      inputs,
      patchRouting({ from: ['song', GROOVEBOX_PORTS.tr909.output], to: ['out', 'in'] }),
    )

    // A tap as well as a route would sum the machine into the mix twice, at twice the level.
    expect(hosted.routed.get('tr909')).toBe(`input-${GROOVEBOX_PORTS.tr909.input}`)
    expect(hosted.tapped.get('tr909')).toBeNull()
    expect(hosted.routed.get('tr808')).toBeNull()
    expect(hosted.tapped.get('tr808')).toBe(`input-${GROOVEBOX_PORTS.tr808.input}`)
  })

  it('restores the original route when the last cable is pulled', () => {
    const hosted = recorder()
    const cable: Patch['cables'][number] = {
      from: ['song', GROOVEBOX_PORTS['303.a'].left],
      to: ['out', 'in'],
    }
    routeGrooveboxSources(hosted, inputs, patchRouting(cable))
    expect(hosted.routed.get('303.a')).not.toBeNull()

    routeGrooveboxSources(hosted, inputs, patchRouting())
    expect(hosted.routed.get('303.a')).toBeNull()
    expect(hosted.tapped.get('303.a')).toBe(`input-${GROOVEBOX_PORTS['303.a'].input}`)
  })

  it('sends every machine in this build somewhere, whatever the list turns out to be', () => {
    const hosted = recorder()
    routeGrooveboxSources(hosted, inputs, patchRouting())
    expect(hosted.routed.size).toBe(GROOVEBOX_SECTIONS.length)
    expect(hosted.tapped.size).toBe(GROOVEBOX_SECTIONS.length)
  })
})

describe('landing inside the song', () => {
  it('rounds a bar down and keeps it in range', () => {
    expect(clampBar(0, 8)).toBe(0)
    expect(clampBar(3.7, 8)).toBe(3)
    expect(clampBar(-4, 8)).toBe(0)
    expect(clampBar(99, 8)).toBe(7)
    // An empty chain still has a bar zero to jump to rather than a bar minus one.
    expect(clampBar(2, 0)).toBe(0)
  })

  it('shortens a loop that would run off the end rather than moving it', () => {
    expect(clampLoop(0, 4, 8)).toEqual({ start: 0, bars: 4 })
    expect(clampLoop(6, 4, 8)).toEqual({ start: 6, bars: 2 })
    expect(clampLoop(7, 4, 8)).toEqual({ start: 7, bars: 1 })
    // A loop of no bars is not a loop; a negative start is the top of the song.
    expect(clampLoop(0, 0, 8)).toEqual({ start: 0, bars: 1 })
    expect(clampLoop(-2, 2, 8)).toEqual({ start: 0, bars: 2 })
  })
})

describe('the hosted transport', () => {
  const ports = (bars: number, armed = true) => {
    const loops: (GrooveboxLoop | null)[] = []
    return {
      loops,
      calls: {
        bars: () => bars,
        armRack: vi.fn(() => armed),
        startAt: vi.fn(),
        setLoop: vi.fn(),
        clearLoop: vi.fn(),
        onLoop: (loop: GrooveboxLoop | null) => loops.push(loop),
      },
    }
  }

  it('refuses to jump before there is a rack to jump with', () => {
    const { calls } = ports(8, false)
    expect(grooveboxTransport(calls).startAt(4)).toBe(false)
    // Starting the song anyway would leave it playing against a clock nothing else is following.
    expect(calls.startAt).not.toHaveBeenCalled()
  })

  it('arms the rack first, then starts on a bar that exists', () => {
    const { calls } = ports(8)
    expect(grooveboxTransport(calls).startAt(99)).toBe(true)
    expect(calls.armRack).toHaveBeenCalledOnce()
    expect(calls.startAt).toHaveBeenCalledWith(7)
  })

  it('tells the engine and the faceplate the same clamped loop', () => {
    const { calls, loops } = ports(8)
    expect(grooveboxTransport(calls).setLoop(6, 4)).toBe(true)
    expect(calls.setLoop).toHaveBeenCalledWith(6, 2)
    // The drawn loop is the one the engine got, not the one that was asked for.
    expect(loops).toEqual([{ start: 6, bars: 2 }])
  })

  it('clears both when the loop is released', () => {
    const { calls, loops } = ports(8)
    grooveboxTransport(calls).clearLoop()
    expect(calls.clearLoop).toHaveBeenCalledOnce()
    expect(loops).toEqual([null])
  })
})
