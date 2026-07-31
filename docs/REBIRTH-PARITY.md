# ReBirth parity, and why the rack must contain the groovebox

Driftbox began as the useful centre of Propellerhead ReBirth: two 303s, an 808, a 909,
patterns, a song and the small mixer that makes those parts one instrument. The rack is
the next product, not a neighbouring one. Its relationship to Driftbox should be the
relationship Reason had to ReBirth:

> **Anything musical that can be made and performed in the groovebox must also be
> possible in rack mode. Rack mode may expose more machinery, but it must not require
> giving up a groovebox capability to reach it.**

This is a product contract, not a claim about the current implementation. The rack is
already a strict superset in routing, modulation, MIDI, sampling, sequencing and sound
design. It is not yet a strict superset in the four authored instruments, their compact
pattern workflow, song automation, or the performance visualiser.

## What “strict superset” means

The contract is about outcomes rather than identical panels:

- A groovebox song opens in rack mode without losing sound, patterns, arrangement,
  automation, effect routing, visuals or performance controls.
- Rack mode can play and edit that song without first flattening it to audio.
- Returning to groovebox mode is lossless while the rack document remains within the
  groovebox capability boundary.
- Adding rack-only modules or cables makes the document rack-only explicitly. It must
  never be silently discarded by the groovebox.
- Shared behaviour has one implementation or one deliberate adapter. The 303 ladder,
  transport arithmetic and serialisation rules must not fork into competing copies.
- Superset does not mean emulating ReBirth's limits. Driftbox keeps named patterns,
  1–64 steps, per-voice shaping and swing, reverb, stems, sharing, touch performance and
  generated drums.

The engines remain separate. `@driftbox/engine` is trigger-shaped and builds short-lived
Web Audio graphs; `@driftbox/rack` owns one persistent sample-rate graph in an
AudioWorklet. “One product” does not require pretending those are the same execution
model. It requires a lossless document bridge and rack devices that can express the
groovebox.

## Capability ledger

This table is the acceptance list. “Rack parity” means the capability works natively in
rack mode or through a first-class groovebox device hosted there—not that a determined
user could approximate it from oscillators.

| Capability | Groovebox now | Rack now | Required destination |
|---|---:|---:|---|
| Two authored 303 voices | Yes | Patchable stereo outputs, retained pattern editor and all eight authored controls per 303 | Landed |
| Authored 808 and 909 kits | Yes | Patchable stereo outputs, retained pattern editor and all six authored controls per voice | Landed; generated PCM character remains deliberate |
| Independent machine pattern banks | Yes | Retained pattern/machine editor, per-section clip assignment and live machine launch plus Tracker/Seq primitives | Landed |
| Per-machine pattern length and launch | Arrangement selection | Per-section retained clip assignment plus bar-quantised session launch | Add finer launch quantisation if performance use demands it |
| 303 note/accent/slide/tie editing | Partial | Retained 303 step editor plus Tracker primitives | Add faster sequential and keyboard entry |
| 909 flam | Step plus width control | Retained step articulation and shared width control | Landed |
| Pattern transforms | Rotate, transpose, randomise and alter | Retained lane/machine rotate, focused randomise/alter, 303 transpose and 909 flam | Landed; add focused clip cut/copy/paste in both modes |
| Song arrangement | Multi-clip sections | Arranger | Adapt shared sections and independent clips to rack scenes |
| Song transport | Section seek and arbitrary whole-bar loop ranges | Hosted section seek, section loop and arbitrary whole-bar loop ranges plus Arranger | Landed |
| Song automation | Recordable versioned tempo, swing, instrument, send and effect lanes | Hosted recorder for tempo, global/per-voice swing, instrument, send and shared effect controls plus Combinator/MIDI | Landed |
| Section mixer | Per voice | Four metered, patchable stereo source strips with level, pan and mute | Landed |
| Distortion, PCF, compressor, delay | Partial | Building blocks | Groovebox devices plus patchable rack equivalents |
| MIDI play/control/learn | Keyboard audition only | Yes | Extract the rack MIDI host for both modes |
| Stereo mix and stems export | Stems | Patch render | Both exports from both modes |
| Named local song library | One autosave | Patch library | One document library with type and compatibility state |
| Visuals and performance pad | Yes | No | Same scene host and master performance controls |
| Shareable, repairable documents | Yes | Yes | Versioned bridge preserving unknown rack-only content |

Update this ledger when a capability lands. It is deliberately about user-visible
behaviour; implementation progress belongs in `ROADMAP.md` and `RACK.md`.

## ReBirth editor parity

The groovebox does not yet match ReBirth's editor even though its sound set does. The
work is ordered by dependency:

1. **Independent clips — landed.** The pattern pool is now a shared clip bank for 303 A,
   303 B, 808 and 909. Each section selects the four sources independently and shorter
   clips wrap under the longest one. Existing composite sections remain the fallback, so
   old songs migrate without changing playback.
2. **Song transport and automation.** Section seek, whole-section looping and the shared
   versioned automation timeline are present. The editor records tempo, swing, drum knobs,
   303 knobs, per-voice swing, sends and effects at the playhead. The shared scheduler
   resolves those targets for live playback and offline planning, including per-hit stem
   sends. Arbitrary whole-bar loop ranges may cross section boundaries. Reuse the thin
   recorder and transport primitives in rack mode, then add bar-quantised clip recording.
3. **Section buses and effects.** The four authored machines now arrive on metered rack
   source strips with level, pan and mute before their patchable stereo outputs. Add the
   ReBirth signal path: distortion, pattern-controlled filter and compressor as inserts,
   delay as a send. Keep Driftbox's reverb and per-voice controls.
4. **Fast pattern editing.** Drag paint/erase, rotate, transpose, randomise,
   material-preserving alter and 909 flam are present. Rack mode now exposes retained drum
   steps, pitched/accented/sliding 303 steps, lane or machine transforms and flam programming
   without restarting playback. Add keyboard tap recording and focused cut/copy/paste.
5. **Interchange.** Bring the rack's MIDI host and learn mappings to the groovebox, add
   full-mix rendering and put songs and patches in one named library.

The schema foundation is now present. Automation events still need stable section and
parameter identities, but can record independent clip changes without splitting or
flattening the original whole-groove pattern pool.

## Document boundary

The rack patch now retains a complete encoded groovebox song and distinguishes three
states through `patchCompatibility`:

1. **Groovebox-compatible.** Fully editable in either mode when that build understands
   the embedded song version; older builds preserve it but do not offer editing.
2. **Rack-extended.** Contains the intact groovebox document plus additional rack
   modules, cables, modulation, generated breaks or overrides. Groovebox mode may play
   it through the rack but must not offer a lossy save.
3. **Rack-native.** A patch with no groovebox representation.

The first half of the bridge is landed: `embedGrooveboxSong` stores the original
versioned song envelope opaquely, `grooveboxSong` returns it only when this engine can
decode it, and the patch codec preserves even a future unknown song exactly. The next
half has begun: rack mode hosts understood retained songs with the existing groovebox
engine and routes their complete mix through the same final performance bus, analyser and
destination as the rack graph. The shared engine also exposes stable live outputs for
303 A, 303 B, 808 and 909. A derived Groovebox source device terminates those four stereo
pairs inside the rack worklet, where ordinary cables can send them through any rack
device. Adding the device alone remains groovebox-compatible; the first cable makes the
document explicitly rack-extended. Each source now has a rack strip with level, balance
pan, mute and a live post-strip meter; its unity defaults preserve the retained mix, while
saving a strip adjustment correctly marks the document as rack-extended. Retained drum
and 303 pattern editing plus per-section machine clip assignment are now available directly
on the device. The selected retained pattern can now be queued independently for any machine
and becomes active at the next bar boundary; following the authored song again uses the same
quantised path, and neither action mutates the document. Contextual voice controls now edit
the complete retained drum or bass parameter block and reach following scheduled hits without
rebuilding the rack. The selected section can now seek or loop on the hosted transport, and
arbitrary whole-bar loop ranges may cross section boundaries without entering the document.
Rack mode now arms the shared recorder against the hosted engine clock for tempo, global
swing, per-voice swing, every drum/303 knob, voice sends and shared effects; recorded lanes
remain in the compatible song envelope and clearing them is undoable. Next, add keyboard tap
recording and focused cut/copy/paste. Do
not compile a song into anonymous VCOs, steps and cables and then attempt to
reverse-engineer it later. A dual-303 device can expose patch points and still retain
“this is 303 A, pattern Acid 2” as authored structure.

The product entry path uses the same boundary: the groovebox can open its current song
in `rack.html`, the rack consumes either a song or patch link, shows the compatibility
state, and returns the retained song to the sequencer without a decode/re-encode cycle.
An understood song plays immediately through its original mix; patching either side of
an authored machine diverts that complete section through the Groovebox source without
restarting transport.

Unknown future data follows the repository's existing rule: preserve it or refuse it,
never delete it during a round trip.

## Completion test

The superset promise is met when the following test can be automated:

1. Build every shipped groovebox song.
2. Convert it to a rack document.
3. Render both for the full arrangement with deterministic noise.
4. Compare timing, section output and the final mix within documented audio tolerances.
5. Convert every rack document that remains groovebox-compatible back to a song and
   compare the complete document, not only its audio.

That test turns “Reason contains ReBirth” from positioning into a property the codebase
can keep.
