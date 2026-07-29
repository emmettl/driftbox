# Driftbox — state and roadmap

Where this is, what is deliberate, and what to do next. Read this before changing
anything in `src/engine/`.

## Where it is

**Working end to end.** Two drum machines, two 303s, a step sequencer with an arrangement,
a per-voice channel strip, two send effects, an oscilloscope and a chillwave visualiser
with a performance mode. CI is green; there are 240 unit tests.

| | |
|---|---|
| Machines | TR-808 (11 voices), TR-909 (11 voices), two TB-303s |
| Synthesis | Pure Web Audio nodes plus one AudioWorklet. **No samples anywhere.** |
| Sequencer | 1–64 steps, off / on / accent, four patterns, swing per voice |
| Song | Sections with repeat counts, editable while playing |
| Basslines | Note / accent / slide per step, a real 4-pole ladder filter |
| Per voice | Level, tune, decay, tone, colour, pan, two sends · live waveform |
| Effects | Tempo-synced delay and a generated-IR reverb, as sends |
| Saving | Autosaved to localStorage, export/import a file, song in a shareable URL |
| Visuals | Oscilloscope (waveform + vectorscope), chillwave scene, performance mode |
| Not built | Per-voice outputs, metronome, published packages |

## What is deliberate

These are decisions, not accidents. Each has a reason that is easy to lose.

**A voice is a pure function from knobs to a `VoiceSpec`.** The renderer
(`engine/render.ts`) is the only file that touches an `AudioContext`. Do not put
synthesis decisions in the renderer or audio-node handling in a voice. The split is what
makes the kit testable and what allows offline measurement — see below.

**All output goes through `buildVoice()`.** Not `voice.build()` directly. `buildVoice`
applies the per-voice trim; bypassing it makes the drawn waveform and the audible hit
different sizes.

**Trim is applied at the very end of the chain, after the waveshaper.** A soft-clipping
curve maps ±1 to ±1, so trimming its input changes saturation, not level. This was a
real bug: the 909 kick's trim moved its peak from 1.42 to 1.42.

**Timers only decide when to look ahead.** Every hit is scheduled against
`ctx.currentTime`. If you ever find yourself triggering a sound "now" from a timer
callback, stop — that is the one change guaranteed to make the groove wobble.

**The scheduler's heartbeat runs in a Worker.** Background tabs clamp `setInterval` to
about a second, far longer than the 120 ms lookahead, so a foreground-only timer drops
audio the moment you switch tabs.

**The engine imports no React and touches no DOM.** This is a hard boundary, not a
preference — it is what lets the engine be embedded elsewhere. Nothing under
`src/engine/` may import from `src/ui/`, `src/visual/` or `src/store.ts`.

**The ladder filter is written once and shipped to the audio thread as a string.**
`worklet.ts` builds the processor's source from `Ladder.toString()` and loads it as a
blob URL, the same way `transport.ts` builds its ticker Worker. The alternative was a
second build entry point, which would have meant the engine could no longer be imported
as one module — and that is the whole reason the boundary exists.

The cost is one rule: **`Ladder` must not reference anything outside itself.** An
AudioWorkletGlobalScope shares no scope with the module, so a captured constant is a
ReferenceError at the moment the first note plays. `ladder.test.ts` guards this by
re-evaluating the class through `new Function` and comparing sample for sample, which
fails loudly in CI rather than quietly in a browser.

**A 303 is one continuous oscillator, not a node per note.** `render.ts` builds a fresh
graph for each drum hit and throws it away; `bassline.ts` cannot, because slide is a
glide between two notes on a single oscillator whose envelope never restarted. Build a
node per note and slide is impossible — the best available is a crossfade, and a
crossfade sounds like two notes rather than one note moving.

**Accent drives three things, not one.** Level, filter envelope depth and resonance
together, as the accent voltage does on the hardware. Wiring it to the level alone is
the single most common way to make a 303 emulation sound flat, and it is an easy edit to
make by accident — `bass.test.ts` asserts all three move.

**Send levels live on the `Kit`, not in `VoiceParams`.** They are routing, and a voice is
a pure function from its knobs to a spec — where its output goes afterwards is not
something the synthesis should be able to reach. Putting a send level in beside the tune
and the decay would be the first crack in that, and it would be a reasonable-looking one.

**Send gains are per voice and permanent, not per hit.** A drum hit's graph disconnects
itself when its tail runs out, and `disconnect()` drops every outgoing connection — so a
send gain built alongside a hit would be orphaned, still attached to the send bus. At
140bpm that is thousands of dead nodes an hour. The hit connects *into* something that
outlives it instead.

**Adding a field to `Kit` means finding every place that rebuilds one.** This has been got
wrong twice, and both times the symptom was miles from the cause:

- `setParam` rebuilt the kit as `{ params }`, so turning one drum knob wiped every 303
  setting and every send level. It read as correct because it *was* correct when the kit
  held nothing but `params`.
- `decodeSong` did not carry `swing`, so per-voice swing worked perfectly until you
  reloaded.

Both are now guarded: `store.test.ts` asserts each editor leaves the other fields alone,
and `song-io.test.ts` round-trips a fully populated kit and compares the whole object. Add
a field to `Kit` and add it to both.

**Swing is applied per voice, at the point a hit is scheduled — not by the transport.**
The transport emits straight times and the step duration, and `playStep` shifts each
voice by its own `swingDelay`. That is what lets hats shuffle against a kick sitting on
the grid, and it is why `StepEvent.time` is unswung. Anything reading that field and
expecting the audible time needs to add the offset itself.

**Per-voice swing is an offset from the song's, not an absolute value.** 0.5 is "however
the song swings". Absolute values would mean turning the master swing up silently left
behind every voice you had ever touched.

**`decodeSong` repairs rather than refuses.** A song arrives from outside the program —
older storage, a hand-edited file, someone else's URL. It clamps what is out of range,
fills what is missing, drops what it cannot read, and returns null only for input that is
not a song at all. The failure mode being avoided is not subtle: it is the app
white-screening on load with the user's work apparently gone.

## Next

Roughly in the order I would do them.

### 1. Score Driftlings with it

The reason the engine boundary exists, and still unproven. `src/engine/` is a standalone
module with no UI dependencies; [Driftlings](https://github.com/emmettl/driftlings) is
the intended host.

The interesting part is not playback, it is **adaptation**: Driftlings already knows how
a level is going (driftlings out, saved, lost, time elapsed), so the pattern chain can
follow it — `haze` while the crowd is walking, `drift` once skills are being spent,
`neon` when it is going well, and something sparse when it is going badly. That is a
better demonstration of a reusable engine than a loop playing underneath.

**Decided: two published packages.** `@driftbox/engine` is the synthesis engine, and
`@driftbox/app` is this sequencer, runnable with `npx @driftbox/app`. Copying the files
was never the answer — two copies of a synthesis engine diverge, and the whole point is
that they cannot — and a git dependency gives Driftlings no version to pin to. GitHub
Pages stays as the third way in, so the app ships from three places at once.

**One build can serve all of them.** Pages is a project site at `/<repo>/` and an `npx`
copy is served from the root, which normally means two builds. It does not have to:
built with `base: './'`, a single `dist/` was verified running identically at
`http://host/driftbox/` and at `http://host/` — plays, loads the ladder, shares links,
no console errors at either. Making that switch would retire the `BASE_PATH` plumbing in
the deploy workflow. It is a live deployment, so it is a deliberate change rather than a
tidy-up.

**The blob-URL worklet is what makes that possible.** Because the ladder's source is
built in memory rather than emitted as an asset, it has no URL to resolve and is immune
to the base path entirely. Had it been a second build entry point — the obvious approach,
and the one rejected in "What is deliberate" above — every distribution channel would
have needed its own asset resolution, and the `npx` copy would have been the one that
quietly fell back to a biquad.

The engine is already in a state to be extracted. Checked, and worth re-checking before
publishing, because all three are easy to break by accident:

- **No runtime dependencies at all.** Nothing under `src/engine/` imports a package.
- **No React, no DOM, no storage.** The only host APIs it touches are Web Audio plus
  `Blob`, `URL` and `Worker`, all of which exist in a worker as well as a page.
- **Nothing reaches back up.** No import from `src/ui/`, `src/visual/`, `src/store.ts`
  or `src/songs.ts`.

What the split still needs:

1. A `package.json` per package, an `exports` map, and `.d.ts` output — the engine is
   consumed as TypeScript today and would need declarations built.
2. **A check that `Ladder.toString()` survives a consumer's bundler.** It holds under
   this build (verified against the minified output: the class comes out self-contained,
   with no helper references). A consumer minifying differently is the one real risk in
   publishing this, and `ladder.test.ts` only guards our own build.
3. A `bin` for `@driftbox/app` that serves the built static files — the app is a Vite
   SPA with no server, so this is a static handler and an open, not a port of anything.
4. Deciding whether `songs.ts` ships with the engine. Driftlings wants the patterns, not
   just the machines, so probably yes — but it is app content living outside the app,
   and that is worth being deliberate about rather than discovering later.

### 2. Per-voice outputs

Everything lands on one bus. Separate outputs per voice — or at least per machine — is
what would let this feed a real mixer or a DAW, and it is the last structural thing
between "a toy that sounds good" and "something you would actually track with".

### 3. A metronome and a count-in

Still missing, and still the thing you notice the moment you try to play along.

## Known limitations

- **Nobody has confirmed how it sounds.** Everything was verified by measurement — the
  synthesis is structurally correct and well-behaved, but no ear has passed judgement.
  The **909 hats, ride and crash** are where I would expect disagreement first: on the
  real machine those were 6-bit samples, so the inharmonic-oscillator approach is
  furthest from the original there. The **303s** are the other place to listen hard: the
  filter is measurably a self-oscillating 4-pole that tracks its cutoff within 3%, but
  whether it squelches the way a real one does is not something a measurement can say.
- **A bassline cannot run at a different length from the drums under it.** Basslines live
  on the `Pattern` rather than in a sequence of their own, so one entry in the chain is
  one bar of the whole arrangement. That buys the chain, the pattern buttons and clear
  working on everything at once, and costs the polymetric trick below on the bass side.
- **The 303s have no per-note tie separate from slide, and no rests inside a held note.**
  Both are on the real machine. Neither is hard; they need somewhere in the grid to live.
- **No AudioWorklet means no squelch.** The fallback is a single biquad — two poles,
  linear, no self-oscillation. The 303 panel says so when it is in use, but it is worth
  knowing that "the basslines sound tame" has one likely cause.
- **There is one delay and one reverb for the whole song, and no way to bypass them.**
  Deliberate — the point of a send is that everything lands in the same room — but it does
  mean you cannot have a short slap on the snare and a long throw on the 303 at once.
- **A pattern's length is shared by its drums and its basslines.** Polymetry works across
  the chain — a 12-step pattern next to a 16-step one — but not *within* a bar, so a
  15-step hat line under a 16-step kick still needs the two as separate patterns.
- **The chillwave backdrop is nearly invisible behind the console.** Deliberate (the step
  grid has to stay readable) but the sun in particular never shows. If it should read
  more strongly, move the scene's sun down rather than raising the opacity.
- **No metronome or count-in.**

## Verifying changes

`npm test` covers the pure layer. Anything about how it *sounds* has to be measured —
see [docs/VERIFYING-AUDIO.md](docs/VERIFYING-AUDIO.md). Please re-run the level
measurements after touching any voice, `render.ts`, or the bus chain; three real bugs
came out of that and all three were invisible to the tests.
