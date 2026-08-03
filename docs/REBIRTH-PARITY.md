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
design. It now hosts the four authored instruments, their compact pattern workflow, song
automation, effects, stem review and the shared performance visualiser without flattening
them. The remaining groovebox-editor gap is faster sequential note entry; rack-native
source export remains a separate modular-workflow concern.

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
| Pattern transforms | Rotate, transpose, randomise, alter and focused cut/copy/paste | Retained lane/machine rotate, focused randomise/alter, 303 transpose, 909 flam and focused cut/copy/paste | Landed |
| Song arrangement | Multi-clip sections | Arranger | Adapt shared sections and independent clips to rack scenes |
| Song transport | Section seek and arbitrary whole-bar loop ranges | Hosted section seek, section loop and arbitrary whole-bar loop ranges plus Arranger | Landed |
| Song automation | Recordable versioned tempo, swing, instrument, send and effect lanes | Hosted recorder for tempo, global/per-voice swing, instrument, send and shared effect controls plus Combinator/MIDI | Landed |
| Section mixer | Per voice | Four metered, patchable stereo source strips with level, pan and mute | Landed |
| Distortion, PCF, compressor, delay | Authored master inserts, off/on/accent PCF pattern lane and delay send | Same retained controls and PCF lane plus patchable Drive, SVF, Compressor and Delay modules | Landed; rack remains the strict superset |
| MIDI play/control/learn | Hardware notes play the focused 303 or pitched drum; learn covers tempo, swing, authored controls, routing and effects | Shared host plus polyphony, channel routing, modulation and Combinator learn | Landed; rack remains the strict superset |
| Stereo mix and stems export | Mastered song mix and pre-master stems | Same retained mix and per-voice stem review/export plus a distinct patch render | Landed for compatible songs; rack-native source stems require an explicit modular source model |
| Named local song library | Shared typed song/patch shelf plus autosave | Same shared shelf, including legacy patch migration | Landed; rack-only work stays visible but cannot be flattened in groovebox mode |
| Visuals and performance pad | Shared reactive scenes over the master XY filter | Same scene host over the same master controls in split/full-pad views | Landed; scene identity stays inside a compatible Song or a rack-native Patch |
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
3. **Section buses and effects — landed.** The four authored machines arrive on metered
   rack source strips with level, pan and mute before their patchable stereo outputs. The
   retained song owns drive, pattern-controlled filter and compressor master
   inserts, with delay as a send; Driftbox's reverb and per-voice controls remain. Both
   editors expose the same controls and off/on/accent PCF lane, while rack mode additionally
   offers patchable Drive, SVF, Compressor and Delay modules.
4. **Fast pattern editing.** Drag paint/erase, rotate, transpose, randomise,
   material-preserving alter and 909 flam are present. Rack mode now exposes retained drum
   steps, pitched/accented/sliding 303 steps, lane or machine transforms and flam programming
   without restarting playback. Rack mode also quantises the shared keyboard into the focused
   retained drum or 303 clip at the hosted playhead. Rack mode now cuts, copies and pastes
   the focused drum lane/whole machine or 303 line without losing accents, flams or slides.
   The original editor now exposes the same engine clipboard for one lane, the visible drum
   machine, one 303 or both 303s, so the two modes cannot disagree about pasted material.
5. **Interchange.** Mastered full-song rendering is now shared by both modes: rack mode
   keeps it explicitly separate from patch rendering so rack-only changes are never
   mistaken for edits to the retained song. The browser MIDI host, monophonic allocator
   and hardware mapping store are now shared; the groovebox plays its focused Keys target
   and learns stable authored parameter identities, while the rack retains polyphony,
   channel routing, modulation and Combinator fan-out. Songs and patches now occupy one
   named local library whose entries record type and compatibility. Both editors can load
   songs; the groovebox refuses rack-extended/native entries rather than flattening them,
   and the rack migrates the former patch-only shelf on first write.

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
remain in the compatible song envelope and clearing them is undoable. Rack keyboard taps now
record into the focused retained clip without passing through generic rack MIDI. Focused
cut/copy/paste is present in both editors and uses the same host-neutral engine transforms.
Both modes now export the same mastered retained-song WAV; rack mode labels that separately
from its rack-graph render. Both modes now also use one browser MIDI host and one hardware
mapping store: groovebox bindings address the shared automation identities and therefore
still travel through visible, saveable, automation-aware edits, while rack mappings retain
their module/parameter identities. The local library is shared too: encoded songs and patches
have one name namespace, explicit type and compatibility metadata, and the old rack patch shelf
is migrated without deleting it. The performance scene is now authored document state too:
compatible documents keep it inside the retained Song, rack-native documents keep it on the
Patch, and the shared scene host sits over the rack's existing master XY filter without
obscuring the patcher. Authored drive, PCF, compressor, delay and reverb settings now stay in
that same compatible envelope, and both editors program the PCF's off/on/accent pattern lane.
Rack-native equivalents remain additive modules, not substitutes for retained song data.
The same boundary now applies to export: rack mode reviews and saves the retained song's
pre-master voice stems without claiming that they contain rack-only cables or processing;
Patch WAV remains a separately labelled render. Next, close the faster sequential-entry
refinements. Do not
compile a song into anonymous VCOs, steps and cables and then attempt to
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
