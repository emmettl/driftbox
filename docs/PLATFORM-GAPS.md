# What the browser offers that Driftbox does not

[REBIRTH-PARITY.md](REBIRTH-PARITY.md) measures the rack against the groovebox, and
[REASON-GAP.md](REASON-GAP.md) measures it against Reason. Both ask what this *product* is
missing. This file asks a different question with a different acceptance list: what the
**platform** already offers that nothing here has reached for yet.

Keeping it separate matters for the same reason the other two are separate. "No offline mode"
is not a musical gap and will never appear on a parity ledger, but it is the difference between
an app you can open on a train and one you cannot — and a ledger that mixes the two produces a
list nobody can order.

Everything below was checked against the tree rather than remembered, and says where. Where a
thing turned out to be half-done already, it is recorded as half-done, because "add the missing
half" is a different piece of work from "start".

## The three that matter

Ordered by what it costs to do them *later* rather than by how much they are wanted.

### 1. ~~Nothing works offline, and nothing offers to install~~ — landed

`public/manifest.webmanifest` and a generated `sw.js` shipped together. Everything below is kept
because the reasoning is what the next person needs, and because two of the decisions are ones a
tidy-up would undo.

**It is verified rather than asserted.** `npm run verify:offline --workspace @driftbox/app` serves
a real `dist/` at the root and at `/driftbox/`, registers the worker, pulls the network and
reloads, and CI runs it after every build. Seventeen entries cached, both pages open offline, at
both roots. It earned its place immediately: the first version of the precache plugin ran at
normal plugin order, and Vite emits the two HTML documents from its own `generateBundle`, so the
list came out with every script and stylesheet in it and neither page. The build succeeded, the
app worked online, and the offline copy was a set of assets with no document to hang them on.
The plugin now runs at `enforce: 'post'` and fails the build if fewer than two documents reach
the list.

Three things are load-bearing and none of them is obvious:

- **There is no `skipWaiting()`, and its absence is the feature.** Taking over immediately would
  hand a page that is already running — already holding its own JS in memory — a new cache that
  does not contain the chunk hashes it is about to ask for. With the scenes loading on demand that
  is not hypothetical. Without it the new worker installs quietly and takes over once every tab
  has closed, which is also what makes deleting the old caches on activate safe: activation cannot
  happen while a client still depends on them.
- **Every path is relative** — the precache list, the manifest's `start_url`, `scope` and icons,
  the registration and its scope. Same rule as `base: './'`, and `cache.addAll` being atomic turns
  one absolute path into no cache at all rather than a partial one. This is why the verification
  serves from a subdirectory: at the root, an absolute path is right by accident.
- **The cache key carries the commit**, for the reason `version.ts` gives about the label it
  shows. Pages redeploys on every push while the version moves only at a release, so a
  version-only key would serve the first deploy's assets until the next release.

The iOS half was already done before any of this — `index.html` carried `mobile-web-app-capable`,
a black-translucent status bar and `viewport-fit=cover`, so Add to Home Screen already gave a
fullscreen app. What was missing was the manifest Chrome needs before it will offer to install at
all, and the caching. The icons are generated from `public/favicon.svg` by
`scripts/icons.mjs`, through the Chromium the browser tests already require, because that SVG is
fifteen blurred ellipses behind an alpha mask in `color(display-p3 ...)` and nothing smaller than
a browser renders it correctly.

The original entry follows.

---

There is no service worker and no web manifest anywhere in `packages/app` — a grep for
`serviceWorker` and `manifest.webmanifest` across the tree returns nothing.

**The iOS half is already done, which is what makes the rest worth doing.** `index.html` carries
`mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, a `theme-color`, and a
`viewport-fit=cover` viewport paid for with `env(safe-area-inset-*)` on everything that must stay
reachable. Add to Home Screen on iOS therefore already gives a fullscreen app with no browser
chrome. What is missing is the manifest — without one, Chrome and Android never offer to install
at all, so the platform where installing is *easiest* is the platform where it is not offered —
and the caching that would let either one open without a network.

This is first on the list because the app is unusually well shaped for it and that shape is not
guaranteed to last. What ships is a prebuilt `dist/` with no runtime dependencies and everything
bundled, served over a relative base so one artifact works at `/<repo>/` and at the root alike.
A precache service worker over a static, self-contained bundle is close to the easiest version of
this problem that exists.

The one real cost is cache invalidation against a Pages deploy, and the tool for it is already
here: `version.ts` produces the `v0.2.0 · 93d9cf6` label that both served pages read, which is
exactly the key a precache should be versioned on. Note the failure mode before writing any of
it — a service worker that caches wrongly does not error, it serves yesterday's build for ever,
and the symptom is a bug report about a fix that shipped a week ago.

The phone-first framing is what makes this a gap rather than a nicety. The README's argument is
that a small screen opens straight into the visuals because that is the part it handles best.
The natural end of that argument is an icon on a home screen that opens without a URL bar and
plays without a signal.

### 2. ~~No MIDI clock, in~~ — landed. Out, still open.

Driftbox follows an external clock: tempo, play, stop, continue and song position. `midi-clock.ts`
holds the estimator, `clock-follow.ts` the rules about what the sequencer does with it, and the
**sync** button beside the MIDI controls in the Keys panel turns it on.

**It is opt-in, deliberately.** Plenty of gear streams clock the moment it is plugged in, and a
sequencer that silently handed its transport and tempo to whatever was on the other end of the
cable would be taking somebody's instrument away without asking.

**The tempo is not written into the song.** `bpm` writes through to the document, which is right
for a knob and destructive here — a DAW at 174 would rewrite a 120bpm song and the autosave would
keep it. `DriftboxEngine.followTempo` moves the transport and re-syncs the tempo-locked delay
while leaving the document alone, and passing null hands the tempo back.

Three things the estimator had to get right, each found by measurement:

- **Fitting a line, not dividing an interval.** At 120bpm a tick is 20.8ms apart, so two
  milliseconds of main-thread jitter on one interval is a ten percent tempo error. A least-squares
  slope over two beats reads the same stream to better than half a beat per minute; the naive
  estimate on that stream swings by more than ten.
- **A dropped tick must not read as half speed, and a *late* tick must not read as a dropped one.**
  Rounding a gap to the nearest whole tick is the obvious rule and biases badly: a tick stalled by
  fifteen milliseconds — a garbage collection, ordinary — rounds up, and every index after it
  shifts. The threshold sits at 1.75 intervals rather than 1.5 because being wrong in that
  direction costs far more than being wrong in the other.
- **The fit itself has to reject outliers, and this was the one that mattered.** A single stalled
  tick near the edge of the window pulled the estimate from 120 to 121.7 on leverage alone. That
  biased slope then made the *next* stalled tick look dropped, which inserted an index nobody
  sent, which biased it further — a runaway that settled at **126.2bpm on a 120bpm stream**, five
  percent out and growing, from noise worth a twentieth of that. A second pass excluding samples
  more than three mean absolute residuals from the first line stops it at source. With it, one
  stall in twenty ticks reads within 1bpm, and even ten milliseconds of jitter on *every* tick —
  half the interval — stays within two.

**Phase lock has landed too.** Tempo and transport following were not enough on their own: over a
long take, a small residual tempo error integrates into audible drift. The follower now
extrapolates a continuous tick position between MIDI pulses, the transport exposes its own
continuous tick phase, and the app compares both at the same `performance.now()` instant. A small,
clamped correction is added to the fitted tempo until the local sixteenth grid is back under the
sender. Song Position Pointer now also reaches the engine on `continue`, so starting from the
middle of a DAW song lands in the matching Driftbox bar rather than merely sharing its tempo.

**Clock out** is untouched, and is now the cheaper half: the filter it would need is the one that
already exists.

The original entry follows.

---

`midi.ts` holds a genuinely good keyboard allocator — one class for mono and poly because the
rule is one rule, and a ninth note on an eight-voice patch steals the oldest and hands it back on
release. `midi-cc.ts` and `rack/midi.ts` handle CC and learning. None of the three contains a
byte of clock: a grep for `0xf8` across all of them returns nothing, and so do start, stop and
continue.

So Driftbox cannot be slaved to a hardware sequencer or a DAW, and cannot drive one. For a
project that models an 808, a 909 and two 303s, that is the boundary between a browser instrument
and a machine that takes part in a setup with other machines.

**The architecture is already most of the way there, in the direction that is normally hard.**
The transport emits straight times scheduled ahead against the audio clock, and every hit is
placed on that clock rather than fired by a timer — so there is a clean seam at which an external
tempo and phase can be substituted for the internal one.

The hard part is the other end, and it should be named before anybody starts: **Web MIDI
timestamps arrive on the main thread and they jitter.** Deriving tempo as `1 / interval` from
consecutive ticks produces a tempo that wobbles audibly. What is wanted is a filter over a window
of ticks — a least-squares fit of tick index against timestamp, or a small phase-locked loop —
which converges on a stable tempo and a phase offset while tolerating a late tick.

That filter is arithmetic on timestamps and nothing else. It is a pure function, it belongs in
the Node project next to `timing.ts`, and it is testable by feeding it synthetic tick streams
with deliberate jitter and dropouts. Which is to say the risky part of this feature is the part
this repo is already best at testing.

### 3. ~~Nothing compensates for output latency~~ — landed

**The fix was not to move the picture, it was to move the reading.** The analyser now sits on a
branch fed through a `DelayNode` holding `outputLatency`, so what it reports and what the ear
receives are the same moment. Nothing about the signal path changed — and the reason it could not
simply be delayed in place is that the analyser *was* the signal path: `master → analyser →
destination`. Delaying it there would have delayed the music along with the picture.

`monitor.ts` holds the arithmetic and `DriftboxEngine.syncOutputLatency()` re-reads it on every
resume, because a context built suspended reports 0 until there is a device attached to be late.
The rack builds its own tap around its own graph from the same exported function, since the two
pages share their scenes and compensating them differently would be worse than compensating
neither.

Two things are worth keeping:

- **The tap ends in a gain of zero that reaches the output.** Web Audio only guarantees that nodes
  on a path to the destination are processed, and a leaf analyser is pulled anyway in everything
  measurable — checked in Chromium, where a leaf reads a full-scale 255 on a tone, identical to one
  in the signal path, and the rack has shipped a leaf analyser for as long as it has had visuals.
  But the engine is a published package embedded in browsers nobody here can test, and the failure
  if one disagrees is not a slightly wrong picture, it is a dead visualiser. One gain node against
  that is cheap, and `render.browser.test.ts` would catch it immediately if the zero were ever not
  exactly zero.
- **`monitor.browser.test.ts` measures the property that matters** — the first non-zero sample
  arrives at the same index whether the context claims no latency or 300ms of it. "The kick still
  sounds like it did" is an opinion; a sample index is a measurement.

`latencyHint: 'interactive'` was already set on the rack's context. `setSinkId` is untouched and
still worth having.

The original entry follows.

---

A grep for `outputLatency` and `baseLatency` across the tree returns nothing, and the
`AudioContext` is constructed without a `latencyHint`.

The README says twice that the visual follows the tune, and the whole scene registry exists to
make that true. But the analyser reads the graph at `currentTime`, while the listener hears that
same audio some milliseconds later — on wired output a small and forgivable number, on Bluetooth
headphones 150–300ms, which is a third of a bar at 120bpm and is plainly visible in a scene whose
entire job is to move on the kick.

The fix is to read the visual phase from `currentTime - outputLatency` rather than from
`currentTime`. It is small, and it is measurable rather than a matter of taste, which puts it in
the same category as the trims: a number that was wrong and is now right.

Two neighbours are worth taking at the same time. `latencyHint: 'interactive'` states the
intent this app actually has, and `setSinkId` would let somebody with an interface attached
choose which output the thing plays out of — which is the live half of the multi-channel wish
recorded in ROADMAP's stems section, and the half a browser can genuinely do.

This is third rather than first only because it degrades gracefully: wrong, but wrong by an
amount most listeners on most hardware will not name.

## Everything else

Ordered loosely by value, not by effort.

**Spectral snapshots, as the next rung of the offline-render ladder.** The browser project
currently asserts peaks, trims and structural properties — six inharmonic partials, a
deterministic 6-bit layer, a clap that retriggers. What none of those catch is a voice whose
*character* changes while its level holds. The technique that does is a fingerprint: render
offline, reduce to a coarse octave-band energy matrix over time, check it in as a fixture with a
tolerance. It is the same move already made once, when a page of `VERIFYING-AUDIO.md` became an
assertion, applied to the half that is still judgement.

**There is a prerequisite, and it is precise.** `render.ts:54` seeds its noise buffer only when a
seed is passed — `options.seed === undefined ? Math.random : seededRandom(options.seed)` — so the
909's PCM ROM is deterministic (`tr909.ts:284` and its neighbours pass `0x909`) and ordinary noise
is not. `effects.ts:107` fills the reverb impulse response from `Math.random` unconditionally, per
channel, deliberately, because independent noise per channel is what stops the tail collapsing to
mono. So a fingerprint over any pattern with a hat or a reverb send compares two different
renders. Either those two sites take a seed the way `pattern.ts:458` already takes an injected
`RandomSource`, or the band reduction is made coarse enough and long enough to average the
difference away. The first is more honest and follows a pattern the repo already uses.

**~~This stopped being theoretical while the monitor tap was being tested.~~ — landed.** A test
comparing the peak of two renders of `808.bd` failed, because `bassDrum` has a noise layer and the
two renders got different noise. That made the cost concrete: it was never only fingerprinting
that the unseeded buffer blocked, it was *any* test comparing one render to another.

All three sites are seeded now — the noise buffer, the reverb's impulse response (two seeds, one
per channel, because their being uncorrelated is what makes the room wide), and the per-hit offset
into the buffer. `determinism.browser.test.ts` asserts it.

**The third site was the interesting one.** The offset exists so that overlapping noise bursts do
not comb-filter — most audibly inside a clap, which is one voice retriggering itself. That needs
the offsets to differ *from each other*, and never needed them to differ between one render and
the next. So it is now a hash of which voice, which source within it, and when — deterministic per
song, still varied per hit, and still varying live because the hit time there depends on when
somebody pressed play.

Three things fell out of doing it that are worth keeping:

- **Chromium's renderer is not bit-reproducible.** What this code computes in JavaScript is
  identical to the sample every time. What comes back from `startRendering()` is not: a bare voice
  differs from itself by up to one float32 ULP, *intermittently*, and through the full master chain
  by up to 6.6e-5 — about −84dBFS. It is not an RNG (the offsets were instrumented and match; a
  biquad, a compressor and a waveshaper are each bit-exact alone) but float summation order in a
  graph with several inputs. **The spectral fingerprints above will therefore need tolerances**, and
  this is the number to size them against.
- **`render.browser.test.ts` no longer stubs `Math.random`.** It used to replace the global for its
  whole duration to stop a genuine CI flake. With the engine deterministic there is nothing left to
  stabilise, and the sweep now asks for a different *variant* of the hit each pass.
- **A hit that does not land on a render-quantum boundary changes far more than its noise offset.**
  Sweeping start times was the obvious way to sample the distribution and is wrong: measured on the
  808 closed hat, which contains no noise at all, the bare peak moves between 0.67 and 3.97 purely
  with where the hit falls inside a quantum. Through the engine it is bounded — 0.28 to 0.78, well
  under full scale, because of the bus and master gains — so it is not a shipping fault. But it is
  real, it is unexplained, and anything measuring a voice in isolation should know about it.

Better characterisation came free. Over 200 offsets the 808 clap runs 0.587 to 1.179, median 0.749,
crossing full scale on 2 of them; the 909 clap runs 0.708 to 0.933 and never does.

**Property-based testing.** No `fast-check` in the tree, against an unusually good surface for it.
Three targets, in the order I would expect them to find something. `hash.ts` round-trips —
`encode` then `decode` is identity for any document — where a marker table read longest-first
carries a compatibility obligation to every link anybody has already shared, which is exactly the
kind of promise a generator is better at attacking than an example. The `Keyboard` allocator,
where "the sounding set is always the newest N held" is a stated invariant and the argument for
one class instead of two rests on it — a property test is how that argument stays true. And
swing, where a per-voice offset must never reorder an event past the next step.

**~~Scene code-splitting, and a size budget in CI.~~ — landed, and it was worth less than it
looked.** The registry now defers only the component and keeps the metadata eager, so a page can
still list scenes and read their accent colours without fetching any. Measured on the built
output, first load went from **400kB to 365kB gzipped** on the sequencer and 515kB to 481kB on the
rack — about 9%, not the third the raw chunk sizes suggested, because **three is 220kB gzipped of
what remains** and every scene shares it. The eighteen scenes are 3–4kB each now, fetched one at a
time.

The structural change matters more than the number: a nineteenth scene is now free to everyone who
does not watch it, where before every scene taxed every visit.

Two things came out of doing it. **The budget had to be per page rather than per chunk** — a chunk
table would have called splitting one 400kB chunk into four 100kB ones an improvement when all
four are still fetched on load — so `scripts/check-size.mjs` sums the entry plus every declared
`modulepreload`, which is exactly the static import graph. And **the size ceiling alone does not
protect the split**: adding a static import of one scene back into the registry was measured at
+3kB gzip, comfortably inside any headroom a non-brittle ceiling needs. So the real guard is
structural and not a number at all — no scene may appear in either page's first-load graph — and
that assertion catches the regression the ceilings sail past. Verified by making it.

Deferring **three itself** is the next real win available, and it is a product decision rather
than a build one: the argument for the phone is that it opens straight into the visuals.

Naming was a side effect worth having. Shared chunks were being named after whichever module the
bundler happened to pick — `Oscilloscope`, then `offline`, then `audio` for a file that is 856kB
of three — so the two that are really libraries are now named `three` and `react`. A budget keyed
on chunk names needs names that mean something.

**Capturing a performance, rather than only rendering one.** Stems are correct and their two
load-bearing decisions are right. What they cannot capture is the thing somebody just *played* —
the pad moves, the pattern switches, the live tweaks. A `MediaStreamDestination` into
`MediaRecorder` captures that, and a canvas capture stream alongside it produces a video of the
visualiser with its own soundtrack, which for a project where the visuals are half the product is
the artifact people would actually share. It must be labelled as a different thing from stems and
not an extension of them: it is real-time, therefore not deterministic, therefore not
reproducible — the exact properties stems were designed to have.

**`localStorage` is the wrong shelf for where the documents are going.** Ten keys live there now
(`driftbox.documents.v1`, `driftbox.patches.v1`, `driftbox.devicepatches.v1` and the rest), and
the documents being stored have grown from songs into rack patches with automation lanes. That is
a synchronous API with a cap around 5MB, and the failure at the cap is a thrown quota error in the
middle of somebody's save. IndexedDB is the answer for the library. The File System Access API is
a separate, smaller win: `download.ts:40` fires one `link.click()` per file, so exporting a set of
stems is N separate downloads into wherever the browser puts things, where a directory handle
would make it one choice and one folder.

**An intensity API, for the Driftlings item.** ROADMAP frames adaptive scoring as
`engine.song = {...}`, which works and undersells what is already built. Game audio has settled
names for the two halves: *horizontal re-sequencing*, which is the chain, and *vertical layering*,
which is muting and unmuting voices by intensity — and the per-voice architecture that made stems
possible gives the second one nearly free. With sections already taking effect at the next bar,
the quantised transition point is done too. `engine.intensity = 0.7` as a first-class API is a
better demonstration of a reusable engine than swapping whole songs, because it is the thing a
game actually needs and the thing a loop playing underneath cannot do.

**Accessibility past the attributes.** The state here is better than a first glance suggests: 417
`aria-` attributes across 47 non-test files, 25 sites honouring `prefers-reduced-motion`, and
every step in `Sequencer.tsx` is a real `<button>` carrying `aria-label` and `aria-pressed`
(`Sequencer.tsx:159`–`184`), so the grid is labelled and reachable rather than a div soup. Two
specific things are missing. The grid has no roving tabindex and no arrow-key navigation, so
reaching the last voice's last step means Tab through every button before it — a 2D control
navigated as a 1D list, which is punishing precisely because each step is correctly focusable.
And the groovebox has no live region at all: `aria-live` appears four times, all in the rack
(`TutorialCoach.tsx:191`, `GrooveboxTools.tsx:209`, `GrooveboxArrangement.tsx:119` and `:220`), so
a pattern change or a section change is announced in one editor and silent in the other. An
axe-core pass inside the existing browser project would be cheap, since CI already runs real
Chromium.

## Deliberately not gaps

Each of these is a thing a reviewer will suggest. Recorded with the reason, so the argument does
not have to be had twice.

**WebGPU.** three.js's `WebGPURenderer` means rewriting every shader into TSL or WGSL, across
eighteen scenes that are deliberately wireframe, low-poly and dark. The output would be the same
picture. Reach for it if a scene ever wants compute — a particle count that a vertex shader
cannot feed — and not before.

**OffscreenCanvas in a worker.** Defensible in general, and the usual reason for it does not apply
here: the failure it prevents is main-thread jank starving the audio scheduler, and that was
already solved by putting the heartbeat in a Worker, because a background tab clamps
`setInterval` to about a second. What is left is UI responsiveness under load, which is not
currently the complaint, weighed against a substantial refactor of how R3F is mounted.

**WASM or SIMD DSP.** Not for the drums, where the work per block is small and the ladder is
already on the audio thread. The one honest exception is the rack's polyphonic graph, and the
right rule there is not a guess: `graph.bench.ts` exists, so let the bench name the poly count at
which JS in a 128-frame quantum stops holding, and treat *that number* as the trigger.

**Collaborative jamming.** A shared session over CRDTs is the fashionable answer, a large amount
of work, and it runs into a latency problem that has no clean solution at musical timescales —
two people cannot play together over a link whose round trip exceeds a sixteenth note, and no
amount of conflict resolution changes that. The asynchronous version already exists and is the
version people use: `hash.ts` puts a whole document under a kilobyte in a URL fragment that never
reaches a server.

## The order

If they were done one at a time, this order:

1. ~~**Manifest and service worker.**~~ Landed. Smallest, and the only one that changes what the
   thing *is* on the platform the README argues it is best on.
2. ~~**Output-latency compensation.**~~ Landed. A few lines, measurable, and it made an existing
   claim true on hardware where it was not.
3. ~~**Scene code-splitting, with the size budget landing in the same change.**~~ Landed, and the
   prediction held for the wrong reason: the budget was worth more than the split, because the
   assertion that protects the split turned out not to be a size at all.
4. ~~**MIDI clock in.**~~ Landed, and it did change what the project is: Driftbox can be slaved to
   a DAW or a hardware sequencer. In before out was the right order — the filter that sending would
   need is the one that now exists.

All four are done, as is the noise seeding that got promoted out of *Everything else* by being
measured twice. Phase-locking the external clock has also landed, leaving Clock Out as the open
MIDI-platform half. What is left there is genuinely optional, except for the tolerance work this
created rather than found:

- **Spectral fingerprints need tolerances**, sized against the 6.6e-5 that Chromium's own renderer
  varies by. That number is measured and recorded above.

Everything under *Everything else* is genuinely optional. The four above are the ones where the
gap is between what the project claims and what it does, which is the only kind of gap this file
is really for.
