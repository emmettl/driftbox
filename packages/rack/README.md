# @driftbox/rack

A modular synth rack: modules, cables between any of them, and one graph running at sample
rate inside a single AudioWorklet.

This is the **spine** — a compiler, three modules and a worklet host. There is no UI, no
patch file format and no way to drag a cable yet. `../../docs/RACK.md` is the design and the
build order; this package is step one of it.

```js
import { Rack } from '@driftbox/rack'

const rack = new Rack(ctx)
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

## Tests

51 of them, none needing a browser. `compile.test.ts` covers the graph as graph theory,
`graph.test.ts` runs the whole thing in Node and measures the audio, `modules/vco.test.ts`
measures alias suppression against an additively-synthesised reference, and
`worklet.test.ts` evaluates the assembled worklet source in a scope of its own and asserts
it produces the same samples as the graph running in-process.

```bash
npm test --workspace @driftbox/rack
```
