import type { ModuleData, ModuleDef, Processor, Transport } from '../types.js'

// A MIDI-style delay made out of the rack's note-shaped CV: pitch, gate and velocity in; the same three out.
//
// The module is polyphonic on purpose. Each MIDI voice gets its own processor, so every note of a chord keeps
// its pitch and velocity and the entire chord repeats together. A retrigger on the same allocated voice starts
// a new echo train; that is the honest boundary of a fixed eight-voice CV graph rather than an unbounded MIDI
// event stream.
//
// Free time follows Reason's 1..1000ms range. Sync uses eight useful note values from 1/128 to 1/2 against the
// rack transport. Pitch is an additive semitone change per repeat and velocity is a linear percentage change
// per repeat, matching Note Echo rather than an audio delay's exponential feedback.
//
// `steps` is optional patch data: dry plus sixteen repeats, 1 for enabled and 0 for muted. The generic panel
// can use the device without it; a dedicated faceplate can turn the echo train into a rhythm without changing
// this playback contract.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export const NOTE_ECHO_STEPS = 17

export class NoteEchoProcessor implements Processor {
  private readonly sampleRate: number
  private readonly data: ModuleData
  private lastGate = 0
  private rootPitch = 0
  private inputVelocity = 1
  private repeats = 0
  private repeat = 0
  private interval = 1
  private until = -1
  private gateSpan = 1
  private pitchStep = 0
  private velocityStep = 1
  private echoPitch = 0
  private echoVelocity = 1
  private echoGateLeft = 0

  constructor(sampleRate: number, _deps: Record<string, unknown>, _id: string, data: ModuleData) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    this.data = data
  }

  private enabled(step: number): boolean {
    const pattern = this.data.get('steps')
    return !pattern || step >= pattern.length || pattern[step] >= 0.5
  }

  private trigger(
    pitch: number,
    velocity: number,
    params: Float32Array[],
    at: number,
    transport?: Transport,
  ): void {
    this.rootPitch = pitch
    this.inputVelocity = velocity > 0 ? Math.max(0, Math.min(1, velocity)) : 1
    this.repeats = Math.max(1, Math.min(16, Math.round(params[3][at])))
    this.repeat = 0
    this.pitchStep = Math.max(-12, Math.min(12, params[4][at]))
    this.velocityStep = Math.max(0.1, Math.min(2, params[5][at]))

    const sync = Math.round(params[0][at]) === 1
    if (sync && transport && transport.tempo > 0) {
      // Whole-note fractions expressed in beats: 1/128 through 1/2. A field rather than a module constant
      // because the processor class is serialised into the worklet on its own.
      const beats = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 1.5, 2]
      const division = Math.max(0, Math.min(beats.length - 1, Math.round(params[2][at])))
      this.interval = Math.max(2, Math.round(beats[division] * this.sampleRate * 60 / transport.tempo))
    } else {
      this.interval = Math.max(2, Math.round(Math.max(1, Math.min(1000, params[1][at])) * this.sampleRate / 1000))
    }
    const gate = Math.max(0.05, Math.min(0.95, params[6][at]))
    this.gateSpan = Math.max(1, Math.min(this.interval - 1, Math.round(this.interval * gate)))
    this.until = this.interval
    this.echoGateLeft = 0
    this.echoPitch = pitch
    this.echoVelocity = this.inputVelocity
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
    transport?: Transport,
  ): void {
    const pitchIn = inlets[0]
    const gateIn = inlets[1]
    const velocityIn = inlets[2]
    const pitchOut = outlets[0]
    const gateOut = outlets[1]
    const velocityOut = outlets[2]
    const dryParam = params[7]

    for (let i = 0; i < frames; i++) {
      const gate = gateIn[i] >= 0.5 ? 1 : 0
      if (gate === 1 && this.lastGate === 0) {
        this.trigger(pitchIn[i], velocityIn[i], params, i, transport)
      }
      this.lastGate = gate

      if (this.until === 0 && this.repeat < this.repeats) {
        this.repeat++
        this.echoPitch = this.rootPitch + this.pitchStep * this.repeat / 12
        // Reason describes this as a linear percentage change per step, not feedback. Clamp because velocity
        // is a control signal with a defined 0..1 destination even when the slope asks to cross either end.
        this.echoVelocity = Math.max(
          0,
          Math.min(1, this.inputVelocity * (1 + (this.velocityStep - 1) * this.repeat)),
        )
        this.echoGateLeft = this.enabled(this.repeat) ? this.gateSpan : 0
        this.until = this.repeat < this.repeats ? this.interval : -1
      }

      // One low sample before a repeat guarantees a real gate edge even when the incoming note was held
      // longer than the echo interval or the preceding repeat used the largest gate fraction.
      const gap = this.until === 1 && this.repeat < this.repeats
      const echoing = this.echoGateLeft > 0 && !gap
      const dry = this.repeat === 0 && gate === 1 && Math.round(dryParam[i]) === 1 && this.enabled(0) && !gap
      if (echoing) {
        pitchOut[i] = this.echoPitch
        gateOut[i] = 1
        velocityOut[i] = this.echoVelocity
      } else if (dry) {
        pitchOut[i] = pitchIn[i]
        gateOut[i] = 1
        velocityOut[i] = velocityIn[i] > 0 ? Math.max(0, Math.min(1, velocityIn[i])) : 1
      } else {
        pitchOut[i] = echoing ? this.echoPitch : this.rootPitch
        gateOut[i] = 0
        velocityOut[i] = 0
      }

      if (this.echoGateLeft > 0) this.echoGateLeft--
      if (this.until > 0) this.until--
    }
  }
}

export const NOTE_ECHO_MODULE: ModuleDef = {
  type: 'note-echo',
  version: 1,
  name: 'Note Echo',
  group: 'Sequencing',
  blurb:
    'Repeats notes or whole chords in time, with a semitone shift and a linear velocity slope on every echo.',
  logo: {
    paths: [
      'M7 13h10v10H7zM27 17h9v9h-9zM46 21h8v8h-8z',
      'M17 18h10M36 22h10',
      'M9 34h44',
    ],
  },
  inlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'velocity', name: 'Velocity' },
  ],
  outlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'velocity', name: 'Velocity' },
  ],
  params: [
    { id: 'sync', name: 'Sync', min: 0, max: 1, default: 1, stepped: true, labels: ['Free', 'Tempo'] },
    { id: 'time', name: 'Time ms', min: 1, max: 1000, default: 250 },
    {
      id: 'division',
      name: 'Division',
      min: 0,
      max: 7,
      default: 3,
      stepped: true,
      labels: ['1/128', '1/64', '1/32', '1/16', '1/8', '1/4', '3/8', '1/2'],
    },
    { id: 'repeats', name: 'Repeats', min: 1, max: 16, default: 3, stepped: true },
    { id: 'pitch', name: 'Pitch', min: -12, max: 12, default: 0, stepped: true },
    { id: 'velocity', name: 'Velocity', min: 0.1, max: 2, default: 1 },
    { id: 'gate', name: 'Gate', min: 0.05, max: 0.95, default: 0.5 },
    { id: 'dry', name: 'Dry', min: 0, max: 1, default: 1, stepped: true, labels: ['Mute', 'On'] },
  ],
  processor: NoteEchoProcessor,
  poly: true,
}
