import { Random } from '../dsp/random.js'
import type { ModuleData, ModuleDef, Processor, Transport } from '../types.js'

interface RandomLike {
  next(): number
}

export const ARP_PATTERN_STEPS = 16

// One shared controller, with two honest sources. Root keeps the original Driftbox behavior: choose a chord
// shape and one note becomes a progression. Played uses the Graph's collector view and arpeggiates the notes
// actually held at its Pitch/Gate inputs. The ordinary summed inlets remain in the signature, so old plans and
// direct processor callers still take the same road.
export class ArpProcessor implements Processor {
  private readonly rng: RandomLike
  private readonly sampleRate: number
  private readonly trigSamples: number
  private readonly data?: ModuleData
  private readonly chords = [
    [0],
    [0, 7],
    [0, 4, 7],
    [0, 3, 7],
    [0, 4, 7, 11],
    [0, 3, 7, 10],
    [0, 5, 7],
    [0, 3, 6],
  ]

  private step = 0
  private started = false
  private rising = true
  private lastClock = 0
  private lastReset = 0
  private held = 0
  private heldVelocity = 1
  private gateLeft = 0
  private trigLeft = 0
  private since = 0
  private interval = 0
  private internalLeft = 0
  private timingWas = 0
  private patternStep = 0

  // Input identity survives between blocks. Hold latches by source voice: a released slot remains in the
  // figure, while a new note allocated to that slot replaces it rather than creating a duplicate ghost note.
  private readonly gateWas = new Uint8Array(64)
  private readonly order = new Uint32Array(64)
  private readonly latched = new Uint8Array(64)
  private readonly latchedPitch = new Float32Array(64)
  private readonly latchedVelocity = new Float32Array(64)
  private orderClock = 0
  private activeCount = 0
  private playedWas = false

  // Fixed workspaces keep note collection and sorting allocation-free in the audio loop. A collector can see
  // sixty-four upstream voices and the RPG octave range can repeat those over four octaves.
  private readonly figurePitch = new Float32Array(256)
  private readonly figureVelocity = new Float32Array(256)
  private readonly figureOrder = new Uint32Array(256)

  constructor(sampleRate: number, deps: Record<string, unknown>, id: string, data?: ModuleData) {
    const Rng = deps.Random as new (seed: string | number) => RandomLike
    this.rng = new Rng(id)
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.trigSamples = Math.max(1, Math.round(this.sampleRate * 0.001))
    this.data = data
  }

  private patternEnabled(step: number): boolean {
    const pattern = this.data?.get('pattern')
    return !pattern || step >= pattern.length || pattern[step] >= 0.5
  }

  private internalInterval(
    timing: number,
    division: number,
    rate: number,
    transport?: Transport,
  ): number {
    if (timing === 2) {
      return Math.max(2, Math.round(this.sampleRate / Math.max(0.1, Math.min(250, rate))))
    }

    // Beat lengths for the labelled whole-note divisions below. Tempo sync deliberately follows the rack
    // tempo even while its transport is stopped: like the RPG-8, an Arp is playable without starting the
    // song. External remains the compatibility default for patches that want explicit Clock/Reset wiring.
    const beats = [2, 1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12, 1 / 16, 1 / 32]
    const at = Math.max(0, Math.min(beats.length - 1, Math.round(division)))
    const tempo = transport && transport.tempo > 0 ? transport.tempo : 120
    return Math.max(2, Math.round(beats[at] * this.sampleRate * 60 / tempo))
  }

  private clearLatch(): void {
    this.latched.fill(0)
  }

  private collectPlayed(
    pitchVoices: Float32Array[],
    velocityVoices: Float32Array[],
    voices: number,
    frame: number,
    hold: boolean,
    manual: boolean,
  ): number {
    let count = 0
    for (let voice = 0; voice < voices; voice++) {
      const use = hold ? this.latched[voice] === 1 : this.gateWas[voice] === 1
      if (!use) continue
      const pitch = this.gateWas[voice] === 1
        ? (pitchVoices[voice]?.[frame] ?? this.latchedPitch[voice])
        : this.latchedPitch[voice]
      const velocity = this.gateWas[voice] === 1
        ? (velocityVoices[voice]?.[frame] ?? this.latchedVelocity[voice])
        : this.latchedVelocity[voice]

      // Several upstream roots can generate the same chord tone. Chord Player suppresses those already, but
      // collecting is a reusable boundary and must not depend on one particular producer doing it first.
      let duplicate = -1
      for (let at = 0; at < count; at++) {
        if (Math.abs(this.figurePitch[at] - pitch) < 1e-5) {
          duplicate = at
          break
        }
      }
      if (duplicate >= 0) {
        this.figureVelocity[duplicate] = Math.max(this.figureVelocity[duplicate], velocity)
        continue
      }

      this.figurePitch[count] = pitch
      this.figureVelocity[count] = velocity > 0 ? Math.min(1, velocity) : 1
      this.figureOrder[count] = this.order[voice]
      count++
    }

    // RPG Manual means note-on order; every other deterministic direction starts from pitch order. Insertion
    // sort is ideal for the tiny usual chord and avoids allocating a temporary array for the rare wide input.
    for (let i = 1; i < count; i++) {
      const pitch = this.figurePitch[i]
      const velocity = this.figureVelocity[i]
      const order = this.figureOrder[i]
      let at = i
      while (at > 0) {
        const before = manual
          ? this.figureOrder[at - 1] > order
          : this.figurePitch[at - 1] > pitch
        if (!before) break
        this.figurePitch[at] = this.figurePitch[at - 1]
        this.figureVelocity[at] = this.figureVelocity[at - 1]
        this.figureOrder[at] = this.figureOrder[at - 1]
        at--
      }
      this.figurePitch[at] = pitch
      this.figureVelocity[at] = velocity
      this.figureOrder[at] = order
    }
    return count
  }

  private advance(length: number, mode: number, opening: boolean): void {
    if (opening) {
      this.started = true
      this.rising = mode !== 1 && mode !== 3
      this.step = this.rising ? 0 : length - 1
    } else if (mode === 4) {
      const roll = (this.rng.next() + 1) * 0.5
      this.step = Math.min(length - 1, Math.max(0, Math.floor(roll * length)))
    } else if (mode === 1) {
      this.step = this.step - 1 < 0 ? length - 1 : this.step - 1
    } else if (mode === 2 || mode === 3) {
      if (this.rising) {
        if (this.step + 1 >= length) {
          this.rising = false
          this.step = length > 1 ? length - 2 : 0
        } else this.step++
      } else if (this.step - 1 < 0) {
        this.rising = true
        this.step = length > 1 ? 1 : 0
      } else this.step--
    } else {
      // Up and Manual both advance through the order already prepared in `figurePitch`.
      this.step = this.step + 1 >= length ? 0 : this.step + 1
    }
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
    transport?: Transport,
    _hostInputs?: Float32Array[][],
    voiceInlets?: Float32Array[][],
  ): void {
    const pitchIn = inlets[0]
    const gateIn = inlets[1]
    const velocityIn = inlets[2]
    const clockIn = inlets[3]
    const resetIn = inlets[4]
    const pitchOut = outlets[0]
    const gateOut = outlets[1]
    const velocityOut = outlets[2]
    const trigOut = outlets[3]

    const sourceParam = params[0]
    const chordParam = params[1]
    const octavesParam = params[2]
    const modeParam = params[3]
    const gateParam = params[4]
    const holdParam = params[5]
    const shiftParam = params[6]
    const velocityModeParam = params[7]
    const velocityParam = params[8]
    const timingParam = params[9]
    const divisionParam = params[10]
    const rateParam = params[11]
    const patternLengthParam = params[12]

    const pitchVoices = voiceInlets?.[0] ?? [pitchIn]
    const gateVoices = voiceInlets?.[1] ?? [gateIn]
    const velocityVoices = voiceInlets?.[2] ?? [velocityIn]
    const inputVoices = Math.min(64, Math.max(pitchVoices.length, gateVoices.length))

    for (let i = 0; i < frames; i++) {
      const played = sourceParam[i] >= 0.5
      const hold = holdParam[i] >= 0.5
      if (!played && this.playedWas) {
        this.activeCount = 0
        this.gateWas.fill(0)
        this.clearLatch()
      }
      this.playedWas = played
      const previousActive = this.activeCount
      let active = 0
      let clearedForChord = false

      if (played) {
        for (let voice = 0; voice < inputVoices; voice++) {
          const gate = (gateVoices[voice]?.[i] ?? 0) >= 0.5
          if (gate) active++
          if (gate && this.gateWas[voice] === 0) {
            if (hold && previousActive === 0 && !clearedForChord) {
              this.clearLatch()
              clearedForChord = true
            }
            this.order[voice] = ++this.orderClock
            this.latched[voice] = 1
          }
          this.gateWas[voice] = gate ? 1 : 0
          if (gate) {
            this.latchedPitch[voice] = pitchVoices[voice]?.[i] ?? 0
            const velocity = velocityVoices[voice]?.[i] ?? 1
            this.latchedVelocity[voice] = velocity > 0 ? Math.min(1, velocity) : 1
          }
        }
        this.activeCount = active
        if (!hold && active === 0) {
          this.started = false
          this.gateLeft = 0
          this.trigLeft = 0
        }
      }

      const reset = resetIn[i] >= 0.5 ? 1 : 0
      if (reset === 1 && this.lastReset === 0) {
        this.started = false
        this.patternStep = 0
      }
      this.lastReset = reset

      this.since++
      const clock = clockIn[i] >= 0.5 ? 1 : 0
      const timing = Math.max(0, Math.min(2, Math.round(timingParam[i])))
      if (timing !== this.timingWas) {
        this.internalLeft = 0
        this.started = false
        this.timingWas = timing
      }
      let clockEdge = timing === 0 && clock === 1 && this.lastClock === 0
      if (timing !== 0) {
        if (this.internalLeft <= 0) {
          clockEdge = true
          this.internalLeft = this.internalInterval(timing, divisionParam[i], rateParam[i], transport)
        }
        this.internalLeft--
      }
      if (clockEdge) {
        let mode = Math.round(modeParam[i])
        if (mode < 0) mode = 0
        else if (mode > 5) mode = 5
        let octaves = Math.round(octavesParam[i])
        if (octaves < 1) octaves = 1
        else if (octaves > 4) octaves = 4

        let base = 0
        if (played) {
          base = this.collectPlayed(pitchVoices, velocityVoices, inputVoices, i, hold, mode === 5)
        } else {
          let which = Math.round(chordParam[i])
          if (which < 0) which = 0
          else if (which >= this.chords.length) which = this.chords.length - 1
          const chord = this.chords[which]
          for (let note = 0; note < chord.length; note++) {
            this.figurePitch[note] = pitchIn[i] + chord[note] / 12
            const inputVelocity = velocityIn[i]
            this.figureVelocity[note] = inputVelocity > 0 ? Math.min(1, inputVelocity) : 1
          }
          base = chord.length
        }

        const length = Math.min(256, base * octaves)
        if (base > 0 && length > 0) {
          for (let octave = 1; octave < octaves; octave++) {
            for (let note = 0; note < base && octave * base + note < length; note++) {
              const at = octave * base + note
              this.figurePitch[at] = this.figurePitch[note] + octave
              this.figureVelocity[at] = this.figureVelocity[note]
              this.figureOrder[at] = this.figureOrder[note]
            }
          }

          const opening = !this.started
          this.interval = this.since
          this.since = 0
          this.advance(length, mode, opening)
          if (this.step >= length) this.step = 0
          const patternLength = Math.max(1, Math.min(ARP_PATTERN_STEPS, Math.round(patternLengthParam[i])))
          this.patternStep = opening ? 0 : (this.patternStep + 1) % patternLength
          const shift = Math.max(-3, Math.min(3, Math.round(shiftParam[i])))
          this.held = this.figurePitch[this.step] + shift
          this.heldVelocity = velocityModeParam[i] >= 0.5
            ? Math.max(0.01, Math.min(1, velocityParam[i]))
            : this.figureVelocity[this.step]
          const fraction = gateParam[i]
          const span = opening ? this.trigSamples : this.interval
          if (this.patternEnabled(this.patternStep)) {
            this.gateLeft = Math.max(1, Math.round(span * (fraction > 0 ? fraction : 0.01)))
            this.trigLeft = this.trigSamples
          } else {
            // A rest still consumes its place in both cycles. That keeps the rhythmic pattern independent
            // of the note figure: sixteen steps remain sixteen steps whether the chord has three notes or
            // seven, and unmuting a pulse never changes every later pitch.
            this.gateLeft = 0
            this.trigLeft = 0
          }
        } else {
          this.started = false
          this.gateLeft = 0
          this.trigLeft = 0
        }
      }
      this.lastClock = clock

      pitchOut[i] = this.held
      velocityOut[i] = this.heldVelocity
      if (this.gateLeft > 0) {
        this.gateLeft--
        gateOut[i] = 1
      } else gateOut[i] = 0
      if (this.trigLeft > 0) {
        this.trigLeft--
        trigOut[i] = 1
      } else trigOut[i] = 0
    }
  }
}

export const ARP_MODULE: ModuleDef = {
  type: 'arp',
  version: 4,
  name: 'Arp',
  group: 'Sequencing',
  blurb:
    'Turns a played chord into one running line, or builds the original Driftbox chord from a single root. Run it from a cable, tempo or free clock, then add rests with its step pattern.',
  logo: {
    paths: ['M6 30l8-8 8 8 8-8 8 8 8-8 8 8', 'M6 14h8', 'M22 14h8', 'M38 14h8'],
  },
  inlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'velocity', name: 'Velocity' },
    { id: 'clock', name: 'Clock' },
    { id: 'reset', name: 'Reset' },
  ],
  outlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'velocity', name: 'Velocity' },
    { id: 'trig', name: 'Trig' },
  ],
  params: [
    { id: 'source', name: 'Source', min: 0, max: 1, default: 0, stepped: true, labels: ['Root', 'Played'] },
    {
      id: 'chord',
      name: 'Chord',
      min: 0,
      max: 7,
      default: 3,
      stepped: true,
      labels: ['Oct', '5th', 'Maj', 'Min', 'Maj7', 'Min7', 'Sus4', 'Dim'],
    },
    { id: 'octaves', name: 'Octaves', min: 1, max: 4, default: 2, stepped: true },
    {
      id: 'mode',
      name: 'Mode',
      min: 0,
      max: 5,
      default: 0,
      stepped: true,
      labels: ['Up', 'Down', 'Up-Dn', 'Dn-Up', 'Rand', 'Manual'],
    },
    { id: 'gate', name: 'Gate Length', min: 0.05, max: 1, default: 0.5 },
    { id: 'hold', name: 'Hold', min: 0, max: 1, default: 0, stepped: true, labels: ['Off', 'On'] },
    { id: 'shift', name: 'Octave Shift', min: -3, max: 3, default: 0, stepped: true },
    {
      id: 'velocityMode',
      name: 'Velocity',
      min: 0,
      max: 1,
      default: 0,
      stepped: true,
      labels: ['Played', 'Fixed'],
    },
    { id: 'velocity', name: 'Fixed Velocity', min: 0.01, max: 1, default: 0.8 },
    {
      id: 'timing',
      name: 'Timing',
      min: 0,
      max: 2,
      default: 0,
      stepped: true,
      labels: ['External', 'Tempo', 'Free'],
    },
    {
      id: 'division',
      name: 'Division',
      min: 0,
      max: 9,
      default: 4,
      stepped: true,
      labels: ['1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32', '1/32T', '1/64', '1/128'],
    },
    { id: 'rate', name: 'Free Rate', min: 0.1, max: 250, default: 8 },
    { id: 'patternLength', name: 'Pattern Steps', min: 1, max: ARP_PATTERN_STEPS, default: 16, stepped: true },
  ],
  processor: ArpProcessor,
  deps: { Random },
  poly: false,
  voiceCollector: true,
}
