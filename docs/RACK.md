# The rack — a design sketch

A modular synth rack, in the browser, patched with cables. Reason's back panel rather than
Reason's front: a small set of modules, free routing between all of them, and a patch that
fits in a URL.

Steps 1 and 2 of the build order at the bottom are built and tested: `packages/rack` has the
compiler, the worklet host, three modules and the patch format, and `packages/app/src/hash.ts`
carries patches in a URL alongside songs. There is no UI yet. Everything below is the shape of
it and the decisions that are expensive to change later — where the implementation taught us
something different, this file says so rather than describing the plan we started with.

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

One signal type. Audio and CV are the same `Float32Array` — Eurorack's choice, not Reason's.
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

Scheduling a param against a frame is **not** built. When it is, `currentFrame` inside the
worklet is a better clock than `ctx.currentTime`, and the rack's own sequencer will need no
lookahead timer and no worker ticker at all — only a tempo and a start frame from outside.

The message set is the ABI: `plan` and `param` today, `transport` when there is one. Resist
growing it.

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
  migrate?(params: Record<string, number>, from: number): Record<string, number>
}

interface Processor {
  /** Per voice, per block. Reference nothing outside this class. */
  process(inlets: Float32Array[], outlets: Float32Array[], params: Float32Array[], frames: number): void
}
```

Three things here were not in the first sketch and are load-bearing:

**`deps` is keyed by string, and the processor looks its dependencies up as `deps.Ladder`.**
Never by identifier. Minified, `Ladder.toString()` comes out as `class{s0=0;...}` —
*anonymous*, not renamed — so any scheme that derives an identifier from `Class.name` at
assembly time emits `const  = class{...}` and the whole worklet fails to parse. Production
only; the dev build works perfectly. `worklet.ts` has the long version.

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

## Seventeen modules

Enough to make a track, and no more. Chosen so that nothing here is a placeholder.

| | |
|---|---|
| **VCO** | saw / pulse / tri, PWM, linear FM inlet, hard sync inlet |
| **Noise** | white and pink |
| **Ladder** | the existing 4-pole. Already written, already tested |
| **SVF** | state-variable multimode — LP/HP/BP/notch, cheap, and unlike the ladder |
| **VCA** | linear and exponential, CV inlet |
| **Drive** | waveshaper |
| **Delay** | CV'able time, tempo-syncable |
| **ADSR** | gate inlet, one envelope out |
| **LFO** | free or synced, several shapes, reset inlet |
| **S&H** | sample and hold |
| **Offset** | attenuverter and offset. Unglamorous and load-bearing |
| **Mixer** | four in, CV levels |
| **MIDI** | pitch, gate, velocity and mod from a keyboard. The only module whose input does not arrive on a cable |
| **Clock** | gate, a fixed 1ms trigger, and a phase ramp. Armed at construction, so it ticks the moment it is patched |
| **Seq** | eight steps of pitch and on/off, advanced by an external clock. No clock inside it |
| **Quantizer** | scale-lock. The highest musical return per line of code in the list |
| **Out** | terminal. Feeds the existing scope and visualiser |

Deliberate omissions. **No sampler** — no samples anywhere is a project rule and this is not
the place to break it. **No reverb**: the generated-IR reverb in `effects.ts` is a
convolver, which belongs after the rack's output as an ordinary Web Audio send, not inside
the worklet. **No polyphony** — see below.

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
drag primitives, the oscilloscope, the twelve scenes, the audio-start gesture handling, and the
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

And the fourth, which sidesteps the latency problem completely: **the visualiser.** Twelve 3D
scenes already exist, on the render thread where being a frame late costs nothing. A compute
shader driving a particle field from the rack's output is the WebGPU idea with no architectural
tax attached, and it is the one to do first.

## What to build, in order

The risk is all in the first item. Do it first and alone.

1. **The spine.** ✅ Built — `packages/rack`, 51 tests, no browser needed. Plan compiler plus
   worklet host, three modules: VCO into Ladder into Out. What it cost was almost entirely in
   places this sketch did not predict, so they are written down in the package README and in
   the comments. The one worth repeating here: minified, `Ladder.toString()` comes out as
   `class{...}` — *anonymous*, not merely renamed — so emitting `const ${dep.name} = ...` would
   have produced `const  = class{...}`, an unparseable worklet, in production builds only.
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
     row to itself. Order-preserving — in a rack the arrangement *is* the document, so a packer that
     shuffled modules to close gaps would move what somebody had placed.
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
   - **The sequencer's oscilloscope, reused.** That took *removing* a dependency rather than adding a
     fallback: it read its analyser from the sequencer's store, so importing it would have dragged the
     engine, the songs and the scenes into a 37kB page. It takes the analyser as a prop now and both
     pages pass their own. Diagnostic rather than decorative here — a VCA left shut reads as a flat
     line, and a patch clipping into the Out reads as a flattened top.

   Then: **a patch library.**

   Four shipped patches live in `@driftbox/rack`, not in the app — the same reasoning that puts the songs
   in the engine: they are data about the rack rather than about the page showing it, so a headless
   consumer gets them too. Built rather than stored, so loading one twice cannot hand back an object
   somebody has already edited. They deliberately share almost nothing, because four sequenced acid lines
   would demonstrate the opposite of what a modular is: one has no sequencer, one has no oscillator, and
   `patches.test.ts` asserts that rather than trusting it.

   Named slots on top, in `app/src/rack/library.ts`. Storage is a **parameter** defaulting to
   `localStorage`, which is what makes the whole thing testable in Node against a plain Map — the same
   trade `compile` makes by taking a registry instead of importing one. A library nobody can test is a
   library that quietly loses somebody's patches.

   Still to do: module drag-to-reorder, and a decision about the visualiser — see below.

## The visualiser, and why it is not on the rack yet

The sequencer has twelve 3D scenes and the obvious next move is to put one behind the rack. Measured
rather than assumed, that costs more than it looks:

| | |
|---|---|
| rack page today | **39 kB** |
| `three` + `@react-three/fiber` | ~600 kB |

Fifteen times the page, for something decorative. It is also the wrong decoration: the back panel is a
picture you are trying to *read* — which cable goes where, which one is dashed — and a moving scene behind
it competes with exactly the thing it would be sitting behind.

The oscilloscope was worth it and cost nothing extra, because it is diagnostic: a VCA left shut reads as a
flat line and a patch clipping into the Out reads as a flattened top, and neither is visible any other way.

If the scenes do arrive, the shape is a **dynamic import** behind a switch that is off by default, so the
600 kB is paid by whoever asks for it. Worth deciding deliberately rather than drifting into.
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

   **5b. Polyphony.** N processors per node, per-voice buffers, `poly: false` and summing at the
   collapse. See the corrected section above: no module code changes.

   **5c. A VCV Rack importer, topology only.** Read `patch.json`, map the Fundamental modules
   that have equivalents here, land the rest as placeholders — which the existing placeholder
   rule already draws honestly, having been designed for version skew and turning out to fit
   this exactly. Running VCV's own modules stays out of scope: that is a C++/Wasm port with
   GPLv3 attached, and the Wasm section above covers why the boundary has to be crossed once per
   block rather than once per sample.

   A `.vcv` is a zip, and a zip entry is deflate-raw — which `DecompressionStream` already does,
   and which `app/src/hash.ts` already uses for the URL. So reading one needs no zip library,
   only the central directory parsed by hand.

   **Third-party modules: not yet.** `ModuleDef` and `Processor` changed four times in four
   PRs — `deps`, `terminal`, the `id` constructor argument, `labels` — and opening them turns
   each into a promise. Worth knowing that the security question is smaller than it looks: a
   worklet scope has no DOM, no `fetch` and no storage, so a hostile module can ruin your audio
   and spin a core but cannot exfiltrate anything. The stringify-and-string-key design means
   opening this later is a small change rather than a rewrite, so there is nothing to pay in
   advance.

Steps 1 to 3 are small — that is the part that was already feasible on 1999 hardware and is
close to free now. Step 4 is where the months are. Reason's budget went into faceplates and
cables, not filters, and ours will too.
