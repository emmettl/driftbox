import type { MultisampleZone } from '@driftbox/rack'

// Pure multisample file-name inference. Decoding stays in RackApp, while these rules stay small enough to
// test without a browser and explicit enough that an automatic map never becomes a mysterious heuristic.

export interface MultisampleSource {
  name: string
  sampleRate: number
}

const SEMITONE: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
}

/** Find a conventional MIDI note in a file name: `Piano_C4`, `F#3`, `Db2`, or `midi-60`. */
export function midiNoteFromName(name: string): number | null {
  const numbered = name.match(/(?:^|[^a-z])(?:midi|note)[ _-]?(\d{1,3})(?=$|\D)/i)
  if (numbered) return Math.max(0, Math.min(127, Number(numbered[1])))

  const named = [...name.matchAll(/(?:^|[^a-z0-9])([a-g])([#b]?)(-?\d)(?=$|[^0-9])/gi)].at(-1)
  if (!named) return null
  const accidental = named[2] === '#' ? 1 : named[2].toLowerCase() === 'b' ? -1 : 0
  const note = (Number(named[3]) + 1) * 12 + SEMITONE[named[1].toLowerCase()] + accidental
  return note >= 0 && note <= 127 ? note : null
}

/** A 0..1 velocity hint from names such as `vel096`, `v64`, `pp`, `mf`, or `ff`. */
export function velocityFromName(name: string): number | null {
  const numbered = name.match(/(?:^|[^a-z0-9])(?:vel(?:ocity)?|v)[ _-]?(\d{1,3})(?=$|\D)/i)
  if (numbered) return Math.max(0, Math.min(1, Number(numbered[1]) / 127))
  const dynamics: Record<string, number> = { pp: 0.16, p: 0.3, mp: 0.43, mf: 0.62, f: 0.78, ff: 0.94 }
  const word = name.match(/(?:^|[^a-z])(pp|mp|mf|ff|p|f)(?=$|[^a-z])/i)?.[1].toLowerCase()
  return word ? dynamics[word] : null
}

const clampNote = (note: number) => Math.max(0, Math.min(127, Math.round(note)))

/**
 * Suggest a complete, gap-free key/velocity map while preserving file order (and therefore `sampleN`).
 * Named roots win. Unnamed batches land chromatically around middle C, which is useful immediately and
 * obvious enough to edit; recordings that share a root become velocity layers.
 */
export function suggestMultisampleZones(sources: readonly MultisampleSource[]): MultisampleZone[] {
  const fallbackStart = 60 - Math.floor((sources.length - 1) / 2)
  const roots = sources.map((source, index) => midiNoteFromName(source.name) ?? clampNote(fallbackStart + index))
  const uniqueRoots = [...new Set(roots)].sort((a, b) => a - b)
  const ranges = new Map<number, { low: number; high: number }>()
  uniqueRoots.forEach((root, index) => {
    const before = uniqueRoots[index - 1]
    const after = uniqueRoots[index + 1]
    const low = before === undefined ? 0 : Math.floor((before + root) / 2) + 1
    const high = after === undefined ? 127 : Math.floor((root + after) / 2)
    ranges.set(root, { low, high })
  })

  const velocities = sources.map((source) => velocityFromName(source.name))
  const layers = new Map<number, number[]>()
  roots.forEach((root, index) => layers.set(root, [...(layers.get(root) ?? []), index]))
  const velocityRanges = new Map<number, { low: number; high: number }>()
  for (const indices of layers.values()) {
    const ordered = [...indices].sort((a, b) => {
      const left = velocities[a]
      const right = velocities[b]
      if (left === null && right === null) return a - b
      if (left === null) return 1
      if (right === null) return -1
      return left - right || a - b
    })
    ordered.forEach((sourceIndex, layer) => {
      if (ordered.length === 1) {
        velocityRanges.set(sourceIndex, { low: 0, high: 1 })
        return
      }
      const low = layer / ordered.length
      const high = (layer + 1) / ordered.length
      velocityRanges.set(sourceIndex, { low, high })
    })
  }

  return sources.map((source, index) => ({
    root: roots[index],
    ...(ranges.get(roots[index]) ?? { low: 0, high: 127 }),
    velocityLow: velocityRanges.get(index)?.low ?? 0,
    velocityHigh: velocityRanges.get(index)?.high ?? 1,
    loopStart: 0.1,
    loopEnd: 0.9,
    loop: false,
    sampleRate: source.sampleRate,
  }))
}

export function midiNoteName(note: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  const midi = clampNote(note)
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}
