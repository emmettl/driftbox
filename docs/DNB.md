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

**B3. On-screen keyboard.** Cheap and high value: `app/src/ui/Keys.tsx` exists, and the per-voice param path the
MIDI module already uses is exactly what it needs. It is also what makes the rack playable on a phone, where
there is no MIDI at all.

### C — the sound

**C1. Pan on the Out**, per voice. Unlocks the Reese.
**C2. Compressor.** D&B is glued together by compression; without it a chopped break and a bass fight.
**C3. Reverb.** In-worklet, so a feedback-delay network rather than the engine's convolver.
**C4. A master limiter** replacing the ±4 clamp. The clamp exists to stop a feedback patch killing the tab and
should stay as the last resort behind something musical — a loud mix currently meets a brick wall.

### D — instant DJ

**D1. A performance mode.** Big controls, no patching visible, the Kaoss pad across the master. The pad is
nearly free: `app/src/ui/KaossPad.tsx` and the engine's morphing LP/HP filter both exist, and it belongs as a
Web Audio insert after the rack's output rather than as a module — for the reason `kaoss.ts` already gives,
that *"the fun of a Kaoss pad is that the whole record ducks away and comes back, drums included"*.

**D2. It arrives playing.** The single most important item in this document. An autoplay policy means audio
needs a gesture, so the gesture has to be the first thing offered and the reward has to be immediate — a beat,
not a bleep. The sequencer page's vibes mode is the reference.

**D3. Shipped D&B patches**, in `@driftbox/rack` alongside the four that exist: a chopped break with a Reese, a
half-time roller, something with the bass doing the work. Written as patterns so they are legible in source and
compiled against the real registry in a test, like the current four.

## Not in this plan

Third-party modules — still deferred, for the reason in `docs/RACK.md`. Full stereo cables. Module
drag-to-reorder. Recording the rack's output to a file, though `engine/stems.ts` shows how.

## The risk worth naming up front

A 909-derived break is not the Amen break and the difference will be audible. If the rendered breaks turn out
not to carry the genre, the honest fallbacks are a verified CC0 pack chosen by a human, or accepting that this
is drum and bass adjacent rather than the real thing. Better to find that out in phase B with one break than in
phase D with a finished performance mode built on it.
