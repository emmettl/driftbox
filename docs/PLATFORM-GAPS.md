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

### 1. Nothing works offline, and nothing offers to install

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

### 2. No MIDI clock, in or out

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

### 3. Nothing compensates for output latency

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

**Property-based testing.** No `fast-check` in the tree, against an unusually good surface for it.
Three targets, in the order I would expect them to find something. `hash.ts` round-trips —
`encode` then `decode` is identity for any document — where a marker table read longest-first
carries a compatibility obligation to every link anybody has already shared, which is exactly the
kind of promise a generator is better at attacking than an example. The `Keyboard` allocator,
where "the sounding set is always the newest N held" is a stated invariant and the argument for
one class instead of two rests on it — a property test is how that argument stays true. And
swing, where a per-voice offset must never reorder an event past the next step.

**Scene code-splitting, and a size budget in CI.** `visual/scenes/index.ts` statically imports all
eighteen scenes, so first load pays for every one of them plus three. The only dynamic import in
the app is `PerformPad.tsx:7`. Meanwhile ROADMAP quotes 1.27MB as a hand-measurement, and neither
`package.json` nor any workflow contains a size check. Splitting the scenes is probably the
largest single first-load win available; asserting a per-chunk budget in `ci.yml` is what stops it
silently regressing, on the same principle already applied to the level measurements — a check
that finds real problems should not depend on somebody remembering it.

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

1. **Manifest and service worker.** Smallest, and the only one that changes what the thing *is*
   on the platform the README argues it is best on.
2. **Output-latency compensation.** A few lines, measurable, and it makes an existing claim true
   on hardware where it currently is not.
3. **Scene code-splitting, with the size budget landing in the same change.** The budget is worth
   little on its own and worth a lot the moment it is guarding a number somebody just improved.
4. **MIDI clock in.** The largest of the four, and the one that changes what the project is. In
   before out: being slaved is the common case, and it proves the filter that sending would then
   reuse.

Everything under *Everything else* is genuinely optional. The four above are the ones where the
gap is between what the project claims and what it does, which is the only kind of gap this file
is really for.
