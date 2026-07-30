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
| Two authored 303 voices | Yes | Approximate patch | First-class dual-303 device or lossless imported devices |
| Authored 808 and 909 kits | Yes | No | First-class generated drum devices; no ROM samples |
| Independent machine pattern banks | Yes | Tracker/Seq primitives | Reuse the shared clip-bank model in rack mode |
| Per-machine pattern length and launch | Arrangement selection | Possible manually | Add live quantised launch to the shared clip model |
| 303 note/accent/slide/tie editing | Partial | Tracker primitives | One clip editor and equivalent rack lanes |
| 909 flam | Step plus width control | Possible manually | Reuse the articulation in the rack clip editor |
| Pattern transforms | Rotate, transpose, randomise and alter | No compact workflow | Add focused clip cut/copy/paste in both modes |
| Song arrangement | Multi-clip sections | Arranger | Adapt shared sections and independent clips to rack scenes |
| Song automation | No | Combinator/MIDI only | Recordable parameter timeline shared by both modes |
| Section mixer | Per voice | Mixer/Out | Four section buses with mute, pan, level, meter and routes |
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
2. **Song transport and automation.** Add seek, loop start/length, bar-quantised clip
   recording and parameter automation. Pattern changes are discrete events; knobs,
   faders and effect controls are sampled automation.
3. **Section buses and effects.** Add the four machine strips and the ReBirth signal
   path: distortion, pattern-controlled filter and compressor as inserts, delay as a
   send. Keep Driftbox's reverb and per-voice controls.
4. **Fast pattern editing.** Drag paint/erase, rotate, transpose, randomise,
   material-preserving alter and 909 flam are present. Add sequential 303 entry,
   keyboard tap recording and focused cut/copy/paste.
5. **Interchange.** Bring the rack's MIDI host and learn mappings to the groovebox, add
   full-mix rendering and put songs and patches in one named library.

The schema foundation is now present. Automation events still need stable section and
parameter identities, but can record independent clip changes without splitting or
flattening the original whole-groove pattern pool.

## Document boundary

A future shared document should distinguish three states:

1. **Groovebox-compatible.** Fully editable in either mode.
2. **Rack-extended.** Contains the intact groovebox document plus additional rack
   modules, cables or modulation. Groovebox mode may play it through the rack but must
   not offer a lossy save.
3. **Rack-native.** A patch with no groovebox representation.

The bridge should be additive: retain the original groovebox document inside the rack
document and derive first-class rack devices from it. Do not compile a song into anonymous
VCOs, steps and cables and then attempt to reverse-engineer it later. A dual-303 device
can expose patch points and still retain “this is 303 A, pattern Acid 2” as authored
structure.

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
