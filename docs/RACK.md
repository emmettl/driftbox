# The rack — a design sketch

A modular synth rack, in the browser, patched with cables. Reason's back panel rather than
Reason's front: a small set of modules, free routing between all of them, and a patch that
fits in a URL.

Nothing here is built. This is the shape of it, the decisions that are expensive to change
later, and the order to prove them in.

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
2. Allocate a `Float32Array(128)` per cable from a pool. Unconnected inlets point at a
   shared zero buffer, so a module never branches on whether it is patched.
3. Emit an ordered list of `(processor, inletBuffers, outletBuffers)`.

Then `process()` walks that list once per render quantum, module by module — not sample by
sample across the whole graph. Each module's inner loop stays tight and stays hot.

Per-block dispatch does **not** cost sample accuracy on a normal signal path: the
topological order guarantees an upstream module has filled its 128 samples before anything
downstream reads them, so an LFO at audio rate modulates a cutoff per sample as it should.

It costs accuracy in exactly one place. A cycle cannot be topologically ordered, so the
compiler breaks each one by marking a cable as **delayed** — it reads the buffer the
previous block wrote. That is a 2.9 ms delay at 44.1 kHz, and it is what Reason did. Tell
the UI which cable was chosen so it can be drawn differently; a feedback patch that
silently behaves unlike the picture is worse than one that admits it.

Zero-delay feedback *inside* a module stays the module's own problem. The ladder already
handles its own.

### Parameters, not AudioParams

Knobs arrive as messages — `{ param, module, id, value, at }` — and the audio thread runs a
one-pole smoother per parameter. `AudioParam` is the wrong tool: the parameter set is
dynamic, it is large, and there is only one processor to hang them on.

`at` is a frame number. Inside a worklet you have `currentFrame`, which is a better clock
than `ctx.currentTime` — the rack's own sequencer needs no lookahead timer and no worker
ticker at all. It only needs a tempo and a start frame from outside.

The message set is the ABI. Keep it to `patch`, `param`, and `transport`, and resist
growing it.

## The module contract

```ts
interface ModuleDef {
  type: string          // 'vco' — stable forever, this is what a patch stores
  version: number
  inlets: Port[]
  outlets: Port[]
  params: ParamDef[]    // id, min, max, default, curve
  processor: new (sampleRate: number) => Processor
  migrate?(params: Record<string, unknown>, from: number): Record<string, unknown>
}

interface Processor {
  /** Per voice, per block. Reference nothing outside this class. */
  process(inlets: Float32Array[], outlets: Float32Array[], params: Float32Array[], frames: number): void
}
```

`migrate` lives next to the module rather than in a central switch. At forty modules a
central migration table is unmaintainable, and the person adding a parameter is the person
who knows what the old value meant.

## Fifteen modules

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
| **Clock/Seq** | gate and pitch out, driven by the transport |
| **Quantizer** | scale-lock. The highest musical return per line of code in the list |
| **Out** | terminal. Feeds the existing scope and visualiser |

Deliberate omissions. **No sampler** — no samples anywhere is a project rule and this is not
the place to break it. **No reverb**: the generated-IR reverb in `effects.ts` is a
convolver, which belongs after the rack's output as an ordinary Web Audio send, not inside
the worklet. **No polyphony** — see below.

## Monophonic first, but shaped for polyphony

The MVP rack is one voice. Polyphony in a modular is not a feature you bolt on: it is
either N copies of the whole compiled plan, or a voice dimension on every buffer and every
piece of module state.

Make one concession now, because retrofitting it is a rewrite: **keep per-module state in an
array indexed by voice**, and have the compiler emit a plan that takes a voice index. The
`Ladder` already does exactly this, per channel — same shape, and the reason it can is that
it holds its state in `this.filters[channel]` rather than in fields. Follow that.

Then polyphony later is a loop count, not a redesign.

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
packages/rack/        @driftbox/rack — compiler, registry, worklet assembly, patch-io
packages/app/src/rack/  the faceplates and the cables
```

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
2. **Patch-io.** Encode, decode, repair, round-trip a fully populated patch, and the URL
   hash. Small, and it unblocks sharing anything built after it. Note that `ParamDef` has no
   `curve` field: the taper is the faceplate's business until there is a faceplate to have an
   opinion.
3. **The other twelve modules.** Now cheap, now independent — each is a class, a def and a
   test, and none of them can break another. The registry is already a parameter rather than a
   constant, which `graph.test.ts` leans on by defining modules of its own.
4. **The rack UI.** A list of faceplates first, cables second. This is the largest single
   piece of work in the project by a wide margin, which is the reason it is fourth: by the
   time the cables are drawn, everything they represent already works and is measured.
5. **Then decide** about polyphony, third-party modules, and whether the VCV importer above is
   a weekend or a rabbit hole. All three are real products in their own right and none should
   be guessed at from here.

Steps 1 to 3 are small — that is the part that was already feasible on 1999 hardware and is
close to free now. Step 4 is where the months are. Reason's budget went into faceplates and
cables, not filters, and ours will too.
