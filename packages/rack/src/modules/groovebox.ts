import { GROOVEBOX_SECTIONS, type GrooveboxSection } from '@driftbox/engine'
import type { ModuleDef, Processor, Transport } from '../types.js'

/**
 * The rack inlet and stereo outlet names for each authored groovebox machine.
 *
 * One table is shared by the host routing and the def. That prevents a cable labelled
 * “303 A R” from quietly reading the 303 B input after either side is reordered.
 */
export const GROOVEBOX_PORTS: Readonly<
  Record<
    GrooveboxSection,
    {
      input: number
      left: string
      right: string
      level: string
      pan: string
      mute: string
    }
  >
> = Object.fromEntries(
  GROOVEBOX_SECTIONS.map((section, input) => [
    section,
    {
      input,
      left: `${section}-l`,
      right: `${section}-r`,
      level: `${section.replace('.', '-')}-level`,
      pan: `${section.replace('.', '-')}-pan`,
      mute: `${section.replace('.', '-')}-mute`,
    },
  ]),
) as Record<
  GrooveboxSection,
  {
    input: number
    left: string
    right: string
    level: string
    pan: string
    mute: string
  }
>

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
 * filters, delays, vocoders and Out strips need no special groovebox path. The three
 * params per section form its source strip in this exact order: level, pan, mute.
 */
export class GrooveboxProcessor implements Processor {
  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
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
      const level = params[section * 3]
      const pan = params[section * 3 + 1]
      const mute = params[section * 3 + 2]
      for (let i = 0; i < frames; i++) {
        const balance = Math.max(-1, Math.min(1, pan[i]))
        const gain = mute[i] >= 0.5 ? 0 : level[i]
        const leftGain = balance > 0 ? 1 - balance : 1
        const rightGain = balance < 0 ? 1 + balance : 1
        leftOut[i] = (left?.[i] ?? 0) * gain * leftGain
        rightOut[i] = (right?.[i] ?? 0) * gain * rightGain
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
  logo: {
    paths: [
      'M7 9v22M21 9v22M35 9v22M49 9v22M57 9v22',
      'M10 14h8M24 22h8M38 13h8M38 18h8M52 25h3',
      'M10 27h8M24 13h8M24 28h8M38 27h8M52 15h3',
    ],
  },
  group: 'Sources',
  inlets: [],
  outlets: GROOVEBOX_SECTIONS.flatMap((section) => [
    { id: GROOVEBOX_PORTS[section].left, name: `${sectionName(section)} L` },
    { id: GROOVEBOX_PORTS[section].right, name: `${sectionName(section)} R` },
  ]),
  params: GROOVEBOX_SECTIONS.flatMap((section) => {
    const ports = GROOVEBOX_PORTS[section]
    const name = sectionName(section)
    return [
      { id: ports.level, name: `${name} Level`, min: 0, max: 1, default: 1 },
      { id: ports.pan, name: `${name} Pan`, min: -1, max: 1, default: 0 },
      {
        id: ports.mute,
        name: `${name} Mute`,
        min: 0,
        max: 1,
        default: 0,
        stepped: true,
        labels: ['On', 'Mute'],
      },
    ]
  }),
  processor: GrooveboxProcessor,
  // The retained song is one performance, even when the rack patch itself is polyphonic.
  poly: false,
}
