import { scalePlayerMask } from './scale-player-display.js'

export interface ChordPreviewOptions {
  key: number
  scale: number
  custom?: readonly number[]
  notes: number
  inversion: number
  open: boolean
  octUp: boolean
  octDown: boolean
  color: boolean
  alter: boolean
}

const relative = (note: number, key: number) => ((note - key) % 12 + 12) % 12

/** Host-side mirror of the processor's voicing arithmetic, used only to explain the current controls. */
export function chordPreview(options: ChordPreviewOptions): number[] {
  const key = Math.max(0, Math.min(11, Math.round(options.key)))
  const mask = scalePlayerMask(options.scale, options.custom)
  const inScale = (note: number) => mask[relative(note, key)] >= 0.5
  const corrected = (note: number) => {
    if (inScale(note)) return note
    for (let distance = 1; distance <= 12; distance++) {
      if (inScale(note - distance)) return note - distance
      if (inScale(note + distance)) return note + distance
    }
    return note
  }
  const root = corrected(key)
  const scaleNote = (steps: number) => {
    let note = root
    let found = 0
    while (found < steps) {
      note++
      if (inScale(note)) found++
    }
    return note
  }
  const notes = Math.max(1, Math.min(5, Math.round(options.notes)))
  const chord = Array.from({ length: notes }, (_, tone) => scaleNote(tone * 2))
  if (options.alter && notes > 1) {
    const interval = relative(chord[1], root)
    chord[1] += interval >= 4 ? -1 : 1
  }

  const inversion = Math.min(Math.max(0, Math.round(options.inversion)), notes - 1)
  const voiced = Array.from({ length: notes }, (_, lane) => {
    const shifted = lane + inversion
    return chord[shifted % notes] + (shifted >= notes ? 12 : 0)
  })
  const bassDistance = voiced[0] - root
  const inversionOctave = bassDistance > 6 ? -12 : bassDistance < -6 ? 12 : 0
  if (inversionOctave !== 0) for (let tone = 0; tone < voiced.length; tone++) voiced[tone] += inversionOctave

  if (options.open && notes >= 3) {
    for (let tone = 1; tone < notes - 1; tone += 2) voiced[tone] += 12
    voiced.sort((a, b) => a - b)
  }
  const add = (note: number, direction: number) => {
    while (voiced.includes(note)) note += direction * 12
    voiced.push(note)
  }
  if (options.octDown) add(root - 12, -1)
  if (options.octUp) add(root + 12, 1)
  if (options.color) add(scaleNote((notes + 1) * 2), 1)
  return voiced.sort((a, b) => a - b)
}
