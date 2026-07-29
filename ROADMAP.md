# Driftbox — state and roadmap

Where this is, what is deliberate, and what to do next. Read this before changing
anything in `packages/engine/`.

## Where it is

**Working end to end.** Two drum machines, two 303s, a step sequencer with an arrangement,
a per-voice channel strip, two send effects, an oscilloscope and a chillwave visualiser
with a performance mode. CI is green; there are 395 unit tests.

| | |
|---|---|
| Machines | TR-808 (11 voices), TR-909 (11 voices), two TB-303s |
| Synthesis | Pure Web Audio nodes plus one AudioWorklet. **No samples anywhere.** |
| Sequencer | 1–64 steps, off / on / accent, add / copy / rename patterns, swing per voice |
| Song | Sections with repeat counts, editable while playing |
| Ships with | Twelve songs — chillwave, acid house, darkwave, electro, ISDN-era FSOL, downtempo, ambient house, trance, breakbeat, upbeat |
| Vibes mode | A player: now-playing, skip, filter pad, two scenes — no grid required |
| Basslines | Note / accent / slide per step, a real 4-pole ladder filter |
| Per voice | Level, tune, decay, tone, colour, pan, two sends · live waveform |
| Effects | Tempo-synced delay and a generated-IR reverb, as sends |
| Saving | Autosaved to localStorage, export/import a file, song in a shareable URL |
| Visuals | Four meters, twelve 3D scenes that warp under a finger, and a full-screen XY filter pad |
| Son et lumière | One song, one visual — every song names its own, no scene used twice |
| Touch | Thumb-sized targets, safe areas, a grid that scrolls, a transport that collapses |
| Published | `@driftbox/engine` and `@driftbox/app` on npm at 0.1.0, with provenance |

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
**A scene is a whole geometry moved by the audio, not a filter over a picture.** Each of
the three does one thing the others cannot: Sunset is a fixed horizon, Lifeforms drifts in
place, Wireframe travels. Forward motion turned out to be the biggest difference of the
three, and the cheapest — the corridor is one buffer built once and moved entirely in the
vertex shader, so an endless tunnel is a single draw call and never allocates a rib.

**A song names its own visual, as an opaque string the engine never resolves.**
`SongPreset.visual` is a hint travelling with the music; the app maps it to a scene and
ignores names it does not have, rather than falling back to a default. A host embedding
the engine with its own visuals — or none — is unaffected. Manual scene changes still win
until the next track, which is the behaviour to keep if a "stick to one visual" option
ever lands.

**Warping a plane needs two envelopes, not one.** A single gaussian forces a choice
between tight enough to keep the horizon and wide enough to notice, and the effect was
tuned three times before that was obvious. It is now a tall, tight lift with a separate,
much wider and much SHALLOWER travelling wake. The wake amplitude is the part to be careful
with: the floor sits about half a unit below the camera, so a wide ripple at the lift's
amplitude throws half the plane above the viewer and the grid stops reading as a floor at
all.

**A touch has to be mapped to what the camera can actually see.** The floor warp took the
touch position straight to a fixed world width, which on a portrait phone put the
deformation a long way off-camera for most of the screen — it read as "too subtle" when it
was mostly happening where nobody could see it. The spread now comes from the viewport
aspect. Any new scene that reacts to touch needs the same: a constant that looks right on a
desktop window is wrong by a factor of three on a phone.

**Shared visual state owns its own clock.** `touch.ts` advances its eased `energy` on its
own animation frame rather than from a scene's `useFrame`. The first version did the
latter, which is right for a scene with one object and wrong for one with seven —
Lifeforms called it eight times a frame and the warp decayed eight times too fast. Whose
job it is to advance shared state should never depend on how many things happen to read it.

**Recovery has to keep trying, because an interruption ends when iOS says it does.**
The audio-recovery hook described a `statechange` listener and a retry in its own comment
and had neither: no listener was registered, and the one-second poll called the function
that *reports* the stall rather than the one that clears it. So recovery was a single
attempt fired from `visibilitychange`, which on iOS lands while the context is still
`interrupted`, fails, and was never tried again — audio gone until a tap, and gone for good
if that tap's attempt failed too. Anything that depends on the OS granting something needs
a retry, not a handler.

**A convolver cannot be gated, only replaced.** Muting a reverb's output does not stop it
emitting its tail; unmute a moment later and the old room is still there, exactly where it
left off. A delay is worse, because the line still holds its contents and the feedback loop
keeps handing them round. Changing song fades the wet path out and then throws both nodes
away. Stopping does not — a record that stops should ring out.

**A warp aimed at a fingertip has to solve for depth, not just for a plane.** The Web's
black hole and the Trench's cannons both land under the finger only because the point they
aim at is derived per-vertex from the eye ray. Solved once on a single plane, a scene with
any depth to it puts the effect visibly beside the finger — and it looks correct on the one
viewport it was tuned on, which is how it survives to being noticed.

**An agent on a grid needs turning back long before it reaches the wall.** The light
cycles turn ninety degrees only, so the sole legal turn AT a wall runs along it — a bike
follows the edge to a corner, turns along the next edge and never comes back. Five of them
drew a neat square while the middle of the board stayed empty. A soft ring at two thirds of
the arena, where a bike keeps turning until it is genuinely heading home, fixes it; turning
at the boundary itself cannot, whatever the bias.

**Fade attributes have to vary along the thing they fade.** The Tron grid handed each line
a per-vertex "how far out am I" and every line across a square grid has BOTH ends on the
boundary — so it interpolated from fully-faded to fully-faded and the entire grid rendered
at zero alpha. Invisible, with nothing anywhere to say so. Computing it per fragment from
the position is both simpler and correct.

**Constant motion with nothing to measure it against is not motion.** The Rez corridor
travels down Z at a constant radius past evenly spaced identical ribs, which strobes: at
rest you cannot tell you are moving. One slow swell along its length — a waist that passes
you — fixes it, and the wavenumber has to divide the corridor's length exactly or the swell
fails to meet itself at the wrap and a seam travels down the tunnel forever.

**Evenly spaced is exactly what makes a moire.** Saturn's planet is a golden-angle spiral,
which is the right generator precisely because it spaces points evenly — and rendered as
points it read as woven fabric. A jitter of a fraction of the spacing kills the
interference without clumping anything.

**A dive into something has to be a dive into THAT thing.** The trench took three
attempts. It began as a straight corridor and a separate sphere with the corridor fading up
— a cross-fade dressed as a move. Then the camera flew down into the corridor instead of
the corridor rising, which is a real move but still a move toward a different object. Only
cutting the groove into the sphere fixed it, and two things fell straight out: travel became
an angle rather than scrolling geometry with a modulo wrap, and from orbit the thing you are
about to dive into is the thing you can already see.

**A proportional pulse does not survive its subject being scaled.** The trench's station
breathes on the low end by scaling radially, and the factor was 1.2% — four units when the
station's radius was 420. Growing the station to 3200 to flatten the trench turned the same
1.2% into thirty-eight units, while the ship still flew fourteen above the floor: any kick
over a third of full scale lifted the floor straight through the camera. Anything that has
to clear a fixed distance must be expressed as a fixed distance.

**Flatness is a radius, not a shading choice.** How much a trench cut round a sphere
appears to bend is just arc length over radius. At a station radius of 420 the hundred and
fifty units you can see ahead bend through seventeen degrees and the floor rolls away like
the inside of a barrel; at 3200 the same stretch bends through three and it converges to a
vanishing point the way the cabinet's does. Nothing about the drawing changed.

**A long lens does not flatten a curve; it magnifies one.** The obvious camera fix for a
trench that curls is a narrower field of view, on the reasoning that a telephoto compresses
depth. It does not help here and it was worth building to find out: at 34 degrees the walls
jam into the frame edges, the visible run collapses to almost nothing, and the bend that is
left is *enlarged* by the same factor everything else is. Apparent curvature is arc over
radius and nothing the camera does changes it. A mild narrowing — 60 down to 46 — is still
worth having, but for a different reason: it stops the near walls splaying to the corners.

**A detail nobody is looking at is a detail that does not exist.** The station's dish was
correct, present and on the far side of the sphere from where the run begins, so it had
never once been seen. Aiming it at the starting camera works and is brittle — it ties a
feature of the station to a property of the flight. Arcing the approach round the hull
instead carries the dish past the frame as a consequence of the path, which does not care
where on the station it sits.

**"Up" is whatever the geometry says it is.** A trench cut round an equator opens RADIALLY
OUTWARD, and its walls are the north and south faces — so from inside it, up points away
from the station's axis, which is horizontal in world terms. Leaving the camera's up as
world-up flew the entire run rolled ninety degrees, floor on the left and sky on the right.
It looked like a framing problem and was an orientation one.

**One fog range cannot serve a shot that starts a kilometre out and ends in a ditch.**
Tuned for inside the groove, the fog made the whole station invisible from orbit, where the
nearest hull is six hundred units away. The range travels with the dive.

**Move the camera, not the world.** The trench arrived by rising forty units into place
under a fixed camera, which is a cross-fade wearing a move — geometry appearing around a
stationary observer never reads as travel. Flying the camera down into the same, entirely
static, trench is the same number of lines and an actual dive.

**Position things as fractions of the frame, not in absolute units.** Jump Man's runner
stood at a fixed eighteen cells left of centre, which is fine on a desktop and walks him off
the edge of a phone the moment the visible width narrows. Anything placed relative to the
viewport has to be expressed relative to the viewport.

**A figure needs volume, not a skeleton.** The dancers began as single lines between
joints, which reads as a stick figure however good the motion is. Rebuilt as an artist's
mannequin — tapered prisms with oversized balls at the pivots — the same poses read as
bodies. The taper is the part doing the work: a limb of constant width is a pipe, and the
balls are what say the thing bends there.

**Orient a prism from a reference that is not parallel to it.** Extruding a cross-section
along a bone needs two axes perpendicular to that bone, and there is no natural choice —
so one comes from any handy reference vector. Using a fixed one fails precisely when the
bone points along it, which for a dancer is every time an arm goes straight up.

**A phone is taller than the phone preset.** A real iPhone in Safari is about 0.46 wide
for its height; Playwright's device preset is 393×660, which is 0.6 — a fifth shorter, and
wide enough to hide a scene disappearing completely. Fitting a wide subject at 0.46 asked
for a camera further away than the canvas's far plane, so the whole arena was clipped and
the screen was black, with no error anywhere. `fitDistance` clamps to the far plane now,
because cropping shows you part of something and overshooting shows you nothing. Check
portrait at the real proportions, not the preset's.

**Colour the keys by pitch, not by scale.** The on-screen piano put its white keys at
0,2,4,5,7,9,11 semitones above the root — the shape of a piano starting at C — while the
303's note 0 is an A. So C, F and G landed on black keys and C#, F# and G# on white ones,
which is backwards from every keyboard ever built. It had even been noticed and papered
over with scale-degree labels instead of fixed. The two gaps, where B meets C and E meets
F, are how anyone reads a keyboard at a glance, and they only appear if the black keys are
placed by pitch. The cost is that the home row now spells A natural minor rather than A
major, which is simply what the white keys from an A are; C major starts on `d`.

**Solve for the frame; do not guess twice.** Scenes picked their camera distance with
`portrait ? a : b`, which is two hand-tuned numbers standing in for one piece of
arithmetic. A perspective camera's field of view is VERTICAL, so the width it can see is
that times the aspect: narrow the window and width binds, widen it and height does. A
distance chosen on a 16:9 laptop therefore left a third of a 1920×950 window empty above
the subject, because at that aspect there had never been a width problem to back away from.
`fit.ts` solves both constraints and takes the larger, and keeps working at aspects nobody
tried. The extents it is given have to be the subject's extent ON SCREEN, not in space — a
ring system seen almost edge on is as wide as its radius and a fraction as tall.

**Looking down at a floor, aim NEARER than the middle.** The near half of a ground plane is
far larger on screen than the far half, so centring on the origin puts the visual mass in
the bottom third with empty sky above it. Aiming closer pitches the camera down and lifts
the board up the frame; aiming further away does the exact opposite, because a more distant
target sits nearer the horizon. Getting that backwards is a one-character mistake that moves
things the wrong way, and only a measurement tells you which way you went.

**Turn the subject when the frame is the wrong shape.** Defcon's board is half again as wide
as it is deep, and a phone's horizontal field of view is about 0.6 of its vertical; framed
landscape it becomes a strip through the middle with dead space above and below. Rotating
the board a quarter turn in portrait fills the same screen at two thirds the distance. Same
lesson as Lifeforms' bodies, from the opposite direction.

**A colour chosen against one background is a colour chosen against one background.** The
pad's amber was picked over the sunset — where it matched the sun so well it vanished into
it — and then used unchanged on nine other scenes nobody had looked at it over. Accents
contrast now, and each scene declares its own.

**Log band edges computed independently collapse at the bottom.** Thirty bands over a
thousand FFT bins: the first ten edges all round down to bin one, so the bottom third of
the meter is the same bar drawn ten times. Walk the edges and force each band to advance at
least one bin.

**Restraint stops being a style once it is the only one you have.** Nine scenes of glowing
vectors in a dark room is a house style; the tenth being a bright blue sky is what proves
the first nine were a choice. It is also the only honest reading of an ambient house record
that is fundamentally *cheerful* — doing the Orb in cold cyan would have been a misread.

**A scene aimed at one record should read that record's shape, not just its level.**
Every scene but one maps loudness to motion, which is right for music that is continuous
and wrong for Undertow — 82bpm, no snare, mostly the space around the hits. Stillwater
does onset detection instead and drops a ring per hit, so the quiet is part of the picture.
Reading levels is the default; it is not the only thing the analyser is good for.

**A composition constant that frames well in landscape frames badly in portrait, and
camera distance will not save it.** Lifeforms' bodies are hand-placed twice as wide as they
are tall; pulling the camera back far enough to fit that on a phone left a band through the
middle with dead space above and below. The fix is to squeeze the layout horizontally and
stretch it vertically — reshape the subject, not the lens.

**Write uniforms through the material, never through the object you handed it.** Building
a uniforms object with `useMemo`, passing it to `<shaderMaterial uniforms={...} />` and
then mutating it every frame reads correctly and does not work: under StrictMode the
material ends up holding a different object, and the shader sees its initial values
forever. Three of the four scenes shipped like this. Nothing errored, and they still
*moved* — their cameras are animated from JS — so a corridor still flew and a web still
spun. All that was missing was every reaction to the music, which is the only thing a
visualiser is for. `uniforms.ts` exists to make the right version the short one. The
general lesson is that "it animates" is not evidence the audio is reaching it: read the
live uniform values off the material and check they are moving.

**A compressed peak is not a mix measurement.** On a dense pattern the master compressor
pins, and its output peak then barely responds to how loud the input is — rendering one
pattern with every voice at `level: 0.05` and at `0.9` gave the same peak both times. Trim
against the raw pre-compressor bus sum instead, and compare with the shipped songs rather
than with 1.0. Half an hour went into lowering faders that could not have helped.

**`===` between a union containing `string` and a `string` is legal, and always false.**
The step cursor compared `song.chain[bar]` — a `ChainStep` object — against a pattern id,
in both grids, identically. TypeScript had no objection: the left side's type includes
`string`, so the comparison type-checks and is simply never true. No cursor rendered on any
of the 176 pads from the day it was written, and the second bug underneath it — indexing
the chain by bar, which ignores `repeat` — stayed hidden behind the first. The lookup is now
a plain exported function with a test, because the half that was wrong is the half a test
can reach.

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

**Both packages are published**, at 0.1.0, with SLSA provenance naming
`refs/tags/v0.1.0` on this repo. Verified from the registry rather than from the green
tick: installed into an empty project and imported (22 voices, 12 songs), and
`npx @driftbox/app@0.1.0` served its index and its 1.27 MB bundle.

The one thing still worth watching is **`Ladder.toString()` under a consumer's bundler**.
It holds under this build — verified against both the minified app bundle and the engine's
own `dist/`, where the class comes out self-contained and still self-oscillates when
evaluated in isolation. A consumer minifying differently is the one genuine risk in
shipping this, and `ladder.test.ts` can only guard our own build. If it ever breaks, the
symptom is silence on the first bass note, not a build error.

## Releasing

**There is no npm token.** Both packages are published by a **trusted publisher** — npm
trades the workflow's `id-token: write` identity for a short-lived credential, so nothing
long-lived is stored in this repo, and there is no secret to leak, rotate or forget. The
Automation token that got 0.1.0 out has been revoked and `NPM_TOKEN` deleted.

Two consequences worth knowing before touching `publish.yml`:

- **Do not add `NODE_AUTH_TOKEN` back.** npm prefers an explicit token over OIDC, so a
  stale or empty one turns a working release into a 401 rather than falling back.
- **The trusted publisher is configured per package**, on npmjs.com, against this
  repository and the workflow *filename* — `publish.yml`. Renaming or moving that file
  breaks publishing, and the failure will look like an auth problem rather than a rename.
  Its allowed action is `npm publish`; `npm stage publish` — which parks a candidate for
  human 2FA approval — is deliberately not enabled, because the trigger is already a
  deliberate act and a second approval would only mean approving the same decision twice.

To release: bump a package, tag `vX.Y.Z` matching one of them — the workflow refuses a tag
that matches neither — and publish a GitHub Release. It also runs on manual dispatch,
defaulting to a dry run.

`@driftbox/app` does not depend on `@driftbox/engine` at runtime; it bundles it. So the
two versions can drift, but the app's devDependency pins an exact version and needs
bumping in step.

### What getting 0.1.0 out cost

Kept because none of it is guessable, and all of it will read as a build problem when it
happens again.

- **A scoped package is RESTRICTED by default**, and restricted publishing needs a paid
  plan. Both packages carry `publishConfig.access: public` for this reason. No dry run
  catches its absence — `--dry-run` never makes the access check, and the notice it prints
  says "default access", which reads as fine and is not.
- **A token that does not bypass 2FA fails with `EOTP`** *after* building the tarball and
  signing the provenance, so the run gets a long way in before dying. This is history now
  — there is no token — but it is what the `Publish` step looks like when auth is wrong,
  and OIDC misconfiguration fails just as late.
- **Provenance needs a CI runner.** Publishing by hand from a laptop cannot produce an
  attestation. That is why bootstrapping 0.1.0 manually would have been a worse trade than
  fixing the credential, and why trusted publishing could not be used for it either: a
  trusted publisher is configured on a package's settings page and there is no way to
  pre-register a name.

**The OIDC path is not yet proven.** 0.1.0 went out on a token; the dry run since cannot
test the credential, because both versions already exist and the workflow skips them — and
`--dry-run` never authenticates in any case. The next real publish is the first test of it.

### 2. ~~Per-voice outputs~~ — done, as stems

A browser cannot hand eight signals to a mixer: `destination` is the output device and on
almost every machine that is two channels. So the useful form of separate outputs is
**stems** — the song rendered once per voice, offline, one float WAV each. That is how a
DAW gets fed anyway.

Two decisions are load-bearing. They are **pre-master**, stopping before the bus
compressor, because a compressor is non-linear and shared and stems rendered through one do
not add back up. And they are **32-bit float**, because pre-master means a stem can exceed
full scale — the 909 closed hat comes out of the shipped chillwave song at 1.11 — and
16-bit would either clip it or force scaling everything down, which destroys the balance
that is the only reason to export a set.

What is left of the original idea is live multi-channel output for the rare machine with an
interface attached. Not built, and not verifiable here.

### 3. Somewhere to put your own songs

Twelve shipped songs demonstrate the range. What is missing is anywhere to keep your own. The obvious next
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

## Verifying changes

`npm test` covers the pure layer. Anything about how it *sounds* has to be measured —
see [docs/VERIFYING-AUDIO.md](docs/VERIFYING-AUDIO.md). Please re-run the level
measurements after touching any voice, `render.ts`, or the bus chain; three real bugs
came out of that and all three were invisible to the tests.
