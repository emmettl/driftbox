# The rack — a design sketch

A modular synth rack, in the browser, patched with cables. Reason's back panel rather than
Reason's front: a small set of modules, free routing between all of them, and a patch that
fits in a URL.

That framing turned out to be half right, and step 5b½ at the bottom says where. The back panel is
what makes a rack a rack; the **Combinator** is what made a Reason patch playable, and it is here
too now — four rotaries and four buttons that move any parameter of any module at once.

The rack works end to end but remains a work in progress and is intentionally unpublished.
Once complete and ready to support a public API, it can join the engine and app on npm.
`packages/rack` has the compiler, worklet host, patch format and 37 modules; the app has
front and back panels, cable dragging, keyboard/MIDI, tracker, sampler, patch library,
Combinator routing with MIDI learn, performance mode and offline export. `packages/app/src/hash.ts` carries
patches in a URL alongside songs. Everything below records the shape of it and the decisions
that are expensive to change later — where implementation taught us something different, this
file says so rather than describing only the plan we started with.

## The product boundary: Reason contains ReBirth

The rack engine is separate from `@driftbox/engine`; the rack product is not separate from
the groovebox. Rack mode is intended to become a strict functional superset: every
303/808/909 song should open, play and stay editable here, with patching and rack-only
devices added around it. This does not mean exploding a song into anonymous primitive
modules. First-class groovebox devices and an additive document bridge preserve the
authored patterns, arrangement and compatibility boundary.

The first live audio boundary is four authored-machine outputs on `DriftboxEngine`:
`tr808`, `tr909`, `303.a` and `303.b`, deliberately the same identities the shared clip
model uses. They are unity dry outputs before the groovebox master and shared effect
returns. Left alone they feed the original mix exactly as before; a host may divert one
to another `AudioNode`. That is the seam for patchable rack devices: retain and schedule
one Song, route its machines separately, and never maintain a second 303 or drum engine.

[REBIRTH-PARITY.md](REBIRTH-PARITY.md) holds the capability ledger, document states and
executable render-equivalence completion test. This file continues to describe how the persistent
graph works. The distinction matters: two execution engines can serve one product without
duplicating their DSP or making interchange lossy.

That ledger measures the rack against the groovebox. [REASON-GAP.md](REASON-GAP.md) measures it
against Reason — what a rack of this shape still cannot do at all, checked against the tree
rather than remembered, including the ones that turn out to be patchable and the ones nobody
should build.

The additive document bridge is now concrete. A `Patch` may carry the exact encoded
groovebox song; it is kept opaque by the patch codec so a rack build can preserve a song
from a future engine version without pretending it can edit it. Public helpers embed and
decode understood songs and classify documents as `groovebox-compatible`,
`rack-extended`, or `rack-native`. The derived Groovebox source is representational:
its presence alone remains compatible, while its first cable is rack-authored intent and
makes the document extended.
The two app entry points now exercise it: “rack” carries the current song into
`rack.html`, which accepts both document kinds and can send the retained song back to the
sequencer unchanged.

Performance state follows the same boundary. A recognised retained Song owns its opaque
visual scene id, so changing scenes in rack mode remains groovebox-compatible and returns
to the sequencer intact. A rack-native document stores that id on the Patch instead. The
scene host is mounted only in split or full-pad view, over the existing master XY filter;
the readable front/back patching surface never receives a moving backdrop.

An understood retained song is now audible in rack mode through the existing
`DriftboxEngine`, not a second rendering implementation. `EngineOptions.destination`
puts that complete mix on the rack's final Kaoss/analyser bus beside the worklet graph,
and the rack transport starts and stops both. Four stereo host inputs feed the
Groovebox source module. Its 808, 909, 303 A and 303 B stereo outlets are ordinary rack signals;
patching a section diverts it from the original master without rebuilding
or restarting the hosted engine. Four source strips apply level, balance pan and mute to
those stereo signals before their outlets. Each strip reports its post-control level
through the same opt-in telemetry path as the patchable VU Meter, without adding hidden
modules to the document. An unpatched machine reaches that input through a non-destructive
engine tap while its audible signal stays on the original master; patching removes the tap
and uses the existing exclusive diversion. The controls default to unity and are not
written into imported songs; saving the first adjustment is rack-authored intent and makes
the document `rack-extended`.

A fifth host input carries a permission-gated browser `MediaStream` into the **Audio
Input** source module. The app requests raw capture with speech processing disabled,
offers every `audioinput` returned by `enumerateDevices()`, and reconnects a selected
device through `createMediaStreamSource()`. Device ids never enter the patch: they are
local, permission-gated runtime state and would make a shared URL machine-specific. The
module selects left/mono or right because two-channel guitar interfaces commonly expose
two physical sockets as one browser device. Removing the last Audio Input module stops
the capture tracks immediately. Capture requires HTTPS or localhost and explicit user
permission; device labels may remain hidden until that permission is granted. The live
context asks for interactive latency, but the browser, operating system and interface
still choose the actual buffer.

Offline export deliberately has no live host input and therefore renders this source as
silence. Exporting a performance would be recording, not deterministic patch rendering;
that remains separate work alongside the looper gap.

The front panel also edits the retained pattern bank directly. Pattern and machine selectors
open one 16-step page at a time; drum steps cycle rest, hit and accent, while each 303 step
can set pitch, Note/Pause, accent and slide. Pausing retains the pitch, and Slide remains
editable on that silent step so the following attack bends in from it as it does in ReBirth.
Longer polymetric patterns page rather than being truncated. A selected 808/909 voice may
also set its own shorter **Lane steps** loop inside that parent pattern; the inactive tail
stays visible and dimmed, and the same compatible song data returns to the original editor.
Edits replace the versioned song envelope and reach the hosted scheduler on its next step
without recompiling the rack graph, restarting the arrangement or turning a compatible song
into a rack-extended document. A section selector beside the steps assigns any pattern from
the retained bank to the selected machine in that arrangement section. Selecting the
section's fallback removes the redundant override, preserving the old whole-pattern song
shape where possible. Each machine can also launch the selected retained pattern on the
next step, beat or bar—or return to following the authored arrangement at that boundary.
Bar remains the default for old hosts. Queued and active launch state, including the pending
quantization, is explicit on the faceplate and remains session-only by default. **Write** is the
deliberate exception: it locks launches to bar boundaries and promotes each active choice into the
retained arrangement. A launch partway through a repeated section splits that section at the boundary,
so bars already heard are not rewritten; Follow removes the machine override from the new boundary
onward. Each write is one undoable compatible-song edit and never creates a rack-only representation.
The same contextual editor exposes all six authored controls for the selected 808/909
voice and all eight controls for either 303. These update the retained kit in place, so
the shared engine applies them to following hits without rebuilding the rack or replacing
the instrument with generic modules. The device also exposes the hosted transport directly:
the selected arrangement section can start or loop, and an arbitrary whole-bar range can
cross section boundaries. Seeking wakes and starts the rack transport with the song; loop
selection remains session-only and never changes the retained envelope.

The retained pattern editor also carries the groovebox's fast operations into rack mode.
The selected drum lane—or the whole visible drum machine—can rotate; focused drum and 303
lanes can randomise or material-preserving alter; and either 303 can transpose. The 909's
flam marks and shared flam width remain authored song data. Each button gesture is its own
undo step, while direct step painting continues to coalesce as one edit.
Drum transforms operate over the selected voice's loop rather than the parent bar, while
inactive authored tail data is retained if the lane is lengthened later. Whole-machine
operations therefore preserve each voice's independent phase and length.

Automation recording is armed on the Groovebox device but clocked by the hosted audio
engine. Moving rack tempo, global song swing, or any visible drum/303 instrument control
while the song runs writes a point at the engine's exact bar and step. Arming and the clock
provider are session state; recorded lanes remain versioned retained song data, so the patch
stays Groovebox-compatible and returns to the sequencer without loss. Clearing all lanes is
an ordinary non-structural rack edit and can be undone.

The contextual mix row completes that recorder surface without translating authored song
data into generic rack modules. The selected drum or 303 exposes its delay/reverb sends and
offset from global swing beside the song-wide drive, PCF, compressor, delay and reverb
controls. The retained pattern has its own off/on/accent PCF lane, so the same authored
filter strikes remain editable in both modes. Those base values, pattern states and
automation targets are the same ones the sequencer uses; selecting another voice only
changes which authored send/swing lane is in focus, while the effects remain song-wide.
Patchable Drive, SVF, Compressor and Delay modules are still available around the Groovebox
device, making rack mode additive rather than an alternate, lossy representation.

Export observes that same boundary. A retained Groovebox song gets the sequencer's complete
stem review desk in rack mode: each authored voice can be auditioned around its first entrance,
saved alone or exported as the full set of pre-master float WAVs. Those files deliberately
describe the compatible song envelope, not later rack cables or modules. **Song WAV** renders
the retained mastered mix, while **Patch WAV** renders the summed modular graph. **Patch stems** use
the same review-before-download desk for rack-native work. Each active terminal Out strip is an
explicit bus that can be previewed in isolation, saved alone or exported as one numbered stereo WAV
per strip, in rack order. That is the stable ownership rule an arbitrary graph needs: a source
does not “own” a shared reverb, but everything deliberately routed into one Out belongs to that bus.
Solo isolation is render-only, so it never edits the patch; the strip's level, pan, mute and automation
remain audible. Keeping all four labels separate prevents a compatible export from silently flattening
rack-only work or a rack render from masquerading as editable Groovebox voice stems.

`renderPatchStems` is the public rack-native boundary and `renderRetainedSongMix` is the public boundary
used by Song WAV: the latter decodes the Song from the Patch and calls the engine-owned mastered renderer.
A Chromium acceptance matrix
round-trips a purpose-built all-machine song and every shipped song through both codecs, then
compares sequencer and rack samples under a 2e-5 maximum-sample tolerance (below -93 dBFS).

The pattern editor's tap arm gives the rack keyboard a second, explicit destination. While
the hosted transport runs, computer, pointer and MIDI-keyboard note-ons are quantised to the
current sequencer step in the focused retained clip. Drum velocity chooses hit or accent; a
303 key writes its root-relative pitch and accent without erasing an existing slide. Claimed
taps audition the authored machine instead of also reaching the generic MIDI graph, and the
entire take coalesces into one rack undo step. The arm, focus and held notes remain session
state; only the resulting pattern steps enter the compatible song envelope. With transport
stopped and a 303 focused, the same arm becomes sequential entry: each pointer, computer or
MIDI note writes at the visible cursor and advances with pattern-length wrap. This is the
retained-song counterpart of ReBirth entry, not a rack-only Tracker approximation.

Focused cut/copy/paste stays at that authored-data boundary too. A drum clipboard carries
its loop length, hit/accent states and any 909 flam marks; a 303 clipboard carries pitch, accent and
slide. The lane/all focus used by rotate also decides whether one drum voice or the whole
machine is copied, and pasting fits detached data to the destination clip length. The
clipboard is session state, while cut and paste are discrete, undoable pattern edits. The
copy/paste transforms live in the engine rather than this faceplate so the original editor
can expose exactly the same operation without translating song data through the rack.

## What this is not

It is not an extension of `@driftbox/engine`. That engine is trigger-shaped — a voice is a
pure function from knobs to a `VoiceSpec`, and `render.ts` builds fresh Web Audio nodes for
each hit. A rack is the opposite: one graph, running continuously, where anything can
modulate anything at audio rate. Those are different engines and pretending otherwise
would damage both.

They can still share an output. The rack is a node; the drum machines are nodes; they sum
into the same destination and the same visualiser. That is the whole integration, and it is
enough.

## The one big decision: our own graph, not the browser's

The rack is **a single AudioWorkletProcessor containing the entire patch**, running its own
graph at sample rate.

The alternative — one native Web Audio node per module, connected with `connect()` — looks
cheaper and is a dead end:

- `AudioParam` only reaches the parameters the spec chose to expose. You cannot modulate a
  `BiquadFilterNode`'s *type*, or a delay's sync division, or anything a module invents.
- Some params are k-rate, updating once per 128-sample block. That limitation is already
  documented in `dsp/worklet.ts` — it is why the ladder's cutoff is a-rate — and in a
  modular every destination has that problem, not just one.
- Every patch edit becomes a native reconnection, with the graph audible mid-edit.
- Feedback through native nodes is not something you control.

Owning the graph costs us the built-in nodes and buys us the only property that makes a
modular a modular. Take the trade.

### Getting the modules onto the audio thread

Exactly the way the ladder already gets there. `dsp/worklet.ts` assembles processor source
from `Ladder.toString()` and hands it over as a blob URL, so the filter is written once, in
ordinary TypeScript, and unit-tested as ordinary arithmetic. The rack does the same with
every module class.

That imposes the rule already written down in that file: **a processor class must reference
nothing outside itself.** The `AudioWorkletGlobalScope` shares no scope with the module that
stringified it, so a captured constant is a `ReferenceError` at the moment the first note
plays.

That constraint is not a tax here — it is the feature. A module that references nothing
outside itself is a module that can be shipped, stored, and one day loaded from somewhere
else. The closed set we build first and the open set we might allow later are the same code
path.

`Ladder` already satisfies it, so the rack gets a real 4-pole ladder filter for free.

### How the graph runs

One signal type. Audio and CV are the same `Float32Array` — Eurorack's choice, not Reason's. A port may
declare that it owns **two** of them, which is what a stereo cable is here; nothing else about the signal
changes and nothing enforces which is which.
1.0 means one octave on a pitch inlet, 0-or-1 on a gate inlet, and nothing anywhere
enforces which is which. A patch that plays an envelope through a speaker is the user's
business.

When a patch arrives, the audio thread compiles it into a flat execution plan:

1. Topologically sort the modules.
2. Allocate one `Float32Array(128)` per **outlet** — not per cable, and not pooled. Unconnected
   inlets point at a shared zero buffer, so a module never branches on whether it is patched.
   Allocating only for *connected* outlets was the first attempt and it introduces a footgun:
   an unconnected outlet has to write somewhere, and the only somewhere is the zero buffer,
   which would invent a signal for every unconnected inlet in the patch at once. Reusing
   buffers between modules whose lifetimes do not overlap is a real optimisation and belongs
   later.
3. Emit an ordered list of `(processor, inletBuffers, outletBuffers, paramBuffers)`.

Then `process()` walks that list once per render quantum, module by module — not sample by
sample across the whole graph. Each module's inner loop stays tight and stays hot.

Per-block dispatch does **not** cost sample accuracy on a normal signal path: the
topological order guarantees an upstream module has filled its 128 samples before anything
downstream reads them, so an LFO at audio rate modulates a cutoff per sample as it should.

It costs accuracy in exactly one place. A cycle cannot be topologically ordered, so the
compiler breaks each one by forcing a module out of order — and **this needs no delay
mechanism at all**, which the sketch got wrong. The buffers are not cleared between blocks, so
a module ordered before its source already reads what the source wrote last block. No copy, no
second buffer, no flag on the cable: the 2.9 ms delay at 44.1 kHz falls out of the ordering for
free, and it is what Reason did.

What the compiler does have to do is *report* it, by comparing positions in the finished order.
Tell the UI which cables ended up backwards so they can be drawn differently; a feedback patch
that silently behaves unlike the picture is worse than one that admits it.

Zero-delay feedback *inside* a module stays the module's own problem. The ladder already
handles its own.

### Parameters, not AudioParams

Knobs arrive as messages — `{ kind: 'param', slot, value }` — and every parameter is a
`Float32Array` of its own, read per sample like an inlet. `AudioParam` is the wrong tool: the
parameter set is dynamic, it is large, and there is only one processor to hang them on.

A knob change **ramps linearly across the block that follows** and then flattens. Not a
one-pole smoother, as first sketched — a ramp to the target within one block is exact,
testable, and clickless, and a slower gesture is the UI's business. The flattening is not
optional: without it the ramp is replayed for as long as the knob sits still, which is a
sawtooth LFO at the block rate, 344 Hz and very audible. `graph.test.ts` has that test.

**Scheduling a param against a frame is built** ✅, and it is the one growth the ABI has earned. A
`param` message may carry an optional `frame`: absent, the change lands at the next block boundary as
it always has; present, its ramp starts at that sample. Frames count from the start of the context —
`currentFrame` on the audio thread, which is a better clock than `ctx.currentTime` and the only one
both sides can see. `Rack.frameFor` converts.

Three things that were not obvious until it was built:

- **Sample-accurate timing, block-rate resolution.** Two changes to one param inside one block still
  leave only the later one audible, because a param is one ramp per block and always has been. That is
  the right trade for automation, which wants its move to *start* in the right place; anything moving
  faster than 344Hz is an LFO, and there is a module for that.
- **A frame already gone by applies at once rather than being dropped.** Late is a timing error somebody
  can hear and reason about. Vanishing is a mystery, and a host reading a lane a block late under load
  is an ordinary thing to happen.
- **It has to travel in `processorOptions`, not only in a message.** No port message reaches an
  `OfflineAudioContext` posted before `startRendering`, because that thread is not running yet — the same
  measured trap that already sends the plan and any loaded sample that way. A schedule made before
  `start()` is held and seeded with them, and without that, exporting a patch would silently produce a
  file with the automation missing.

**And it records now** ✅ — `Patch.automation` is a lane per parameter, written when the transport is
armed and played back through exactly this. `packages/rack/src/automation.ts` has the reasoning; the two
pieces that were missing on this side were a host-visible playhead (`app/src/rack/playhead.ts`, derived
from the context clock rather than reported from the worklet, so it exists whether or not a Meter is on
screen) and a lookahead scheduler. The scheduler's 100ms tick decides only how far ahead work is done and
never where a value lands — that is what the frame is for.

**Playback never goes through the patch**, and that is deliberate: a lane played back through `setParam`
would record itself, one point per tick, for ever. It takes the road a MIDI note takes.

The knob still moves ✅ — `app/src/rack/live.ts`, and the shape of it is the part worth keeping. The
obvious build was to grow the meter channel so the audio thread reports its current values, and it would
have worked. It is worse three ways: it grows the ABI, which this file says to resist; it puts a few
hundred floats a second on `postMessage` for something purely visual; and the reading would be a sample of
the *past* while the schedule is the future, so the panel could disagree with the sound.

**The host already has the lane and the playhead that decided what the audio thread was told.** Reading
the same lane at the same position is the same arithmetic, so the knob and the sound are one number
computed twice and cannot drift. No message, no ABI change, and it settles at exactly the moment playback
does. `Driven.tsx` applies it in the one place the Chassis decides what `value` means, so every faceplate
gets it and none of them changed — the same property that lets a module be added with no UI work at all.

A correction worth recording, because it changed the design: the note above used to say a MIDI-driven
param was invisible in the same way and that one channel would fix both. **It was wrong.** The MIDI
module's note, gate and velocity are `hidden`, so no faceplate ever draws them; a learned CC goes through
`setParam` and was always visible; a Combinator routing moves the patch. A lane was the only driver a
panel could not see, and checking that rather than trusting it is what turned a general reporting channel
into thirty lines of arithmetic.

**The Automation Desk makes those lanes operable** ✅. The header count opens one timeline inventory for
every rack-native parameter lane, including module/parameter identity, point range, curve type and a compact
curve drawing. Opening a lane exposes parameter-aware Pencil and Eraser tools: horizontal movement snaps to
sixteenths, Pencil height spans the declared knob range, skipped steps are filled during a fast stroke, and one
undo restores the complete draw or erase gesture. Erasing the final point removes the empty lane by the same
optional-field rule as Clear. The same lane exposes its musical positions and values: points can be added, moved in
one-based `bar.step` notation, corrected or removed, and a continuous lane can switch between linear
interpolation and holds. Moving onto an occupied position replaces it, because two values at one instant cannot be played. One
lane or the complete take can also be cleared without rebuilding the graph. Every action is an ordinary
undoable document edit. Unknown
preserved targets remain named by their ids instead of vanishing from the desk. Stepped controls record and
remain locked to `hold` curves as the format intended, so automating a waveform, mode or mute never sweeps
through intermediate choices on its way to the recorded value.

The message set is the ABI: `plan`, `param`, `transport`, `monitor` and `data`. Resist growing it — the
frame is a field on a message that already existed, not a sixth kind, and that is the shape any further
growth should take.

## The module contract

```ts
interface ModuleDef {
  type: string          // 'vco' — stable forever, this is what a patch stores
  version: number
  inlets: Port[]
  outlets: Port[]
  params: ParamDef[]    // id, min, max, default, stepped
  processor: new (sampleRate: number, deps: Record<string, unknown>) => Processor
  deps?: Record<string, Dep>   // shared DSP classes, BY STRING KEY — see below
  terminal?: boolean           // its first outlet sums into the audio output
  voiceExpansion?: number      // child output voices per input voice; absent means one
  migrate?(params: Record<string, number>, from: number): Record<string, number>
}

interface Processor {
  /** Per voice, per block. Reference nothing outside this class. */
  process(inlets: Float32Array[], outlets: Float32Array[], params: Float32Array[], frames: number): void
}
```

Three things here were not in the first sketch and are load-bearing:

**`deps` is keyed by string, and the processor looks its dependencies up as `deps.Ladder`.**
Never by identifier. Minified, `Ladder.toString()` comes out as `class{s0=0;...}` — the
*source text* is anonymous — so any scheme that derives an identifier from `Class.name` at
assembly time is at the mercy of what that bundler decided the name is. Measured under
rolldown 1.2.2 it is the mangled binding, `me`; measured when this was first written it was
the empty string, which emits `const  = class{...}` and fails to parse. **Bundler-dependently
broken is worse than reliably broken**: it works in our build and goes silent in somebody
else's, in production only. A minifier does not touch string keys, so the two halves cannot
disagree. `worklet.ts` has the long version and `minified.test.ts` runs it.

**`terminal` replaces a reserved output buffer.** One line in a def rather than a special case
in the compiler: an empty rack is silence, two Outs are a mix of both, and the Out module still
has a real outlet so it can be patched onward.

**`stepped` exists because a waveform selector is not a continuous control.** Everything else
ramps across the block; a stepped param jumps, because a selector two thirds of the way between
saw and pulse is not a sound and a ramping value would make it flicker across the changeover.

`migrate` lives next to the module rather than in a central switch. At forty modules a
central migration table is unmaintainable, and the person adding a parameter is the person
who knows what the old value meant. It is called from `compile`, which is the one place with
both the saved params and the def that owns them — `decodePatch` preserves the version and
deliberately does nothing with it.

## Forty-four modules

Enough to make a track, and no more. Chosen so that nothing here is a placeholder.

| | |
|---|---|
| **Groovebox** | Retained 808, 909 and two 303s as four stereo host-fed rack sources |
| **Audio Input** | permission-gated microphone or audio-interface capture, with device selection in the host |
| **VCO** | saw / pulse / tri, PWM, linear FM inlet, hard sync inlet |
| **Voice** | a whole synth in one module: two oscillators, a ladder and two envelopes, playable in chords |
| **Noise** | white and pink |
| **Sampler** | loaded or generated audio, sliced and retriggered from CV |
| **Multisampler** | key and velocity zones, root tuning and sustain loops, played polyphonically from MIDI |
| **Ladder** | the existing 4-pole. Already written, already tested |
| **SVF** | state-variable multimode — LP/HP/BP/notch, cheap, and unlike the ladder |
| **VCA** | linear and exponential, CV inlet |
| **Drive** | waveshaper |
| **Distortion** | tube, tape, fuzz and digital as four curves, with a tone control after the hit |
| **Cabinet** | driven preamp, three-band tone stack and speaker-shaped rolloffs |
| **EQ** | low shelf, sweepable mid with a Q, high shelf — stereo |
| **Imager** | independent low and high width around one crossover, so the bottom stays centred |
| **Delay** | CV'able time, tempo-syncable |
| **Ping-Pong** | wet echoes bouncing left then right, cross-fed so one mono line fills a stereo cable |
| **ADSR** | gate inlet, one envelope out |
| **LFO** | free or synced, several shapes, reset inlet |
| **S&H** | sample and hold |
| **Offset** | attenuverter and offset. Unglamorous and load-bearing |
| **Mixer** | four in, CV levels |
| **Transport** | bar, beat and musical-division signals at the patch tempo |
| **MIDI** | pitch, gate, velocity and mod from a keyboard. The only module whose input does not arrive on a cable |
| **Clock** | gate, a fixed 1ms trigger, and a phase ramp. Armed at construction, so it ticks the moment it is patched |
| **Seq** | eight steps of pitch and on/off, advanced by an external clock. No clock inside it |
| **Tracker** | four lanes and up to 64 steps, carrying pattern data in the patch |
| **Arranger** | a list of sections, each a pattern and a count of bars — a song, driving a Tracker |
| **Arp** | one held note becomes a running line: a chord, a direction and a clock |
| **Scale Player** | polyphonic key/scale correction or wrong-note filtering, with portable custom scales |
| **Chord Player** | one note into a scale-built chord: inversions, open voicing, octaves, colour and alter |
| **Note Echo** | polyphonic note repeats with tempo sync, pitch shift and a velocity slope per echo |
| **Compressor** | dynamics and sidechain control for glue and ducking |
| **Limiter** | stereo-linked look-ahead peak control with gain-reduction CV |
| **Reverb** | an in-worklet feedback-delay network |
| **Phaser** | six swept allpass stages, stereo motion built in, sweep CV in octaves |
| **Quantizer** | scale-lock. The highest musical return per line of code in the list |
| **Follower** | an envelope follower: audio in, its contour out as CV, plus a gate above a threshold |
| **Alligator** | three filtered gates across one signal — fixed low/band/high, gated and enveloped apart |
| **Vocoder** | 8, 16 or 32 bands: one sound wearing another's spectral shape, with a formant shift |
| **Combinator** | four rotaries and four buttons, each driving any parameter of any module — and each also a CV outlet |
| **VU Meter** | patchable needle, LED and waveform displays; unchanged Thru signal and a ballistic envelope outlet |
| **Tuner** | chromatic pitch and confidence analysis, with a silent-tuning thru mute |
| **Looper** | stereo record, play and overdub with session-only capture |
| **Out** | terminal. Feeds the existing scope and visualiser |

Two original omissions were later reversed for the rack specifically. The **sampler** and
its generated or user-loaded breaks are the subject of [docs/DNB.md](DNB.md); the drum
machines themselves still ship no recorded audio or ROM data. **Reverb** is an in-worklet
feedback-delay network, because the engine's convolver is unavailable inside an
`AudioWorkletGlobalScope`. MIDI, Voice and Multisampler use the graph's per-voice processors;
mono effects still receive their voices summed — see below.

## Monophonic first — and polyphony is cheaper than this section used to claim

The rack is one voice today.

**This section previously gave the wrong instruction and it is worth recording why.** It said
to make "one concession now, because retrofitting it is a rewrite: keep per-module state in an
array indexed by voice", and cited the engine's `Ladder` as already doing that. Both halves
were wrong. The concession was never made — every module holds scalar state, `SvfProcessor`'s
integrators included — and the `Ladder` does not index state by channel either. It holds
`s0..s3` as plain scalars; the *worklet wrapper* in `dsp/worklet.ts` does
`this.filters[channel] = new Ladder(sampleRate)`. It instantiates one filter per channel.

That accident is the better pattern, and it makes polyphony much cheaper than the paragraph it
replaces: **do not index state by voice, instantiate N processors per module.** The Graph
already builds one processor per plan node. Polyphony is building N of them and looping.

**No module code changes at all.** All of the work lands in the Graph and the plan:

- N-wide buffers, or a buffer set per voice.
- One flag, `poly: false`, on modules that must run once — a Delay duplicated eight times is
  eight delays, and a shared delay is the point.
- A rule for a polyphonic cable arriving at one of those: **sum the voices**, which is what a
  mixer bus does and what VCV Rack does.

The one thing that has to come first is somewhere for the notes to come from — see step 5.

## The patch format

Mirror `song-io.ts`, including the part that matters most — a patch arrives from outside the
program, and `decodePatch` never throws on a value it can repair.

```json
{ "v": 1, "patch": {
  "modules": [
    { "id": "vco1", "type": "vco", "version": 1, "params": { "tune": 0.5 }, "pos": [2, 0] }
  ],
  "cables": [
    { "from": ["vco1", "out"], "to": ["ladder1", "in"] }
  ]
}}
```

Cables reference module ids and **port names**, never indices — so reordering the module
list is harmless, and a module that gains an inlet does not silently rewire every patch that
used it.

Two rules the song format does not need:

**An unknown module type becomes an inert placeholder, not a deletion.** `song-io.ts`
already declines to check voice ids against the kit registry, on the grounds that silently
deleting somebody's settings because they opened an older build is not a repair. That
argument is stronger here: deleting a module deletes every cable touching it, so opening a
newer patch in an older build and re-saving would quietly demolish the patch. Keep the type,
keep the params, keep the cables, draw it as a blank faceplate, refuse to run it.

**A cable whose endpoints do not resolve is dropped.** A dangling cable has no sensible
repair, and a placeholder module still resolves.

### Into the URL

Reuse the app's existing hash path verbatim — deflate through `CompressionStream`, then
base64url, with the marker character that already distinguishes a compressed payload from a
plain one for browsers without it. A twenty-module patch is a couple of kilobytes of
repetitive JSON, which is more compressible than a song; expect a few hundred characters.

One concrete integration point: the hash needs a **kind** marker so a patch and a song can
share the scheme without being mistaken for each other. Add it as a prefix alongside the
existing encoding marker, not as a query parameter, so the payload stays in the fragment and
never reaches a server.

This is the differentiated thing about the whole product. VCV Rack cannot be a link.

## Where it lives

```
packages/rack/           @driftbox/rack — compiler, registry, worklet assembly, patch-io
packages/app/rack.html   the rack's entry point
packages/app/src/rack/   everything behind it: chassis, back panel, cables, faceplates
packages/app/src/        shared — the hash codec, styles, controls, scenes
```

## A separate entry point, not a tab

**The rack is its own page.** `index.html` opens the sequencer and nothing about it changes;
`rack.html` opens the rack. Two documents, two roots, no shared store and no router. The
sequencer does not grow a rack tab, and nothing in the rack's flow has to be reachable from a
step grid.

This is Vite's multi-page build, which costs one extra line of config, and it works with
`base: './'` exactly as the single page does — the same relative-path reasoning in
`vite.config.ts` that lets one build serve GitHub Pages at `/driftbox/` and `npx
@driftbox/app` at the root covers a second page for free.

Why a second page inside `packages/app` rather than a fourth package:

- **The dependency is already the right shape.** `@driftbox/app` has no runtime dependencies
  at all — `@driftbox/engine` is a *devDependency*, because the published tarball is `bin` plus
  a bundled `dist`. `@driftbox/rack` goes in the same way, aliased to source in
  `vite.config.ts` and mapped in `tsconfig.app.json`, and the published package gains a second
  page rather than a dependency. `npx @driftbox/app` then serves both, which is a better
  answer than two installs.
- **Sharing is a relative import.** Extracting a `packages/ui` means designing a component API
  before either consumer has told us what it needs. Start with both pages in one package,
  where sharing costs nothing and the boundary can be drawn later against real usage rather
  than a guess.
- **It is reversible.** Everything rack-shaped lives under `src/rack/`, so lifting it into its
  own package later is a directory move plus a package.json.

What is genuinely shared, and worth keeping shared: the hash codec (`src/hash.ts` — already
done, and already carrying both kinds), the stylesheet and its tokens, the knob and pointer-
drag primitives, the oscilloscope, the eighteen scenes, the audio-start gesture handling, and the
panel-fold machinery. What is not: the step grid, the pattern chain, the song picker — the rack
has no patterns, and pretending otherwise is how the two flows end up tangled.

What has to be new is the part with no equivalent in the sequencer, and it is the reason this
is a separate flow rather than a new panel: **the rack turns around.** Tab flips it to the back
and you patch cables. That is Reason's one genuinely great interaction and there is nothing in
a step sequencer to hang it off.

One thing the two pages should eventually share that is not UI at all: **the audio context.**
The rack and the drum machines sum into the same destination by design, so a patch that filters
an 808 through a ladder is a later feature and not an architectural change. Two pages cannot
share a context, though — so if that matters more than the separation does, the decision gets
revisited, and it is the only thing that would revisit it.

`@driftbox/rack` imports no React and touches no DOM, the same hard boundary
`@driftbox/engine` has, enforced the same way — by the package split rather than by
discipline.

It depends on the engine for **one thing**, and this sketch had it wrong at first. The claim
was that the rack should depend on nothing: the clock lives in the worklet on `currentFrame`,
so it needs neither `transport.ts`'s worker ticker nor `timing.ts`'s lookahead, and that part
holds. But the ladder module has to *be* the engine's `Ladder`. Copying it would give the
rack a filter that drifts away from the one the drum machines use, which is precisely the
failure the engine's README calls out — two copies of a synthesis engine would diverge. So
the dependency is real, it is narrow, and it is only DSP. The engine is `sideEffects: false`,
so a bundler drops the sequencer and the songs.

The UI starts inside the app rather than as a third published package. Faceplates will want
to live next to the app's existing knob components, and the cable layer has no shape yet to
design a package boundary around.

## A third host: the rack without a browser

There were two hosts and both of them are Web Audio. `Rack` wraps an `AudioWorkletNode` on a live
context; `renderPatch` does the same on an `OfflineAudioContext`. Neither is reachable from a game
server, a Node process, or anything embedding a JS engine to make sound with — and the awkward part
was that the rack could already do it. `Graph` is arithmetic over `Float32Array`s: `graph.test.ts`
has run the whole thing in Node since the first week, measuring the samples that came out.

So the capability existed and only the API did not. An embedder following the tests had to reach for
`compile` and `Graph`, which `index.ts` lists in the tier this package explicitly does not promise,
and to reassemble the registry into the `{modules, deps}` shape the Graph wants — a detail of how the
worklet is built that nobody outside should have to know. `headless.ts` is that path made supported.

**It is not a second engine, and that is the property worth defending.** Same `compile`, same module
processors, same `Graph`. `worklet.test.ts` already pins that the assembled worklet produces the same
samples as the graph running in-process, so all three hosts are one piece of arithmetic reached three
ways; `headless.test.ts` pins the facade against a hand-driven Graph so it stays that way. A fourth
implementation of the DSP for headless use would have been the obvious build and would have started
drifting on the first module anybody touched.

**What does not travel is the groovebox.** A patch's 808, 909 and 303s arrive on the host inputs from
`@driftbox/engine`, whose renderer builds Web Audio nodes per hit — so headless you get the rack's own
modules, and `hostInputs` on `process` is the seam anything else fills. That is a real limit on the
"strict superset" claim outside a browser, and it is a limit of the engine's shape rather than of this.

Measured on the machine this was written on: a shipped preset renders at about 20x realtime at 48kHz,
which is a few percent of one core. `examples/headless.mjs` is that measurement, runnable.

### The registry is an argument, because a default is a static reference

`new Rack(ctx)` read as the friendly signature and cost every consumer the entire module set. A default
parameter is a reference the bundler must keep, so `MODULES` — and therefore all thirty-three modules and
their processors — was retained even in a build that passed its own registry. Measured: `Rack` alone came to
24.2kB gzipped and did not move by a single byte when handed a four-module registry.

Requiring it takes a four-module game to 11.2kB, and a headless one to 7.7kB. The same change made the
individual module defs worth exporting: nineteen of them were reachable only through `MODULES`, which is to
say a consumer wanting three modules had no way to ask for three. They are promised API now, because API you
have to use to do a supported thing cannot sit in the tier that is expected to change. The processors are
not — a def is data about a module, a processor is the audio thread's contract, and that is the third-party
question this document defers.

Two things make the trimmed case behave rather than merely fit. A patch naming a module the registry does
not have becomes a **placeholder**, exactly as it does in a build that is a version behind, so a registry
that is missing something degrades visibly and in `plan.notes` rather than by demolishing the document. And
the worklet is assembled from the registry it was given, so a trimmed rack ships a smaller audio thread too
rather than a full one behind a smaller API.

The cost is that every host writes `MODULES` where it used to write nothing, and that the editor in this
repo — where anybody can drag in any module — passes the whole set and saves nothing. That is the right way
round: the application that needs everything says so, and the embedder that does not is no longer paying for
its convenience.

### What the app was holding that the package should have been

Two things reached this package late, and both were found by asking what an embedding host would have to
write for itself.

**The automation scheduler.** Lanes are in the document, so a host has to hand them over in time — and that
was forty lines inside `RackApp`. A patch opened anywhere else therefore played the patch and not the
performance, with nothing to notice: no error, no missing module, just every recorded move absent. It is
`lanes.ts` now, and the app uses it, because two copies of a scheduler would drift the way two copies of a
filter would.

**Where the music is.** `Adaptive` quantises to the bar, and the bar comes from the host. `RackRenderer`
counted frames and `Rack` answered nothing, so the adaptive layer worked in an offline render and not in a
browser. `Rack.beat` is derived from `ctx.currentTime` — the third time this codebase has made that choice,
after `live.ts` and `playhead.ts`, and for the same three reasons: it does not grow the message ABI, it is
available always and exactly, and it cannot disagree with what was scheduled because `frameFor` converts
against the same clock.

The pattern worth taking from both: **the app is where the gaps hide.** Anything a host must write for
itself to make a patch sound the way its author left it is not a host's job, it is this package's.

### Following a scene, without swapping patches

The obvious way to make music adapt is to keep several patches and swap between them. **It is wrong
here, and specifically wrong**: applying a plan rebuilds every processor, so an oscillator's phase, a
filter's history and an envelope's stage all restart. A swap is a hard cut with a click on it. That is
recorded at `Graph.setPlan`, along with the note that preserving state across an edit needs module
identity across two plans, which the compiler does not carry.

So `adaptive.ts` moves parameters **inside one patch**, which this rack is unusually well set up for: a
Combinator rotary already reaches any parameter of any module through the patch's own `modulation`
list — including stepped ones no cable can touch — and a Tracker's `pattern` param already selects one
of eight patterns on the next step edge. What was missing was the mapping from a host's number to those
knobs, and the rule about *when* each one may move:

- **Continuous** — a level, a cutoff, a send — moves now, and the Graph ramps it across the block that
  follows, so it slides rather than clicks.
- **Discrete** — a pattern index, a waveform, a mute — moves on the **bar line**. A drum pattern that
  changes on beat three is not a transition, and no amount of ramping fixes it, because there is nothing
  between pattern 2 and pattern 3 to ramp through.

It holds no clock. The caller says where the beat is, because the caller is the only one who knows
whether it is driving a live `Rack` off `ctx.currentTime` or a `RackRenderer` running faster than real
time. And it sends only what changed: a game's update loop runs at frame rate, and every send across a
live `Rack` is a `postMessage` the audio thread has to drain.

**What it is not** is a sequencer. Nothing here decides notes. A score is a list of curves onto knobs,
which is the smallest thing that makes the rack follow a scene — and the largest thing that can be added
without inventing a second place where music is decided.

## Other people's modules: the Wasm question

Reading a VCV Rack `.vcv` patch is feasible and cheap. It is a zip with a `patch.json`
listing modules by plugin and model slug, params by id, and cables by module and port id —
which is very nearly the format above, because there are not many sensible ways to write it
down.

Running VCV's modules is a different project entirely. They are native C++ compiled against
Rack's ABI and linked against Rack's own library; they are not Wasm and cannot be loaded in a
browser. Porting one means compiling that plugin *plus a Rack shim* to Wasm, and the
licensing matters as much as the build: Rack is GPLv3 and each plugin is licensed on its own,
some commercially.

**On the FFI overhead, which is the interesting part of the question:** the instinct is right
that it would swamp the compute, and the reason is specific. A VCV module's `process()` is
called *per sample* — 44,100 times a second per module. Crossing JS→Wasm that often would be
brutal, and it is also the wrong way to use Wasm. The fix is the one this design already
takes for its own graph: cross the boundary **once per block**, with the whole graph on the
far side. That is 344 calls a second, and the overhead disappears into the noise.

Which makes it an architectural fork rather than an optimisation. Either the graph runs in JS
with JS modules, or it runs in Wasm with Wasm modules — a per-sample mixture of the two is
the one arrangement that cannot work. Worth knowing: hand-written JS over monomorphic
`Float32Array`s in a hot loop is usually within 1.5–2× of Wasm for this kind of arithmetic,
so the win from Wasm is **reusing existing C++ DSP**, not raw speed. Keep `Graph` behind an
interface so a second backend is possible, and do not build one for performance alone.

The version of this that is actually worth doing: **import the topology.** Read the `.vcv`,
map the modules that have equivalents here, and let everything else land as a placeholder —
which the placeholder rule above already handles, since it was designed for exactly this
shape of problem in a different guise. VCV's own Fundamental set is VCO, VCF, VCA, ADSR, LFO,
SEQ3, Mixer, and that overlap with the fifteen above is not a coincidence. A patch somebody
built in Rack, opening in a browser, at a URL, with the gaps honestly drawn as blanks.

## Compute shaders: what they are and are not for

A synth voice is the worst-shaped workload a GPU can be given. Every filter is a recurrence
relation — sample *n+1* depends on sample *n* through the filter's state — so 128 samples of a
ladder cannot be split across 128 threads at any price. And WebGPU is not reachable from an
`AudioWorkletGlobalScope` at all: there is no `navigator.gpu` there. Getting GPU results into
the audio path means running ahead on the main thread and draining a `SharedArrayBuffer` ring
buffer, which adds tens of milliseconds of latency and needs cross-origin isolation headers
that GitHub Pages will not set.

But "parallel across time" is the only axis it fails on, and three things here are parallel
across something else:

- **Voices.** 256 independent voices, one thread each, every thread running its own
  recurrence serially. This is a genuinely good fit, and it is the polyphony question above
  wearing a different hat.
- **Partials.** An additive oscillator with a thousand sinusoids, or a modal resonator bank —
  embarrassingly parallel, impossible in JS at that count, and a module with a sound nothing
  else in a browser has. This is the one that would be worth building for its own sake.
- **Spectra.** FFT work: big partitioned convolution, a phase vocoder, spectral freezing.
  Parallel across bins.

And the fourth, which sidesteps the latency problem completely: **the visualiser.** Seventeen 3D
scenes already exist, on the render thread where being a frame late costs nothing. A compute
shader driving a particle field from the rack's output is the WebGPU idea with no architectural
tax attached, and it is the one to do first.

## What to build, in order

The risk is all in the first item. Do it first and alone.

1. **The spine.** ✅ Built — `packages/rack`, 51 tests, no browser needed. Plan compiler plus
   worklet host, three modules: VCO into Ladder into Out. What it cost was almost entirely in
   places this sketch did not predict, so they are written down in the package README and in
   the comments. The one worth repeating here: minified, `Ladder.toString()` comes out as
   `class{...}` — the source text is anonymous — so emitting `const ${dep.name} = ...` produced
   `const  = class{...}`, an unparseable worklet, in production builds only. `Class.name` itself
   turns out to be bundler-dependent rather than reliably empty; see the section above.
   Dependencies go through a string key for that reason and no other.
2. **Patch-io.** ✅ Built — `rack/patch-io.ts`, the kind-aware hash codec in
   `app/src/hash.ts`, and the patch half of persistence in `app/src/rack/persistence.ts`.
   Three things worth knowing came out of it:

   - `decodePatch` takes **no registry**, deliberately. Validating against one here would
     delete exactly what the placeholder rule protects, so param clamping stays in `compile`
     and per-module migration does too — which is where `ModuleDef.migrate` is finally called,
     having been declared in step 1 and never invoked.
   - The song's hash markers (`z`, `r`) are one character and already in the wild, so they
     could not grow a prefix. A patch is `p` then the same encoding character, and the marker
     table is read longest-first. `hash.test.ts` pins a literal hash captured from the build
     *before* kinds existed — if a codec change cannot read it, that change has broken every
     link anybody has already shared.
   - A forty-module patch is under 1000 characters in a URL. That is the product claim, tested.

   `ParamDef` still has no `curve` field: the taper is the faceplate's business until there is
   a faceplate to have an opinion.
3. **The other modules.** ✅ Built — sixteen in the registry, and the "cheap and independent"
   prediction held: each is a class, a def and a test, and none of them broke another. What did
   not hold was the count and a few of the designs.

   - **Clock and Seq are two modules, not one.** A clock that is not a sequencer can drive four
     of them at different divisions; a sequencer with no clock in it can be advanced by an
     envelope, a comparator, or another sequencer's gate. One module doing both would have made
     every one of those a special case.
   - **Modules with several responses expose all of them at once.** The SVF has four outlets
     rather than a mode knob, Noise has white and pink, the LFO has bipolar and unipolar. Each is
     computed anyway, so a selector would be spending a knob to withhold something already
     sitting in a register — and the LFO's pair removes the commonest piece of patch furniture
     in a modular, the offset module whose only job is turning ±1 into 0..1 for a VCA.
   - **`ProcessorClass` gained a third argument: the module's `id`.** Anything random seeds from
     it. Seeding from an instance counter — the first attempt — meant a patch containing noise
     sounded different every time the graph was rebuilt, which quietly makes "the same patch is
     the same sound" false. An id is stable across sessions and different between two Noise
     modules, so it gets reproducibility and decorrelation from one change.
   - **Two DSP claims were wrong until measured.** Asymmetric saturation produces *signal
     dependent* DC, so Drive's original trick of subtracting `tanh(bias * drive)` left an offset
     of 0.51 on a 0.6 sine; it has a 5Hz DC blocker now, which is what real distortion circuits
     do. And Kellet's suggested pink make-up gain of 0.11 leaves pink 9dB below the white outlet
     next to it — 0.325 is measured to match.

   The most valuable file to come out of this is `modules/modules.test.ts`, which holds every
   entry in the registry to the structural rules at once: writes every outlet sample, never
   writes an inlet or a param buffer, stays finite at both ends of every param with hostile
   inlets, is deterministic, survives `toString()` into a bare scope, and declares every dep it
   looks up. A new module gets all of it by being added to the list.
4. **The rack UI.** 🚧 First slice built and playable at `rack.html`: a vertical stack of
   faceplates, knobs that reach the audio thread, the 3D flip on Tab, a back panel with jacks, cables
   that hang, drag-to-patch and click-to-unpatch, and a patch that survives a reload or a link.

   Decisions taken, and what they cost:

   - **Fixed width, half or full.** Two adjacent half-width modules share a row; anything else gets a
     row to itself. A generic faceplate with no more than three visible controls becomes half-width
     automatically, so small utilities such as Delay, VCA and Clock compact without another registry
     entry; a hand-built faceplate opts in because it may contain things its param list does not reveal.
     The layout remains order-preserving — in a rack the arrangement *is* the document, so a packer that
     shuffled modules to close gaps would move what somebody had placed.
   - **Reordering is two-dimensional and previews the real faceplates.** Full-width rows are crossed by
     moving vertically; a half-width row is crossed left to right, including the empty side of a lone
     module. The proposed order is run back through the same layout function while the pointer moves, so
     the rack visibly settles around a hollow target slot. The lifted faceplate is a separate layer that
     follows the pointer continuously — it never becomes a blank placeholder or teleports from slot to
     slot while it is in your hand.
   - **One coordinate system, no DOM measuring.** Front panel, back panel and cables are all laid out
     by `layout.ts` into a fixed design space that the cable SVG uses as its `viewBox`. Nothing has to
     agree with anything at runtime because there is only one set of numbers, and the geometry is
     testable without a browser.
   - **Every control is one fixed cell, and the grid is real CSS grid.** The first version predicted
     module heights with a formula while the controls flowed with `flex-wrap`, and the two disagreed by
     250px — the sequencer rendered with a hole in it. A control that escapes its cell takes the height
     arithmetic with it, which is why a stepped param with more than three positions becomes a stepper
     rather than a row of buttons.
   - **CSS 3D for the flip, not three.js.** `@react-three/fiber` was already available and is the
     wrong tool: rotating real DOM keeps every knob a real element with its own pointer events, focus
     ring and ARIA role. `perspective`, `preserve-3d` and `backface-visibility` are the whole
     mechanism, and it honours `prefers-reduced-motion`.
   - **Cables sag much less than it feels like they should.** 0.10 of the span, down from 0.22 — at
     0.22 the back panel read as bunting rather than as patch leads.
   - **The cables swing when the rack turns**, which is the detail that made Reason's back panel feel
     like an object rather than a diagram. A damped pendulum per cable over 2.2s, `swingAngle` in
     `cable.ts`, one rAF loop that runs only while a swing is in flight and honours
     `prefers-reduced-motion`. Two things about it were wrong first and **only driving the page found
     either** — every property test passed both times:
     - The first version swung the belly on an arc of radius `sag`, so the cable could not change
       length. Correct physics, measured at 10.8 design units of travel, and invisible on a rack 480
       units wide: the mid-swing screenshot was indistinguishable from the settled one. The reach is now
       its own number and length is only approximately conserved. An invisible effect that conserves
       length perfectly is not a better effect.
     - Deriving each cable's period from its own length is real and, here, worth almost nothing: every
       cable in the shipped patch spans 433-508 units, because the rack is one column wide and they all
       run about the same diagonal. That is a 5% spread in period and all eight peaked on the same
       frame. A deterministic per-cable seed, hashed from the cable's own name, varies the period by
       ±15% and staggers the start by up to 70ms. Real patch leads differ in stiffness and seating,
       which is exactly why a real panel does not move as one sheet.
   - **Faceplates: a sparse registry with a generic fallback.** Hand-built for the VCO, the Ladder and
     Out; derived from the def for everything else. Same principle as the compiler's placeholder rule —
     degrade sensibly rather than fail — so adding a module stays a class, a def and a test with no UI
     work, and a module type this build has never seen still arrives with something you can turn. The
     back panel is *never* hand-built, which is what makes cables work universally.
   - **`ParamDef` gained an optional `labels`.** The fallback could otherwise only show numbers, and a
     gate switch labelled "0" and "1" looks like a bug. Names belong on the def rather than in the UI
     precisely so the *generated* faceplate gets them: that is the difference between the fallback
     being a fallback and the fallback being enough.

   Then: **touch, keyboard patching and a scope.**

   - **Patching was completely broken on touch** while working perfectly on a mouse. `pointerup`'s
     target is not the thing under the pointer on a touchscreen — implicit pointer capture delivers the
     release to the element the touch *started* on, so the source jack was being handed to itself as the
     drop target. The fix was to stop asking the DOM and resolve the target by position instead, which is
     better than reaching for `elementFromPoint`: it behaves identically for mouse and touch, it needs no
     DOM so it is testable, and it **snaps** — which is not a nicety when a fingertip is wider than the
     jack it is covering. Filtering candidates by kind is what makes the snap forgiving rather than
     merely tolerant.
   - **Keyboard patching.** Enter arms a jack, Enter on a compatible one completes the cable, Escape
     lets go, Delete pulls one out. It shares `connect` with the drag so there is one definition of a
     legal cable. A modular whose whole point is the cables is a poor thing to make mouse-only.
   - **Unplugging is visible at every occupied inlet.** The original cable midpoint was an invisible
     click target which only announced itself after somebody happened to hover it. Every cable now has
     a persistent × beside its inlet, where controls cannot stack because an inlet accepts one cable;
     outlets still fan out freely. The midpoint shortcut and Delete on a focused jack remain. A deleted
     cable leaves the patch and audio graph immediately, while a snapshot of its old cubic frays into
     fifteen deterministic smoke wisps over 1.25s; reduced-motion users get an effectively instant exit.
   - **The sequencer's oscilloscope, reused.** That took *removing* a dependency rather than adding a
     fallback: it read its analyser from the sequencer's store, so importing it would have dragged the
     engine, the songs and the scenes into a 37kB page. It takes the analyser as a prop now and both
     pages pass their own. Diagnostic rather than decorative here — a VCA left shut reads as a flat
     line, and a patch clipping into the Out reads as a flattened top.

   Then: **a document library.**

   Four shipped patches live in `@driftbox/rack`, not in the app — the same reasoning that puts the songs
   in the engine: they are data about the rack rather than about the page showing it, so a headless
   consumer gets them too. Built rather than stored, so loading one twice cannot hand back an object
   somebody has already edited. They deliberately share almost nothing, because four sequenced acid lines
   would demonstrate the opposite of what a modular is: one has no sequencer, one has no oscillator, and
   `patches.test.ts` asserts that rather than trusting it.

   Named slots now live in shared `app/src/document-library.ts`; `app/src/rack/library.ts` is a
   compatibility entry point. Songs and patches share a name namespace, and each encoded entry records
   its type plus the rack/groovebox compatibility state so listing never has to decode the whole shelf.
   The groovebox keeps rack-only entries visible but cannot load them; the rack can host either type.
   The former `driftbox.patches.v1` shelf is read as a migration source and carried into the typed shelf
   on first write without deleting the old key. Storage remains a **parameter** defaulting to
   `localStorage`, which keeps the entire migration and CRUD surface testable against a plain Map.

   **Module drag-to-reorder** ✅ — by the title bar, with a drop line showing where it lands. Four things
   decided by building it:

   - **The geometry is in `layout.ts`, not the component.** `dropIndex` counts how many modules the
     pointer has passed the *midpoint* of. Asking which module it is over has no answer in the gaps or
     past either end and needs two special cases; counting midpoints is total, and it is what makes the
     drop line land where the eye expects. Pure, so it is tested without a browser like everything else
     here.
   - **The handle is the title bar.** Dragging from anywhere would fight every knob — a knob captures the
     pointer itself, so the two would race and the winner would be whichever sat deeper in the tree. The
     handle is a transparent overlay added by the chassis rather than something each faceplate wires up,
     because requiring one would have quietly broken the generic fallback and with it the registry's
     promise that a module needs no UI work.
   - **The arrows stay.** Dragging is unavailable to anybody who cannot drag, and this is the same
     standard the back panel already holds itself to, where Enter arms a jack.
   - **A no-op edit no longer rebuilds the graph.** `structural` bumped the revision unconditionally, so
     a drag that ended where it started — and, it turned out, moving the first module up, which has always
     been able to decline — recompiled the patch and reset every oscillator's phase and every filter's
     history for nothing. It now compares by reference and declines to bump. That was a pre-existing
     defect this feature only made easy to trigger.

   **Patterns, and then a bank of them** ✅ — because until this the rack had no way to enter a note at
   all. The Tracker had no faceplate, so it fell back to the generic one, which draws params; a pattern is
   `PatchModule.data`, and `setData` was only ever called for samplers. Every pattern came from a shipped
   chunk and was invisible and immutable. That is a strange gap in an instrument and a fatal one for
   shipping songs people can start from — a song you cannot edit is a recording.

   - **An edit is not structural.** Pattern data compiles into the plan, so treating a cell as a patch
     change would rebuild every processor on every cell touched. It takes the two paths `setParam` takes
     instead, which works because `pushed` already beats `seeded` in the Graph — a rule that exists so
     recompiling cannot discard a loaded break, and a pattern turns out to be the same shape of problem.
   - **A bank is the same array, longer.** Patterns sit end to end, so pattern *p* is
     `[p * length, (p + 1) * length)`. A lane of sixteen values at a length of sixteen is exactly pattern
     0 — which is every patch written before banks existed, byte for byte. The alternative, a slot per
     pattern, would have meant a naming scheme in the data, a migration, and a reader that knew about banks.
   - **The pattern inlet is scaled by sixteen so a Unit lane drives it one for one.** One Tracker clocked
     by the bar, chaining another's patterns, *is* an arrangement — so the song mechanism needed no new
     module, only an inlet.
   - **Past the end of the data is a rest, not a wrap.** An empty bank slot is what an unfinished song
     looks like; wrapping would make it secretly repeat bar one and be very hard to debug.

   Shipped rack-native songs remain future work. The performance mode is now present, and it settles the
   visualiser question below: a moving scene competes with a back panel you are trying to *read*, while in
   split/full-pad performance views it has its own surface. Scenes belong on that player, not behind the
   patcher.

   **The Arranger** ✅ — a list of sections, each a pattern and a count of bars, driving a Tracker's pattern
   inlet. The mechanism was already there; this is the thing that made a song something you can *see*.

   - **A module, not a layer over the patch.** A pattern index over time *is* a signal, and making it one
     buys three things a host-side arrangement would not: one Arranger drives several Trackers from one
     cable each; the patch format needs no change at all, unlike `modulation`, which had to be added for
     the Combinator because a routing genuinely is not a signal; and being CV it composes — a song can be
     offset, quantised or driven by something else. The cost is that a song lives in a module rather than
     somewhere obviously "above" the patch, which only reads wrong if you were expecting a DAW.
   - **Clocked by the bar.** Its clock inlet takes the Transport's `bar` outlet, because a section is
     measured in bars and counting sixteenths to find them would put the same arithmetic in two modules.
   - **`elapsed` counts bars started, not bars finished.** The first edge is the start of bar one rather
     than the end of it. Getting that backwards makes every section one bar short — the same off-by-one
     the Tracker sidesteps by starting its step counter at −1 — and it is what the module's tests are
     mostly about.
   - **All sixteen sections on the panel at once**, in two columns of eight, with the ones past the song's
     length dimmed rather than removed. A scrolling list would hide the shape of the song, which is the
     one thing the panel exists to show; and shortening a song must be as reversible as turning the knob
     back, which is the same promise the Tracker makes about a shortened pattern.
   - **A general `setData` under the Tracker's `setLane`.** Sections are not lanes but they are the same
     kind of thing — an array read at audio rate and edited while it plays — so the named accessor became
     the special case of a general one rather than every module getting its own store action.
   - **The panel reads `module.data`, not the store.** The Chassis looks the module up out of the live
     patch on every render, so the prop is exactly as current and costs no subscription. It also makes the
     panel renderable in a test, which the Tracker's is not: zustand answers a server render from the
     state the store was *created* with, so a component that subscribes draws an empty patch.

   **A picker that explains itself** ✅ — a card and a sentence per thing, shelved by what it does, with a
   search over both. What it replaced was twenty-nine names in a row — `Offset`, `S&H`, `Alligator`,
   `Combi` — which assumes you already know what they are, and that is exactly what somebody opening a
   modular for the first time does not. Reason's browser was a picture and a sentence per device for the
   same reason: the picker is where you find out what the instrument can do.

   - **The copy is on the def, not in the app.** `ModuleDef` gained `blurb` and `group`, both optional.
     The registry's promise is that adding a module is a class, a def and a test — copy in the host would
     have made it "a class, a def, a test, and an edit to a file in another package", which is the
     coupling `faceplates/index.ts` goes to some trouble to avoid. A module from somewhere else brings its
     own description the way it brings its own name.
   - **The groups had to be stated rather than inferred.** `MODULE_LIST`'s order always implied them and
     nothing could read it. Each def now names its shelf, the list is sorted to agree, and
     `modules.test.ts` holds it to that — because the picker walks the list once and starts a shelf when
     the group changes, so a module out of order would silently open a second "Filters" further down.
     One pass rather than grouping by a `Map`, which keeps the deliberate order *within* a shelf.
   - **The search reads the blurbs, not only the names.** "wobble" finds the LFO. Somebody who wants a
     wobble does not know to type "LFO", and a picker that only matched names would tell them the rack has
     nothing.
   - **`browse` is a plain function in its own file.** The search is the only part with anything to get
     wrong, and a component holding its query in `useState` cannot be searched from a test without a DOM.
     Same reasoning as `midiTargets`.
   - The generic faceplate and the picker now share one `portSummary`, which also stopped a Transport
     announcing itself as "0 in · 6 out".

   **Undo** ✅ — sixty-four steps, on Ctrl/Cmd+Z and on two buttons in the header. First item off
   [REASON-GAP.md](REASON-GAP.md), and the cheapest of the three that list leads with.

   - **A stack of whole patches, not a log of inverse operations.** The usual argument — a patch is
     large, an operation is small — does not survive the measurement step 2 already made for the URL:
     a forty-module patch is under a thousand characters, so sixty-four of them is less than one loaded
     break. What a log costs is an inverse for every action forever, and the failure mode when somebody
     forgets one is the bad kind: undo does not break, it silently restores a document that never
     existed. A stack of documents cannot have that bug because it never has to know what an edit meant.
   - **One `write` helper, and every document edit goes through it.** That was already the argument for
     `structural`; undo is what made it worth extending to the edits that are *not* structural. A knob,
     a pattern cell, the tempo and a retained groovebox pattern each called `set` themselves, and each
     would have had to remember to record history — the one that forgot would make undo skip a step
     rather than fail. Settling, autosave, the revision and the history are now decided in one place.
   - **Coalescing is keyed by what was edited, never by a clock.** `setParam` fires on every pointer
     move, so without it one drag of one knob fills the entire history. A time window would need a fake
     clock to test and is wrong in both directions: a slow deliberate drag becomes many steps, two quick
     edits to different knobs become one. Keyed, the rule is pure — and driving the page confirmed it,
     twenty pointer moves undone by one press.
   - **A restore has to ask the document whether the graph needs rebuilding.** A forward edit knows,
     because it knows what it did. `needsRebuild` compares modules, cables and the voice count, and
     deliberately ignores params, pattern data and the retained song: the first two reach the audio
     thread as messages, and the third belongs to a hosted engine that swaps its song live. Rebuilding
     for an undone knob would reset every oscillator's phase and every filter's history, which is the
     click the whole two-path design at the top of `store.ts` exists to avoid.
   - **It found a latent bug either side of it.** The push subscription in `RackApp` skipped any edit
     that bumped the revision, on the grounds that a rebuild re-seeds from the plan. Data is the one
     thing a rebuild does *not* re-seed — `pushed` beats `seeded`, which is what stops a recompile
     throwing away a loaded break — so undoing a removed Tracker would have brought it back playing the
     pattern it had before the undo. The guard is gone; the walk it costs is over references that are
     usually identical.
   - **Opening a document is where undo stops.** A history spanning a load would let one press
     resurrect a patch somebody deliberately left, and that patch is not gone: it is in the library, in
     storage, or in the link they arrived by.

   **Stereo cables** ✅ — second off [REASON-GAP.md](REASON-GAP.md), and the one this file and
   `docs/DNB.md` had both talked themselves out of.

   Both of them said the same thing: full stereo cables "would double every buffer and make every module
   answer what it means to filter a stereo signal". **Neither was the price**, and the reason is one word
   in the wrong place — the objection assumed stereo would be a property of the *cable* or of the *graph*.
   It is a property of a **port**.

   - **A stereo port owns two consecutive buffers and occupies two slots.** A def declaring
     `[in(stereo), cv]` hands `process` three inlet buffers: left, right, cv. So a module that says
     nothing sees exactly what it saw before, twenty-seven of the twenty-nine did not change at all, and
     the Graph needed no change to how it wires inlets and outlets — because those were already flat
     lists of buffer indices rather than one per port. The whole feature lands in `compile.ts`, plus the
     mix stage in `graph.ts` where a terminal outlet can now be a pair.
   - **Three rules, in `stereo.ts`, and all of them total.** stereo→stereo carries both; mono→stereo
     feeds both channels from the one buffer; stereo→mono takes the **left**. Total matters as much as
     correct here: an unconnected inlet arrives as the zero buffer and comes back as one or two of it,
     which is the property that stops any module having to branch on whether it is patched.
   - **Folding is the left channel, not the sum, and that is Reason's rule** — its jacks say "L (Mono)".
     A sum would need a scratch buffer and a copy per folded inlet every block, which is the machinery
     the polyphonic collapse already pays for, and it would add 6dB to any centred signal. The Mixer is
     one module away for anybody who wants the sum, and it is then visible in the patch.
   - **Adding a channel is safe, and port aliases make a deliberate rename safe too.** Cables name ports,
     so widening `out` moves no cable. A canonical port may also own historical ids; the compiler accepts
     them and the rear panel resolves them onto the current physical jack. An outlet alias can select one
     channel of a stereo port, which is what lets Groovebox collapse eight mono jacks into four stereo ones
     without turning an old left-only or right-only cable into a different signal. New cables use only the
     canonical id; saved aliases remain intact and removable.
   - **Out went first because nothing else could be heard without it.** Everything upstream can be as
     stereo as it likes while the end of the rack takes one channel. Its pan param is unchanged and now
     means balance on a pair, which is what a pan control on a stereo channel means on any mixer — one
     knob, one name, rather than a second control that only sometimes applies.
   - **The Reverb is the first real stereo source, and its left channel did not move.** One FDN, two
     output mixing vectors: the left is the mean of the taps it always was, the right is the same taps
     under an alternating sign. Uncorrelated, equal energy, full density on both sides — splitting the
     eight lines four and four would also decorrelate and would halve the echo density on each side,
     which is audibly sparser than the mono version was. Measured on the shipped hero patch, side/mid
     went 0.0466 → 0.0492: the record is wider and nothing else about it moved.
   - **The compiler reports a fold** as `plan.notes`, and the back panel draws those cables thinner with
     the reason in their title. Same bargain the delayed cables strike: a patch that behaves unlike its
     picture is worse than one that admits it. A stereo jack gets a second ring rather than a second
     hole, because it is still one connection — dragged, snapped and pulled out like any other.

   **An EQ** ✅ — the fourth thing off [REASON-GAP.md](REASON-GAP.md), and the first module added since
   stereo cables landed.

   - **The rack had two filters and neither is an EQ.** The Ladder is a 303's filter and the SVF is a clean
     two-pole, and both of them *remove* a part of the spectrum. Nothing could add 2dB at 80Hz or take 3dB
     out at 400Hz — which is not a filter operation, it is the operation a mixing desk does on every
     channel, and this rack grew mixer strips before it grew the thing that goes on one.
   - **Shelves at the ends, a parametric in the middle.** The two jobs are different: the ends are tone and
     want to move everything past a corner, while the problem in the middle is always a specific frequency
     and wants a Q. Three parametric bands would spend three more knobs to be worse at the two jobs anybody
     has. It was approximable — an SVF's four outlets into a Mixer with signed levels — at six modules, a
     page of cables and no say in where the bands sit, which is exactly the case for a device rather than a
     chunk that `alligator.ts` already argues.
   - **Stereo, and for a reason that is about placement rather than about the sound.** An EQ's curve applies
     to both channels equally; what makes it stereo is that it sits at the *end* of a chain, so a mono one
     would fold away the width the Reverb had just produced. Each channel keeps its own filter states and
     shares the coefficients, which is what "the same curve on both" means arithmetically — and a state
     array indexed wrongly shows up as one channel filtering the other's signal, which is what its test
     with two different tones is for.
   - **Coefficients are recomputed only when a knob has moved**, the trade `reverb.ts` and `svf.ts` both
     make. A knob sitting still costs one comparison per sample; a knob being dragged ramps and so
     recomputes per sample for the length of the gesture, which is the honest price of a control that
     responds at audio rate rather than at block rate.
   - **It resets its own state on a non-finite sample** rather than leaving that to the Graph's final clamp.
     The clamp keeps the tab alive; it does not un-poison a biquad, which would otherwise stay silent for
     ever. The test proves the recovery by feeding it an infinity and then a tone.

   **Duplicate a module** ✅ — and the pre-existing bug it walked into.

   - **The copy lands beside the original, not at the end.** The module list *is* the layout, so a copy
     appended to the bottom is one you have to go and find and then move back up past everything else.
   - **It arrives unpatched, and that is not laziness.** Copying the outgoing cables would aim them at the
     same inlets, and one cable per inlet means the later one wins — so duplicating a module would silently
     *unpatch* the original, which is the opposite of what the word means. Combinator routings are left for
     the same reason: a routing names its target by module id, so copies would drive what the original
     already drives and the two panels would fight over every knob.
   - **A fresh id, from the same numbering `addModule` uses.** Anything random in the rack seeds from the
     id, so the copy of a Noise is a different noise rather than the same one 6dB louder — the same
     reasoning `poly.test.ts` records one level up, where later voices get a suffixed id.
   - **Params and data are copied a level deeper than the spread reaches.** Nothing mutates a patch in
     place today, and "today" is the problem: two modules whose lane array is the same reference is a trap
     laid for whoever writes the first in-place edit.

   **Bypass** ✅ — one flag on a module, resolved entirely by the compiler.

   - **It cannot be a param, which is the first thing anybody tries.** A param is read by the module's own
     `process`, and a bypassed module does not run — so something has to answer for its outlets on its
     behalf, and only the compiler can see both ends of the cables that would carry the answer. Exactly the
     reasoning that put `terminalMute` and `terminalSolo` outside their processor: solo silences the
     *others*, and a module has no idea the others exist.
   - **A bypassed module gets no node at all.** Not "runs and is ignored" — it is not built, so bypassing
     the Vocoder genuinely gives back its 32 bands. The honest consequence is that its filter history and
     oscillator phase are gone when it comes back, which is what not running something means.
   - **All of its outlets carry its first inlet**, and the tidier-looking alternative is nonsense on a real
     module: pairing outlet *n* with inlet *n* would put a cutoff CV on the SVF's highpass jack. The first
     inlet is the signal path on every module here by convention, and bypass is a statement about the
     signal path. A module with **no** inlets bypasses to silence, which is what turning a source off
     means — so one flag covers Reason's Bypass and its Off.
   - **Resolution happens before the topological sort**, so a bypassed module in the middle of a chain
     stops constraining the order and cannot report a feedback delay that no longer exists. It also means
     the stereo rules apply to the *resolved* source, so a bypassed module in front of something stereo
     does not quietly fold the pair.
   - **A ring of bypassed modules is silence, not a stack overflow.** A patch arrives from outside the
     program, and the placeholder rule's standard — neutralise, never crash — has to hold here too.
   - **A bypassed terminal comes off the mix bus.** Its outlet buffer is written by nobody, so summing it
     would put whatever was last in that buffer into the mix for ever.
   - `needsRebuild` had to learn about it, or undoing a bypass would leave the graph running the resolved
     plan while the document said otherwise. And `false` is never written to the patch: a rack that has
     never had anything bypassed stays byte-identical to one saved before the flag existed.

   **And the bug.** Adding a fourth button to the module tools found that none of the other three could be
   clicked. `.rk-grip` is a transparent overlay across the whole title bar at `z-index: 2`, and
   `.rk-module-tools` sits inside that band at `top: 6px` with no z-index at all — so ↑, ↓ and ✕ had been
   covered since the grip arrived. The keyboard could still reach them, which is exactly why nobody
   noticed, and it inverts the promise this file makes two sections up: the arrows exist so that reordering
   is available to anybody who cannot drag, and they were working for those people and for nobody else.
   One line of CSS. **Only driving the page finds this**, which is now the fourth time that sentence has
   had to be written here.

## Teaching it: guided tours that watch rather than drive

The rack accumulated conveniences faster than it accumulated ways of finding out about them. Three of the
best things it does are invisible: a module on the Sources shelf arrives wired to its own fresh Out, the
on-screen keyboard builds a MIDI module and cables it the first time you press a key, and a *filter*
deliberately does none of that because a processor cannot guess what it is meant to be processing. Every one
of those is correct behaviour that somebody has to be told once. Written down in the guide, they are four
sentences in a reference nobody reads before they are already stuck.

So: `app/src/rack/tutorials.ts`, six lessons, and one rule that decides the whole design.

**A step is a claim about the patch, not a position in a script.** `done(state)` is a pure predicate over a
snapshot — the patch, whether audio started, whether the transport runs, whether the rack is turned around,
how many notes are sounding. It ticks when the claim becomes true because you made it true. Nothing in the
tour presses, patches or turns anything.

That is not only a principle, it is what makes the thing cheap and unbreakable:

- **It cannot get out of step**, because there is no step to lose. Wander off, load a preset, undo half of
  it, come back tomorrow — the predicates are re-evaluated against whatever the rack is now.
- **Order is the reader's.** Doing step four while reading step two credits step four. A scripted tour would
  have to either refuse or resynchronise, and both are worse than noticing.
- **It is a Node test.** The interesting failures are silent ones — a predicate nobody can satisfy leaves
  somebody stuck doing exactly as they were told; one already true on an empty rack ticks itself and teaches
  nothing. `tutorials.test.ts` asserts no step holds on a blank rack, and carries a finished-state fixture
  per lesson written from the instruction text, so a step and its own wording cannot drift apart.

`TutorialCoach.tsx` is only the panel, and owns exactly two things the pure layer cannot: which step you are
on, and which are done. **Completion latches** — half the lessons say "turn the rack around" and then ask you
to turn back, so a checklist re-derived from live state would untick itself one instruction later. Skipping
marks a step passed rather than done and is reversible: doing it later still credits it, and a tour reports
itself finished only when every step genuinely happened.

It is an aside pinned clear of the keyboard rather than a modal, because a modal covers the rack the tour is
asking you to touch. The alternative — a spotlight cut-out over the real control — needs the panel to know
where every control is, which is a second layout system that goes wrong silently every time a faceplate
moves. A named place to look ("Back panel", "Add module") costs nothing and survives rearrangement.

The factory bank grew the same gap and got the same treatment. Not one shipped patch contained a MIDI module
or a Voice, so the answer to "I opened the rack and pressed a key" was silence from a bank of eight patches
all busy playing themselves. **First Light** and **One Finger** are playable rather than self-running, and
the **Keys** and **Arp** chunks are the first two that wait for a key — declared with `playable`, for the
same reason `needsSample` is declared, so the test that every chunk makes a sound on arrival can hold them to
the right standard instead of skipping them.

## The visualiser, and why it lives on the performance pad

The sequencer has eighteen 3D scenes and the obvious first move was to put one behind the rack. Measured
rather than assumed, that costs more than it looks:

| | |
|---|---|
| rack page today | **40 kB** |
| `three` + `@react-three/fiber` | ~600 kB |

Fifteen times the original page, for something decorative. It is also the wrong decoration: the back panel is a
picture you are trying to *read* — which cable goes where, which one is dashed — and a moving scene behind
it competes with exactly the thing it would be sitting behind.

The oscilloscope was worth it and cost nothing extra, because it is diagnostic: a VCA left shut reads as a
flat line and a patch clipping into the Out reads as a flattened top, and neither is visible any other way.

The shipped shape therefore keeps that original constraint: the scene code is a **dynamic import** mounted
only when the user chooses split or full-pad view. The 600 kB is paid by whoever asks for the performance
surface, and the rack and back panel remain visually quiet.

**The third obstacle is now gone** ✅, and it was the only one that was an accident rather than a decision.
Every scene did `useBox((s) => s.engine)` and handed it to `readLevels`, which only ever wanted
`engine.analyser` — so thirteen scenes depended on the sequencer's whole store, its songs and its engine
to reach one `AnalyserNode`. The rack could not have used a scene at any price.

- **`levels.ts` takes an `AnalyserNode`.** The coupling was one field deep and entirely accidental, which
  is the same thing that was true of the Oscilloscope, and the same fix: remove the dependency rather than
  add a fallback to it. It also makes the band-splitting testable against a fake analyser and no engine.
- **`audio.ts` publishes what the scenes are watching** — analyser, running, tempo — as a mutable module
  object, the shape `touch.ts` already uses and for the same reason: every scene reads these inside
  `useFrame` and none of them re-renders when one changes. The two scenes reading `running` read it inside
  the frame callback, and the tempo was already being fetched imperatively through `useBox.getState()`.
- **The `Visualiser` is the boundary.** A scene cannot take a prop — it is looked up from a registry by
  id, so there is nowhere to thread one through — so the page hands them to the canvas and the canvas
  publishes them. One file for either page to know about.
- **A test sweeps the directory** for an import of the store or the engine, because copying an existing
  scene as the start of a new one is exactly how this comes back, and it would come back silently.

The host-neutral boundary now pays off in rack mode. `PerformPad` supplies the rack analyser, transport
state and tempo to the same `Visualiser`, forwards pad gestures to both the master Kaoss filter and shared
scene touch state, and exposes the same scene cycle control. Scene choice is document state: retained songs
keep it within the song envelope, while rack-native patches use their optional top-level field. This avoids
both bundle cost on the editing-only path and visual competition with a readable patch panel.
5. **Playing it, then polyphony.** Decided rather than guessed at, in this order — and two things
   fell out of the deciding that make the work smaller than it looked.

   **5a. A MIDI module, monophonic.** Polyphony without a note source is eight copies of the
   same note, and the rack can currently only be played by its own monophonic Seq. So this comes
   first, and it is useful on its own.

   It looks like it needs an ABI change and does not. An `AudioWorkletGlobalScope` has no
   `navigator`, so MIDI cannot arrive on the audio thread — but the message set already carries
   `param`, and a param already ramps across one block. So the module's pitch, gate and velocity
   are **params the host writes** from Web MIDI, and its processor only copies them to its
   outlets. Gate is `stepped` so it steps rather than ramps; pitch ramping over 2.9ms is an
   inaudible glide. Nothing new in `RackMessage`.

   Web MIDI is Chromium-only, so absence has to read as absence rather than as breakage — the
   same standard `loadRack` already holds itself to.

   **5b. Polyphony.** ✅ Both halves are done: the compiler and the Graph carry the voices, and a
   `Keyboard` drives them. Same discipline as step 1 — the part with the risk in it first, with no UI —
   which is why they landed apart, and why this line went on saying "the graph half is built; nothing
   drives more than one voice yet" for a good while after that had stopped being true. A status marker
   is a claim about the tree like any other, and this one was checkable in `midi.test.ts` the whole time.

   The corrected section above held: **no module changed to get polyphony.** All of it is in the
   compiler and the Graph. What the compiler emits is `voices`, a `poly` flag per node, and a
   `poly[]` map saying which buffers are per-voice — that last one so `process()` never has to work
   anything out at run time.

   The four cases are decided once at build time and stored, because deciding them per sample would
   be four branches in the innermost loop in the program:

   | consumer | source | the inlet gets |
   |---|---|---|
   | poly | poly | that voice's buffer |
   | poly | mono | the one buffer, the same for every voice |
   | mono | poly | a scratch holding every voice summed — **the collapse** |
   | mono | mono | the one buffer |

   Twenty-two modules are now `poly: false`: **Arp, Arranger, Audio Input, Amp / Cab, Clock, Combinator, Delay,
   Distortion, Groovebox, Imager, Limiter, Loop Station, Meter, Out, Phaser, Ping-Pong Delay, Reverb, Seq, Tracker,
   Transport, Tuner and Vocoder**. They are shared buses, clocks, controllers or processors whose state belongs
   to the rack rather than to one voice. Delay is the clearest example — eight two-second buffers would
   be eight separate delays — and Imager makes the other failure vivid: widening each voice before the
   polyphonic collapse would simply throw that width away. `poly.test.ts` pins this list so a new module
   cannot become shared merely because nobody made the decision.

   Two things needed adding that the plan did not mention:

   - **`setParam` gained an optional voice.** A knob means every voice; a keyboard means one. That is
     the only thing polyphony added to the message ABI, and it is what lets one MIDI module hold
     eight different notes.
   - **Later voices get a suffixed module id.** Anything random seeds from the id, so eight voices of
     Noise would otherwise be one source 18dB louder rather than eight uncorrelated ones — the same
     bug as the instance-counter seeding from step 3, one level up. Voice zero keeps the plain id, so
     a one-voice patch is byte-identical to before polyphony existed. `poly.test.ts` asserts that.

   What drives it: a `Keyboard` allocates a controller across the voices, MIDI writes each voice's note,
   and a voice-count control sits in the header.

   **One class for one voice and for eight, and that is the point.** At one voice `Keyboard` is exactly
   last-note priority with legato — hold a key, press another, it moves without releasing the gate, and
   letting go returns to the one still held. At eight it is a polyphonic allocator. They came out the
   same because the rule is the same: keep a stack of every key physically held, and sound the newest N.
   Two classes would have meant the monophonic feel quietly regressing the day polyphony arrived, and a
   mono synth returning to a held note is most of what makes a glide knob mean anything. Written this
   way, a ninth note on an eight-voice patch steals the oldest and hands it back on release — which is
   also what a good polysynth does, and it needed no rule of its own.

   The allocation is recomputed from the stack and only changed voices are reported, which made two of
   its tests wrong before it: a release that changes nothing correctly says nothing, and a voice that
   has never sounded counts as idle for longer than one just freed. It also hid one real bug — a
   re-pressed key emitted nothing, so the envelope never retriggered and the key felt dead.

   **One thing worth knowing before it surprises somebody**, and measured rather than guessed: raising
   the voice count on a patch with no MIDI module multiplies the output by exactly that number, because
   every voice plays the same note. On the shipped Acid patch, one voice peaks at 0.49 and eight at 3.93
   — right against the ±4 clamp. That is the summing being correct; eight voices playing one note *is*
   eight times as loud. Normalising by 1/N was the tempting fix and is wrong, because it would make a
   real three-note chord quiet on an eight-voice patch. The rack says so instead.

   **5b½. The Combinator.** ✅ Built. Four rotaries and four buttons that move other modules' knobs.

   This document opens by saying the rack is "Reason's back panel rather than Reason's front", and
   that was right about where the interesting problem was and wrong about where Reason's value
   was. The back panel is what makes a rack a rack. The **Combinator** is what made a Reason patch
   *playable* — one gesture opening a filter, shortening a decay and switching a waveform — and
   until now nothing here could move a parameter at all except a hand on the knob.

   Four decisions, in descending order of how expensive they would be to change:

   - **It is a panel of macro controls, not a container.** Reason's Combinator holds devices; a
     routing here names its target by module id, which the patch format already had. Containment
     was how Reason scoped *which* parameters a rotary could reach, and it cost it a tree in the
     document, a tree in the rack and a rule for what a cable leaving a container means. So
     `Patch` grows one optional array, `modulation`, and nothing else in the format changes. The
     honest cost is that a Combinator and what it drives are grouped by intent rather than by
     containment — move one away and the routing still works. A rack of chunks is already arranged
     by intent, and `chunks/index.ts` argues that case at length.

   - **A routing is arithmetic on the patch, not a cable.** It is control rate, host side, and
     touches neither the graph, the plan nor the message ABI. That is not a compromise: an inlet is
     a buffer the graph fills at sample rate and a param is a slot the host writes, and joining them
     means either promoting every param to a buffer — doubling the allocation for something a knob
     moves twice a minute — or letting the audio thread write params, which is a second claim on
     values the host believes it owns. `ParamDef.hidden` exists because that fight already happened
     once, with the MIDI module. Reason's Combinator is control rate too.

     Everything downstream then carries it for free, which is the part worth noticing. The routed
     value **is** the target's param, so it saves, autosaves, travels in a URL, renders in an
     offline export, and shows up as the destination knob visibly moving. None of that needed a
     line of new machinery, and a design that put routings in the graph would have needed all of it.

   - **`compile` applies routings as well as the store does.** Two callers, one function, so they
     cannot disagree about what a routing means. The store settles the patch so the driven knob is
     seen to move; the compiler settles it so a patch that never went through a host — a shipped
     chunk, a link opened headlessly, an offline render — still plays what its rotaries say. Without
     the second one, "what a patch sounds like" would be a property of the page that opened it.

   - **The controls are CV outlets as well as routing sources**, which Reason's were not. It costs
     one line in a graph where audio and CV are the same `Float32Array`, and it means one rotary can
     sweep a filter's *parameter* through a routing and open a VCA through a *cable* at once. The
     shipped `combi` chunk does exactly that, to make the point in the one place somebody will see it.

   Three smaller things that were decided by building it:

   - **Two routings onto one target: the later wins.** The same rule two cables into one inlet
     follow. A contested destination is the same problem in both places and having the answer differ
     by which kind of connection you used would be a trap.
   - **One pass, over a working copy.** A routing whose source an earlier routing wrote sees the new
     value, so chaining one Combinator into another works and works in a defined order — and a cycle
     settles after one pass instead of oscillating, which is the same trade the compiler makes when
     it breaks a cycle in the cable graph.
   - **A routing at a stepped param rounds.** A rotary sweeping a VCO's waveform has to land *on* a
     waveform. It is the same reason `stepped` exists at all, one level up.

   **The routing list is a panel, not the back of the rack**, which is where Reason puts it and was
   the obvious place. `BackPanel.tsx` is one SVG in design units — that is exactly what lets cables
   be drawn without measuring the DOM and tested without a browser — and a routing list is selects
   and number fields. Putting it there means `foreignObject` and a module whose height depends on how
   many routings it has, which is the height-arithmetic trap step 4 records falling into once already.
   Two things were also only found by driving the page, as usual: the Combinator's five rows come from
   its eight jacks and its controls need three, so it opened with a hole in it exactly like the Clock
   did — filled now with the list of what each control drives, which is the one thing a macro panel
   cannot otherwise say. And `display: contents` set inline beat the narrow-screen media query, so on a
   390px viewport the five cells of each routing interleaved with the next one's.

   **5b¾. Two more Reason devices.** ✅ Built — a **Follower** and an **Alligator**, chosen because each
   does something no arrangement of the existing modules does.

   The **Follower** is arithmetic the rack already had and kept to itself. `compressor.ts` follows an
   envelope to decide how much to duck by, and nothing else could see it — so sidechaining meant a
   Compressor with its sidechain patched, and only that. As a module it is the one CV source that comes
   from something you can *hear*: a filter opening on a kick is a cable rather than a sequencer lane kept
   in sync by hand. It has a gate outlet as well as a contour one, because a comparator on a follower is
   how audio clocks a sequencer.

   The **Alligator** is the device that is hard to describe and instantly recognisable — a drone in, three
   independently gated bands out, a rhythm made of something that had no rhythm in it. Three decisions
   carried it:

   - **Fixed lowpass, bandpass, highpass.** Three configurable filters is what you can already patch; the
     fixed split *is* the device, and a device earns its place by making one arrangement effortless.
   - **Gates arrive on cables, with no pattern sequencer inside** — the same call `docs/RACK.md` records
     for Clock and Seq. A gate from a cable can come from the Tracker, a Clock division, an envelope, a
     Follower on the kick, or another Alligator; building the sequencer in makes every one of those a
     special case.
   - **Three outlets rather than a mix**, because sending the top band to a delay and leaving the bottom
     dry is what people actually do with it. A Mixer is one module away.

   The per-band envelope is not decoration: a raw gate multiplied into audio clicks on every edge, twice.
   Shared attack, per-band decay — the attack only exists to kill the click and one value does that for
   all three, while the decay is the musical control.

   The `chop` chunk ships it wired up. And the chunk suite grew the assertion it had been missing all
   along: **every chunk that can make a sound is now run through the Graph in Node and measured.**
   "Compiles with nothing dropped" was never the same claim as "you hear something", and this codebase
   has closed that gap by hand twice already — `ensureSampler` and `ensureMidi` both exist because a
   freshly dropped thing did nothing at all. Measured peaks: reese 0.48, combi 0.56, chop 0.39, sub 0.69,
   hats 0.64, and Break 0.0000 exactly, which is what makes its `needsSample` flag a real distinction
   rather than a precaution.

   **5b⅞. Playing the Combinator from hardware.** ✅ Built — MIDI learn, now shared with the
   original editor in `app/src/midi-cc.ts` while rack targets keep their module identities.

   The Combinator is a **performance** idea: one gesture moving a dozen parameters. Performing it with a
   mouse is one gesture at a time, so until this it was a macro panel you configured rather than one you
   played. This is the other half of the feature, and it is why the rotaries run 0..127 in the first place —
   that is a controller's range, and `modules/combi.ts` said so before anything could send one.

   - **Learn, not fixed controller numbers.** A table — CC 16 is rotary one — is less code and quietly
     demands everybody reconfigure their hardware to match us. Most cheap controllers cannot be
     reconfigured at all. Learn is the difference between a feature and a feature with a prerequisite.
   - **Bindings are not part of the patch.** A patch travels in a URL; a binding describes the box on your
     desk. Sharing a patch that silently re-aimed somebody else's controller would be wrong, and one
     carrying a mapping for hardware nobody else owns would be carrying noise. They live in storage, beside
     the patch, like `SampleInfo` and the fold states.
   - **A controller goes through the store, not straight to the audio thread** — the opposite of what a
     *note* does. A note is performance and must never reach the patch; a controller turning a rotary is
     the same act as turning it with a mouse, so it has to move the knob on screen, run the routing so
     everything it drives moves too, save, and travel in a link. Going direct would give a rotary that
     silently changed the sound and nothing else.
   - **One binding per target, one controller to many targets.** The same shape as the rack itself: an
     inlet takes one cable, an outlet feeds as many as you like. Two controllers on one rotary is a fault
     you cannot see, because the old one still moves it.

   All the decision logic is pure and tested in Node, for the reason `midiTargets` already gives: Chrome
   refuses Web MIDI under automation, so a rule left inside the message handler could not be verified at
   all. What *had* never been exercised was the wiring between handler, store and audio thread — so that
   was driven in a browser against a **fake `requestMIDIAccess`**, and it is worth doing again if any of
   it moves. End to end: arm a rotary, send CC 74, the chip reads `CC 74`; sweep it 0 to 127 and the
   Combi chunk's filter goes 120Hz to 6000Hz, which is exactly the range that chunk's routing declares.

   **5b⅞ (again). A vocoder.** ✅ Built. The biggest remaining Reason device, and the one the rack most
   clearly could not fake: a filter bank on *two* signals at once with an envelope follower per band is
   dozens of modules and a patch nobody would finish wiring.

   It is worth noting **what made it cheap**: it is the Follower and the Alligator multiplied. The
   Alligator established the filter bank, the Follower established the envelope, and this is those two
   ideas at N bands. Built first it would have been a large unfamiliar module; built third it was an
   afternoon.

   - **Bands are a stepped choice — 8, 16, 32.** They are three different instruments, not three points on
     a sweep: 8 is a robot and 32 is close to intelligible. The selector is 0..2 and the processor turns it
     into a count with `8 << selector`, because a constant at module scope would not survive being
     stringified into the worklet.
   - **The shift is the control people play**, and Reason put it on the BV512's front panel for that
     reason: it offsets which modulator band drives which carrier band, so the formants move without the
     pitch. Bands pushed off either end read as silence rather than wrapping — wrapping folds the top of
     the spectrum onto the bottom, which sounds like a fault rather than like a voice moved.
   - **One instance, whatever the voice count.** `poly: false`, so a polyphonic carrier is summed first,
     which is what vocoding a chord means. It is also the most expensive module here — 32 bands is 64
     filters and 32 followers per sample — and eight of those is not a trade anybody would choose.
   - **Band overlap is deliberate.** Measured at 16 bands, a 2kHz modulator still puts about a third as
     much energy in the 300Hz band as a 300Hz modulator does. That is the bank overlapping rather than
     leaving gaps, and a bank with gaps sounds worse — so `vocoder.test.ts` asserts the *diagonal* (each
     run peaks where its modulator sits) rather than a ratio that would pin the filter width.

   The test file measures with a ten-line Goertzel rather than an FFT: there are a handful of frequencies
   worth asking about and Goertzel answers exactly one each time, with no dependency. It also goes through
   `compile` and the `Graph`, which is the only way to catch the carrier and modulator inlets being wired
   the wrong way round — a swap the class tests could never see, because they build both arrays themselves.

   The `talk` chunk ships it: a chopped break as the modulator, two detuned saws as the carrier.

   **5c. A VCV Rack importer, topology only.** ✅ Built. Both predictions held.

   **A `.vcv` needed no zip library.** A zip entry is deflate-raw, which `DecompressionStream`
   already does and which `app/src/hash.ts` has used for the URL since patch sharing existed —
   so `vcv/zip.ts` is sixty lines and no dependency, against what would have been the first
   runtime dependency anywhere in this repo. It is deliberately not a general zip reader: no CRC
   check, no zip64, no data descriptors. Sizes come from the central directory rather than the
   local header, because a local header is allowed to say zero and defer.

   **The placeholder rule fit exactly.** It was built in `compile.ts` for version skew between
   two builds of *this* rack, and importing somebody else's rack turns out to be the same
   problem: the parts we understand play, the parts we do not are visibly absent with their
   cables intact, and saving does not demolish them. A placeholder's type carries where it came
   from — `vcv:Bogaudio/Wavefolder` — so the faceplate says "a Rack module we do not have"
   rather than "corrupt".

   **The weak point, and it is worth knowing.** `patch.json` identifies a port by *number*, not
   by name, so mapping requires knowing the order Fundamental declares its ports in — which is
   not in the file, is not part of any published format, and has changed between VCV versions.
   The table is best effort and has **not** been checked against a real `.vcv` written by Rack.

   Two things make that manageable rather than reckless. The importer reports every mapping it
   made with both endpoints named, and the UI shows all of it — so a wrong index reads as one
   obviously wrong line rather than as a patch that sounds subtly wrong for reasons nobody can
   find. And a test fires a cable at every plausible index of every mapped model and asserts the
   result only ever names ports we actually have, so a wrong index can land on the wrong port but
   never on a nonexistent one.

   **Knobs are not carried over**, deliberately. A VCV param is a number whose meaning lives in
   that module's C++, so carrying one across means encoding a guess about somebody else's
   internals for every param of every model — and a cutoff silently a factor of ten out is worse
   than a knob at our default.

   Running VCV's own modules stays out of scope: a C++/Wasm port with GPLv3 attached, and the
   Wasm section above covers why such a bridge has to cross the boundary once per block rather
   than once per sample.

   **Third-party modules: not yet.** `ModuleDef` and `Processor` changed four times in four
   PRs — `deps`, `terminal`, the `id` constructor argument, `labels` — and opening them turns
   each into a promise. Worth knowing that the security question is smaller than it looks: a
   worklet scope has no DOM, no `fetch` and no storage, so a hostile module can ruin your audio
   and spin a core but cannot exfiltrate anything. The stringify-and-string-key design means
   opening this later is a small change rather than a rewrite, so there is nothing to pay in
   advance.

   **5d. A stereo imager.** ✅ Built. Stereo cables stopped being plumbing and became an instrument:
   the Imager splits the side signal around one crossover and gives the low and high bands independent
   widths, so a mix can keep its kick and bass centred while opening the top.

   Mid/side is the load-bearing choice. The centre never moves; zero width is mono, one is exactly the
   signal that arrived, and two doubles only the difference between the speakers. The crossover is a
   one-pole lowpass plus its exact residual rather than two unrelated filters, so the bands reconstruct
   the original side sample-for-sample whenever both width controls are at one. That makes Init genuinely
   transparent even during the filter's first block, not just after it has settled.

   A separate module rather than a mode on EQ keeps both devices honest: EQ changes spectrum equally on
   both channels, Imager changes only their difference. It also leaves every saved patch untouched while
   closing the first of the two stereo-device gaps in `REASON-GAP.md`.

   **5e. A ping-pong delay.** ✅ Built, as a new module rather than a mode on Delay. One mono signal enters
   the left line, then cross-feedback writes each repeat into the opposite line: left, right, left, right,
   with one decay shared by the sequence. The wet outlet is stereo and the dry path remains a visible Mixer
   cable, exactly as it is for the original Delay.

   Keeping the types separate is compatibility work, not catalogue padding. Turning the existing Delay's
   ports stereo would make a centred mono cable feed two identical lines and change the sound of every old
   patch. The new type breaks that symmetry deliberately while `delay` stays sample-for-sample itself.

   **5f. A phaser.** ✅ Built. Six allpass stages per channel supply the primitive no existing patch could
   fake: frequency-dependent phase rotation without a magnitude curve. Mixing that result back with dry
   audio creates three moving notches; an internal LFO sweeps them, the right channel follows a quarter-cycle
   later, and the Sweep inlet moves both sides in octaves from any rack CV.

   The Mix knob is topology rather than convenience. At one hundred percent wet the cascade is an allpass
   and measures flat; at half wet its phase cancellation is the sound. Keeping that recombination inside
   the device is what makes it a phaser rather than six invisible utility filters and a Mixer.

   **5g. Multi-mode distortion.** ✅ Built beside Drive rather than on top of it. Tube, tape, fuzz and
   digital are four transfer functions, not four labels over one waveshaper; Amount drives each through
   its useful range, then a tone stage shapes the harmonics the selected curve created. Bias, output level
   and an Amount CV make the device playable rather than just a preset selector.

   It is stereo because this device also belongs across a bus, with independent tone and DC-blocker state
   per channel. `Drive` remains the level-normalised predictable curve and no saved patch changes sound;
   choosing the larger device is an explicit request for character rather than an upgrade side effect.

   **5h. A look-ahead limiter.** ✅ Built as a patchable mastering device above the Graph's fixed terminal
   safety limiter. A five-millisecond stereo delay gives one linked detector time to see a peak and move
   both channels together; input gain drives the master into it, ceiling and release define the result,
   and a GR outlet makes the reduction available elsewhere in the patch.

   The look-ahead maximum is a monotonic queue rather than a scan of the whole delay for every sample.
   That keeps the work proportional to samples rather than sample rate times window length. The last
   ceiling comparison catches the fraction left by the attack ramp, so this device's number is a promise;
   the terminal limiter remains the invariant for patches that never add one.

   **5i. An amp and cabinet.** ✅ Built, and immediately adopted by the Guitar Pedalboard factory whose
   gap list reserved its stable `cabinet` identity. A level-normalised preamp feeds a three-band tone
   stack, a rumble high-pass and two speaker low-pass poles; Combo, Stack and Bright choose useful upper
   corners without pretending three filters are measured convolution IRs.

   Stereo state is independent throughout so the device also works after wide pedals and on buses. The
   factory now reads Audio Input → Tuner → high-pass → Drive → Amp / Cab → EQ → Compressor before its
   visible dry/delay path.

   **5j. A chromatic tuner.** ✅ Built on the existing analysis telemetry rather than a second audio-thread
   message path. A rolling window is low-pass filtered and downsampled before normalised autocorrelation;
   choosing the first credible peak avoids calling a bright guitar's second harmonic the note, and
   interpolating around it gives the faceplate a useful cents error. Silence and weak periodicity blank the
   display rather than freezing an old answer. Reference A is patch state, pitch is not, and Mute silences
   only Thru so the detector keeps listening. That made the Guitar Pedalboard start Audio Input → Tuner and,
   at the time, left the looper as its one remaining enforced handoff.

   **5k. A performance looper.** ✅ Built, adopted by the Guitar Pedalboard after Reverb, and the last
   enforced handoff in that factory. Record monitors dry; Play adds the stereo take; Dub writes the input
   over the old loop with Feedback while monitoring both; Stop and an alternating Clear trigger complete
   the performance surface. Dub on an empty pedal records the first pass, so no button is a dead end.

   The processor allocates thirty seconds of stereo storage once rather than growing and copying it on the
   audio thread. Its waveform, duration and playhead use the existing meter telemetry. The captured take is
   intentionally session state — params and device placement save, megabytes of performed audio do not —
   so a shared patch reopens as the same empty pedal rather than as a covert audio file.

   **5l. A multisample instrument engine.** ✅ Built beside the break-slicing Sampler, whose trigger,
   slice and reverse contract remains untouched. Multisampler takes pitch, gate and velocity, chooses a
   key-and-velocity zone on the gate edge, and keeps that recording latched while pitch remains bendable.
   Root keys, source sample rates and normalized sustain-loop points turn recordings into one playable
   instrument; overlapping zones choose the nearest root deterministically.

   Zone maps are compact numeric metadata in `PatchModule.data`, so they survive encoding and sharing.
   PCM remains in `sample0`, `sample1`, … session data slots, where large audio buffers already belong;
   a patch never silently grows by megabytes. The module is explicitly polyphonic, which makes a chord
   one MIDI-to-Multisampler cable rather than a bank of manually duplicated samplers.

   The stacked editor completes the human half. Key Atlas accepts a multi-file picker or drop, recognises
   note names, MIDI numbers and dynamic/velocity suffixes in filenames, fills the ranges between roots,
   and turns duplicate roots into velocity layers. Its two-dimensional map uses key horizontally and
   velocity vertically; selecting a zone exposes exact root, low/high key, low/high velocity and sustain
   loop points. The rack keyboard patches pitch, gate and velocity into the instrument on its first note.

   **5m. A polyphonic Note Echo.** ✅ Built as a note transform rather than an audio delay: pitch, gate and
   velocity enter and leave, while each allocated voice owns its repeat train. Free timing covers 1–1000ms;
   tempo sync covers 1/128 through 1/2 notes. One to sixteen echoes can move by ±12 semitones per repeat,
   follow a linear 10–200% velocity slope and use a gate fraction that always leaves a real retrigger edge.

   Dry plus sixteen repeat enables are portable `PatchModule.data`. The stacked Echo Matrix faceplate draws
   them as velocity-scaled pulses, makes every active one directly muteable and still exposes all eight
   playback params. Keeping the pattern in patch data rather than UI state lets any host edit it without a
   processor change. A retrigger on an already allocated voice starts a fresh train, which is the honest
   boundary of this graph: it repeats input chords voice-for-voice, but cannot turn one note into simultaneous
   zero-delay cluster voices. That expansion belongs with the held-chord player work, not in a fake CV sum.

   **5n. A polyphonic Scale Player.** ✅ The scale half of Scales & Chords now sits in the same
   pitch/gate/velocity path as MIDI, Note Echo and Voice. It carries the thirteen Reason scale presets plus
   Chromatic, corrects each out-of-scale note to the nearest degree with a downward tie-break, or suppresses
   it in Filter mode. The scale decision is latched on the gate edge while the correction remains an offset,
   so pitch bend still moves a held note instead of being frozen out.

   Custom scales are twelve portable enable flags in `PatchModule.data`, keeping editor state out of the
   processor contract. The module runs once per rack voice, so an incoming
   chord stays polyphonic and every note is corrected independently. Generating a multi-note chord from one
   voice remains separate: it needs an event/voice expansion layer, not several pitch CVs summed together.

   Scale Map completes the editing path: twelve pitch-class keys show the preset after the selected root is
   applied, with explicit note names and correction/filter status. Clicking a key copies the visible preset
   into Custom before toggling it, so exploring a variation takes one gesture and never destroys the factory
   shape. The last enabled note cannot be removed; missing or damaged custom data falls back to Major on both
   the processor and panel instead of turning the device silently unusable.

   **5o. Variable-width voice streams.** ✅ The structural half of chord generation has landed without
   changing an existing processor. `Plan.voiceWidths` replaces the old mono/poly bit as the Graph's exact
   allocation instruction while retaining that bit as an old-plan fallback. A module can declare up to eight
   child lanes per input voice; each processor instance receives its source voice, lane and a node-local shared
   state object in the constructor, and ordinary polyphonic modules downstream inherit the wider stream
   automatically. The shared state lets an expander suppress coincident generated notes without making the
   Graph understand chords. A VCO after an expander
   therefore becomes one VCO instance per generated note, not one VCO receiving several pitch values added
   together.

   Mono modules still collapse every arriving voice before they run. Fanout is bounded at sixty-four processors
   per module — eight performed notes times five chord tones plus all three optional additions — and a second
   expander that would exceed that bound is held at its input width with a visible plan note instead of dropping
   the last players' notes. The compiler
   decides all widths and mappings at rebuild time; the audio loop remains a branch-free walk over prepared
   buffers. The next stack can now be the Chord Player itself rather than another graph redesign.

   **5p. Chord Player.** ✅ The first consumer of variable-width streams generates one to five tertian notes
   in any Scale Player key/scale, including the same portable Custom mask. Inversion chooses the lowest chord
   tone, Open spreads alternating inner voices, and Oct Down, Oct Up and Color can all add notes together. The
   full setting uses eight real lanes: five chord tones, two root octaves and the 13th colour note.

   Wrong roots take the same nearest scale note and downward tie-break as Scale Player while pitch bend remains
   live. Alter is a held control that toggles the chord third outside the scale, making the ordinary major/minor
   exchange concrete instead of pretending the manual specifies a larger hidden table. Node-local shared state
   removes coincident generated pitches across simultaneously played input roots, so two chords sharing E do
   not layer it twice. Four device patches cover a triad, seventh, open ninth and the full wide thirteenth.

   Chord Loom completes the editing path with all eight allocated lanes visible at once, including their pitch
   class and octave relative to the selected key. The header states the previewed key, scale and actual output
   count; all eight persistent controls remain ordinary routed `ParamControl`s. Alter is the exception because
   its behaviour is the point: pointer or keyboard press writes one and release, cancellation or lost focus
   writes zero, matching Reason's momentary button instead of turning it into a misleading latch.

   **5q. Mono voice collectors.** ✅ A shared controller can now declare `voiceCollector` and receive the
   independent buffers at each polyphonic inlet alongside the old summed inlet. It still runs once and writes
   mono outlets; this is observation, not another kind of voice expansion. The Graph prepares the grouped
   buffers at rebuild time and applies each inlet trim to every voice before the processor sees them, so the
   audio loop remains a walk over fixed arrays and the rear-panel contract does not acquire an exception.

   Ordinary mono modules still receive only the collapse, and old plans have no collector flag. The first
   intended consumer is the Arp: it can finally sequence the pitches a player is actually holding without
   turning a Delay, Out or other shared device into something that understands note identity.

   **5r. Held-chord Arp.** ✅ The original one-finger chord builder remains the default `Root` source, while
   `Played` reads independent Pitch, Gate and Velocity voices through the collector boundary and emits one
   monophonic line. Up, Down, both turning directions, Random and Manual note-on order operate over one to
   four octaves; Hold retains the last chord, Octave Shift moves the figure ±3 octaves, and velocity either
   follows the selected input note or uses a fixed level. Two new device patches expose the played modes.

   The new Gate and Velocity ports are additive and every old cable still resolves by stable port id. The
   existing chord, direction, octave and gate parameters keep their ids and defaults, so a saved Arp remains
   the same Root figure after the module version advances. Duplicate collected pitches are emitted once, and
   all note/order/latch workspaces are fixed typed arrays rather than allocations in the audio loop.

   Arp Field completes the editor with sixteen visible configuration steps and all original routed controls. Root
   mode shows the exact semitone intervals the chosen chord and direction will produce. Played mode shows the
   collector lanes and octave walk without inventing live pitch telemetry the host has not received; the legend
   keeps Hold and the played/fixed velocity policy visible. Random uses an explicitly representative unordered
   permutation rather than pretending a display-only RNG can predict the audio processor's seeded state.

   **5s. Arp rhythm engine.** ✅ External Clock remains the default, preserving the original Driftbox/Reason →
   ReBirth one-finger patch exactly, while appended timing controls add straight, dotted and triplet rack-tempo divisions
   and a 0.1–250 Hz free clock. A portable sixteen-value pattern mutes selected pulses without advancing the note
   cycle, so the next enabled pulse plays the next figure note; its all-enabled default is therefore silent in the compatibility sense as well as musically familiar.
   Pattern length is an ordinary routed parameter from one to sixteen steps.

   Arp Field turns the existing sixteen-position preview into the pattern editor. Enabled steps retain the exact
   Root interval or representative Played lane; muted steps say `rest`, inactive positions beyond Pattern Steps
   are disabled, and every button exposes its state to keyboard and assistive-technology users. Together with the
   additive Played source, this makes Rack mode's Arp a strict superset of OG Driftbox rather than a fork of it.

   **5t. Arp note insertion.** ✅ The RPG-style Insert control is an ordinary routed parameter: `Low` and `Hi`
   alternate the actual pitch extreme with the selected direction, while `3-1` and `4-2` walk forward and then
   back through that direction. Rhythm rests do not consume an inserted note. Arp Field previews the reshaped Root
   figure exactly and labels Played anchors as the lowest or highest held note without pretending it knows which
   collector lane currently owns that pitch. `Off` remains the default, preserving every older figure.

   **5u. Arp single-note repeat.** ✅ `Single Note Repeat` can be switched off so a one-note figure sounds
   once and waits for a new note or Reset, while figures containing a chord continue to run. The control is routed
   and visible on Arp Field. It defaults to `On`, which keeps the OG Driftbox retrigger behavior unchanged.

   **5v. Arp shuffle.** ✅ The routed `Shuffle` switch reads the rack transport's shared 0–1 shuffle amount,
   supplied by a retained Groovebox song's master swing. It delays sixteenth-note positions between eighths
   as long/short pairs, leaves eighth and triplet grids intact, and defaults to `Off`. Hosts that do not supply
   a global value remain straight, so neither older patches nor the original External-clock path moves.

   **5w. Arp gate endpoints.** ✅ Gate Length now spans the full RPG range. Zero emits no Gate while leaving
   the short Trig output usable; Tie is legato from the opening note rather than waiting for one interval to be
   measured. Pattern rests, Reset, timing changes and released Played chords still close a tie. The default and
   every previously valid saved value are unchanged.

   **5x. Arp converter bypass.** ✅ The routed `Arpeggiator` switch defaults to `On`; `Off` stops the figure
   and mirrors monophonic note control without waiting for a clock. Root passes its ordinary Pitch, Gate and
   Velocity inputs. Played uses last-note priority across collector voices and falls back to the previous held
   key when the newest is released. Trig marks each selected-note change, while Hold, pattern, direction,
   insertion and shift are bypassed. Played/Fixed velocity policy remains in the MIDI-CV path, and its default
   still mirrors performed velocity. This matches RPG-8's monophonic role without changing OG Driftbox's enabled default.

   **5y. Inlet presence contract.** ✅ A compiled node now carries one immutable cable-presence bit beside
   each flattened processor inlet. This is deliberately structural rather than a test for non-zero samples:
   a cable from a placeholder or bypassed source remains plugged in while it carries silence. Processors can
   therefore implement normalled and arming jacks without confusing “unplugged” with “currently low”. Plans
   from older builds fall back to their non-zero buffer indices, so the audio ABI remains backwards compatible.

   **5z. Start of Arpeggio.** ✅ The appended `Start` inlet uses that presence bit for the RPG rear-panel
   contract: unplugged is the old immediate-start behavior, while a patched-low jack arms the device and emits
   no arpeggio until a rising trigger restarts the note walk, insert phase and rhythm pattern. The appended
   `Start` outlet opens on the first note and every complete figure return. It copies that opening note's Gate
   Length rather than emitting the ordinary 1 ms Trig, including closed and Tie. Both port ids are additive,
   and Arpeggiator Off remains an ungated MIDI-to-CV converter.

   **5aa. Arp rear CV modulation.** ✅ Four appended inlets merge with the routed panel controls without
   moving any old port id. Gate Length and Velocity add normalized bipolar offsets and clamp at their endpoints.
   Octave Shift adds in octave units before quantization. Rate follows the same exponential convention as Clock
   and LFO (`+1` doubles Free rate); it is inert in External and Tempo modes. Velocity modulation is sampled for
   each generated note, while converter mode applies it continuously to Played or Fixed velocity policy.

   **5ab. MIDI performance CV.** ✅ MIDI now publishes Pitch Bend, Aftertouch, Expression, Breath and Sustain
   beside its existing Mod outlet. The host decodes 14-bit bend to an exact bipolar −1…+1 signal, channel or
   poly pressure to shared Aftertouch, CC 2/11 to normalized continuous CV and CC 64 to a thresholded gate.
   Hidden host-written params keep performance out of the saved patch and append after every existing slot.

   **5ac. Arp performance passthrough.** ✅ Six appended input/output pairs carry Mod, Pitch Bend, Aftertouch,
   Expression, Breath and Sustain around the note engine. The first five remain transparent when the figure is
   armed and waiting or the Arpeggiator is Off. A polyphonic MIDI source repeats global controllers per voice;
   the mono collector deliberately takes lane one rather than summing those copies into an inflated CV.

   **5ad. Outlet presence contract.** ✅ Compiled nodes now carry immutable cable-presence bits for outputs
   as well as inputs. The compiler counts the winning cable into a live inlet and preserves a cable whose
   destination is a placeholder, but ignores a superseded connection. Older plans default to unpatched because
   outlet buffers were always allocated and cannot reveal fanout. The process loop only passes the prepared bits.

   **5ae. Sustain normal.** ✅ An incoming Sustain pedal now drives Hold while Sustain Out is unpatched. Patching
   that output breaks the internal link without disabling the explicit Hold button, and emits a gate whose level
   follows Fixed Velocity plus CV; Played/Manual mode uses RPG's 100/127 pedal default. This is topology, not a
   sample heuristic, so a patched-low or placeholder cable still selects the output behavior.

   **5af. Combined Gate / Velocity.** ✅ RPG's main Gate CV encodes velocity in the gate amplitude. Arp now
   appends that exact product as `Gate / Velocity`: rests and Gate Length close it, while every high sample has
   the current note velocity in figure and converter modes. Binary `Gate` and independent `Velocity` stay in
   place, so Reason-compatible cabling is available without giving up Driftbox's more composable split signals.

Steps 1 to 3 are small — that is the part that was already feasible on 1999 hardware and is
close to free now. Step 4 is where the months are. Reason's budget went into faceplates and
cables, not filters, and ours will too.
