# @driftbox/rack

A modular synth rack: modules, cables between any of them, and one graph running at sample
rate inside a single AudioWorklet.

It is still a work in progress and is intentionally private and unpublished. Once complete
and ready to support a public API, it can join the engine and app on npm.

Thirty-one modules, a compiler, a worklet host and a patch format. The app supplies the
playable front and back panels at [`rack.html`](../app/rack.html): cable dragging, keyboard and MIDI,
tracker, sampler, patchable VU meters, patch library, Combinator routing with MIDI learn,
drag-to-reorder, performance mode and offline export.
`../../docs/RACK.md` records the design and the decisions the implementation taught us.

```js
import { Rack, MODULES } from '@driftbox/rack'

const rack = new Rack(ctx, MODULES)
if (!(await rack.start())) throw new Error('no AudioWorklet, no rack')

rack.patch = {
  modules: [
    { id: 'osc', type: 'vco', params: { tune: -12 } },
    { id: 'filter', type: 'ladder', params: { cutoff: 700, resonance: 0.8 } },
    { id: 'out', type: 'out' },
  ],
  cables: [
    { from: ['osc', 'out'], to: ['filter', 'in'] },
    { from: ['filter', 'out'], to: ['out', 'in'] },
  ],
}
rack.output.connect(ctx.destination)
rack.setParam('filter', 'cutoff', 2400)
```

Live capture stays host-side because browser permission and device ids are not portable
patch data. The app does this behind its Input control; an embedding host can do the same:

```js
import { RACK_LIVE_INPUT } from '@driftbox/rack'

const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
ctx.createMediaStreamSource(stream).connect(rack.input(RACK_LIVE_INPUT))
```

## Embedding it in a web game

The whole rack is a `Rack` on a context you own, so a game embeds it the way it embeds any Web Audio: make
the context on a user gesture, start the rack, connect it wherever the game's audio goes.

```js
const ctx = new AudioContext()               // on a click, tap or key — browsers require a gesture
const rack = new Rack(ctx, MODULES)          // or a registry of just the modules your patch uses
if (!(await rack.start())) return            // no AudioWorklet, no rack: the one failure to handle
rack.patch = decodePatch(levelMusic) ?? PATCHES[0].build()
rack.output.connect(musicBus)                // your own gain, so the game can duck it
rack.setTransport(rack.patch.tempo ?? 120, true)
```

Nothing about that is rack-specific except `start()`, which resolves `false` where worklets are unavailable
— a rack without one is not a degraded rack, it is no rack, and saying so beats looking broken. From there
the two sections below are what a game reaches for: `Adaptive` to follow the scene, and `RackRenderer` if
any of the music wants rendering ahead of time rather than played live.

## What it costs a bundle

The registry is an argument rather than a default, and that is the whole of why these numbers move: a
default parameter is a static reference, so `MODULES` used to be retained even by a caller passing its own
registry. Measured before the change, `Rack` came to 24.2kB gzipped and did not move by one byte when handed
a four-module registry.

| what you import | minified | gzip | brotli |
|---|---|---|---|
| `Rack` + `Adaptive` + `LanePlayer` + codec, four modules | 31.2 | **11.2** | 10.1 kB |
| the same, eight modules | 35.8 | 12.6 | 11.3 kB |
| the same, `MODULES` — all thirty-three | 74.3 | 24.2 | 21.3 kB |
| `RackRenderer` + `Adaptive`, four modules | 21.3 | 7.7 | 7.0 kB |
| every export, nothing shaken | 146.8 | 43.9 | 38.0 kB |

So a game that knows its patch carries about 11kB gzipped for a modular synth, its compiler, an adaptive
score and automation playback. A patch editor — anything where somebody can drag in any module — passes
`MODULES` and carries all of it, which is what this repo's own app does.

The content tree-shakes on its own: the shipped patches are 3.5kB gzipped, the chunks 1.3kB and the VCV
importer 1.7kB, and none of them appear unless imported. The floor underneath everything is the compiler and
the graph at 4.4kB.

Measured by bundling each entry point with rolldown at `minify: true` — the bundler Vite uses — then
compressing with gzip -9 and brotli quality 11.

## Playing what was recorded

A patch can carry recorded parameter moves, and **it does not play them by itself**. The rack's own
sequencing runs on the audio thread, but automation lanes live in the document, so something host-side has
to hand them over in time. `LanePlayer` is that, and it used to exist only inside this repo's app — which
meant a patch opened anywhere else played the patch and not the performance, silently.

```js
const lanes = new LanePlayer(rack)
setInterval(() => lanes.advance(rack.patch.automation), 100)   // or in the game's update loop
```

Each point is handed over with the frame it belongs at, so how often you call `advance` decides only how
far ahead work is done, never where a value lands. It queues nothing while stopped and re-queues from the
current position after a seek or a loop.

## Rendering it without a browser

`Rack` and `renderPatch` are both Web Audio — a live context and an offline one. The DSP is not: `Graph` is
arithmetic over `Float32Array`s, so a patch can be rendered anywhere JavaScript runs. `RackRenderer` is that
path, made supported, so an embedder is not reaching for `compile` and `Graph` — the tier this package
explicitly does not promise — and reassembling the module registry by hand.

```js
import { RackRenderer, PATCHES } from '@driftbox/rack'

const renderer = new RackRenderer(MODULES, { sampleRate: 48000 })
renderer.patch = PATCHES[0].build()
renderer.setTransport(renderer.patch.tempo ?? 120, true)

const block = [new Float32Array(128), new Float32Array(128)]
renderer.process(block)          // fill your own buffers, forever
const file = renderer.render(8)  // or render a stretch in one call
```

It is the same `compile`, the same modules and the same `Graph` the worklet runs — not a second
implementation — and `headless.test.ts` pins that the two produce identical samples.

**The groovebox does not come with it.** A patch's 808, 909 and 303s arrive on the host inputs from
`@driftbox/engine`, whose renderer is Web Audio from end to end, so headless you get the rack's own modules
and whatever you feed `process`'s `hostInputs`. In a browser, both halves work as they always have.

`examples/headless.mjs` renders a shipped patch to a WAV and prints what it cost. On this machine a full
preset is around 20x realtime at 48kHz — a few percent of one core.

## Following a scene

A game has a number describing how things are going and wants the music to know. `Adaptive` is the mapping
from that number to the patch's knobs, and the rule about when each one is allowed to move.

```js
import { Adaptive } from '@driftbox/rack'

const score = new Adaptive(rack, {
  controls: [
    { target: ['macro', 'rotary1'], points: [{ at: 0, value: 0 }, { at: 1, value: 127 }] },
    { target: ['drums', 'pattern'], points: [{ at: 0, value: 0 }, { at: 1, value: 3 }],
      onBar: true, step: true },
  ],
})

score.update(danger, rack.beat)   // in the game's update loop
```

`beat` is answered the same way by both hosts — `Rack` derives it from `ctx.currentTime`, `RackRenderer`
counts frames — so one score drives a live rack and an offline render without being written twice. An
`OfflineAudioContext` is the exception: its clock does not advance while it renders, so drive a score
through `RackRenderer.render`'s `onBlock` rather than off a `Rack` on an offline context.

**It moves parameters inside one patch rather than swapping patches**, and that is the load-bearing
decision. Applying a plan rebuilds every processor, so a patch swap restarts oscillator phase, filter state
and envelope stages — a hard cut with a click on it. A Combinator rotary already reaches any parameter of
any module, including the stepped ones no cable can touch, so there is nothing a swap would buy.

The other rule is *when*. A level or a cutoff moves at once and the Graph ramps it across the block, so it
slides. A pattern index or a waveform waits for the bar line, because a drum pattern that changes on beat
three is not a transition. `onBar` is that, and it is the only thing `update`'s `beat` argument is read for.

Call `update` as often as you like: it sends only what changed, so a steady scene costs nothing.

## Why it is not part of `@driftbox/engine`

That engine is trigger-shaped: a voice is a pure function from knobs to a `VoiceSpec`, and
the renderer builds fresh Web Audio nodes for each hit. A rack is the opposite — one
persistent graph where anything modulates anything at audio rate. Two engines, one host,
summing into the same destination.

It does depend on the engine for one thing: the ladder module wraps `Ladder` rather than
copying it. Two copies of a filter would diverge, and a rack whose squelch had drifted from
the drum machines' squelch is exactly the failure the engine's own README warns about.

## What is deliberate

**The graph is ours, not the browser's.** One AudioWorkletProcessor holds the whole patch.
Native nodes look cheaper and are a dead end: `AudioParam` only reaches the parameters the
spec chose to expose, so you cannot modulate a filter's *type*, or a delay's sync division,
or anything a module invents. Owning the graph is what makes it a modular.

**The compiler is pure and the audio thread only walks a list.** Ordering, cycle breaking
and buffer allocation all happen in `compile.ts` against plain objects, so all of it is
tested as arithmetic. A topological sort inside `process()` would be a glitch waiting for the
first patch edit.

**Cycles are broken by ordering, not by a delay line.** A module that runs before its source
reads the buffer the source wrote last block. The buffers are not cleared between blocks, so
the one-block delay falls out for free — no copy, no special buffer. It is reported in
`plan.notes` so a UI can draw that cable differently, because a patch that behaves unlike its
picture is worse than one that admits it.

**A module type this build does not know becomes a placeholder, not a deletion.** Deleting it
would take every cable touching it too. Open a newer patch in an older build, re-save, and
the patch would be quietly demolished.

**Dependencies are looked up by string key, never by identifier.** Minified, `Ladder`
serialises to `class{...}` with no name at all — see the comment at the top of `worklet.ts`.
This one fails in production only.

**One signal type.** Audio and CV are the same `Float32Array`; pitch inlets are
volts-per-octave and 0 V is C2. Nothing enforces which is which.

**A Combinator routing is arithmetic on the patch, not a cable.** Reason's Modulation Routing —
one rotary moving several devices' parameters at once — is a list of `{from, to, min, max}` in
the patch, applied by `applyModulation` and by `compile`. It is deliberately *not* in the graph:
an inlet is a buffer the graph fills at sample rate and a param is a slot the host writes, and
joining the two would mean either promoting every param to a buffer or giving the audio thread a
second claim on values the host owns. Control rate is also what Reason's Combinator is. The
payoff is that the routed value saves, travels in a URL and renders in an offline export with no
new machinery at all — and a rotary can reach a VCO's *waveform*, which no cable can.

```js
rack.patch = {
  modules: [
    { id: 'macro', type: 'combi', params: { rotary1: 127 } },
    { id: 'filter', type: 'ladder' },
    { id: 'out', type: 'out' },
  ],
  cables: [{ from: ['filter', 'out'], to: ['out', 'in'] }],
  modulation: [
    { from: ['macro', 'rotary1'], to: ['filter', 'cutoff'], min: 200, max: 8000 },
  ],
}
rack.setParam('macro', 'rotary1', 0)   // the host settles the targets; see applyModulation
```

## What is promised, and what is not

The package exports two tiers, listed explicitly in `index.ts` and pinned by `api.test.ts`.

**Promised** — the rack, the document, the content: `Rack`, `Patch` and its parts,
`encodePatch`/`decodePatch`/`PATCH_FORMAT`, `MODULES`, the shipped patches and chunks, the
Combinator's routing helpers, `renderPatch`, `renderRetainedSongMix`, the VCV importer.

**Not promised** — exported because something in this repo needs them: `compile` and the `Plan`
shapes it returns, `Graph`, the worklet loaders, and the individual module defs and processors.
`Processor`, `ProcessorClass` and `Dep` are the third-party-module question `docs/RACK.md` defers,
and `Plan` is an implementation detail of the compiler.

**`export * from './types.js'` used to stand where that list is**, which is how the compiler's
internals became API without anybody deciding they should be. The tiers are not enforceable by the
type system — TypeScript cannot say "exported but not promised" — so they are enforced by being
written down and pinned. The pin's job is not to be right about the names; it is to make changing
them a line in a diff.

**The patch format is the part worth being stable about**, and that is designed in rather than
hoped for: a version in the envelope, every added field optional, a decoder that never throws and
preserves what it does not recognise, and a test that a patch written before a field existed still
round-trips byte-identically. Adding `modulation` for the Combinator exercised all of that.

## Tests

None of them need a browser.

| | |
|---|---|
| `modules/modules.test.ts` | Every module in the registry against the structural rules at once — writes every outlet sample, never writes an inlet or a param buffer, stays finite at both ends of every param with hostile inlets, is deterministic, survives `toString()` into a bare scope, declares every dep it looks up. A new module gets all of it by being added to the list |
| `compile.test.ts` | The graph as graph theory: ordering, cycle breaking, the zero buffer, contested inlets, placeholders, migration |
| `graph.test.ts` | The whole thing in Node, measuring the audio — including three patches that use most of the rack at once |
| `worklet.test.ts` | The assembled worklet source, evaluated in a scope of its own, asserting it produces the same samples as the graph running in-process |
| `keys.test.ts` | That module and port names containing spaces, quotes or a NUL cannot be confused for one another |
| `api.test.ts` | The exported names, in two tiers. Adding an export fails it by name, which is the point |
| `minified.test.ts` | The package bundled and minified by rolldown, with the worklet then assembled from what came out and measured against the same patch unminified. The `toString()` scheme's failure is silent and happens only in a consumer's build |
| `lanes.test.ts` | The lookahead scheduler: that a point lands on the frame its position falls on, that it is queued exactly once across the seam, that a stopped transport queues nothing, and that a seek re-queues |
| `host.test.ts` | Where the live host thinks the music is: that the position advances at the tempo, that changing tempo does not move the past, and that a pause holds while a restart rewinds |
| `headless.test.ts` | The browser-free host: that it makes sound with no `AudioContext` defined at all, that it is sample-for-sample the same as driving the Graph by hand, that a scheduled change lands mid-block, and that its musical position survives a tempo change |
| `adaptive.test.ts` | The score: what a curve reads, that it holds the end rather than extrapolating, that a bar-locked control waits and lands on the value wanted *at* the bar, that a seek counts as a boundary, and that a steady scene sends nothing |
| `modulation.test.ts` | Combinator routing: which of two routes onto one target wins, what a route onto a stepped param lands on, that a chain sees the value an earlier route wrote, that a cycle settles rather than oscillating, and that a route this build cannot resolve survives a round trip |
| per-module | The claims each module's comments make: alias suppression against an additive reference, the pink slope, every ADSR time knob against a stopwatch, the delay's interpolation, the quantizer's octave boundaries |

```bash
npm test --workspace @driftbox/rack
```
