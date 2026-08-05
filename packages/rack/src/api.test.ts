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
  'GROOVEBOX_SOURCE_ID',
  'isGrooveboxEditable',
  'patchCompatibility',
  'renderRetainedSongMix',
  'withGrooveboxSource',
  // The modules it ships with, as a set and one by one.
  //
  // **The individual defs are promised because trimming the bundle is supported.** `Rack` requires a
  // registry rather than defaulting to the whole set, so that a consumer only carries the modules it
  // patches — and API you have to use to do a supported thing cannot sit in the tier that is expected to
  // change. Nineteen of these were previously reachable only through `MODULES`, which is to say a consumer
  // wanting three modules had no way to ask for three.
  //
  // The processors below stay unpromised. A def is data about a module; a processor is the audio thread's
  // contract, which is the third-party-module question `docs/RACK.md` defers.
  'MODULES',
  'MODULE_LIST',
  'ADSR_MODULE',
  'ALLIGATOR_MODULE',
  'ARP_MODULE',
  'ARRANGER_MODULE',
  'AUDIO_INPUT_MODULE',
  'CABINET_MODULE',
  'CLOCK_MODULE',
  'CHORD_PLAYER_MODULE',
  'COMBI_MODULE',
  'COMPRESSOR_MODULE',
  'DELAY_MODULE',
  'DISTORTION_MODULE',
  'DRIVE_MODULE',
  'EQ_MODULE',
  'FOLLOWER_MODULE',
  'GROOVEBOX_MODULE',
  'IMAGER_MODULE',
  'LADDER_MODULE',
  'LFO_MODULE',
  'LIMITER_MODULE',
  'LINE_MIXER_MODULE',
  'LOOPER_MODULE',
  'METER_MODULE',
  'MIDI_MODULE',
  'MIXER_MODULE',
  'MULTISAMPLER_MODULE',
  'NOTE_ECHO_MODULE',
  'NOISE_MODULE',
  'OFFSET_MODULE',
  'OUT_MODULE',
  'PHASER_MODULE',
  'PING_PONG_MODULE',
  'QUANTIZER_MODULE',
  'REVERB_MODULE',
  'SAMPLE_HOLD_MODULE',
  'SAMPLER_MODULE',
  'SCALE_PLAYER_MODULE',
  'SEQ_MODULE',
  'SVF_MODULE',
  'TRACKER_MODULE',
  'TRANSPORT_MODULE',
  'TUNER_MODULE',
  'VCA_MODULE',
  'VCO_MODULE',
  'VOCODER_MODULE',
  'VOICE_MODULE',
  'WAVETABLE_MODULE',
  // Portable multisample zone metadata. Hosts use these to embed maps in the patch while keeping PCM in
  // session-only data slots.
  'MULTISAMPLE_ZONE_FIELDS',
  'MULTISAMPLE_ZONE_STRIDE',
  'multisampleSlot',
  'packMultisampleZones',
  'unpackMultisampleZones',
  // The repeat pattern is dry plus sixteen echoes; hosts use this to build a stable step editor.
  'NOTE_ECHO_STEPS',
  // The Arp rhythm editor is the same portable sixteen-position contract.
  'ARP_PATTERN_STEPS',
  // A custom scale is one portable enabled-note flag for each pitch class.
  'SCALE_PLAYER_CUSTOM_NOTES',
  // Five tertian notes and all three additions are real output voices, not pitch values to sum.
  'CHORD_PLAYER_LANES',
  // Content: patches to open, chunks to drop in.
  'PATCHES',
  'patchPresetById',
  'CHUNKS',
  'chunkById',
  'insertChunk',
  // One device's knobs, which is content in exactly the way the two above are — and the same promise:
  // a host that shows a bank should not have to be this build.
  'DEVICE_PATCHES',
  'devicePatchesFor',
  'initDevicePatch',
  'completeParams',
  // Combinator routing, which is arithmetic on a patch and therefore part of the document.
  'applyModulation',
  'routeValue',
  'routedParams',
  'sourcePosition',
  // Recorded parameter moves, which are also part of the document, and for the same reason: reading or
  // writing a lane is arithmetic on a patch rather than anything the audio thread owns.
  'STEPS_PER_BAR',
  'stepOf',
  'laneFor',
  'setPoint',
  'clearLane',
  'valueAt',
  'pointsIn',
  'automationLength',
  // Rendering a patch offline, in a browser.
  'renderPatch',
  'renderPatchStems',
  'patchStemTargets',
  'renderLength',
  // Rendering with no browser at all, and following a game while it does.
  'RackRenderer',
  'Adaptive',
  'adaptiveValue',
  'adaptiveValues',
  // Playing a patch's recorded automation back, which nothing outside this repo could do before.
  'LanePlayer',
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
  'GROOVEBOX_PORTS',
  'GrooveboxProcessor',
  'loadRack',
  'rackSource',
  'RACK_PROCESSOR',
  'RACK_HOST_INPUTS',
  'RACK_LIVE_INPUT',
  // Individual module defs and processors, exported one by one as things needed them. The registry is the
  // supported way to reach a module; these are convenience that hardened into API.
  'ALLIGATOR_BANDS',
  'AlligatorProcessor',
  'AudioInputProcessor',
  'ArpProcessor',
  'ARRANGER_SECTIONS',
  'ArrangerProcessor',
  'COMBI_CONTROLS',
  'COMBI_ROTARY_MAX',
  'CombiProcessor',
  'FollowerProcessor',
  'LadderProcessor',
  'LineMixerProcessor',
  'MIDI_INPUTS',
  'MidiProcessor',
  'OutProcessor',
  'TRACKER_LANES',
  'TrackerProcessor',
  'VcoProcessor',
  'VoiceProcessor',
  'WavetableProcessor',
  'VOCODER_BAND_COUNTS',
  'VOCODER_MAX_BANDS',
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

  it('exports every module in the registry one by one', () => {
    // **The list above is a pin; this is the rule behind it.** Trimming the bundle means assembling a
    // registry by hand, which a consumer can only do for modules that are individually exported — so a
    // module reachable solely through `MODULES` is a module nobody can pay for separately. Four landed in
    // the days after that path shipped and none of them got an export, because nothing said they had to.
    //
    // Compared by identity rather than by name, so a def renamed on the way out is still found and a
    // convention about `*_MODULE` is not quietly load-bearing.
    const exported = new Set(Object.values(rack))
    const missing = rack.MODULE_LIST.filter((def) => !exported.has(def)).map((def) => def.type)
    expect(missing, 'in MODULE_LIST but not exported on its own').toEqual([])
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
