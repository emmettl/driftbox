# Verifying audio without listening to it

Unit tests can check that a kick's spec *describes* a downward pitch sweep. They cannot
check that the thing which comes out of the speakers is a kick. This is how to close that
gap — and it is not a formality: every one of the three level bugs found so far was
invisible to the test suite and obvious to a measurement.

The whole approach rests on one property of the engine: a `VoiceSpec` renders into an
`OfflineAudioContext` exactly as it renders into a live one. So you can render a voice,
or a whole pattern, faster than real time and read the samples.

## Running a measurement

`OfflineAudioContext` is a browser API, so these run in the page, not in Node. Start the
dev server and paste into the browser console — or use whatever tooling drives the page.

A headless browser works and is worth the setup if you are changing anything more than
once — the recipes below are all `page.evaluate` bodies:

```js
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
console.log(await page.evaluate(async () => { /* recipe here */ }))
```

Vite serves the TypeScript directly, so the engine can be imported at runtime. The
`/@id/` prefix is how Vite exposes a bare specifier to a dynamic import — `@driftbox/engine`
on its own is not a URL, and the engine now lives outside the app's own source tree:

```js
const eng = await import('/@id/@driftbox/engine')
const { defaultSong } = eng   // the shipped patterns come from the engine too
```

> **Gotcha.** After Vite hot-reloads a file it serves it under a cache-busted URL, so a
> console `import()` can hand you a *different module instance* than the running app.
> That does not matter for pure functions like `renderVoiceOffline`, but it does mean you
> cannot drive the app's zustand store this way — state you set will not reach the UI.
> Reload the page before measuring, and drive the UI by clicking it.

## Recipe 1 — one voice

Peak level, decay time, and where its energy sits.

```js
const eng = await import('/@id/@driftbox/engine')
const SR = 44100
const d = await eng.renderVoiceOffline(eng.voiceById('808.bd'), undefined, 1, SR)

let peak = 0, peakAt = 0
for (let i = 0; i < d.length; i++) {
  const a = Math.abs(d[i]); if (a > peak) { peak = a; peakAt = i }
}
// Time from the peak until it stays below 1% of it.
let tail = peakAt
for (let i = d.length - 1; i > peakAt; i--) {
  if (Math.abs(d[i]) > peak * 0.01) { tail = i; break }
}
console.log({ peak, decayMs: Math.round(((tail - peakAt) / SR) * 1000) })
```

**What good looks like.** Every voice should peak in roughly `0.65–0.90` at default
knobs. Nothing should exceed `1.0`. A kick decays in a few hundred milliseconds, a closed
hat in tens, a crash in over a second.

If a voice is out of range, fix its `trim` in the kit registry — `trim = 0.75 / peak` —
rather than reaching for its internal gains.

## Recipe 2 — the whole kit's balance

The check that caught the worst bug. Voices summing different numbers of sources land at
wildly different levels, and the symptom is musical, not technical: a clap you cannot
hear under the kick.

```js
const eng = await import('/@id/@driftbox/engine')
let min = 9, max = 0
for (const v of eng.ALL_VOICES) {
  const d = await eng.renderVoiceOffline(v, undefined, 1, 44100)
  let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]))
  min = Math.min(min, p); max = Math.max(max, p)
}
console.log({ min, max, spread: max / min })
```

**What good looks like.** Spread under about `1.7`, and no voice over `1.0`.

**Run it more than once.** Noise sources start at a random offset into the shared buffer,
so voices with noise in them peak differently every render and this number moves. Measured
over five consecutive runs: `1.43, 1.50, 1.53, 1.64, 1.67`. A single run saying `1.35` —
which is what this document used to claim — was one sample of that spread, not a fixed
property. It was `9.1` before the trims, so the trims are still doing their job.

**Known and not yet fixed:** in one of those five runs the 909 open hat peaked at `1.023`,
just over full scale on its own. It is intermittent by nature — it depends where in the
noise buffer that render happened to start — and it is quiet enough not to clip the bus,
but the stated bar is that no voice exceeds `1.0` and this one sometimes does.

## Recipe 3 — a pattern, through the real bus

Renders a pattern through the same gain / compressor / master chain the live engine uses,
and checks the output does not clip. Keep the bus values here in step with the engine's
constructor.

```js
const eng = await import('/@id/@driftbox/engine')
const { defaultSong } = eng
const SR = 44100, song = defaultSong()
const pattern = song.patterns.find(p => p.id === 'pulse')

const dur = eng.stepTime(0.05, pattern.length * 2, song.bpm, song.swing) + 1.2
const ctx = new OfflineAudioContext(1, Math.ceil(dur * SR), SR)

const bus = ctx.createGain(); bus.gain.value = 0.9
const comp = ctx.createDynamicsCompressor()
comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4
comp.attack.value = 0.004; comp.release.value = 0.18
const master = ctx.createGain(); master.gain.value = 0.7
bus.connect(comp); comp.connect(master); master.connect(ctx.destination)

for (let s = 0; s < pattern.length * 2; s++) {
  const t = eng.stepTime(0.05, s, song.bpm, song.swing)
  for (const [vid, track] of Object.entries(pattern.tracks)) {
    const v = track[s % pattern.length] ?? 0
    if (!v) continue
    const spec = eng.buildVoice(eng.voiceById(vid), song.kit.params[vid], v === 2 ? 1 : 0.55)
    eng.renderVoice(ctx, spec, bus, t)
  }
}

const d = (await ctx.startRendering()).getChannelData(0)
let peak = 0, clipped = 0
for (let i = 0; i < d.length; i++) {
  const a = Math.abs(d[i]); if (a > peak) peak = a; if (a >= 0.999) clipped++
}
console.log({ peak, clipped })
```

**What good looks like.** `clipped === 0` and `peak` below `1.0` for **every** shipped
pattern. A user turning things up and clipping is their business; the defaults clipping is
ours.

If a pattern clips, lower the offending voice's `level` in `defaultSong()` — the mix
layer — rather than the master. The master is already set as low as it should go.

## Recipe 4 — do hits land where the pattern says

Verifies the sequencer and swing end to end. Use a **sparse** pattern (`haze`), or every
step has a hit and the check proves nothing.

Render as in recipe 3 without the bus, then probe a short window at each step time:

```js
const probe = (t) => {
  const from = Math.floor(t * SR), to = from + Math.floor(0.012 * SR)
  let p = 0; for (let i = from; i < Math.min(to, d.length); i++) p = Math.max(p, Math.abs(d[i]))
  return p
}
```

**What good looks like.** Steps with hits show a clear peak. Steps without hits show
either zero or a smoothly decaying value — a tail from an earlier hit, which is correct
physics, not a failure. Do not expect silence after a kick.

For swing, compare `stepTime` for an odd step at two swing settings; the shift should be
`swing * 0.5 * secondsPerStep`. At 102 BPM and swing 0.6 that is 44 ms of a 147 ms step.

## Recipe 5 — the 303s

Three things about a bassline are worth measuring, and none of them are levels.

**Is it the real filter?** `Bassline.create` falls back to a biquad when an AudioWorklet
cannot be loaded, and the fallback sweeps but does not squelch. Everything below is
meaningless if this is `false`.

```js
const eng = await import('/@id/@driftbox/engine')
const ctx = new OfflineAudioContext(1, 44100, 44100)
const { bassline, usingLadder } = await eng.Bassline.create(ctx)
console.log({ usingLadder })   // must be true
```

**Does slide actually join two notes?** This is the one that cannot be checked by
looking at the code, because it depends on the VCA envelope *not* being retriggered.
Render two notes a step apart and probe the moment just before the second lands — a
sliding pair is still sounding there, an ordinary pair is silent.

```js
const eng = await import('/@id/@driftbox/engine')
const { defaultSong } = eng
const SR = 44100, params = defaultSong().kit.bass['303.a'], step = 0.14

const gapBefore = async (slide) => {
  const ctx = new OfflineAudioContext(1, SR, SR)
  const { bassline } = await eng.Bassline.create(ctx)
  bassline.output.connect(ctx.destination)
  const a = { note: 0, accent: false, slide }
  bassline.play(eng.bassNote(params, a, eng.REST, step), 0.05)
  bassline.play(eng.bassNote(params, { note: 12, accent: false, slide: false }, a, step), 0.05 + step)
  const d = (await ctx.startRendering()).getChannelData(0)
  const from = Math.floor((0.05 + step - 0.004) * SR)
  let peak = 0
  for (let i = from; i < from + Math.floor(0.003 * SR); i++) peak = Math.max(peak, Math.abs(d[i]))
  return peak
}
console.log({ sliding: await gapBefore(true), notSliding: await gapBefore(false) })
```

**What good looks like.** `sliding` clearly above zero, `notSliding` exactly `0`.
Measured: `0.087` and `0`.

**Does accent do all three of its jobs?** Render one note with and without it. The
accented one must be louder *and* brighter — count zero crossings over the first 40ms as
a crude brightness proxy. Measured at default knobs: peak `0.269 → 0.391` and crossings
`5 → 14`. If the level moved and the crossings did not, accent has been wired to the VCA
only, which is the usual way a 303 emulation ends up sounding flat.

> **Adding basslines does not raise the output peak.** Worth knowing before you go
> hunting for headroom: measured through the real bus, Drift went `0.984 → 0.982` and
> Neon `0.977 → 0.964` when the 303s were added. Sustained bass sits under the
> compressor's threshold long enough to pull the transients down with it, so the
> headroom on the shipped patterns is set by the drums and turning the 303s down buys
> nothing.

## Recipe 6 — the sends, and the one that can run away

Two things to check. First that the effects do anything: render a pattern with and without
the sends routed, and compare the level a second *after* the last hit. Dry, that window is
silence; wet, it is the tail. Measured on the shipped song: `0.0001` dry against `0.028` on
Neon.

Second, and more important — **the delay feedback is the one control here that can build
rather than decay.** Everything else in the app gets quieter on its own. Set every send on
every voice to 1, the feedback knob to maximum, and render four bars:

```js
const hot = defaultSong()
hot.fx = { ...hot.fx, delayFeedback: 1, reverbSize: 1 }
for (const id of Object.keys(hot.kit.params)) hot.kit.sends[id] = { delay: 1, reverb: 1 }
for (const id of Object.keys(hot.kit.bass)) hot.kit.sends[id] = { delay: 1, reverb: 1 }
// ...render through the bus as in recipe 3, routing each voice's output into
// sends.delayInput / sends.reverbInput through a gain
```

**What good looks like.** `clipped === 0`, `peak` under `1.0`, and the level a second after
the last hit clearly *below* the peak — decaying, not sustaining.

This caught a real one. The feedback cap was `0.92`, which is fine on its own; combined
with a dotted-eighth delay and everything sent at full it peaked at `1.109` with 33 clipped
samples and was still over full scale a second later. The cap is `0.85` now, which passes
the same test. Re-run this after touching `DELAY_DIVISIONS`, the feedback cap, or the
default sends — a shorter delay overlaps its repeats more and builds faster, so the three
interact.

## Recipe 7 — the metronome

Two things, and neither is about how it sounds.

**Is it clipping?** The click goes straight to the destination, past the bus compressor
that catches everything else — so it is the one sound in the engine with nothing to save
it. Render both and check:

```js
const eng = await import('/@id/@driftbox/engine')
const peakOf = async (spec) => {
  const ctx = new OfflineAudioContext(1, 44100, 44100)
  eng.renderVoice(ctx, spec, ctx.destination, 0.01)
  const d = (await ctx.startRendering()).getChannelData(0)
  let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]))
  return p
}
console.log({ strong: await peakOf(eng.metronomeClick(true)), weak: await peakOf(eng.metronomeClick(false)) })
```

**What good looks like.** Strong around `0.70`, weak around `0.50`, neither near `1.0`.
Check the *ratio* as well as the ceiling: the two clicks are at different frequencies, so
equal gains do not give equal peaks, and a first pass at this rendered them at `0.68` and
`0.67` — the downbeat stopped being audible as a downbeat.

**Is it really out of the mix?** The claim is that the click bypasses the bus, so it is
neither compressed with the music, nor sent to the reverb, nor drawn on the scope. The
analyser sits after the master bus, so anything it sees went through it:

```js
const song = eng.defaultSong()
song.patterns = song.patterns.map(p => ({ ...p, tracks: {}, bass: {} }))  // silent song
const engine = new eng.DriftboxEngine(song)
engine.metronome = true
await engine.start()
// sample engine.analyser over a couple of seconds
```

**What good looks like.** Exactly `0`. Anything above it means the click is going through
the bus and ducking the mix on every beat.

## Things measurement has caught

Kept as a record of what these are worth.

1. **A 9:1 level spread across the kit.** 808 snare at 2.27, its clap and closed hat at
   0.25. Fixed with measured per-voice trims.
2. **Trim being applied in the wrong place.** Two voices ignored it entirely, because a
   waveshaper re-normalises whatever you feed it — trimming its input changes how much it
   saturates, not how loud it is. Only visible as "the number did not move".
3. **The output clipping.** The busiest pattern peaked at 2.14 raw and 1.08 through the
   compressor. Two samples over full scale is inaudible on its own and a sign the whole
   gain structure is wrong.
4. **A delay that could be driven past full scale.** Feedback capped at 0.92, every send
   at maximum: 1.109 peak, 33 clipped samples, still over full scale a second after the
   last hit. Only reachable at extreme settings, but a control that can break the output
   when it is turned all the way up is a control with the wrong range.
5. **A metronome that clipped.** The click peaked at `1.01` — over full scale, and the
   one sound with no compressor downstream to catch it. Correcting that naively then made
   the strong and weak clicks near-identical in level, so the downbeat stopped reading;
   both were set from rendered peaks rather than from gains.
6. **A comment that had stopped being true.** The default delay was documented as the
   dotted eighth and was in fact a straight quarter — the knob value did not map where the
   prose said it did. Caught by printing what the UI actually renders, not by reading it.

None of these would have failed a test, and none are visible by reading the code.
