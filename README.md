# Driftbox

A drum machine and step sequencer in the browser — a TR-808, a TR-909 and a pair of
TB-303s, all synthesised from scratch, with a chillwave visualiser and an oscilloscope.
Inspired by Propellerhead ReBirth.

Run it without installing anything at
[emmettl.github.io/driftbox](https://emmettl.github.io/driftbox/), or locally:

```bash
npx @driftbox/app
```

## Two packages

| | |
|---|---|
| [`@driftbox/engine`](packages/engine) | The synthesis and the sequencer. No React, no DOM — meant to be embedded. |
| [`@driftbox/app`](packages/app) | This sequencer, as a runnable app. |

The split is the point rather than tidiness: the engine is meant to score
[Driftlings](https://github.com/emmettl/driftlings), and two copies of a synthesis engine
would diverge. One package, one engine.

```bash
npm install     # workspaces; installs both
npm run dev     # the app, with the engine built from source for HMR
npm run lint    # oxlint
npm run typecheck
npm test        # vitest, across both packages
npm run build   # engine to dist/, then the app
```

Space plays and stops · `V` drops into performance mode · `X` switches the scope between
a waveform and a vectorscope · click a step to cycle it off → on → accented · on the 303
page, click a step to place a note and drag it up or down to tune it.

Patterns can be added, renamed (double click one), duplicated and deleted. **click** turns
on a metronome and **1·2·3·4** counts a bar in before playing.

The **Song** strip along the top is the arrangement — each card is a pattern and a number
of bars, and it can be rearranged while the thing is playing.

Your work is saved as you go. **share** puts the whole song in a link, **save** and
**load** move it to and from a file, and **reset** goes back to the shipped patterns.

Neither package is published yet. [docs/PUBLISHING.md](docs/PUBLISHING.md) is the setup
and the release steps; nothing goes to npm without cutting a release on purpose.

**Picking this up?** [ROADMAP.md](ROADMAP.md) has the current state, the decisions worth
not undoing, and what to build next. [docs/VERIFYING-AUDIO.md](docs/VERIFYING-AUDIO.md)
is how to check a change actually sounds right without trusting your ears or the tests.

`packages/app/public/og.png` is the link preview, and it is a real screenshot — so it goes
stale when the UI changes. Regenerate it by loading the app at a 1600×840 viewport,
pressing play so the scope has something in it, and screenshotting the page. The tags that
point at it live in `packages/app/index.html`, with the reasoning next to them.

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

## The 303s have a real ladder filter

A `BiquadFilterNode` cannot be a 303. It is two poles with a linear, tame resonance —
enough for a filter sweep, nowhere near the squelch. Three things make the difference,
and only the first is about slope: **four** poles rather than two, feedback strong enough
that the filter self-oscillates into a sine at its own cutoff, and a `tanh` **inside**
that feedback loop, which is what stops a self-oscillating filter from exploding and what
makes the resonance sound thick rather than like a whistle sitting on top of the sound.

So the filter is Huovilainen's nonlinear ladder model, running in an `AudioWorklet`. It
is written once, as ordinary TypeScript, and serialised into the worklet with
`toString()` — so the audio thread runs that exact code rather than a second copy that
can drift, and the filter stays testable as plain arithmetic. Measured: it self-oscillates
at full resonance, tracks the requested cutoff within 3% from 300Hz to 2.4kHz, decays to
nothing at half resonance, and stays bounded however hard it is driven.

Slide and accent are the rest of it. A slide is a glide between two notes that share one
envelope — which is why a 303 here is one continuous oscillator rather than a node per
note, as the drums are. An accent drives level, filter envelope depth *and* resonance
together, the way the accent voltage does on the hardware; wiring it to the level alone
is the usual way one of these ends up sounding flat.

## Voices are data

A voice is a **pure function from its knob positions to a `VoiceSpec`** — a description
of oscillators, noise sources, envelopes and filters. A separate renderer turns that spec
into Web Audio nodes. Nothing below `packages/engine/` knows an `AudioContext` exists until
that last step.

That split is what makes the synthesis testable. "Does the kick sweep downward into the
bass" is otherwise only answerable by ear, which in practice means never answered at all;
here it is an assertion. It also means a patch can be serialised, and that the same spec
can be rendered into a live context *or* an `OfflineAudioContext` — which is how the kit
is actually verified, and how the channel strip draws each voice's real waveform.

## A song is a value

A `Song` is plain JSON — patterns, a chain, kit settings and the effect sends. That was a
deliberate constraint from the start rather than a convenience, and it is what makes three
separate features nearly free: the session autosaves, a song exports to a file, and a
whole song compresses into a URL you can paste to somebody. Measured on the shipped song,
6020 bytes of JSON become 987 characters of hash.

The reading side is the part with actual work in it, because a song arrives from outside
the program — from storage written by an older build, from a file somebody edited by hand,
from a link someone else sent. `decodeSong` treats all of it as untrusted: it clamps what
is out of range, fills in what is missing, drops what it cannot read, and gives up only on
input that is not a song at all. The failure it exists to prevent is not subtle — it is
the app white-screening on load with your work apparently gone.

## The visualiser is the instrument

**vibes** goes full screen, and the whole screen is a filter pad — drag across for cutoff,
up for resonance, exactly where a Kaoss pad puts them. It filters *everything*, not just
the 303s: the fun of one of these is the whole record ducking away and coming back, drums
included. A 303 already has a cutoff knob on its channel strip for the other job.

It is momentary, so it glides back open when you let go, and it sits after the bus
compressor — so the compressor is not reacting to signal the filter is about to throw
away, and a resonant peak cannot be pumped by it. The metronome is downstream of it, which
means sweeping the filter shut never takes your count-in with it.

Works with a thumb. The pad is the reason the touch work exists.

## Swing is per voice

Swing that applies to everything at once is a tempo setting, not a groove. Here the
transport emits *straight* times and each voice is shifted by its own swing as it is
scheduled — so the hats can shuffle against a kick that stays flat on the grid, which is
most of what makes a slow pattern feel like it is leaning rather than limping.

Each voice's knob is an offset from the song's swing rather than an absolute value, so
moving the master swing moves everything with it instead of stranding every voice you
had already touched.

## Timing

Timers decide when to *look ahead*, never when a sound happens. Every hit is scheduled
against the audio clock, ahead of time, so the groove is sample-accurate regardless of
what the main thread is doing. The heartbeat runs in a Worker, because a background tab
clamps `setInterval` to about once a second — far longer than the lookahead window, which
would starve the scheduler and drop the audio the moment you switched tabs.

## The engine is reusable

`packages/engine/` imports no React, touches no DOM, and does not know a sequencer UI
exists. It is published as `@driftbox/engine` and meant to be embedded — the intent is for
it to score [Driftlings](https://github.com/emmettl/driftlings):

```ts
import { DriftboxEngine } from '@driftbox/engine'

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

## Licence

[MIT](LICENSE). Use it, embed it, sell what you build with it — the engine is meant to be
picked up, and that is the licence that gets least in the way of doing so.

The ladder filter follows the nonlinear Moog model published by **Antti Huovilainen**
("Non-linear digital implementation of the Moog ladder filter", DAFx-04). The
implementation here is original; the model is his, and it is worth reading if you want to
understand what the four stages are doing.

**Not affiliated with, endorsed by, or connected to Roland Corporation.** TR-808, TR-909
and TB-303 are Roland's trademarks, and ReBirth is Reason Studios'. They appear here only
to describe which instrument each voice is modelled on — nothing in this project is a
Roland product, and a software licence grants no trademark rights either way. Every sound
is synthesised from scratch: there are no samples, and no recordings of any hardware were
used to make it.
