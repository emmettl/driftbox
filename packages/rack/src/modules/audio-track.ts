import type { ModuleData, ModuleDef, Processor, Transport } from '../types.js'

// A stereo recording placed on the rack transport.
//
// The patch stores only the musical placement and level. PCM arrives through `setData`, exactly as it does
// for Sampler and Multisampler, so adding a track does not turn every rack file and share URL into megabytes
// of encoded audio. The host retains the recording for this session and can supply it again to a rebuilt or
// offline rack.
//
// Playback is deliberately one-shot. Repeating a recording is an arrangement decision, represented by a
// second Audio Track (or a Looper when repetition is the performance), rather than a hidden loop switch that
// makes the visible timeline ambiguous.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class AudioTrackProcessor implements Processor {
  private readonly data: ModuleData
  private readonly sampleRate: number
  private left: Float32Array | undefined
  private right: Float32Array | undefined
  private rateData: Float32Array | undefined
  private sourceRate: number
  private position = -1
  private running = false
  private lastBeat = 0
  private start = -1

  constructor(sampleRate: number, _deps: Record<string, unknown>, _id: string, data: ModuleData) {
    this.data = data
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.sourceRate = this.sampleRate
  }

  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
    transport?: Transport,
  ): void {
    const nextLeft = this.data.get('left')
    const nextRight = this.data.get('right')
    const nextRateData = this.data.get('sampleRate')
    const start = Math.max(0, Math.round(params[0][0]))
    const changed =
      nextLeft !== this.left ||
      nextRight !== this.right ||
      nextRateData !== this.rateData ||
      start !== this.start
    if (changed) {
      this.left = nextLeft
      this.right = nextRight
      this.rateData = nextRateData
      const sourceRate = nextRateData?.[0]
      this.sourceRate = sourceRate && sourceRate > 0 ? sourceRate : this.sampleRate
      this.start = start
      this.position = -1
    }

    const outLeft = outlets[0]
    const outRight = outlets[1]
    const isRunning = transport?.running === true
    if (!isRunning) {
      outLeft.fill(0)
      outRight.fill(0)
      this.running = false
      this.position = -1
      this.lastBeat = transport?.beat ?? this.lastBeat
      return
    }

    // A fresh transport pass always re-arms the clip. If audio or placement is changed while the playhead
    // is already beyond its start, seek to the corresponding point so loading a track does not require a
    // stop/play ritual before it can be heard.
    // The host can suspend immediately after sending Stop, so the processor is not guaranteed one block
    // with `running: false`. A beat that moved backwards is the other unambiguous start-of-pass signal.
    const rewound = (transport?.beat ?? 0) + 1e-7 < this.lastBeat
    if (!this.running || rewound) this.position = -1
    this.running = true
    const beatPerFrame = frames > 0 ? (transport?.beatsPerBlock ?? 0) / frames : 0
    const startBeat = start / 4
    if (this.position < 0 && changed && (transport?.beat ?? 0) > startBeat && beatPerFrame > 0) {
      this.position = Math.max(
        0,
        (((transport?.beat ?? 0) - startBeat) / beatPerFrame) *
          (this.sourceRate / this.sampleRate),
      )
    }

    for (let frame = 0; frame < frames; frame++) {
      const beat = (transport?.beat ?? 0) + beatPerFrame * frame
      if (this.position < 0 && beat >= startBeat) this.position = 0

      const position = this.position
      const index = Math.floor(position)
      const fraction = position - index
      const leftA = index >= 0 ? (this.left?.[index] ?? 0) : 0
      const leftB = index >= 0 ? (this.left?.[index + 1] ?? leftA) : 0
      const rightA = index >= 0 ? (this.right?.[index] ?? leftA) : 0
      const rightB = index >= 0 ? (this.right?.[index + 1] ?? rightA) : 0
      const left = leftA + (leftB - leftA) * fraction
      const right = rightA + (rightB - rightA) * fraction
      const level = Number.isFinite(params[1][frame]) ? params[1][frame] : 1
      outLeft[frame] = left * level
      outRight[frame] = right * level
      if (position >= 0) this.position += this.sourceRate / this.sampleRate
    }
    this.lastBeat = (transport?.beat ?? 0) + (transport?.beatsPerBlock ?? 0)
  }
}

export const AUDIO_TRACK_MODULE: ModuleDef = {
  type: 'audio-track',
  version: 1,
  name: 'Audio Track',
  group: 'Sources',
  blurb:
    'Places one stereo recording on the rack timeline. The audio stays in this session; its start position is saved.',
  guide: {
    overview:
      'Audio Track plays one local recording once when the rack transport reaches its saved position, then routes it through ordinary rack cables.',
    concepts: [
      {
        title: 'Placement is musical',
        body: 'Start is measured in rack sixteenths, so the recording keeps its bar-and-step position when the tempo changes.',
      },
      {
        title: 'The file is session audio',
        body: 'The patch remembers the device and placement, but not megabytes of PCM. Reopening a shared patch leaves the track empty.',
      },
    ],
    firstPatch: [
      'Patch Out to a mixer or terminal output.',
      'Load an audio file and choose the bar and sixteenth where it should enter.',
      'Press Play to hear it in time with the rest of the rack.',
    ],
    watchFor: [
      'Audio Track does not time-stretch the recording. Tempo changes move its start on the musical grid without changing its pitch.',
      'Add another Audio Track for another placement; use Loop Station for a repeating live performance.',
    ],
  },
  logo: {
    paths: ['M8 20h6l4-8 6 18 6-22 6 24 6-14 6 6h8', 'M8 37h48'],
  },
  inlets: [],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    { id: 'start', name: 'Start', min: 0, max: 1023, default: 0, stepped: true },
    { id: 'level', name: 'Level', min: 0, max: 2, default: 1 },
  ],
  processor: AudioTrackProcessor,
  poly: false,
}
