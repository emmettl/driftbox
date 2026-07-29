# Driftbox — state and roadmap

Where this is, what is deliberate, and what to do next. Read this before changing
anything in `packages/engine/`.

## Where it is

**Working end to end.** Two drum machines, two 303s, a step sequencer with an arrangement,
a per-voice channel strip, two send effects, an oscilloscope and a chillwave visualiser
with a performance mode. CI is green; there are 240 unit tests.

| | |
|---|---|
| Machines | TR-808 (11 voices), TR-909 (11 voices), two TB-303s |
| Synthesis | Pure Web Audio nodes plus one AudioWorklet. **No samples anywhere.** |
| Sequencer | 1–64 steps, off / on / accent, add / copy / rename patterns, swing per voice |
| Song | Sections with repeat counts, editable while playing |
| Ships with | Four songs — chillwave, darkwave, acid house, ISDN-era FSOL |
| Vibes mode | A player: now-playing, skip, filter pad, two scenes — no grid required |
| Basslines | Note / accent / slide per step, a real 4-pole ladder filter |
| Per voice | Level, tune, decay, tone, colour, pan, two sends · live waveform |
| Effects | Tempo-synced delay and a generated-IR reverb, as sends |
| Saving | Autosaved to localStorage, export/import a file, song in a shareable URL |
| Visuals | Oscilloscope, two 3D scenes that warp under a finger, and a full-screen XY filter pad |
| Touch | Thumb-sized targets, safe areas, a grid that scrolls, a transport that collapses |
| Not built | Per-voice outputs, published packages |

## What is deliberate

These are decisions, not accidents. Each has a reason that is easy to lose.

**A voice is a pure function from knobs to a `VoiceSpec`.** The renderer
(`engine/render.ts`) is the only file that touches an `AudioContext`. Do not put
synthesis decisions in the renderer or audio-node handling in a voice. The split is what
makes the kit testable and what allows offline measurement — see below.

**A source has three gain stages and they are not interchangeable.** `Source.gain` sets
how loud that source is *within* its voice, `VoiceSpec.gain` sets the voice's level, and
`Voice.trim` normalises it against the rest of the kit. The first of those was never read
by the renderer, from the first commit until somebody heard the 808 kick's click, and the
trims quietly absorbed the damage — they were measured against the output, so the kit
balanced while every voice was internally wrong. `render.test.ts` now asserts all three
stay separate.

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
preference — it is what lets the engine be embedded elsewhere. It is now enforced by the
package split rather than by discipline: `packages/engine` cannot reach into
`packages/app`, because nothing declares that dependency and it would not resolve.

**`Voice.pitched` declares what the tune knob actually does.** The mapping from knob to
frequency lives inside each builder where nothing outside can see it, so a caller had no
way to go the other direction and work out the knob position for a given note. Declaring
the range is what lets a tom be played from a keyboard. Only the toms carry it: a snare has
a tune knob too, and playing tunes on it is not a thing anybody wants.

The ranges are a little under an octave — a real 808's tom tuning is limited, and reaching
further means playing a different tom. It is a soft limit rather than a hard one, so do not
narrow them to prove a point.

**The 303 keyboard is monophonic on purpose.** Holding one key and pressing another glides
between them on one envelope, which is the sequencer's slide reached from the other end. A
polyphonic keyboard here would be a different instrument.

**A song builder returns a fresh Song every call.** `clonePatterns` in `songs/notation.ts`
exists for that: without it two calls hand back the same pattern objects, so anything that
mutated a pattern in place would edit the shipped song permanently and `reset` would
restore the corrupted version. Nothing mutates today — the store is immutable throughout —
but "the defaults are safe as long as nobody writes `pattern.name = ...`" is not a property
worth relying on, and the failure would be silent and permanent. Caught by a test, not by
reading.

**Touch devices open in the visuals, not on the grid.** A phone opening on a step grid
opens on the part a small screen handles worst and buries the part it handles best. Chosen
by `pointer: coarse` at startup — so it is a property of the device rather than of the
window size — and the console is one tap away.

That made vibes mode needing its own transport unavoidable: it had relied on the space
bar, which does not exist on a phone, so the app would have opened silent with no way to
start it.

**The console is kept mounted while it folds away.** Unmounting on the state change would
make it vanish rather than fold into the edit button; `FOLD_MS` in `App.tsx` and `--fold`
in the stylesheet have to agree, or it either disappears early or lingers.

**Folded panels are unmounted, not hidden.** The scope and the voice waveform each run an
animation frame loop, and a hidden panel still drawing sixty times a second is exactly the
cost somebody folded it away to avoid. Which panels are folded lives under its own
localStorage key, not in the Song — it is a property of your screen, and it must not
travel in a shared link.

**The notation counts its own steps and throws.** A line one character short is invisible
by eye — the point of writing patterns as a picture is that they read as one, and a picture
does not announce that it is 13 wide when it should be 14. Unchecked it becomes a track
shorter than its pattern, which the loader silently pads, so the song plays differently
from how it reads. The check caught two errors in the first song written after it existed.

**Skipping songs only asks when there is something to lose.** `pristine()` compares the
current song to the preset it came from, so a listener who has edited nothing is never
interrupted, and somebody who has is never silently overwritten — loading replaces the
autosave too. Startup does the same comparison to work out which shipped song a restored
session is.

**Anything laid over the filter pad needs an explicit `z-index`.** The pad is
`position: absolute; z-index: 1` across the whole stage, so a sibling without one paints
underneath it and its buttons stop working. This has now caught the scene switcher and the
whole now-playing strip. The strip stays pointer-transparent and only its buttons opt back
in, so drags still reach the filter everywhere else.

**Shared visual state owns its own clock.** `touch.ts` advances its eased `energy` on its
own animation frame rather than from a scene's `useFrame`. The first version did the
latter, which is right for a scene with one object and wrong for one with seven —
Lifeforms called it eight times a frame and the warp decayed eight times too fast. Whose
job it is to advance shared state should never depend on how many things happen to read it.

**Nothing that asks to be pressed should animate its `transform`.** The play button pulsed
with a `scale`, which makes it a moving target for a thumb — and a browser refuses to click
it at all, because it never settles. Pulse the light, not the geometry.

**The filter pad is the whole screen, and it filters the whole mix.** Not a widget in a
corner, and not wired to the 303s' own cutoff — the obvious reading of "mess with a 303's
filter" and the wrong one. What makes a Kaoss pad fun is the entire record ducking away
and coming back. It is an insert after the bus compressor, so the compressor is not
reacting to signal about to be discarded, and it is momentary, because a filter left
half-shut after you lift your finger sounds like something is broken.

**Two ways the pad can get stuck, both silent.** It is released on pointer *cancel* as
well as up — a system gesture or an incoming call otherwise leaves it shut — and on
unmount, because escape leaves the visuals mid-drag and no pointer event ever arrives. The
symptom either way is a mix that is inexplicably muffled with nothing on screen to explain
it.

**Touch styles key off `pointer: coarse`, not a width breakpoint.** A tablet in landscape
is wide *and* touched. Hover styles are neutralised there too: on a touch screen `:hover`
sticks after a tap and leaves controls looking permanently focused.

**The metronome is not a voice and does not go through the bus.** It is a `VoiceSpec` so
it can reuse the renderer, but it connects straight to the destination: through the bus it
would duck the whole mix through the compressor on every beat, arrive in the reverb, and
draw itself on the oscilloscope. It also ignores swing — swing is a property of the music,
and a click that shuffled with it would be measuring against itself.

The cost of bypassing the bus is that it is the one sound in the engine with no compressor
downstream to catch it, so its level is measured rather than chosen. See recipe 7 in
docs/VERIFYING-AUDIO.md.

**A pattern's id is a stable key; its name is not.** The arrangement refers to patterns by
id, so renaming must never touch it and removing a pattern must strip it from the chain —
a stale chain entry does not error, it silently plays the wrong bar, because
`patternForBar` falls back to the first pattern.

**TypeScript 7.** The native compiler, taken for the speed: type-checking both packages
went from 0.94s to 0.17s cold, and the engine's declaration emit from 0.36s to 0.13s.
Worth recording that the emit is **byte-identical** to 6.0.3 — both compilers were run
over `packages/engine` and every `.js` and `.d.ts` compared — because the engine's `dist/`
is published output and a compiler swap that quietly changed it would be a bad way to find
out. Declaration emit, declaration maps, project references and the explicit `.js`
specifiers all behave the same.

**The engine has no runtime dependencies, and neither does the published app.** The engine
imports no package at all. The app ships a prebuilt bundle plus a server written against
Node built-ins, so `npx @driftbox/app` fetches one tarball and runs — no install tree
between somebody and a drum sound. Adding a runtime dependency to either is a decision,
not a detail.

**Relative imports inside the engine carry an explicit `.js` extension.** TypeScript emits
specifiers verbatim, so without them the published output is `from './bass'`, which raw
Node ESM cannot resolve. This was not theoretical — importing the packed tarball from a
fresh project failed with `ERR_MODULE_NOT_FOUND` until they were added.

**The app resolves the engine from source, not from `dist/`.** Aliased in
`vite.config.ts`, `vitest.config.ts` and `tsconfig.app.json`. Otherwise the workspace
symlink resolves through the package's `exports` to a build, and every engine edit would
need a rebuild before the app saw it — with a stale `dist/` quietly serving old audio code
in the meantime. The published package still ships its own `dist/` for outside consumers.

**The app builds with a relative base.** One `dist/` serves the Pages project site at
`/driftbox/`, `npx @driftbox/app` at the root, and any other static host. The cost is that
an unknown path cannot be served the app inline — relative asset paths would resolve
against the wrong directory — so the `npx` server redirects to `/` instead. Driftbox has
no routes, and a shared song lives in the fragment, which survives a redirect.

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

The reason the engine boundary exists, and the last part of it still unproven. The
packaging is done — `packages/engine/` is `@driftbox/engine`, published-shaped and
verified as a tarball — so what is left is the actual scoring.

The interesting part is not playback, it is **adaptation**: Driftlings already knows how a
level is going (driftlings out, saved, lost, time elapsed), so the arrangement can follow
it — `haze` while the crowd is walking, `drift` once skills are being spent, `neon` when
it is going well, and something sparse when it is going badly. The chain is plain data and
sections take effect at the next bar, so this is `engine.song = {...}` and nothing more.
That is a better demonstration of a reusable engine than a loop playing underneath.

**Before publishing to npm for real**, the things worth re-checking:

- **`Ladder.toString()` under a consumer's bundler.** It holds under this build — verified
  against both the minified app bundle and the engine's own `dist/`, where the class comes
  out self-contained and still self-oscillates when evaluated in isolation. A consumer
  minifying differently is the one genuine risk in publishing this, and `ladder.test.ts`
  can only guard our own build. If it ever breaks, the symptom is silence on the first
  bass note, not a build error.
- **The version numbers.** Both packages are at `0.1.0` and have never been published.
  `@driftbox/app` does not depend on `@driftbox/engine` at runtime — it bundles it — so
  they can drift, but the app's devDependency pins an exact version and will need bumping
  in step.
- **Whether the `@driftbox` scope is available**, and whether it should be public
  (`npm publish --access public`).

### 2. Per-voice outputs

Everything lands on one bus. Separate outputs per voice — or at least per machine — is
what would let this feed a real mixer or a DAW, and it is the last structural thing
between "a toy that sounds good" and "something you would actually track with".

### 3. More songs, and somewhere to put them

Three shipped songs demonstrate the range; they do not make a library. The obvious next
step is user songs saved by name rather than one autosave slot and a file dialog — the
storage layer already round-trips a whole Song, so this is a list and a picker rather than
new machinery.

## Known limitations

- ~~**Nobody has confirmed how it sounds.**~~ Somebody has now, and the verdict was that
  it is fine. The **909 hats, ride and crash** remain the place I would expect
  disagreement first — 6-bit samples on the real machine, so the inharmonic-oscillator
  approach is furthest from the original there — but this is no longer an open question
  about the whole kit.
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
- **A pattern with no kick in it is the one that clips.** Not the busiest — the busiest
  have transients for the bus compressor to clamp against. `Lift` is hats and a 303 with
  no kick at all, and measured at `1.04` from the drums alone until its two hat machines
  were offset off each other's steps. Worth checking any pattern that is all sustain.
- **The chillwave backdrop is nearly invisible behind the console.** Deliberate (the step
  grid has to stay readable) but the sun in particular never shows. If it should read
  more strongly, move the scene's sun down rather than raising the opacity.
- **No metronome or count-in.**

## Verifying changes

`npm test` covers the pure layer. Anything about how it *sounds* has to be measured —
see [docs/VERIFYING-AUDIO.md](docs/VERIFYING-AUDIO.md). Please re-run the level
measurements after touching any voice, `render.ts`, or the bus chain; three real bugs
came out of that and all three were invisible to the tests.
