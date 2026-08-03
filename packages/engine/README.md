# @driftbox/engine

A TR-808, a TR-909 and two TB-303s, synthesised from scratch with Web Audio. **No
recorded samples** — the analogue voices follow their circuit topologies, while the
909's digital cymbals use generated 6-bit/30kHz PCM and modal synthesis. The 303 includes
a real 4-pole ladder filter running in an `AudioWorklet`.

Imports no React, touches no DOM, and does not know a sequencer UI exists. It is meant to
be embedded — in a game, an installation, or your own sequencer.

```bash
npm install @driftbox/engine
```

```ts
import { DriftboxEngine, defaultSong } from '@driftbox/engine'

const engine = new DriftboxEngine(defaultSong())
await engine.start()        // from a click; browsers start audio contexts suspended
engine.audition('909.cp')   // a one-shot, for a game event
```

Browser only — it is Web Audio from top to bottom. It imports cleanly in Node (useful for
tests and tooling) but needs a real `AudioContext` to make a sound.

## A song is a value

```ts
import { defaultSong, encodeSong, decodeSong, type Song } from '@driftbox/engine'
```

A `Song` is plain JSON: patterns, an arrangement, kit settings and effect sends. So a
soundtrack ships as an asset rather than as code, and `decodeSong` treats anything it is
handed as untrusted — clamping what is out of range, filling what is missing, and
returning `null` only for input that is not a song at all.

The four shipped patterns (`haze`, `drift`, `neon`, `pulse`) come with the package, so
there is something to play before you have written anything.

## Adaptive soundtracks

The chain is data, so a host can rewrite it as the thing it is scoring changes:

```ts
engine.song = { ...engine.song, chain: [{ pattern: 'haze', repeat: 4 }] }
```

Sections take effect at the next bar boundary, because the transport reads the
arrangement one bar ahead rather than caching it.

## Voices are pure functions

A voice is a **pure function from its knob positions to a `VoiceSpec`** — a description of
oscillators, noise sources, envelopes and filters. A separate renderer turns that spec
into Web Audio nodes, so the synthesis is testable without an audio device, a patch can be
serialised, and the same spec renders into a live context *or* an `OfflineAudioContext`:

```ts
import { renderVoiceOffline, voiceById } from '@driftbox/engine'

const samples = await renderVoiceOffline(voiceById('808.bd'))
```

## The 303s

A `BiquadFilterNode` cannot be a 303: two poles, linear resonance, no self-oscillation.
This uses Huovilainen's nonlinear ladder model in an `AudioWorklet` — four poles, feedback
past the point of oscillation, and a `tanh` *inside* the loop, which is what makes the
resonance thick rather than a whistle on top. Measured: self-oscillates at full resonance,
tracks the requested cutoff within 3% from 300Hz to 2.4kHz, and stays bounded however hard
it is driven.

Slide and accent are the rest of it. A slide glides between two notes sharing one
envelope; a paused step retains its pitch and can bend the following attack from silence,
as ReBirth did. An accent drives level, filter envelope depth *and* resonance together,
as the accent voltage does on the hardware.

If `AudioWorklet` is unavailable — an old browser, or a Content-Security-Policy that
blocks blob scripts — the 303s fall back to a single biquad and sweep rather than squelch.
`engine.usingLadder` says which you got.

## Licence

[MIT](../../LICENSE). The ladder filter follows the model published by Antti Huovilainen
("Non-linear digital implementation of the Moog ladder filter", DAFx-04); the
implementation is original.

**Not affiliated with, endorsed by, or connected to Roland Corporation.** TR-808, TR-909
and TB-303 are Roland's trademarks and appear here only to describe which instrument each
voice is modelled on. Every waveform is generated: there are no recorded samples, and no
recordings or ROM data from any hardware were used.
