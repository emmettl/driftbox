import type { ModuleData, ModuleDef, Processor, ProcessorVoice } from '../types.js'

// The chord half of Reason's Scales & Chords Player. Unlike a pitch quantizer, this changes voice
// cardinality: each incoming pitch/gate/velocity voice owns eight child lanes, enough for five tertian notes
// plus Oct Down, Oct Up and Color at the same time. `voiceExpansion` makes those real downstream voices.
//
// The scale table intentionally mirrors Scale Player. Processor classes are serialised alone into the
// AudioWorklet, so sharing a module-scope constant would make both classes invalid there. Custom uses the same
// twelve-note PatchModule.data mask, which lets one editor contract serve both devices.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export const CHORD_PLAYER_LANES = 8

export class ChordPlayerProcessor implements Processor {
  private readonly data: ModuleData
  private readonly lane: number
  private readonly voice: number
  private readonly voices: number
  private readonly shared: Record<string, unknown>
  private readonly scales: number[][]
  private readonly chord = new Float64Array(8)
  private readonly voiced = new Float64Array(8)
  private customSource: Float32Array | undefined
  private customDegrees: number[] = []

  constructor(
    _sampleRate: number,
    _deps: Record<string, unknown>,
    _id: string,
    data: ModuleData,
    voice?: ProcessorVoice,
  ) {
    this.data = data
    this.lane = voice?.lane ?? 0
    this.voice = voice?.voice ?? 0
    this.voices = voice?.voices ?? 1
    this.shared = voice?.shared ?? {}
    this.scales = [
      [0, 2, 4, 5, 7, 9, 11],
      [0, 2, 3, 5, 7, 8, 10],
      [0, 2, 4, 6, 7, 9, 11],
      [0, 2, 4, 5, 7, 9, 10],
      [0, 1, 4, 5, 7, 8, 10],
      [0, 2, 3, 5, 7, 9, 10],
      [0, 1, 3, 5, 7, 8, 10],
      [0, 2, 3, 5, 7, 8, 11],
      [0, 2, 3, 5, 7, 9, 11],
      [0, 2, 4, 7, 9],
      [0, 3, 5, 7, 10],
      [0, 1, 5, 7, 8],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    ]
  }

  private degrees(which: number): number[] {
    if (which < this.scales.length) return this.scales[which]
    const mask = this.data.get('customScale')
    if (mask !== this.customSource) {
      this.customSource = mask
      this.customDegrees = []
      if (mask) {
        for (let note = 0; note < 12 && note < mask.length; note++) {
          if (mask[note] >= 0.5) this.customDegrees.push(note)
        }
      }
    }
    return this.customDegrees.length > 0 ? this.customDegrees : this.scales[0]
  }

  private inScale(note: number, key: number, degrees: number[]): boolean {
    const relative = ((note - key) % 12 + 12) % 12
    return degrees.indexOf(relative) !== -1
  }

  /** Nearest scale note, lower first so an exact tie agrees with Scale Player and Reason. */
  private corrected(note: number, key: number, degrees: number[]): number {
    if (this.inScale(note, key, degrees)) return note
    for (let distance = 1; distance <= 12; distance++) {
      if (this.inScale(note - distance, key, degrees)) return note - distance
      if (this.inScale(note + distance, key, degrees)) return note + distance
    }
    return note
  }

  /** Walk `steps` scale degrees upward from an already-correct root. */
  private scaleNote(root: number, steps: number, key: number, degrees: number[]): number {
    let note = root
    let found = 0
    while (found < steps) {
      note++
      if (this.inScale(note, key, degrees)) found++
    }
    return note
  }

  private contains(values: Float64Array, count: number, note: number): boolean {
    for (let i = 0; i < count; i++) if (values[i] === note) return true
    return false
  }

  private sort(values: Float64Array, count: number): void {
    // Eight values at most. Insertion sort has no allocation and beats handing a temporary array to sort.
    for (let i = 1; i < count; i++) {
      const value = values[i]
      let at = i
      while (at > 0 && values[at - 1] > value) {
        values[at] = values[at - 1]
        at--
      }
      values[at] = value
    }
  }

  private add(values: Float64Array, count: number, note: number, direction: number): number {
    while (this.contains(values, count, note)) note += direction * 12
    values[count] = note
    return count + 1
  }

  /** Build absolute semitone notes, returning how many of the eight lanes are active. */
  private buildChord(
    root: number,
    key: number,
    degrees: number[],
    notes: number,
    inversion: number,
    open: boolean,
    octUp: boolean,
    octDown: boolean,
    color: boolean,
    alter: boolean,
  ): number {
    for (let tone = 0; tone < notes; tone++) this.chord[tone] = this.scaleNote(root, tone * 2, key, degrees)

    // Reason describes Alter as changing one chord note and gives major-to-minor (or the reverse) as the
    // canonical result. Toggle the tertian third; for exotic intervals, move toward the nearest common third.
    if (alter && notes > 1) {
      const interval = ((this.chord[1] - root) % 12 + 12) % 12
      this.chord[1] += interval >= 4 ? -1 : 1
    }

    const inverted = Math.min(Math.max(0, inversion), notes - 1)
    for (let lane = 0; lane < notes; lane++) {
      const shifted = lane + inverted
      this.voiced[lane] = this.chord[shifted % notes] + (shifted >= notes ? 12 : 0)
    }
    // The selected inversion names the bass, but not its octave. Keep that bass within a tritone of the
    // played root, matching Reason's stated "as close as possible" rule, then move the whole voicing with it.
    const bassDistance = this.voiced[0] - root
    const inversionOctave = bassDistance > 6 ? -12 : bassDistance < -6 ? 12 : 0
    if (inversionOctave !== 0) {
      for (let tone = 0; tone < notes; tone++) this.voiced[tone] += inversionOctave
    }

    // A drop-style open voicing: move alternating inner notes up an octave, then restore pitch order. It
    // preserves every chord tone and responds to both Notes and Inversion, which are Reason's stated rules.
    if (open && notes >= 3) {
      for (let tone = 1; tone < notes - 1; tone += 2) this.voiced[tone] += 12
      this.sort(this.voiced, notes)
    }

    let count = notes
    if (octDown) count = this.add(this.voiced, count, root - 12, -1)
    if (octUp) count = this.add(this.voiced, count, root + 12, 1)
    if (color) count = this.add(this.voiced, count, this.scaleNote(root, (notes + 1) * 2, key, degrees), 1)
    this.sort(this.voiced, count)
    return count
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

    let counts = this.shared.chordCounts as Int32Array | undefined
    let seen = this.shared.chordPitches as Float64Array | undefined
    if (!counts || counts.length !== frames || !seen || seen.length !== frames * this.voices) {
      counts = new Int32Array(frames)
      seen = new Float64Array(frames * this.voices)
      this.shared.chordCounts = counts
      this.shared.chordPitches = seen
    } else if (this.voice === 0) {
      counts.fill(0)
    }

    for (let i = 0; i < frames; i++) {
      let key = Math.round(params[0][i])
      if (key < 0) key = 0
      else if (key > 11) key = 11
      let which = Math.round(params[1][i])
      if (which < 0) which = 0
      else if (which > this.scales.length) which = this.scales.length
      const degrees = this.degrees(which)
      let notes = Math.round(params[2][i])
      if (notes < 1) notes = 1
      else if (notes > 5) notes = 5
      let inversion = Math.round(params[3][i])
      if (inversion < 0) inversion = 0
      else if (inversion > 4) inversion = 4

      const inputSemitone = pitchIn[i] * 12
      const rounded = Math.round(inputSemitone)
      const root = this.corrected(rounded, key, degrees)
      const bend = inputSemitone - rounded
      const count = this.buildChord(
        root,
        key,
        degrees,
        notes,
        inversion,
        params[4][i] >= 0.5,
        params[5][i] >= 0.5,
        params[6][i] >= 0.5,
        params[7][i] >= 0.5,
        params[8][i] >= 0.5,
      )
      const active = this.lane < count && gateIn[i] >= 0.5
      const generated = (this.lane < count ? this.voiced[this.lane] : root) + bend
      pitchOut[i] = generated / 12

      let unique = active
      if (unique) {
        const used = counts[i]
        const base = i * this.voices
        for (let note = 0; note < used; note++) {
          // Float32 pitch CV can turn the same semitone into values a few millionths apart depending on
          // which root produced it. That is representation noise, not a microtonal interval.
          if (Math.abs(seen[base + note] - generated) < 1e-5) {
            unique = false
            break
          }
        }
        if (unique && used < this.voices) {
          seen[base + used] = generated
          counts[i] = used + 1
        }
      }
      gateOut[i] = unique ? 1 : 0
      velocityOut[i] = unique ? Math.max(0, Math.min(1, velocityIn[i])) : 0
    }
  }
}

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SCALES = [
  'Major', 'Minor', 'Lydian', 'Mixolydian', 'Spanish', 'Dorian', 'Phrygian',
  'Harm Min', 'Mel Min', 'Maj Pent', 'Min Pent', 'Hemi Pent', 'Chromatic', 'Custom',
]

export const CHORD_PLAYER_MODULE: ModuleDef = {
  type: 'chord-player',
  version: 1,
  name: 'Chord Player',
  group: 'Sequencing',
  blurb:
    'Turns every incoming note into a scale-built chord. Shape one to five tertian notes, then add octaves or colour.',
  logo: {
    paths: [
      'M7 31h6V20h6v11h6V15h6v16h6V10h6v21h6V18h7v13',
      'M11 11l10-5 10 5 10-5 12 5',
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
    { id: 'key', name: 'Key', min: 0, max: 11, default: 0, stepped: true, labels: KEYS },
    { id: 'scale', name: 'Scale', min: 0, max: 13, default: 0, stepped: true, labels: SCALES },
    { id: 'notes', name: 'Notes', min: 1, max: 5, default: 3, stepped: true },
    { id: 'inversion', name: 'Inversion', min: 0, max: 4, default: 0, stepped: true },
    { id: 'open', name: 'Open Chords', min: 0, max: 1, default: 0, stepped: true, labels: ['Close', 'Open'] },
    { id: 'octUp', name: 'Add Oct Up', min: 0, max: 1, default: 0, stepped: true, labels: ['Off', 'On'] },
    { id: 'octDown', name: 'Add Oct Down', min: 0, max: 1, default: 0, stepped: true, labels: ['Off', 'On'] },
    { id: 'color', name: 'Add Color', min: 0, max: 1, default: 0, stepped: true, labels: ['Off', 'On'] },
    { id: 'alter', name: 'Alter', min: 0, max: 1, default: 0, stepped: true, labels: ['Off', 'Held'] },
  ],
  processor: ChordPlayerProcessor,
  poly: true,
  voiceExpansion: CHORD_PLAYER_LANES,
}
