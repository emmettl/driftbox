import type { ModuleData, ModuleDef, Processor } from '../types.js'

// The scale half of Reason's Scales & Chords Player, expressed in the note-shaped CV this rack uses:
// pitch, gate and velocity in; the same three out.
//
// This is deliberately a different module from Quantizer. Quantizer continuously turns arbitrary voltage
// into pitches and emits a trigger whenever the result changes. Scale Player processes *notes*: it decides
// the correction at the gate edge, keeps the decision for that note and preserves pitch bend afterwards.
// Because it is polyphonic, every note of an incoming chord is corrected or filtered independently.
//
// Reason's default mode moves an out-of-scale note to the nearest valid pitch and resolves an exact tie
// downward. Filter mode silences that note instead. The thirteen preset scales and Chromatic are available;
// Custom reads a twelve-note enable mask from `customScale` patch data. Keeping the mask in ModuleData means
// the generic panel can play the device today and a keyboard editor can arrive without changing its DSP ABI.
//
// Chord generation is not hidden in here. Turning one input voice into as many as five simultaneous output
// voices changes the graph's voice cardinality; summing those pitches into one CV would not make a chord.
// This module closes the faithful per-voice half while that structural work remains explicit.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export const SCALE_PLAYER_CUSTOM_NOTES = 12

export class ScalePlayerProcessor implements Processor {
  private readonly data: ModuleData
  private readonly scales: number[][]
  private lastGate = 0
  private correction = 0
  private allowed = true

  constructor(_sampleRate: number, _deps: Record<string, unknown>, _id: string, data: ModuleData) {
    this.data = data
    // Ordered exactly like the Scale param labels below. The Spanish preset is the common Spanish/Phrygian
    // dominant form; Hemi Pentatonic is the common Japanese hemitonic form. Fields rather than module
    // constants keep worklet serialisation self-contained.
    this.scales = [
      [0, 2, 4, 5, 7, 9, 11], // major
      [0, 2, 3, 5, 7, 8, 10], // natural minor
      [0, 2, 4, 6, 7, 9, 11], // lydian
      [0, 2, 4, 5, 7, 9, 10], // mixolydian
      [0, 1, 4, 5, 7, 8, 10], // Spanish / Phrygian dominant
      [0, 2, 3, 5, 7, 9, 10], // dorian
      [0, 1, 3, 5, 7, 8, 10], // phrygian
      [0, 2, 3, 5, 7, 8, 11], // harmonic minor
      [0, 2, 3, 5, 7, 9, 11], // melodic minor ascending
      [0, 2, 4, 7, 9], // major pentatonic
      [0, 3, 5, 7, 10], // minor pentatonic
      [0, 1, 5, 7, 8], // hemi pentatonic
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // chromatic
    ]
  }

  private degrees(which: number): number[] {
    if (which < this.scales.length) return this.scales[which]

    const mask = this.data.get('customScale')
    if (!mask) return this.scales[0]
    const custom: number[] = []
    for (let note = 0; note < 12 && note < mask.length; note++) {
      if (mask[note] >= 0.5) custom.push(note)
    }
    // An empty custom keyboard has no meaningful nearest note. Falling back to Major keeps selecting the
    // patch useful and avoids turning a missing host editor into a silent device.
    return custom.length > 0 ? custom : this.scales[0]
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const pitchIn = inlets[0]
    const gateIn = inlets[1]
    const velocityIn = inlets[2]
    const pitchOut = outlets[0]
    const gateOut = outlets[1]
    const velocityOut = outlets[2]
    const keyParam = params[0]
    const scaleParam = params[1]
    const filterParam = params[2]

    for (let i = 0; i < frames; i++) {
      const gate = gateIn[i] >= 0.5 ? 1 : 0
      if (gate === 1 && this.lastGate === 0) {
        let key = Math.round(keyParam[i])
        if (key < 0) key = 0
        else if (key > 11) key = 11
        let which = Math.round(scaleParam[i])
        if (which < 0) which = 0
        else if (which > this.scales.length) which = this.scales.length
        const degrees = this.degrees(which)

        // MIDI-style pitch CV lands on semitones at note-on. Round once here so tiny floating-point error
        // cannot classify a C as a C sharp, then retain only the correction so later bend is untouched.
        const inputNote = Math.round(pitchIn[i] * 12)
        const relative = ((inputNote - key) % 12 + 12) % 12
        this.allowed = degrees.indexOf(relative) !== -1
        this.correction = 0

        if (!this.allowed && Math.round(filterParam[i]) === 0) {
          // Search outward with the lower candidate first. That ordering is the specified tie-break: F# in
          // C major is exactly between F and G and must become F.
          for (let distance = 1; distance <= 12; distance++) {
            const lower = ((relative - distance) % 12 + 12) % 12
            if (degrees.indexOf(lower) !== -1) {
              this.correction = -distance
              this.allowed = true
              break
            }
            const upper = (relative + distance) % 12
            if (degrees.indexOf(upper) !== -1) {
              this.correction = distance
              this.allowed = true
              break
            }
          }
        }
      }
      this.lastGate = gate

      pitchOut[i] = pitchIn[i] + this.correction / 12
      const sounding = gate === 1 && this.allowed
      gateOut[i] = sounding ? 1 : 0
      velocityOut[i] = sounding ? Math.max(0, Math.min(1, velocityIn[i])) : 0
    }
  }
}

export const SCALE_PLAYER_MODULE: ModuleDef = {
  type: 'scale-player',
  version: 1,
  name: 'Scale Player',
  group: 'Sequencing',
  blurb:
    'Keeps notes and whole chords in key. Correct wrong notes to the nearest scale tone or filter them out.',
  logo: {
    paths: [
      'M7 32h7V17h7v15h7V12h7v20h7V20h7v12h7',
      'M8 10h8M25 7h8M42 12h8',
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
    {
      id: 'key',
      name: 'Key',
      min: 0,
      max: 11,
      default: 0,
      stepped: true,
      labels: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    },
    {
      id: 'scale',
      name: 'Scale',
      min: 0,
      max: 13,
      default: 0,
      stepped: true,
      labels: [
        'Major', 'Minor', 'Lydian', 'Mixolydian', 'Spanish', 'Dorian', 'Phrygian',
        'Harm Min', 'Mel Min', 'Maj Pent', 'Min Pent', 'Hemi Pent', 'Chromatic', 'Custom',
      ],
    },
    {
      id: 'filter',
      name: 'Wrong Notes',
      min: 0,
      max: 1,
      default: 0,
      stepped: true,
      labels: ['Correct', 'Filter'],
    },
  ],
  processor: ScalePlayerProcessor,
  poly: true,
}
