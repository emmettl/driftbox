# Driftbox — state and roadmap

Where this is, what is deliberate, and what to do next. Read this before changing
anything in `src/engine/`.

## Where it is

**Working end to end.** Two drum machines, a 16-step sequencer with pattern chaining, a
per-voice channel strip, an oscilloscope and a chillwave visualiser with a performance
mode. CI is green; there are 130 unit tests.

| | |
|---|---|
| Machines | TR-808 (11 voices), TR-909 (11 voices) |
| Synthesis | Pure Web Audio nodes. **No samples anywhere.** |
| Sequencer | 16 steps, off / on / accent, four patterns, chain, swing |
| Per voice | Level, tune, decay, tone, colour, pan · live waveform |
| Visuals | Oscilloscope (waveform + vectorscope), chillwave scene, performance mode |
| Not built | 303 basslines, pattern save/load, song mode, per-voice outputs |

## What is deliberate

These are decisions, not accidents. Each has a reason that is easy to lose.

**A voice is a pure function from knobs to a `VoiceSpec`.** The renderer
(`engine/render.ts`) is the only file that touches an `AudioContext`. Do not put
synthesis decisions in the renderer or audio-node handling in a voice. The split is what
makes the kit testable and what allows offline measurement — see below.

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
preference — it is what lets the engine be embedded elsewhere. Nothing under
`src/engine/` may import from `src/ui/`, `src/visual/` or `src/store.ts`.

## Next

Roughly in the order I would do them.

### 1. Score Driftlings with it

The reason the engine boundary exists, and still unproven. `src/engine/` is a standalone
module with no UI dependencies; [Driftlings](https://github.com/emmettl/driftlings) is
the intended host.

The interesting part is not playback, it is **adaptation**: Driftlings already knows how
a level is going (driftlings out, saved, lost, time elapsed), so the pattern chain can
follow it — `haze` while the crowd is walking, `drift` once skills are being spent,
`neon` when it is going well, and something sparse when it is going badly. That is a
better demonstration of a reusable engine than a loop playing underneath.

Mechanically: decide how the code is shared first. Options are a published package, a git
dependency, or a monorepo. **Copying the files is the wrong answer** — two copies of a
synthesis engine diverge, and the whole point is that they cannot.

### 2. The 303s

The other half of ReBirth, and the part with real DSP in it. A TB-303 is a
sawtooth/square through a resonant 4-pole ladder filter with an envelope, plus accent and
slide.

`BiquadFilter` will not do it. A 303's character is a 4-pole ladder that self-oscillates,
and a biquad is 2-pole with a tame resonance — you can get close to a filter sweep but
never to the squelch. This wants an **`AudioWorklet`** running a real ladder
implementation (Stilson/Smith, or the Huovilainen model), which is the most interesting
Web Audio work left in the project.

Slide (portamento between overlapping notes) and accent (which drives both level and
filter envelope) are what make a 303 line sound like a 303 line rather than a synth
playing sixteenths. Do not skip them.

### 3. Pattern persistence

Right now a reload loses your work, which makes the app hard to actually use. A `Song` is
already plain JSON, so this is mostly plumbing: `localStorage` for the working session,
plus export/import to a file. A shareable URL — song compressed into the hash — is a nice
extra and costs little.

### 4. Per-voice send effects

A drum machine with no reverb or delay is missing most of the genre. The cheap version is
one delay and one reverb (a generated impulse response via `ConvolverNode`) as sends,
with a knob per voice. This is where a sparse chillwave pattern starts to sound like a
record rather than a demo.

## Known limitations

- **Nobody has confirmed how it sounds.** Everything was verified by measurement — the
  synthesis is structurally correct and well-behaved, but no ear has passed judgement.
  The **909 hats, ride and crash** are where I would expect disagreement first: on the
  real machine those were 6-bit samples, so the inharmonic-oscillator approach is
  furthest from the original there.
- **The chillwave backdrop is nearly invisible behind the console.** Deliberate (the step
  grid has to stay readable) but the sun in particular never shows. If it should read
  more strongly, move the scene's sun down rather than raising the opacity.
- **Swing applies to the whole pattern.** Per-voice swing — hats shuffling against a
  straight kick — is a small change to `Transport` and a real musical win.
- **Pattern length is fixed at 16 in the UI.** The model already supports any length, and
  polymetric loops (a 15-step hat line over a 16-step kick) come free from that.
- **No metronome or count-in.**

## Verifying changes

`npm test` covers the pure layer. Anything about how it *sounds* has to be measured —
see [docs/VERIFYING-AUDIO.md](docs/VERIFYING-AUDIO.md). Please re-run the level
measurements after touching any voice, `render.ts`, or the bus chain; three real bugs
came out of that and all three were invisible to the tests.
