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

Vite serves the TypeScript directly, so the engine can be imported at runtime:

```js
const eng = await import('/src/engine/index.ts')
const { defaultSong } = await import('/src/songs.ts')
```

> **Gotcha.** After Vite hot-reloads a file it serves it under a cache-busted URL, so a
> console `import()` can hand you a *different module instance* than the running app.
> That does not matter for pure functions like `renderVoiceOffline`, but it does mean you
> cannot drive the app's zustand store this way — state you set will not reach the UI.
> Reload the page before measuring, and drive the UI by clicking it.

## Recipe 1 — one voice

Peak level, decay time, and where its energy sits.

```js
const eng = await import('/src/engine/index.ts')
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
const eng = await import('/src/engine/index.ts')
let min = 9, max = 0
for (const v of eng.ALL_VOICES) {
  const d = await eng.renderVoiceOffline(v, undefined, 1, 44100)
  let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]))
  min = Math.min(min, p); max = Math.max(max, p)
}
console.log({ min, max, spread: max / min })
```

**What good looks like.** Spread under about `1.5`. It was `9.1` before the trims, and is
`1.35` now.

## Recipe 3 — a pattern, through the real bus

Renders a pattern through the same gain / compressor / master chain the live engine uses,
and checks the output does not clip. Keep the bus values here in step with the engine's
constructor.

```js
const eng = await import('/src/engine/index.ts')
const { defaultSong } = await import('/src/songs.ts')
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

None of these would have failed a test, and none are visible by reading the code.
