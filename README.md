# Driftbox

A drum machine and step sequencer in the browser — a TR-808 and a TR-909, both
synthesised from scratch, with a chillwave visualiser and an oscilloscope. Inspired by
Propellerhead ReBirth.

```bash
npm install
npm run dev

npm run lint    # oxlint
npm test        # vitest
npm run build   # type-check + production build
```

Space plays and stops · `V` drops into performance mode · `X` switches the scope between
a waveform and a vectorscope · click a step to cycle it off → on → accented.

## No samples

Every sound is synthesised from the circuit topology of the machine it comes from. The
808's bass drum is a sine with a fast pitch drop and a click of filtered noise; its snare
is two tuned oscillators mixed against a noise generator by the "snappy" control; its
hats and cymbals are six square oscillators at deliberately inharmonic ratios, so no two
partials form a simple interval and the ear refuses to hear a pitch. The 909 uses the
same approach with a different character — shorter, driven, brighter.

Reproducing the topology gets far closer than EQ-ing a noise burst into submission, and
it means every knob does something real rather than filtering a fixed recording. It also
keeps the whole kit to a few kilobytes of code.

## Voices are data

A voice is a **pure function from its knob positions to a `VoiceSpec`** — a description
of oscillators, noise sources, envelopes and filters. A separate renderer turns that spec
into Web Audio nodes. Nothing below `src/engine/` knows an `AudioContext` exists until
that last step.

That split is what makes the synthesis testable. "Does the kick sweep downward into the
bass" is otherwise only answerable by ear, which in practice means never answered at all;
here it is an assertion. It also means a patch can be serialised, and that the same spec
can be rendered into a live context *or* an `OfflineAudioContext` — which is how the kit
is actually verified, and how the channel strip draws each voice's real waveform.

## Timing

Timers decide when to *look ahead*, never when a sound happens. Every hit is scheduled
against the audio clock, ahead of time, so the groove is sample-accurate regardless of
what the main thread is doing. The heartbeat runs in a Worker, because a background tab
clamps `setInterval` to about once a second — far longer than the lookahead window, which
would starve the scheduler and drop the audio the moment you switched tabs.

## The engine is reusable

`src/engine/` imports no React, touches no DOM, and does not know a sequencer UI exists.
It is meant to be embedded — the intent is for it to score
[Driftlings](https://github.com/emmettl/driftlings):

```ts
import { DriftboxEngine } from './engine'

const engine = new DriftboxEngine(song)
await engine.start()          // from a click; browsers start contexts suspended
engine.audition('909.cp')     // one-shot, for a game event
```

A `Song` is plain JSON — patterns, a chain, and kit settings — so a soundtrack ships as
an asset rather than as code.

## Verification

The unit tests cover the pure layer: timing and swing maths, the pattern model, and the
shape of every voice's spec. Some of them assert real musical properties — that hats are
built from six *inharmonic* partials, that claps retrigger rather than firing once, that
the 909 kick is shorter and more driven than the 808's.

What tests cannot reach was measured by rendering offline and looking at the samples.
Doing that caught three things nothing else would have:

- **Voice levels were all over the place.** The 808 snare peaked at 2.27 while its clap
  and closed hat sat at 0.25 — nine to one, so the clap was inaudible under the kick and
  the snare clipped before it reached the bus. Each voice now carries a measured trim.
- **Two voices ignored their trim.** A soft-clipping curve maps ±1 to ±1, so trimming the
  signal going *into* the drive stage barely changes what comes out; it just saturates
  less. The trim had to move to the end of the chain.
- **The output clipped.** The busiest shipped pattern peaked at 2.14 raw and still 1.08
  after the bus compressor. All four patterns now peak under full scale with zero clipped
  samples.
