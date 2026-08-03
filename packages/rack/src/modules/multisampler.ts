import type { ModuleData, ModuleDef, Processor } from '../types.js'

// A keyed, velocity-layered sampled instrument.
//
// This is deliberately a new device beside Sampler. Sampler is a break slicer: one buffer, equal cuts,
// trigger and EOC. Turning its data into key zones would change both its sound and its reason for existing.
// A multisample instrument instead takes pitch, gate and velocity, chooses one zone on the gate edge, and
// keeps that choice for the note so a bend cannot jump into another recording halfway through.
//
// **Metadata is patch data; PCM is not.** `zones` is a flat array in `PatchModule.data`, nine numbers per
// zone. The corresponding audio arrives through `sample0`, `sample1`, … with `Rack.setData`. This keeps root
// keys, ranges, velocity splits and loop points portable while local audio remains outside a URL. The layout
// is exported below for hosts, but the processor uses literal offsets because this class is stringified into
// the AudioWorklet and cannot close over module constants.
//
// A zone is: root MIDI note, low/high MIDI note, low/high velocity, normalised loop start/end, loop enabled,
// source sample rate. Source rate matters: a 44.1 kHz recording in a 48 kHz context must advance by 44.1/48
// before musical transposition is applied, or even its root note is sharp.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export const MULTISAMPLE_ZONE_STRIDE = 9
export const MULTISAMPLE_ZONE_FIELDS = [
  'root',
  'low',
  'high',
  'velocityLow',
  'velocityHigh',
  'loopStart',
  'loopEnd',
  'loop',
  'sampleRate',
] as const

export interface MultisampleZone {
  root: number
  low: number
  high: number
  velocityLow: number
  velocityHigh: number
  loopStart: number
  loopEnd: number
  loop: boolean
  sampleRate: number
}

export function multisampleSlot(index: number): string {
  return `sample${Math.max(0, Math.floor(index))}`
}

export function packMultisampleZones(zones: readonly MultisampleZone[]): number[] {
  return zones.flatMap((zone) => [
    zone.root,
    zone.low,
    zone.high,
    zone.velocityLow,
    zone.velocityHigh,
    zone.loopStart,
    zone.loopEnd,
    zone.loop ? 1 : 0,
    zone.sampleRate,
  ])
}

export function unpackMultisampleZones(values: ArrayLike<number>): MultisampleZone[] {
  const zones: MultisampleZone[] = []
  for (let at = 0; at + MULTISAMPLE_ZONE_STRIDE <= values.length; at += MULTISAMPLE_ZONE_STRIDE) {
    zones.push({
      root: values[at],
      low: values[at + 1],
      high: values[at + 2],
      velocityLow: values[at + 3],
      velocityHigh: values[at + 4],
      loopStart: values[at + 5],
      loopEnd: values[at + 6],
      loop: values[at + 7] >= 0.5,
      sampleRate: values[at + 8],
    })
  }
  return zones
}

export class MultisamplerProcessor implements Processor {
  private readonly sampleRate: number
  private readonly data: ModuleData
  private position = -1
  private sample: Float32Array | undefined
  private root = 60
  private sourceRate: number
  private loopStart = 0
  private loopEnd = 0
  private loops = false
  private velocity = 1
  private envelope = 0
  private lastGate = 0

  constructor(sampleRate: number, _deps: Record<string, unknown>, _id: string, data: ModuleData) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.sourceRate = this.sampleRate
    this.data = data
  }

  private coefficient(seconds: number): number {
    if (!(seconds > 0)) return 1
    return 1 - Math.exp(-4.605170185988091 / Math.max(1, seconds * this.sampleRate))
  }

  private trigger(note: number, velocity: number): void {
    const zones = this.data.get('zones')
    let chosen = -1
    let best = Infinity

    if (zones) {
      const count = Math.floor(zones.length / 9)
      for (let zone = 0; zone < count; zone++) {
        const at = zone * 9
        const root = Number.isFinite(zones[at]) ? zones[at] : 60
        let low = Number.isFinite(zones[at + 1]) ? zones[at + 1] : 0
        let high = Number.isFinite(zones[at + 2]) ? zones[at + 2] : 127
        if (low > high) {
          const swap = low
          low = high
          high = swap
        }
        let velocityLow = Number.isFinite(zones[at + 3]) ? zones[at + 3] : 0
        let velocityHigh = Number.isFinite(zones[at + 4]) ? zones[at + 4] : 1
        if (velocityLow > velocityHigh) {
          const swap = velocityLow
          velocityLow = velocityHigh
          velocityHigh = swap
        }
        if (note < low || note > high || velocity < velocityLow || velocity > velocityHigh) continue
        // Nearest root wins where zones overlap; velocity centre breaks an otherwise exact tie. This lets a
        // host crossfade ranges later without changing today's deterministic selection rule.
        const score = Math.abs(note - root) + Math.abs(velocity - (velocityLow + velocityHigh) * 0.5) * 0.001
        if (score < best) {
          best = score
          chosen = zone
        }
      }
    } else if (this.data.get('sample0')) {
      // A useful fallback for a host that pushes one sample before it has written metadata.
      chosen = 0
    }

    const sample = chosen >= 0 ? this.data.get(`sample${chosen}`) : undefined
    if (!sample || sample.length < 2) {
      this.sample = undefined
      this.position = -1
      this.envelope = 0
      return
    }

    const at = chosen * 9
    const root = zones && Number.isFinite(zones[at]) ? zones[at] : 60
    const sourceRate = zones && Number.isFinite(zones[at + 8]) ? zones[at + 8] : this.sampleRate
    let loopStart = zones && Number.isFinite(zones[at + 5]) ? zones[at + 5] : 0
    let loopEnd = zones && Number.isFinite(zones[at + 6]) ? zones[at + 6] : 1
    // Zone points are portable normalized values, but playback boundaries are sample frames. Rounding here
    // keeps a saved point stable after its metadata has made a Float32 round trip (0.6 otherwise becomes
    // 6.000000238 on a ten-frame sample and leaks the next frame before wrapping).
    loopStart = Math.round(Math.max(0, Math.min(1, loopStart)) * sample.length)
    loopEnd = Math.round(Math.max(0, Math.min(1, loopEnd)) * sample.length)

    this.sample = sample
    this.position = 0
    this.root = root
    this.sourceRate = sourceRate > 0 ? sourceRate : this.sampleRate
    this.loopStart = loopStart
    this.loopEnd = Math.max(loopStart + 1, loopEnd)
    this.loops = Boolean(zones && zones[at + 7] >= 0.5 && this.loopEnd <= sample.length)
    this.velocity = velocity
    this.envelope = 0
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const pitch = inlets[0]
    const gateIn = inlets[1]
    const velocityIn = inlets[2]
    const out = outlets[0]
    const envOut = outlets[1]
    const tune = params[0]
    const attack = params[1]
    const release = params[2]
    const velocityAmount = params[3]
    const level = params[4]

    for (let i = 0; i < frames; i++) {
      const gate = gateIn[i] >= 0.5 ? 1 : 0
      if (gate === 1 && this.lastGate === 0) {
        const note = 36 + pitch[i] * 12 + tune[i]
        const velocity = velocityIn[i] > 0 ? Math.max(0, Math.min(1, velocityIn[i])) : 1
        this.trigger(note, velocity)
      }
      this.lastGate = gate

      const sample = this.sample
      if (!sample || this.position < 0) {
        out[i] = 0
        envOut[i] = 0
        continue
      }

      const envelopeTarget = gate ? 1 : 0
      const seconds = gate ? attack[i] : release[i]
      this.envelope += (envelopeTarget - this.envelope) * this.coefficient(seconds)

      const index = Math.floor(this.position)
      const fraction = this.position - index
      const a = sample[index] ?? 0
      const b = sample[index + 1 < sample.length ? index + 1 : index] ?? 0
      const played = a + (b - a) * fraction
      const velocityGain = 1 - velocityAmount[i] + velocityAmount[i] * this.velocity
      out[i] = played * this.envelope * velocityGain * level[i]
      envOut[i] = this.envelope

      const note = 36 + pitch[i] * 12 + tune[i]
      let ratio = (this.sourceRate / this.sampleRate) * Math.pow(2, (note - this.root) / 12)
      if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1
      this.position += ratio

      if (gate && this.loops && this.position >= this.loopEnd) {
        const length = this.loopEnd - this.loopStart
        this.position = this.loopStart + ((this.position - this.loopStart) % length)
      } else if (this.position >= sample.length || (!gate && this.envelope < 1e-5)) {
        this.position = -1
        this.sample = undefined
        this.envelope = 0
      }
    }
  }
}

export const MULTISAMPLER_MODULE: ModuleDef = {
  type: 'multisampler',
  version: 1,
  name: 'Multisample Instrument',
  group: 'Sources',
  blurb:
    'Maps recordings across keys and velocity layers, with root tuning and sustain loops. Patch MIDI pitch, gate and velocity and play it polyphonically.',
  guide: {
    overview:
      'A Multisample Instrument chooses one recording when a note begins, based on pitch and velocity, then transposes that recording from its root note. Its zones turn a folder of recordings into one playable instrument.',
    concepts: [
      {
        title: 'Zones choose the recording',
        body: 'Each zone has a key range, velocity range and root note. Where zones overlap, the closest root wins; the chosen recording stays fixed until the next note so a pitch bend cannot switch samples halfway through.',
      },
      {
        title: 'Gate shapes the note',
        body: 'A rising Gate selects and starts a sample. Attack and Release shape its envelope, while a zone’s sustain loop repeats only while the gate remains held.',
      },
    ],
    firstPatch: [
      'Load or map a multisample set on the faceplate.',
      'Patch MIDI V/Oct, Gate and Velocity to the three matching inputs, then patch Out to a mixer or Out device.',
      'Hold a low and a high note, then adjust Attack and Release; use Env when another module should follow the same shape.',
    ],
    watchFor: [
      'Zone mapping is saved with the patch, but the recording data is local to this session and device.',
      'No matching key-and-velocity zone means silence, not the nearest arbitrary sample.',
    ],
  },
  logo: {
    paths: [
      'M6 31V10h52v21H6z',
      'M13 10v21M21 10v21M29 10v21M37 10v21M45 10v21M53 10v21',
      'M10 10v12h7V10M26 10v12h7V10M42 10v12h7V10',
      'M7 35c7-6 12 4 19-2s12 4 19-2 8 3 12 0',
    ],
  },
  inlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'velocity', name: 'Velocity' },
  ],
  outlets: [
    { id: 'out', name: 'Out' },
    { id: 'env', name: 'Env' },
  ],
  params: [
    { id: 'tune', name: 'Tune', min: -24, max: 24, default: 0 },
    { id: 'attack', name: 'Attack', min: 0, max: 2, default: 0.002 },
    { id: 'release', name: 'Release', min: 0.001, max: 8, default: 0.2 },
    { id: 'velocity', name: 'Velocity', min: 0, max: 1, default: 1 },
    { id: 'level', name: 'Level', min: 0, max: 1, default: 0.8 },
  ],
  processor: MultisamplerProcessor,
  poly: true,
}
