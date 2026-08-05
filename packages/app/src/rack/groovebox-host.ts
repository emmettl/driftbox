import { GROOVEBOX_PORTS, type Patch } from '@driftbox/rack'
import { GROOVEBOX_SECTIONS, type GrooveboxSection } from '@driftbox/engine'
import { routedGrooveboxSections } from './groovebox.js'

// How an authored song and the rack around it share one audio graph, and how the rack drives that song's
// transport.
//
// Out of `RackApp` because none of it is React. Both halves are decisions with edges — which machines get
// diverted, which bar a jump lands on — and both were previously only reachable by starting audio in a
// browser, which is to say only reachable by hand.

/** The part of the hosted engine that decides where each machine's audio goes. */
export interface SectionRouting {
  routeSection(section: GrooveboxSection, destination: AudioNode | null): void
  tapSection(section: GrooveboxSection, destination: AudioNode | null): void
}

/** The part of the live rack that offers host inputs. */
export interface HostInputs {
  input(index: number): AudioNode | null
}

/**
 * Keep every authored machine visible to the rack graph, diverting only patched ones.
 *
 * An unpatched source keeps the exact hosted mix #114 introduced and adds a silent rack
 * tap for its front-panel meter. The first cable removes that tap and diverts the whole
 * machine through the same worklet input; removing the last cable restores the original
 * route and tap without restarting the song.
 */
export function routeGrooveboxSources(
  hosted: SectionRouting,
  live: HostInputs,
  patch: Patch,
): void {
  const routed = new Set(routedGrooveboxSections(patch))
  for (const section of GROOVEBOX_SECTIONS) {
    const ports = GROOVEBOX_PORTS[section]
    const input = live.input(ports.input)
    if (routed.has(section)) {
      hosted.tapSection(section, null)
      hosted.routeSection(section, input)
    } else {
      hosted.routeSection(section, null)
      hosted.tapSection(section, input)
    }
  }
}

/** A loop over the hosted song, in whole bars. */
export interface GrooveboxLoop {
  start: number
  bars: number
}

/** What the Groovebox faceplate can ask of the hosted transport. */
export interface GrooveboxTransport {
  startAt: (bar: number) => boolean
  setLoop: (start: number, bars: number) => boolean
  clearLoop: () => void
}

/**
 * Everything the transport needs from the world, so the arithmetic can be checked without one.
 *
 * `armRack` is the rack side of a jump: it sets the transport tempo and swing and starts the rack
 * running, and answers false when there is no live rack to do it to. Returning false rather than jumping
 * anyway is the point — a hosted song started against a rack that does not exist plays alone, on a clock
 * nothing else is following.
 */
export interface GrooveboxTransportPorts {
  /** Total bars in the hosted song. Clamped to at least one, because an empty chain has no bar zero. */
  bars: () => number
  armRack: () => boolean
  startAt: (bar: number) => void
  setLoop: (start: number, bars: number) => void
  clearLoop: () => void
  onLoop: (loop: GrooveboxLoop | null) => void
}

/** The first bar of a song, and the last one that exists. Fractions land on the bar they are inside. */
export function clampBar(bar: number, totalBars: number): number {
  const total = Math.max(1, totalBars)
  return Math.max(0, Math.min(total - 1, Math.floor(bar)))
}

/**
 * A loop that fits inside the song.
 *
 * The length is clamped against what is left *after* the start, so a four-bar loop asked for on the last
 * bar of a two-bar song becomes one bar there rather than running off the end into silence.
 */
export function clampLoop(start: number, bars: number, totalBars: number): GrooveboxLoop {
  const total = Math.max(1, totalBars)
  const loopStart = clampBar(start, total)
  return {
    start: loopStart,
    bars: Math.max(1, Math.min(total - loopStart, Math.floor(bars))),
  }
}

/** Bind the clamps above to a real engine, a real rack and the store that draws the loop. */
export function grooveboxTransport(ports: GrooveboxTransportPorts): GrooveboxTransport {
  return {
    startAt: (bar) => {
      if (!ports.armRack()) return false
      ports.startAt(clampBar(bar, ports.bars()))
      return true
    },
    setLoop: (start, bars) => {
      const loop = clampLoop(start, bars, ports.bars())
      ports.setLoop(loop.start, loop.bars)
      ports.onLoop(loop)
      return true
    },
    clearLoop: () => {
      ports.clearLoop()
      ports.onLoop(null)
    },
  }
}
