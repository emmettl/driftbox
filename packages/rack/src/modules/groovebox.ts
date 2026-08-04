import { GROOVEBOX_SECTIONS, type GrooveboxSection } from '@driftbox/engine'
import type { MeterReading, ModuleDef, Processor, Transport } from '../types.js'

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
      output: string
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
      output: `${section.replace('.', '-')}-out`,
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
    output: string
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
  private readonly sampleRate: number
  private readonly meterIds: string[]
  private readonly levels = new Float32Array(4)
  private readonly peaks = new Float32Array(4)
  private readonly envelopes = new Float32Array(4)
  private readonly waveforms = Array.from({ length: 4 }, () => new Float32Array(48))

  constructor(
    sampleRate = 48_000,
    _deps: Record<string, unknown> = {},
    id = 'groovebox',
  ) {
    this.sampleRate = sampleRate
    // Kept inside the class because processors are stringified into the worklet without
    // their module scope. These are the same stable section identities the engine owns.
    this.meterIds = ['tr808', 'tr909', '303.a', '303.b'].map(
      (section) => `${id}:${section}`,
    )
  }

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
      let squares = 0
      let peak = 0
      for (let i = 0; i < frames; i++) {
        const balance = Math.max(-1, Math.min(1, pan[i]))
        const gain = mute[i] >= 0.5 ? 0 : level[i]
        const leftGain = balance > 0 ? 1 - balance : 1
        const rightGain = balance < 0 ? 1 + balance : 1
        leftOut[i] = (left?.[i] ?? 0) * gain * leftGain
        rightOut[i] = (right?.[i] ?? 0) * gain * rightGain
        squares += leftOut[i] * leftOut[i] + rightOut[i] * rightOut[i]
        const samplePeak = Math.max(Math.abs(leftOut[i]), Math.abs(rightOut[i]))
        if (samplePeak > peak) peak = samplePeak
      }

      const rms = frames > 0 ? Math.sqrt(squares / (frames * 2)) : 0
      this.levels[section] = rms
      this.peaks[section] = peak
      const previous = this.envelopes[section]
      const release = Math.pow(
        0.01,
        frames / Math.max(1, this.sampleRate * 0.3),
      )
      this.envelopes[section] =
        peak >= previous ? peak : peak + (previous - peak) * release

      const waveform = this.waveforms[section]
      for (let point = 0; point < waveform.length; point++) {
        const index = Math.max(
          0,
          Math.min(frames - 1, Math.floor((point * frames) / waveform.length)),
        )
        const sample = frames > 0 ? (leftOut[index] + rightOut[index]) * 0.5 : 0
        waveform[point] = Math.max(-1, Math.min(1, sample))
      }
    }
  }

  /** Four post-strip readings, without materialising four hidden rack modules. */
  meters(): readonly MeterReading[] {
    return this.meterIds.map((id, section) => ({
      id,
      level: this.levels[section],
      peak: this.peaks[section],
      envelope: this.envelopes[section],
      waveform: this.waveforms[section].slice(),
    }))
  }
}

export const GROOVEBOX_MODULE: ModuleDef = {
  type: 'groovebox',
  version: 2,
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
  guide: {
    overview:
      'This is the bridge from a retained Groovebox song into the cable rack. It does not make a second copy of the song: it exposes the four authored machines as separate stereo stems so the rack can process and mix them independently.',
    concepts: [
      {
        title: 'Four stems, one song',
        body: '808, 909, 303 A and 303 B each have one stereo output. Their patterns and synthesis still come from the retained Groovebox song; the controls here only set each stem’s level, pan and mute.',
      },
      {
        title: 'Retained means embedded',
        body: 'A rack-native patch may not contain a Groovebox song. In that case every outlet is silent. Open or convert a Groovebox song first if you want this device to produce audio.',
      },
    ],
    firstPatch: [
      'Open a Groovebox song in the rack so this source has authored material.',
      'Patch the 808 stereo output to one effect or mixer path and the 303 A output to another.',
      'Use the strip mutes to confirm which machine each cable is carrying, then balance the four levels.',
    ],
    watchFor: [
      'A stereo output folded into a mono input follows the rack convention: its left channel is heard.',
      'Older patches with separate left and right Groovebox cables retain the channel each cable originally carried.',
      'Editing the embedded song changes what these outlets play; it is not a sample frozen at import time.',
    ],
  },
  inlets: [],
  outlets: GROOVEBOX_SECTIONS.map((section) => ({
    id: GROOVEBOX_PORTS[section].output,
    name: sectionName(section),
    stereo: true,
    aliases: [
      { id: GROOVEBOX_PORTS[section].left, channel: 0 },
      { id: GROOVEBOX_PORTS[section].right, channel: 1 },
    ],
  })),
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
