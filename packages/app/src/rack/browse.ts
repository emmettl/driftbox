import { CHUNKS, MODULE_LIST, type Chunk, type ModuleDef } from '@driftbox/rack'

// What the picker shows for a given search.
//
// Its own file rather than living inside `Palette.tsx`, for two reasons that happen to agree. The search
// is the only part of the picker with anything to get wrong, and a component holding its query in
// `useState` cannot be searched from a test without a DOM — so a plain function is testable where a
// component is not. Same reasoning as `midiTargets` in `midi.ts`. And a `.tsx` file that exports
// non-components breaks React fast refresh, which is a real cost during a session of moving knobs about.

/** Does this name and description answer the search? Case-insensitive substring, nothing cleverer — a
 *  fuzzy matcher would need explaining every time it ranked something surprisingly. */
function matches(query: string, ...text: (string | undefined)[]): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return text.some((t) => t?.toLowerCase().includes(needle))
}

export interface Shelf {
  group: string
  modules: ModuleDef[]
}

/** The chunks that match a search, and the shelves of modules that match it. */
export function browse(query: string): { chunks: readonly Chunk[]; shelves: Shelf[] } {
  const shelves: Shelf[] = []
  for (const def of MODULE_LIST) {
    if (!matches(query, def.name, def.blurb, def.group)) continue
    const group = def.group ?? 'Other'
    // Walked rather than grouped into a Map, so a shelf's contents keep MODULE_LIST's order — which is
    // deliberate (a VCO before a Sampler, a Transport before a Clock) and a sort would throw away.
    // `modules.test.ts` guarantees each group is contiguous, which is what makes one pass correct.
    if (shelves[shelves.length - 1]?.group !== group) shelves.push({ group, modules: [] })
    shelves[shelves.length - 1].modules.push(def)
  }
  return {
    chunks: CHUNKS.filter((chunk) => matches(query, chunk.name, chunk.blurb)),
    shelves,
  }
}
