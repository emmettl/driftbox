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

The two stereo devices have landed: a **Ping-Pong Delay** whose wet repeats alternate across a stereo
outlet, and a **Stereo Imager** with two-band mid/side width. What remains is the Groovebox source's
four pairs becoming four stereo jacks rather than eight mono ones. That change waits on a port
rename, which would move existing cables — adding a channel to a port is safe, renaming one is not.

### 2. ~~Nothing records a parameter move~~ — landed

The rack could *drive* a parameter from four places — a knob, a Combinator routing, a learned CC,
a cable into a param-shaped inlet — and remembered none of them. Reason's sequencer records any
parameter of any device onto a lane against the timeline, and that is most of what makes it a
DAW rather than an instrument.

It now does. `Patch.automation` is a lane per parameter, recorded against the arrangement and played back
through the frame the ABI grew. Four decisions worth keeping:

- **Lanes live on the Patch, not on the retained Song.** Reusing the engine's timeline looks like the
  smaller change and is not: that timeline belongs to a `Song`, and a rack-native patch has none — so
  automation would have been absent from exactly the patches somebody built out of modules.
- **A target is `[module, param]`**, the tuple a cable and a Combinator routing already use, so a lane
  naming a module the file does not contain is caught by the rule cables follow and gets the codec's
  endpoint parser for free.
- **Positions are musical; frames are only how they are played.** A lane records at a sixteenth from the
  top, so it survives a tempo change, a loop and being shared. The conversion to a frame happens at the
  last possible moment, in the scheduler.
- **Playback never goes through the patch.** It is sent straight to the audio thread, the same road a MIDI
  note takes and for the same reason: a lane played back through `setParam` would record itself, one point
  per tick, for ever. The knob still follows it — the host re-reads the same lane at the same playhead for
  the screen, so the panel and the sound are one number computed twice rather than two channels that can
  disagree. See `app/src/rack/live.ts`.

Two halves, and only one of them is in the parity ledger:

- **The lane — landed for rack parameters.** The groovebox's own versioned timeline
  (`engine/automation.ts`) is still what records *its* controls; `packages/rack/src/automation.ts` is the
  rack's, for module parameters. REBIRTH-PARITY.md's row about the shared recorder is about the first.
- **The clock to record against — landed.** `param` messages take an optional `frame`, so a change
  starts at the sample asked for rather than at the next block boundary, up to 2.9ms out. It is the one
  growth `RACK.md` said to resist and the one that earned it, and it is a field on a message that
  already existed rather than a sixth kind. `Rack.scheduleParam` and `Rack.frameFor` are the host half;
  a schedule made before `start()` travels in `processorOptions`, because no port message reaches an
  offline render. **Playback is therefore unblocked and recording is not yet wired** — what is left is
  the interchange work above, not anything architectural.

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
| Duplicate a device | Copy, paste, duplicate, with settings | **Landed** | Copies params and pattern data, lands beside the original, arrives unpatched |
| Auto-routing | A new device connects to the next mixer channel | **Landed** | A new *source* arrives with its own Out wired, the way `insertChunk` already gave a chunk one. Gated on the def declaring an outlet named `out`, so the Noise and the Groovebox — which have no single primary output — still arrive unpatched |
| CV trim | A trim pot on every CV input | **Landed** | A saved bipolar −1…+1 pot beside every rear inlet. Driftbox has one signal type for audio and CV, so audio inlets get the same control: a strict superset rather than a guessed distinction. **The graph pays only for pots that are doing something** — an inlet with nothing patched to it, or with its pot at unity, keeps the direct buffer path, because a trimmed inlet costs a buffer of its own and a multiply per sample. Turning one is a message, not a rebuild; engaging one and returning it to unity are the two ends that change the plan's shape |
| Bypass | On / Bypass / Off on every effect | **Landed** | A flag on the module; the compiler drops its node and passes its first inlet through |
| Device patches | A browser and a factory bank per device | **Landed** | A browser in the corner of every faceplate — name, step, list, save, delete — rendered by the Chassis rather than by each panel, so the eleven hand-built faceplates and the generic fallback got one without any UI work. `DEVICE_PATCHES` is the factory bank; Init is **derived from the def**, so every device has a bank and a way back to its defaults even if nobody wrote it one. Which patch you are on is derived from the knobs, never remembered, so the name cannot start lying the moment you turn something. Knobs only — a device patch is a *sound*, and `data` is a pattern, which belongs to the song. Applying one is a single non-structural edit and therefore one undo and no click |
| Multi-select | Rubber-band a group of devices | **Landed** | Click, shift-click for a span, platform modifier to toggle one, or drag across inert faceplate surface to rubber-band. Shift/Cmd/Ctrl-drag adds to the group. Removing a group is one structural edit and therefore one undo. |
| Undo | Full history | **Landed** | `history.ts` — sixty-four steps, a drag is one of them |

None of these is architectural. All of them are the difference between a rack you demonstrate
and a rack you work in for an afternoon.

## Missing devices

Ordered by return, not by how big Reason's version was.

- **~~EQ — there is nothing at all.~~ Landed.** Low shelf, sweepable mid with a Q, high shelf,
  stereo in and out. What it replaced was an approximation — split an SVF's four outlets into a
  Mixer with signed levels — that costs six modules, a page of cables and no say in where the
  bands sit. Stereo because of *where* an EQ sits rather than because the curve differs per side:
  it goes at the end of a chain, so a mono one would have folded away the width that stereo
  cables had just made carryable. Still no analyser, which is a different feature and wants the
  Meter's telemetry path rather than a module of its own.
- **~~A complete voice.~~ Landed.** `Voice` is two band-limited oscillators with a detune, a ladder
  filter with key tracking, an amplifier envelope and a filter envelope — one module that makes a note
  from a gate with nothing else patched. `poly: true`, which is the point: a chord now costs one cable
  where it used to cost eight copies of a five-module patch kept identical by hand.

  Not a chunk, deliberately. A chunk is a recipe and the right shape for a *sound* somebody should be
  able to take apart; five modules per voice is still five modules per voice, so it would not have bought
  the thing above. The patching cost had to disappear rather than be automated.

  The oscillator moved to `dsp/osc.ts` and is shared with the VCO through `deps` rather than copied —
  `Random` was already shared between the LFO and the Noise the same way. A pasted copy would have gone
  on passing `vco.test.ts` while drifting from the numbers it measures.
- **~~A stereo imager and a ping-pong delay.~~ Landed.** The Imager has independent low and high
  mid/side width around a crossover. Ping-Pong is a separate mono-in, stereo-out module whose repeats
  cross from left to right; the original Delay stays untouched, so every saved patch keeps its sound.
- **~~A phaser.~~ Landed.** Six first-order allpass stages per channel, swept by a quadrature stereo
  LFO or an octave-scaled cable at the Sweep inlet. The dry/wet control is part of the effect rather
  than convenience: an allpass alone has flat magnitude, and its moving notches only exist when the
  phase-shifted signal meets dry audio.
- **~~Note effects.~~ Partly landed.** Something sits between a note source and a voice now: `Arp`
  takes one held note, builds a chord under it — eight shapes, one to four octaves — and walks it up,
  down, up-down, down-up or at random against a clock. That is the RPG-8 mode people actually leave
  switched on, and it is the half of this gap that suits a rack whose appeal is one held note doing a
  lot. `Quantizer` remains a different thing: CV scale-lock at audio rate, which cannot add a note that
  was not played.

  **It builds its chord rather than listening to one, and the reason is structural.** A chord lives in a
  *polyphonic* pitch signal, one note per voice, and a mono module reading a polyphonic inlet sees it
  **summed** — `poly.test.ts` calls that the collapse, and it is the right rule for a Delay fed by four
  voices. So a mono arpeggiator patched to a held chord would read the sum of the notes, which is not a
  note. A *held-chord* arpeggiator needs the compiler and the Graph to hand a mono module the per-voice
  buffers, and that is the work this gap still names.

  **Note Echo has landed** as a polyphonic pitch/gate/velocity transform: free or tempo-synced spacing,
  one to sixteen repeats, semitone movement, a linear velocity slope, gate length, dry mute and a portable
  seventeen-step enable pattern. Echo Matrix draws that pattern as velocity-scaled pulses, keeps muted
  echoes on the timeline, and leaves all eight playback controls on the same faceplate. Each input voice
  repeats independently, so ordinary chords echo together.
  The fixed-voice CV graph still cannot express Reason's zero-length cluster trick, where one input note
  becomes several simultaneous output voices; that remains part of the same structural expansion as a
  held-chord arpeggiator.

  **The scale half of Scales & Chords has landed** as `Scale Player`. It is deliberately note-shaped rather
  than a second `Quantizer`: key and scale are sampled at each gate edge, out-of-scale notes move to the
  nearest valid pitch with downward tie-breaking, or Filter mode silences them. All thirteen Reason presets,
  Chromatic and a portable twelve-note Custom mask are present. Pitch bend remains live after the decision,
  and each incoming chord voice is corrected independently. The Scale Map faceplate makes the selected notes
  visible in the current key; clicking any note copies a preset into Custom and edits it in place.

  The voice-cardinality foundation has now landed: buffers carry exact widths, expanders get bounded child
  lanes for each source voice, and ordinary modules downstream inherit the wider stream. The eight-lane maximum
  covers five tertian notes plus octave-up, octave-down and colour together. Mono collapse keeps
  its old meaning, and old plans still run through the original mono/poly fallback.

  **Chord Player has landed on that foundation.** It scale-corrects each input root, builds one to five tertian
  tones, supports inversion and open voicing, and can add both root octaves and a 9/11/13 colour note together.
  Alter toggles the third outside the current scale while held. The expanded voices keep pitch bend and velocity,
  and coincident notes across simultaneous input chords are emitted once rather than layered. Chord Loom shows
  every allocated voice and gives Alter its actual momentary pointer/keyboard interaction.
- **~~A multisample instrument.~~ Landed.** `Multisampler` sits beside the unchanged
  break-slicing `Sampler`: it maps session-loaded recordings by key and velocity, respects root key and
  source sample rate, sustains between per-zone loop points, and instantiates per MIDI voice. Zone maps
  travel as compact patch metadata while PCM remains session-only. Its Key Atlas faceplate loads a batch,
  infers roots and dynamics from names such as `Piano_C3_pp.wav`, fills the keyboard ranges, and exposes
  exact root, key, velocity and loop editing. The dock keyboard wires pitch, gate and velocity to it on
  the first note, so adding the device and dropping recordings is enough to play.
- **~~Multi-mode distortion.~~ Landed.** `Distortion` keeps stereo intact and selects four genuinely
  different curves — tube sigmoid, tape arctangent, exponential fuzz, and hard-clipped bit reduction —
  before a shared tone stage and output level. The original normalised `Drive` stays the predictable
  one-curve tool and every patch using it keeps its sound.
- **~~A limiter.~~ Landed.** The Graph now has a fixed terminal limiter as its safety invariant, and the
  patch has the mastering device that is a creative decision: stereo-linked 5 ms look-ahead, input gain,
  a ceiling, release, and gain reduction as an outlet. The final comparison guarantees the stated ceiling;
  the terminal still protects patches that do not use the device.
- **~~Audio input~~ — landed.** `getUserMedia()` capture enters the worklet on a fifth host bus
  and the Audio Input source makes it patchable. The app enumerates `audioinput` devices after
  permission, switches them by exact `deviceId`, disables speech processing, and stops every
  capture track when the input is disabled or its last module is removed. Device selection
  remains runtime state rather than machine-specific data in a shared patch.

### The guitar-chain ledger

The `Guitar Pedalboard` factory is the concrete consumer of these gaps. It now patches Audio Input →
Tuner → high-pass SVF → Drive → Amp / Cab → EQ → Compressor, with a visible dry/delay Mixer, Reverb,
Loop Station and Out.
**Distortion is present** through `Drive`, while the new multi-mode Distortion adds
four more characters and its own post-curve tone stage without changing the factory's existing
sound.

The **amp/cabinet stage and tuner have landed and are wired into that factory**. The cabinet's driven
preamp, three-band tone stack and speaker rolloffs remove direct-interface fizz without pretending to be
an unavailable convolution IR. The chromatic tuner uses normalised autocorrelation rather than a crossing
count, reports frequency and confidence over the Meter telemetry path, and can mute Thru for silent tuning.
The **stereo Loop Station completes the enforced guitar chain**: thirty seconds of preallocated capture,
record/play/overdub/stop, feedback, dry/loop balance and a session waveform. Captured audio deliberately
does not enter the patch document; reopening a shared rack powers up an empty pedal. Its stable id, along
with the adopted cabinet and tuner ids, remains recorded in `GUITAR_PEDALBOARD_GAPS`,
and `patches.test.ts` enforces the handoff: the moment any is registered, the factory test
fails until that device is actually incorporated. Cabinet, tuner and looper all followed that path
immediately when they landed. This is deliberately stronger than a roadmap note that can go stale.

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
2. ~~Stereo cables and their first devices.~~ Landed, per port, with the stereo Imager and Ping-Pong
   Delay on top. The Groovebox's four pairs remain ordinary module work rather than an architectural
   change.
3. ~~Recorded automation.~~ Landed — the ABI carries a frame, lanes live on the patch, an export plays
   them, and the knob follows. Nothing remains.
4. ~~EQ~~, then ~~a complete voice~~. Both landed.
5. ~~The rack-wide table above.~~ Landed: duplicate, bypass, auto-routing, device patches,
   multi-select (including its rubber band), and bipolar input trim.

Update this file when one lands, the same way the capability ledger is updated. A gap list that
goes stale is worse than none, because it argues for work that is already done.
