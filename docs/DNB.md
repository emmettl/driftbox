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

### A — foundations

**A1. Transport.** Tempo, bar and beat position, play/stop, all sample-accurate off `currentFrame`. The
`transport` message that `docs/RACK.md` reserved and never sent. Clock and Seq gain synced modes so a division
means a sixteenth rather than a number of Hz. Everything rhythmic depends on this and nothing rhythmic is
possible without it.

**A2. Module data.** The mechanism above. Sampler and sequencer both wait on it.

### B — the instruments

**B1. Sampler.** The genre-defining module, and slicing is the part that matters: divide a buffer into N slices
and trigger by index, because that is what chopping a break *is*. Plus playback rate on a V/Oct inlet, reverse,
loop points, and a start-offset CV. A break you can only loop is a drum loop; a break you can retrigger by
slice is jungle.

**B2. Sequencer.** Multi-lane, 16 to 64 steps, transport-locked, patterns written in the engine's notation.
Lanes emit gates; one lane emits pitch. This is what drives the sampler's slice index, which is where the
breakbeat mangling comes from.

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
