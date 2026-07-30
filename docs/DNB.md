# Drum and bass, and the instant-DJ problem

A plan to take the rack from something you build to something you play. Two goals, and the second one is the
harder and the more important:

1. **Drum and bass in the browser** — 170bpm, a chopped break, and a Reese bass with some weight to it.
2. **The instant-DJ feeling** — it should be fun within about four seconds of the page loading, for somebody
   who has never seen a modular and does not want to learn one.

Nothing here is built. `docs/RACK.md` is the design of what exists; this is what to do next and why.

## The reframe, which changes the order of everything

**The rack is a construction kit and this asks for an instrument.** Today it opens behind a Start button on a
monophonic bleep, and everything good about it is behind understanding what a cable does. That is the right
shape for the thing it has been so far and the wrong shape for "instant DJ" — those two want opposite things
from the same code.

This has been solved once already, in this repo, and the answer is in the sequencer's README: it *"works as a
player if that is all you want… You never have to open the grid."* On a touch device it does not even open on
the grid, because a phone "opens on the part a small screen handles worst and buries the part it handles best".

So the rack needs the same split: **arrive playing something good, with the patching underneath rather than in
front.** That is not a coat of paint at the end — it decides what gets built and in what order, because a
performance layer over a rack that cannot hold a beat is nothing.

## What drum and bass actually demands

Measured against what the rack has, not against a vibe:

| Needed | Where we are |
|---|---|
| 170bpm, bars, a half-time feel | **nothing in the rack knows what a bar is** |
| A break, chopped and re-triggered | **no sampler, and no route for audio to get in** |
| Reese bass — detuned saws phasing against each other | oscillators yes; **mono end to end**, and a Reese is a stereo sound |
| Sub bass | fine already |
| Growl — resonance into saturation | fine already: ladder, drive |
| Glue | **no compressor** |
| Space | **no reverb** — the engine's is a convolver, deliberately outside the worklet |
| Sequencing | 8 mono steps |
| Headroom | a hard ±4 clamp, which a loud mix hits constantly |

## Decisions taken

**Samples: the rack gets them, the engine does not.** `ROADMAP.md`'s "No samples anywhere" keeps meaning
exactly what it says about the drum machines — every sound synthesised from the circuit it came from. The rack
is a different instrument, and "two engines, one host" was already the framing. Both docs should say so
explicitly rather than leaving the rule looking broken.

**Breaks are synthesised on load, not shipped as audio.** This is the interesting one and it is only available
because `engine/stems.ts` already renders a song offline into AudioBuffers. So a break is written as a
*pattern* in the engine's existing ASCII notation, rendered through the 909 at 170bpm when the page loads, and
handed to the sampler to chop.

Three things fall out of that, all of them good:

- **No licence question.** The Amen break is The Winstons' and was never cleared; this repo publishes to npm
  with signed provenance naming a real person. Shipping famous breaks is that person's exposure. A break we
  synthesised is ours.
- **The URL survives.** A patch referring to `break:jungle-1` is a few bytes. Two seconds of stereo audio is
  about 700kB, which would have killed the one thing VCV Rack structurally cannot do.
- **It is historically honest.** Jungle layered 909 kicks and hats over breaks constantly. A 909-derived break
  is not the Amen and is not pretending to be.

**Loading your own file is first-class anyway**, because plenty of people will want the real thing, and because
a sampler that can only play what we shipped is a toy. A patch using a loaded sample cannot travel in a URL and
should say so plainly rather than silently sharing a broken link.

*Not* doing: picking a third-party "royalty-free" pack and vendoring it. Licences on sample packs need reading
by somebody who can be accountable for having read them, and a wrong one here is published under a real name
with an attestation attached. If a specific CC0 pack is chosen and checked, wiring it in is an afternoon.

**Stereo goes as far as a pan on the Out and no further, for now.** Cables stay mono; the Out gains a pan per
voice. Two chains hard-panned gives a Reese that actually phases, which is most of the point, and it costs no
change to any module. Full stereo cables would double every buffer and make every module answer "what does it
mean to filter a stereo signal" — worth doing later, from evidence, not now.

**A new sequencer module, reusing the engine's notation and not its machinery.** The valuable, reusable part is
`songs/notation.ts` — `X` accent, `x` normal, `.` rest, spaces for grouping — because it makes a shipped pattern
legible as a line in the source, and its own comment explains why: *"a wall of zeroes and ones is both
unreadable and unwritable"*. What does not transfer is the scheduler: the engine produces voice triggers
through Web Audio nodes on a 120ms lookahead, and the rack needs gates and CVs in a sample-rate graph. Same
data, different machine.

## The architectural through-line

The biggest gap is not the sampler. It is that **a module cannot be given bulk data.** `RackMessage` is
`plan | param`, and:

- a sampler needs audio buffers — hundreds of kilobytes of Float32;
- a real sequencer needs pattern data — 64 steps across 8 lanes is 512 values, which params cannot sanely carry
  and a faceplate could never show as 512 knobs.

One mechanism serves both, and it has to be designed before either. Roughly: a `data` message carrying a
transferable payload keyed by module id and slot, held by the Graph and handed to the processor. Two properties
it needs that params do not have:

- **Transferred, not copied.** A `Float32Array` sent to a worklet should move rather than clone, or every
  sample load costs a copy on the audio thread's doorstep.
- **Not in the patch.** Same argument as the MIDI module's hidden params: a patch stores *which* break, never
  the samples. Pattern data is the exception and does belong in the patch, so the mechanism has to allow both.

## The order

Each phase is shippable on its own, and each is useless without the one before it.

### A — foundations ✅

**A1. Transport.** ✅ Built. The `transport` message `docs/RACK.md` reserved and never sent.

One choice is worth recording. Teaching every module about tempo would have widened the `Processor` contract
eighteen times; instead **one Transport module reads it and everything else syncs by patching to its outlets**,
which is how a real rack does it. So the contract widened once — a fifth argument to `process`, which every
existing module ignores because this is JavaScript — and will not need to again.

A useful consequence: Clock and Seq did **not** need the synced modes this plan asked for. Patch `sixteenth`
into a Seq's clock and it is a sixteenth.

Outlets are `run`, `bar`, `beat`, `quarter`, `eighth`, `sixteenth` — all of them rather than a division knob, for
the reason the SVF gives about its four responses.

Three things came out of building it, all found by tests:

- **Position is accumulated per block, not derived from an absolute frame count.** Deriving it makes a mid-bar
  tempo change jump to wherever the new arithmetic lands, which is a stumble. Accumulating carries on from
  where the music was.
- **`beatsPerBlock` is zero while stopped.** Getting that wrong was a real bug: a module interpolating position
  across the block crept forward and snapped back every block, so a *stopped* bar ramp wobbled instead of
  holding still.
- **It fires the downbeat when play is pressed**, the same decision the Clock makes by arming itself at
  construction. A transport silent until a whole beat has gone by reads as broken, and at 60bpm that is a
  second of nothing.

Tempo lives in the patch, like the engine's `Song.bpm`, because a drum-and-bass patch *is* 174 and one shared at
the wrong tempo is not the patch that was shared. Absent means 120, so a patch written before this round-trips
unchanged. Whether it is *running* is session state and is not in the patch.

And **the gesture that starts audio now starts the music** — D2 in miniature, and the cheapest possible down
payment on it.

**A2. Module data.** ✅ Built. A `data` message, plus `PatchModule.data` for the kind that belongs in the
document.

The two-layer split turned out to be the whole design. Data pushed with `Rack.setData` **survives a rebuild**,
because a sample is not part of the patch and every structural edit recompiles — losing a break somebody loaded
because they moved a cable would be indefensible. Data from the patch is replaced every build, because there it
*is* the document. A push wins where both have a slot.

Transferred rather than copied: `postMessage`'s second argument moves the buffer, so a two-second stereo break
costs no main-thread copying. The consequence is that the array is unusable on the host afterwards, which is why
`setData` takes a `Float32Array` rather than an `AudioBuffer` it could have quietly copied out of.

Change detection is identity — read it every block, and a different array means new data. Deliberately that
crude, so nothing has to subscribe to anything.

Proved with a test-only probe module rather than a real consumer, the way `poly.test.ts` does. The sampler and
the sequencer are phase B, and both were waiting on exactly this.

### B — the instruments

**B1. Sampler.** ✅ Built, with the breaks to feed it.

Slicing is equal division rather than transient detection, which sounds like a shortcut and is how people
actually chop: sixteen slices on a one-bar break is one slice per sixteenth. That only lines up because the break
is **rendered at the patch's tempo**, so the arithmetic is exact rather than approximately right — and it is why
loading a break adopts its tempo instead of leaving the chop to drift.

The slice is latched at the trigger and read nowhere else. Following the knob per sample would make a slice
change mid-play jump the playhead into the middle of a different drum, which is a glitch rather than an edit.
Selection wraps rather than clamps, so a random source sweeping past the end comes back round instead of
hammering the last slice.

It is the first module to take bulk data, and change detection is exactly what `types.ts` describes: read the
buffer every block, and a different array means a different break.

**The breaks are synthesised, and they work.** Three of them — Jungle, Chopper, Roller — written as four lines of
the engine's ASCII notation each and rendered through the 909 on load. Two bars are rendered and the second is
kept, so the first bar's tails have decayed into it and the loop does not click where it wraps. Measured in a
browser: all exactly 1.379s, normalised to 0.9 peak, and their density orders the way the patterns say it should.

**What is still unverified is whether they carry the genre**, which is the risk this document opens with and is
not something measurement can answer. They are 909-derived and not the Amen. That needs ears.

One consequence of transferring rather than copying, worth knowing: `setData` empties the array on the host side,
so loading one break into two samplers needs a copy per sampler. The alternative was copying on the audio
thread's doorstep, which is what transferring exists to avoid.

**B2. Tracker.** ✅ Built, as `tracker` — four lanes of up to 64 steps, pattern in `PatchModule.data`.

This was planned as "lanes emit gates; one lane emits pitch" and built differently, which is worth recording
because the difference is the whole module. **Every lane is values, not switches.** A step is a number: zero is
a rest, anything else opens the gate *and* comes out as a CV. One decision, and it means the same lane can drive
drums (any non-zero), a bassline (semitones) or a chopped break (slice indices) — which in most racks is three
modules. A dedicated pitch lane would have made the other three second-class.

Two details that follow from it:

- **The CV holds its last non-zero value across rests.** A rest is a gap in the rhythm, not a lurch to zero in
  the pitch. Dropping to zero would end every phrase on the same wrong note and lurch anything tracking the CV.
- **A per-lane `Unit` switch.** Semitones by default, because that is what every other pitch-shaped signal in
  the rack is; `Unit` divides by 16 instead — a bar of sixteenths, and the Sampler's default slice count — so a
  lane written 0-15 sweeps exactly one pass through a chopped break. Both wirings are then direct, with no
  scaler module in between, which is the point.

The existing 8-step `seq` is **kept** rather than replaced. Rewriting its param shape would have broken every
patch already shared as a URL, and "a short one with knobs" and "a long one with a pattern" are different
instruments to reach for.

One trap, and the contract suite caught it: the first version read module-scope `LANES`/`UNIT` constants inside
`process()`. A processor is serialised with `Class.toString()` into an `AudioWorkletGlobalScope` where that scope
does not exist, so it would have thrown a `ReferenceError` the first time a patch with a tracker loaded. The fix
derives the lane count from `outlets.length / 3`, which cannot disagree with the def either.

**B3. On-screen keyboard.** ✅ Built, as `RackKeys`. Cheap as predicted — no new message, no new module, because
the MIDI module's params already *are* the note, the gate and the velocity, and the host already writes them per
voice.

It did **not** reuse `app/src/ui/Keys.tsx`, which is coupled to the engine's bass voices and to `useBox`. What it
reuses is the thing worth reusing: `Keyboard` from `midi.ts`, where last-note priority, legato and voice
allocation live. Those are the difference between a keyboard and a row of buttons, and a second implementation
would have drifted from the first.

`Keyboard` was per-channel state hidden inside `openMidi`, so it came out as a **`KeyboardBank` shared by both**.
Two banks would each have believed they owned all the voices: an on-screen note could be silently stolen by one
from hardware, and a release would hand back a voice the other still held. Sharing also means the on-screen keys
light up for notes played on a controller.

The layout is a C-rooted piano, and that is the *opposite* of the conclusion `ui/Keys.tsx` reaches, for the same
reason. Colours follow pitch: the 303's note 0 is an A, so a C-shaped layout there put C, F and G on black keys.
The rack's 0 V is MIDI 36, a **C2**, so here a piano starting at C is exactly right.

Three things were wrong and driving the page found all three, none of which any test would have:

- **The keys were below the fold**, so nothing could reach them. Now stuck to the bottom of the viewport, the
  counterpart to the sticky header. The CSS comment claimed "a fixed bar" before the CSS actually did it.
- **The keys were nearly square.** Drawn into a `0 0 width 1` viewBox stretched with `preserveAspectRatio: none`,
  a white key came out 63px wide and 92px tall, which makes the black keys look fat and turns rounded corners
  into ovals. The viewBox now carries a real aspect ratio and letterboxes instead.
- **Stop made the keyboard completely dead.** Stop suspends the whole AudioContext — the honest fix for a Clock
  that ignores `running` — and holding a key with the transport stopped drew a flat line on the scope. A
  sequencer being stopped is exactly when you want to play by hand, so a note now resumes the context and
  **leaves the transport stopped**. Pressing a key from cold starts the rack too, and re-strikes the note once
  the audio thread exists, because otherwise the first press of a session is swallowed.

Pressing a key with no MIDI module patches one in, the same way loading a break ensures a Sampler — and it
**takes over** the pitch and gate inlets it lands on, because one cable per inlet is the rule everywhere and two
sources into a pitch inlet would sum into a wrong note.

### C — the sound ✅

**C1. Pan on the Out.** ✅ Built. Cables stay mono, exactly as argued above; what changed is that `Plan.outputs`
carries a **param slot** alongside each terminal buffer, and the Graph reads that buffer when it sums. So pan is
a property of the mix rather than of the module, the law lives in one place, and a knob turn needs no recompile.

The law is **balance, not equal-power**, and that is the load-bearing choice. Equal-power puts centre at 0.707 on
both channels, which would have made every patch shared before this quietly 3dB quieter — for a format whose
selling point is that a patch travels in a URL, that is not cosmetic. Balance leaves centre at unity, so the
default is a genuine no-op.

The `Thru` outlet stays mono and pre-pan. A patch cable in this rack carries one signal, and a Thru that quietly
carried only the left half would be a trap.

**C2. Compressor.** ✅ Built. The sidechain inlet is the point: fed from a kick it is the duck that makes a
bassline breathe, and left unpatched it reads its own input and is an ordinary compressor. Peak detection rather
than RMS, because the thing being tamed is a drum transient and an RMS window smooth enough to be pleasant is
long enough to miss it. Gain reduction comes out as a signal, so the compressor's own ducking can drive
something else.

**C3. Reverb.** ✅ Built, as an FDN — a convolver needs Web Audio nodes, which an `AudioWorkletGlobalScope` does
not have. **Eight lines**, not four, and that was measured: at four lines a fifth of a second into the tail only
12% of samples were meaningfully non-zero, which is a rattle rather than a room. Householder mixing because it
is `subtract a share of the sum` at any size and is unitary, so the loop cannot gain energy whatever the delay
lengths are. Lengths are prime numbers of samples, nudged odd after rate scaling, so nothing can share a factor
and ring at one period.

**C4. A master limiter.** ✅ Built, replacing the bare ±4 clamp — the clamp is still behind it, because it is
what keeps a feedback patch from killing the tab and no amount of gain riding substitutes for that. Linked
across the pair so a peak on one side does not shift the image; downward gain immediate and upward eased, which
is what makes the attack instant without a lookahead and stops the release pumping.

Seven existing tests asserted master levels of 1, 1.5 and 2, which a limiter at 0.95 can no longer produce.
Those were updated by **scaling the probe signals** rather than by baking 0.95 into them: their subject is voice
routing, and a sum that trips the limiter is measuring the limiter. One of them — the noise-seeding test —
had been reduced to a ratio of 1.18 by limiting, and would have gone on "passing" as a seeding test long after
it stopped being one.

Two things phase C broke and fixed. **A hand-built faceplate does not follow its def**: `pan` was added to
`OUT_MODULE` and simply did not appear, because `faceplates/Out.tsx` names its params rather than walking them.
`faceplates.test.ts` now renders every hand-built faceplate and checks that each non-hidden param its module
declares is actually asked for — verified by reverting the fix and watching it fail. And **B3's sticky keyboard
painted over the bottom of the rack**: fixed with `scroll-padding-bottom` on the document and matching padding
on the stage, so the last module can be scrolled — and tab-focused — clear of the keys.

### D — instant DJ ✅

**D1. A performance mode.** ✅ Built. A `Perform` toggle swaps the rack for the pad; the keyboard, the transport
and the audio graph are the same ones, and what changes is which of them are big enough to use with your hands.

The pad was nearly free, as predicted — but **not by reusing `ui/KaossPad.tsx`**, which is welded to the
sequencer's store, its scene list and its visualiser. What is reusable is the engine's `Kaoss` class, unchanged:
a context in, an input and an output gain out. `rack/PerformPad.tsx` is a second surface over the same audio
rather than a shared component pretending two pages are one.

It is an insert after the rack's output, which here means after the phase C limiter — the same order the engine
uses, and for the same reason: the limiter should not be reacting to a signal the filter is about to throw away.

**D2. It arrives playing.** ✅ Built, and the important half was **not** making it play. It was deciding who
gets it: `openingPatch` now returns whether this is a *fresh* arrival, and only a visitor with nothing of their
own is given a demo. A shared link or a saved session is somebody's work, and replacing it because that makes a
better first impression would be the worst thing this page could do.

For a fresh arrival the starter patch is now `Cut Up` rather than `Acid` — a beat, not a bleep — and the one
gesture that starts audio also renders the break into it, because a Sampler with no data is silent. Measured
end to end: from the click to a playing break is about 2.6 seconds, and the level arrives at roughly double
what the old acid starter produced.

**D3. Shipped D&B patches.** ✅ Built: `Cut Up`, `Ducked` and `Wobbler`.

They are **named apart from the breaks** deliberately. The breaks are already called Jungle, Chopper and Roller,
and the two pickers sit next to each other — a patch called Chopper that loads a break called Chopper reads as
one thing with two names until it very much does not. Found by driving the page and reading "Chopper" back
without being able to tell which one it was.

Two things they demonstrate that nothing else does:

- **The Tracker drives the Sampler's slice with no scaler in between.** Lane 1 in `Unit` mode divides by 16 and
  the Sampler multiplies by its slice count of 16, so a lane value *is* a slice number. That is what the Unit
  switch was added for. One wrinkle: a lane value of zero is a rest, so slice 0 cannot be written — the Sampler
  wraps, so 16 means slice 0, which is why those lanes count 1 to 16.
- **The sidechain.** `Ducked`'s Compressor takes its key from the Sampler rather than from its own input, so
  every hit of the break pushes the bass down. One cable, and it is the pump the genre is built on.

A preset can now name the break it was written around (`needsBreak`). The break itself cannot live in
`@driftbox/rack` — a rendered bar is about 700kB against a patch's few hundred bytes — so the preset names one
and the host resolves it; that package deliberately does not know what the string means.

## Not in this plan

Third-party modules — still deferred, for the reason in `docs/RACK.md`. Full stereo cables. Module
drag-to-reorder.

**Recording the rack's output to a file** was on this list and is now built, as `renderPatch` — offline
rather than a tap on the live output. That reproduces the *patch*: exact, faster than real time, and the
same thing anybody opening the shared link hears. A performance is not captured, which is the honest cost;
a patch is the artefact this rack makes and a take is not, yet.

It also found a real bug in the rack's own message path. A port message is delivered on the audio thread,
and an `OfflineAudioContext` does not run that thread until `startRendering` — so posting a plan and
rendering immediately is a race, and it loses **silently**: the file comes out exactly the right length and
completely empty. Five consecutive exports were silent from code that had produced audio minutes before.
The fix is `processorOptions`, which is structured-cloned into the processor's constructor synchronously
when the node is built, so there is no thread and no ordering to get wrong. The plan, the transport and any
bulk data all take that route now, and the live path is a little safer for it.

## The risk worth naming up front

A 909-derived break is not the Amen break and the difference will be audible. If the rendered breaks turn out
not to carry the genre, the honest fallbacks are a verified CC0 pack chosen by a human, or accepting that this
is drum and bass adjacent rather than the real thing. Better to find that out in phase B with one break than in
phase D with a finished performance mode built on it.
