import { GROOVEBOX_SECTIONS, type GrooveboxSection } from '@driftbox/engine'
import type { ModuleDef, Processor, Transport } from '../types.js'

/**
 * The rack inlet and stereo outlet names for each authored groovebox machine.
 *
 * One table is shared by the host routing and the def. That prevents a cable labelled
 * “303 A R” from quietly reading the 303 B input after either side is reordered.
 */
export const GROOVEBOX_PORTS: Readonly<
  Record<GrooveboxSection, { input: number; left: string; right: string }>
> = Object.fromEntries(
  GROOVEBOX_SECTIONS.map((section, input) => [
    section,
    {
      input,
      left: `${section}-l`,
      right: `${section}-r`,
    },
  ]),
) as Record<GrooveboxSection, { input: number; left: string; right: string }>

const sectionName = (section: GrooveboxSection): string =>
  section === 'tr808'
    ? '808'
    : section === 'tr909'
      ? '909'
      : section === '303.a'
        ? '303 A'
        : '303 B'

/**
 * The audio-thread half of the retained groovebox source.
 *
 * Native Web Audio renders the 303s and drum machines; this processor only crosses that
 * host boundary. Once copied into these buffers the signals are ordinary rack audio, so
 * filters, delays, vocoders and Out strips need no special groovebox path.
 */
export class GrooveboxProcessor implements Processor {
  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
    _transport?: Transport,
    hostInputs: Float32Array[][] = [],
  ): void {
    const sections = Math.floor(outlets.length / 2)
    for (let section = 0; section < sections; section++) {
      const channels = hostInputs[section] ?? []
      const left = channels[0]
      const right = channels[1] ?? left
      const leftOut = outlets[section * 2]
      const rightOut = outlets[section * 2 + 1]
      for (let i = 0; i < frames; i++) {
        leftOut[i] = left?.[i] ?? 0
        rightOut[i] = right?.[i] ?? 0
      }
    }
  }
}

export const GROOVEBOX_MODULE: ModuleDef = {
  type: 'groovebox',
  version: 1,
  name: 'Groovebox',
  blurb:
    'The retained song’s authored 808, 909 and two 303s as stereo rack sources. Silent when the patch has no retained song.',
  group: 'Sources',
  inlets: [],
  outlets: GROOVEBOX_SECTIONS.flatMap((section) => [
    { id: GROOVEBOX_PORTS[section].left, name: `${sectionName(section)} L` },
    { id: GROOVEBOX_PORTS[section].right, name: `${sectionName(section)} R` },
  ]),
  params: [],
  processor: GrooveboxProcessor,
  // The retained song is one performance, even when the rack patch itself is polyphonic.
  poly: false,
}
