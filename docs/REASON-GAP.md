# What Reason has that the rack does not

[REBIRTH-PARITY.md](REBIRTH-PARITY.md) measures the rack against the *groovebox* — the promise
that Reason contained ReBirth. This file measures it against the other half of the analogy:
**Reason itself.** Two different questions with two different acceptance lists, and conflating
them is how a ledger row like "song automation" comes to mean both "the groovebox can do it and
the rack cannot" and "nothing in this product can do it at all".

Everything below was checked against the tree rather than remembered, and says where. A gap that
turns out to be patchable is recorded as patchable, because "you can already build that from two
modules" is a different piece of work from "nothing here can do that".

## The three that matter

Ordered by what it costs to do them *later* rather than by how much they are wanted.

### 1. ~~Cables are mono~~ — landed

`graph.ts` used to say so plainly, and gave a reason that sounded like a cost nobody would pay:

> Full stereo cables would double every buffer and make every module answer what it means to
> filter a stereo signal.

**Neither was the price, because stereo is declared per port rather than per cable.** A port that
says nothing owns one buffer and its module sees one, exactly as before; a port that opts in owns
two consecutive buffers and occupies two slots in its processor's arrays. Twenty-seven of the
twenty-nine modules did not change at all, and no patch written before it moved a byte.

Three rules, all in `stereo.ts` and all total:

| | |
|---|---|
| stereo → stereo | both channels, in order. The point of the feature |
| mono → stereo | the one buffer feeds both channels, so a mono source is centred |
| stereo → mono | the **left** channel, and the compiler records the fold in `plan.notes` |

The last rule is Reason's — its jacks are labelled "L (Mono)" — and it is deliberately not a sum.
A sum needs a scratch buffer and a copy per folded inlet every block, and it adds 6dB to any
centred signal. The Mixer is one module away for anybody who wants it, and it is then visible in
the patch.

Two ports opted in first, and they are the pair that makes the feature audible rather than
theoretical: **Out** (both ports, so the end of the rack can take a pair at all) and **Reverb**
(a stereo tail out of a mono in, which is what a room is). The reverb's left channel is
arithmetically what it was — one FDN, two output mixing vectors, the second being the same taps
under an alternating sign — so folding it back to mono is unchanged sample for sample.

What is still to come is the rest of the adopters: a ping-pong Delay, a stereo imager, and the
Groovebox source's four pairs becoming four stereo jacks rather than eight mono ones. That last
one waits on a port rename, which would move existing cables — adding a channel to a port is
safe, renaming one is not.

### 2. Nothing records a parameter move

The rack can *drive* a parameter from four places — a knob, a Combinator routing, a learned CC,
a cable into a param-shaped inlet — and remembers none of them. Reason's sequencer records any
parameter of any device onto a lane against the timeline, and that is most of what makes it a
DAW rather than an instrument.

Two halves, and only one of them is in the parity ledger:

- **The lane.** The groovebox already has a versioned automation timeline with a recorder
  (`engine/automation.ts`). REBIRTH-PARITY.md has the row: expose the shared recorder in rack
  mode. That is interchange work.
- **The clock to record against.** `graph.ts` notes that nothing is scheduled against a frame
  yet — `param` messages ramp across the block that follows them and no further. Sample-accurate
  automation needs the message ABI to grow a frame, which is the one growth `RACK.md` says to
  resist and the one that would earn it.

### 3. ~~There is no undo~~ — landed

It was nowhere in the app, and the rack raised the stakes on it: `removeModule` deliberately
drops every cable *and* every Combinator routing that touched the module, so one click on a
wired Combinator destroyed ten minutes of patching with no way back.

`history.ts` is now that, and three decisions in it are worth keeping:

- **A stack of whole patches, not a log of inverse operations.** The usual argument for a log
  does not survive the measurement `RACK.md` already made for the URL: a forty-module patch is
  under a thousand characters, so sixty-four of them is less than one loaded break. What a log
  would cost is an inverse per action forever, and the day somebody forgets one, undo does not
  fail loudly — it restores a document that never existed.
- **Coalescing is keyed by what was edited, not by a clock.** `setParam` fires on every pointer
  move, so one drag would otherwise fill the entire history. Keying by module and param makes
  the rule pure and testable in Node; a 300 ms window would need a clock and is wrong in both
  directions — a slow deliberate drag becomes many steps and two quick edits to different knobs
  become one.
- **A restore asks the document whether the graph has to be rebuilt.** Forward edits know,
  because they know what they did; a restore does not. `needsRebuild` compares modules, cables
  and the voice count and deliberately ignores params and pattern data, both of which reach the
  audio thread as messages — so undoing a knob does not reset every oscillator's phase.

It also fixed a latent bug either side of it. The push subscription in `RackApp` skipped
structural edits, on the grounds that a rebuild re-seeds from the plan — but data is the one
thing a rebuild does not re-seed, because `pushed` beats `seeded` so a recompile cannot throw
away a loaded break. Undoing a removed Tracker would have brought it back playing the pattern it
had before the undo.

## Everything else, rack-wide

| | Reason | Here | Notes |
|---|---|---|---|
| Duplicate a device | Copy, paste, duplicate, with settings | Absent | Chunks insert *recipes*; nothing copies a module you have already tuned |
| Auto-routing | A new device connects to the next mixer channel | Chunks only | `addModule` appends an unpatched module; `insertChunk` wires a fresh Out, which is the same idea |
| CV trim | A trim pot on every CV input | Absent | Needs an Offset module inline per connection |
| Bypass | On / Bypass / Off on every effect | Terminal only | `Out` has mute and solo; no other module can be taken out of circuit |
| Device patches | A browser and a factory bank per device | Patch-level | The library saves whole racks; `PATCHES` and `CHUNKS` are whole-rack and multi-module |
| Multi-select | Rubber-band a group of devices | Absent | Reordering and removal are one module at a time |
| Undo | Full history | **Landed** | `history.ts` — sixty-four steps, a drag is one of them |

None of these is architectural. All of them are the difference between a rack you demonstrate
and a rack you work in for an afternoon.

## Missing devices

Ordered by return, not by how big Reason's version was.

- **EQ — there is nothing at all.** No peaking band, no shelf, no analyser. Approximable by
  splitting an SVF's four outlets into a Mixer with signed levels, which is a real answer for a
  three-band tone control and not an answer for "take 2 dB out at 400 Hz". It is the most
  conspicuous absence in a rack that, as of this week, has mixer strips.
- **A complete voice.** Subtractor, Thor and Malström are each *one device* that makes a sound
  on its own. Here every voice is patched from VCO, SVF and ADSR. Polyphony landed at step 5b
  and nothing yet takes advantage of eight voices being eight *different* notes, because the
  patching cost is paid per voice-shaped patch rather than once.
- **A stereo imager and a ping-pong delay.** Both were impossible before cables carried a pair
  and are ordinary modules now. The Delay is the interesting one: making its existing ports
  stereo would change what every patch using it sounds like, so it wants a second thought about
  whether ping-pong is a mode or a module.
- **A phaser.** Chorus and flanger are patchable and `delay.ts` says so in its header — a delay
  whose time an LFO sweeps. A phaser is not: it is a chain of allpass sections and there is no
  allpass anywhere.
- **Note effects.** Nothing sits between a note source and a voice. No arpeggiator (RPG-8), no
  note echo, no scale-and-chord generator. `Quantizer` is CV scale-lock at audio rate, which is
  a different thing: it cannot add a note that was not played.
- **A multisample instrument.** `Sampler` is one buffer plus slices. No key zones, no velocity
  layers, no root key, no loop points — so a sampled instrument, as opposed to a sampled break,
  cannot be built.
- **Multi-mode distortion.** `Drive` is one waveshaper and a 5 Hz DC blocker. Scream 4's value
  was the *selector* — tube, tape, fuzz, digital — plus a tone stage, and each is a different
  curve rather than a different amount.
- **A limiter.** `Compressor` is dynamics; the ±4 clamp in the Graph is the only ceiling.
  `RACK.md` records eight voices of the Acid patch peaking at 3.93 against that clamp, which is
  the measurement that says a maximiser has somewhere to go.
- **Audio input.** No live, line or microphone capture. The Sampler takes files and generated
  breaks. Vocoding something you are saying is currently vocoding something you recorded
  elsewhere first.

## Deliberately not gaps

Worth writing down so nobody builds them twice.

- **A Spider.** Splitting is free — an outlet already feeds as many cables as you like — and
  merging is what `Mixer` is. Reason needed the device because its outputs were one-to-one.
- **A second rack.** `chunks/index.ts` argues this at length: Reason had one rack, and two here
  would mean two graphs, two transports and a document that no longer round-trips as one link.
- **Rack Extensions and VSTs.** `RACK.md` step 5c covers third-party modules: the design is
  ready for it, the ABI has changed four times in four PRs, and opening it early turns each
  change into a promise.
- **ReWire.** A protocol for getting audio out of one 2001 application and into another. A tab
  is not a host and a URL is a better answer than a transport bridge.

## The order

1. ~~Undo.~~ Landed. Cheapest, and it makes everything after it safer to try.
2. ~~Stereo cables.~~ Landed, per port. The remaining adopters — a ping-pong Delay, an imager,
   the Groovebox's four pairs — are now ordinary module work rather than an architectural change.
3. Recorded automation, once the ABI carries a frame.
4. EQ, then a complete voice — the two the picker most obviously cannot offer anybody.
5. The rack-wide table above, in whatever order the annoyance surfaces.

Update this file when one lands, the same way the capability ledger is updated. A gap list that
goes stale is worse than none, because it argues for work that is already done.
