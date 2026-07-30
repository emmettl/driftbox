# @driftbox/rack

A modular synth rack: modules, cables between any of them, and one graph running at sample
rate inside a single AudioWorklet.

It is still a work in progress and is intentionally private and unpublished. Once complete
and ready to support a public API, it can join the engine and app on npm.

Twenty-two modules, a compiler, a worklet host and a patch format. The app supplies the
playable front and back panels at [`rack.html`](../app/rack.html): cable dragging, keyboard and MIDI,
tracker, sampler, patch library, performance mode and offline export. `../../docs/RACK.md`
records the design and the decisions the implementation taught us.

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

None of them need a browser.

| | |
|---|---|
| `modules/modules.test.ts` | Every module in the registry against the structural rules at once — writes every outlet sample, never writes an inlet or a param buffer, stays finite at both ends of every param with hostile inlets, is deterministic, survives `toString()` into a bare scope, declares every dep it looks up. A new module gets all of it by being added to the list |
| `compile.test.ts` | The graph as graph theory: ordering, cycle breaking, the zero buffer, contested inlets, placeholders, migration |
| `graph.test.ts` | The whole thing in Node, measuring the audio — including three patches that use most of the rack at once |
| `worklet.test.ts` | The assembled worklet source, evaluated in a scope of its own, asserting it produces the same samples as the graph running in-process |
| `keys.test.ts` | That module and port names containing spaces, quotes or a NUL cannot be confused for one another |
| per-module | The claims each module's comments make: alias suppression against an additive reference, the pink slope, every ADSR time knob against a stopwatch, the delay's interpolation, the quantizer's octave boundaries |

```bash
npm test --workspace @driftbox/rack
```
