import { describe, expect, it } from 'vitest'
import * as rack from './index.js'

// What this package promises, pinned.
//
// **This exists because `export * from './types.js'` used to stand in `index.ts`.** A blanket re-export
// publishes whatever that file happens to contain, so the compiler's `Plan` shapes and the audio thread's
// `Processor` contract became public API without anybody deciding they should be — and `docs/RACK.md`
// records those contracts changing four times in four PRs while separately concluding that opening them
// "turns each into a promise". The promise had already been made by accident.
//
// So the list is written down here. The point is not that these names are correct; it is that **changing
// them is a line in a diff** rather than a side effect of adding a field somewhere else. A test that fails
// when you add an export is a test doing its job: read the failure, decide whether the new name is meant to
// be public, and put it in the right group.
//
// Types are not checked — they are erased before this file runs, and TypeScript has no way to say
// "exported but not promised" anyway. `index.ts` groups them by tier in comments, which is the only
// enforcement available and is why the comment there is long.

/** Values a consumer of the published package is meant to reach for. */
const PROMISED = [
  // The rack itself, and the document.
  'Rack',
  'EMPTY_PATCH',
  'PATCH_FORMAT',
  'decodePatch',
  'encodePatch',
  'embedGrooveboxSong',
  'grooveboxSong',
  'isGrooveboxEditable',
  'patchCompatibility',
  // The modules it ships with.
  'MODULES',
  'MODULE_LIST',
  // Content: patches to open, chunks to drop in.
  'PATCHES',
  'patchPresetById',
  'CHUNKS',
  'chunkById',
  'insertChunk',
  // Combinator routing, which is arithmetic on a patch and therefore part of the document.
  'applyModulation',
  'routeValue',
  'routedParams',
  'sourcePosition',
  // Rendering a patch without a browser.
  'renderPatch',
  'renderLength',
  // Reading somebody else's rack.
  'importVcv',
  'importVcvPatch',
  'VCV_MODELS',
]

/**
 * Exported because something in this repo needs them, not because they are promised.
 *
 * If this package is published, these are what a major version is reserved for — or what moves behind an
 * `internal` entry point the day somebody outside depends on one.
 */
const UNSTABLE = [
  // The compiler and the audio thread. `compile` is exported because the app draws `plan.notes`.
  'compile',
  'Graph',
  'loadRack',
  'rackSource',
  'RACK_PROCESSOR',
  // Individual module defs and processors, exported one by one as things needed them. The registry is the
  // supported way to reach a module; these are convenience that hardened into API.
  'ALLIGATOR_BANDS',
  'ALLIGATOR_MODULE',
  'AlligatorProcessor',
  'ARRANGER_MODULE',
  'ARRANGER_SECTIONS',
  'ArrangerProcessor',
  'COMBI_CONTROLS',
  'COMBI_MODULE',
  'COMBI_ROTARY_MAX',
  'CombiProcessor',
  'FOLLOWER_MODULE',
  'FollowerProcessor',
  'LADDER_MODULE',
  'LadderProcessor',
  'MIDI_INPUTS',
  'MIDI_MODULE',
  'MidiProcessor',
  'OUT_MODULE',
  'OutProcessor',
  'TRACKER_LANES',
  'TRACKER_MODULE',
  'TrackerProcessor',
  'VCO_MODULE',
  'VcoProcessor',
  'VOCODER_BAND_COUNTS',
  'VOCODER_MAX_BANDS',
  'VOCODER_MODULE',
  'VOCODER_RANGE_HZ',
  'VocoderProcessor',
]

describe('the public API', () => {
  it('exports exactly what it says it does', () => {
    // Sorted on both sides, so the failure message is a readable diff of names rather than an argument
    // about the order somebody happened to write them in.
    expect(Object.keys(rack).sort()).toEqual([...PROMISED, ...UNSTABLE].sort())
  })

  it('does not list a name in both tiers', () => {
    // A name in both groups makes the tiers meaningless and the total still add up, so nothing else here
    // would notice.
    expect(PROMISED.filter((name) => UNSTABLE.includes(name))).toEqual([])
  })

  it('actually exports every promised name', () => {
    // Separate from the equality above so that a *missing* promise fails with a message about that name,
    // rather than as one line in a list diff. Removing something promised is the serious direction.
    for (const name of PROMISED) {
      expect(rack, `${name} is promised but not exported`).toHaveProperty(name)
    }
  })

  it('keeps the patch codec free of the registry, which is what lets an unknown module survive', () => {
    // The property the whole placeholder rule rests on, asserted at the surface: `decodePatch` takes one
    // argument. If it ever grew a registry parameter, a patch containing a module this build does not have
    // would start losing it, and every note in `patch-io.ts` about not demolishing somebody's work would
    // quietly stop being true.
    expect(rack.decodePatch.length).toBe(1)
  })

  it('opens on an empty patch that is a patch', () => {
    expect(rack.decodePatch(rack.encodePatch(rack.EMPTY_PATCH))).toEqual(rack.EMPTY_PATCH)
  })
})
