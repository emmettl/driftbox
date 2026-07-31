# Driftbox

A drum machine and step sequencer in the browser — a TR-808, a TR-909 and a pair of
TB-303s, all synthesised from scratch, with music-reactive visualisations and an oscilloscope.
Inspired by Propellerhead ReBirth.

On a phone it opens straight into the visuals, because that is the part a small screen
handles best and a step grid is the part it handles worst. Play is top left, **edit** is
top right, and the console appears to fly out of it.

It works as a player if that is all you want: the song's name and the section it is in sit
along the bottom, with skip buttons either side. You never have to open the grid.

Run it without installing anything at
[emmettl.github.io/driftbox](https://emmettl.github.io/driftbox/), or locally:

```bash
npx @driftbox/app
```

## Two published packages, and the rack

The engine and app are on npm, published from CI with [provenance](https://docs.npmjs.com/generating-provenance-statements)
— every tarball carries a signed attestation naming the commit and the workflow run that
built it.

| | |
|---|---|
| [`@driftbox/engine`](https://www.npmjs.com/package/@driftbox/engine) | The synthesis and the sequencer. No React, no DOM — meant to be embedded. |
| [`@driftbox/app`](https://www.npmjs.com/package/@driftbox/app) | This sequencer, as a runnable app. |
| `@driftbox/rack` | The unpublished, work-in-progress modular engine behind [`rack.html`](packages/app/rack.html); it will join the npm packages when complete. |

The rack is intended to be a **strict superset** of the groovebox, in the same sense that
Reason contained and extended ReBirth: anything authored in the 303/808/909 editor should
open, play and remain editable in rack mode. That is a destination rather than a claim
about the current build. [The parity contract and capability ledger](docs/REBIRTH-PARITY.md)
say exactly what “superset” means and order the work needed to get there.

To build something with the engine:

```bash
npm install @driftbox/engine
```

```js
import { DriftboxEngine, SONGS } from '@driftbox/engine'

// From a click or a tap — an AudioContext starts suspended otherwise.
const engine = new DriftboxEngine(SONGS[0].build())
await engine.start()

engine.song = SONGS[3].build()   // takes effect at the next bar
engine.kaoss.set(0.4, 0.7)       // the performance filter, across the whole mix
```

Each preset carries a `visual` hint — an opaque string naming the scene it was written to
be seen with. The engine has no idea what a scene is; a host with its own visuals maps it
however it likes, and one without ignores it.

It has **no runtime dependencies** and ships its own `src/` alongside `dist/`, so the
reasoning in the comments travels with it and "go to definition" lands somewhere real.

The split is the point rather than tidiness: the engine is meant to score
[Driftlings](https://github.com/emmettl/driftlings), and two copies of a synthesis engine
would diverge. One package, one engine.

```bash
npm install     # workspaces; installs all three
npm run dev     # the app, with the engine built from source for HMR
npm run lint    # oxlint
npm run typecheck
npm test        # vitest, across all workspaces — both projects
npm run coverage # the same suite, plus a browsable report in coverage/
npm run build   # engine to dist/, then the app
```

### Two test projects

Most of the suite is Node — the pure layer, and `npm run test:node` is that alone, for the
inner loop. The rest runs in **real Chromium**, and needs one setup step:

```bash
npx playwright install chromium
```

That project exists because `OfflineAudioContext` is a browser API, and in this repo it is not
a detail at the edge — it is where the audio is. The measurements below under *Verification*
each caught a real bug and each used to be a page of instructions somebody had to remember to
re-run; they are now assertions that run on every push. Set `DRIFTBOX_CHROMIUM` to an existing
Chrome or Chromium binary to use that instead of downloading one.

`npm run coverage` collects V8 line and branch coverage from both projects and includes production
files that no test imports, so gaps stay visible. It is a diagnostic rather than a quality gate:
there is intentionally no percentage threshold, and CI retains the HTML report for 14 days.

Space plays and stops · `V` drops into performance mode · `X` switches the scope between
a waveform and a vectorscope · click a step to cycle it off → on → accented · on the 303
page, click a step to place a note and drag it up or down to tune it.

Patterns can be added, renamed (double click one), duplicated and deleted. **click** turns
on a metronome and **1·2·3·4** counts a bar in before playing.

Drag across drum steps to paint or erase a run. The selected drum or 303 line can be
rotated, randomised or rearranged without changing how much material it contains; 303
lines can also be transposed. Rotation can expand to the whole machine currently on
screen. On the 909, **flam** switches the pads into double-strike programming and exposes
the spacing control.

The **Song** strip along the top is the arrangement. Each card is a number of bars and
shows the clip for the machine currently on screen: switch between 808, 909, 303 A and
303 B to give the same section four independent patterns and loop lengths. It can all be
changed and rearranged while the thing is playing. Each section can also start playback
from its first bar or become the active song loop.

Your work is saved as you go. **share** puts the whole song in a link, **save** and
**load** move it to and from a file, and **reset** goes back to the shipped patterns.

The engine and app are published at `0.2.0`. [docs/PUBLISHING.md](docs/PUBLISHING.md) has
the release steps; nothing goes to npm without cutting a release on purpose.

**Picking this up?** [ROADMAP.md](ROADMAP.md) has the current state, the decisions worth
not undoing, and what to build next. [docs/VERIFYING-AUDIO.md](docs/VERIFYING-AUDIO.md)
is how to check a change actually sounds right without trusting your ears or the tests.

`packages/app/public/og.png` is the link preview, and it is a real screenshot — so it goes
stale when the UI changes. Regenerate it by loading the app at a 1600×840 viewport,
pressing play so the scope has something in it, and screenshotting the page. The tags that
point at it live in `packages/app/index.html`, with the reasoning next to them.

## No recorded samples

Every sound is generated in the browser; no recordings or original ROM data ship with
the engine. The 808's bass drum is a sine with a fast pitch drop and a click of filtered
noise; its snare is two tuned oscillators mixed against a noise generator by the "snappy"
control; its hats and cymbals are six square oscillators at deliberately inharmonic
ratios, so no two partials form a simple interval and the ear refuses to hear a pitch.

The 909 is deliberately different. Its analogue drums are shorter, driven and brighter.
The original machine's hats, ride and crash came from 6-bit PCM clocked at roughly 30kHz,
so these voices generate a deterministic waveform at that resolution and add quiet
cymbal modes for the bell and plate resonances. That gives them the bandwidth, grain and
repeatable attack of a sampled voice without copying a recording.

Following the analogue topology where there was one, and the digital medium where there
was not, gets far closer than EQ-ing one noise burst into submission. It also means every
knob changes the generated voice rather than filtering a fixed recording, and keeps the
whole kit to a few kilobytes of code.

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

## Playing it

There is a keyboard under the grid, laid out as an actual piano: the black keys are placed
by **pitch**, so the naturals are white, the sharps are black, and the two gaps fall where
B meets C and E meets F. Since the 303's note 0 is an A, the home row spells A natural
minor — for a major scale under the fingers start on `d`, which is a C. `z` and `x` shift
octave, shift is accent.

It is **monophonic, because a 303 is**, and that is the feature rather than the limit:
hold one key, press another without letting go, and the two glide together on one
envelope. Which is the sequencer's slide, arrived at from the other end.

The toms play from it too — they are pitched percussion, and each tunes across a little
under an octave. Past that the keys dim: the way further up is the next tom, which is what
the machine's three of them are for. Select one in the grid and it appears as a target.

## Sixteen songs, one pair of 303s

It ships with sixteen, and they share nothing — different tempos, different halves of the
drum rack, different rooms:

In playing order, each with the scene it was written for — one song, one visual, no
scene used twice:

| | | |
|---|---|---|
| **Sundown** | Chillwave. 102bpm, swung, lots of space. | *Sunset* |
| **Acieed** | Acid house. 126bpm, dead straight, four to the floor. | *Web* |
| **Undertow** | Darkwave. 82bpm, no snare anywhere — a rimshot and a lot of reverb. | *Stillwater* |
| **Light Cycles** | Electro, for the grid. 128bpm, a broken kick rather than four to the floor, an 808 clap for a backbeat and no snare anywhere. | *Light Cycles* |
| **Transmission** | ISDN-era FSOL. 104bpm, patterns of 14, 12 and 8 steps so nothing lines up, and no backbeat at all. | *Lifeforms* |
| **Defcon** | Downtempo. 68bpm, the slowest thing here, built on the tritone — the one interval that refuses to resolve. | *Defcon* |
| **Cumulus** | Ambient house, after the Orb. 116bpm, the heaviest swing here by a distance, and the only cheerful thing in the set. | *Clouds* |
| **Pump** | Hip house, aimed at the Technotronic record. 124bpm, and the only 303 here playing stabs rather than a line. | *Dancers* |
| **Assembly** | Minimal techno. 132bpm, with the drum rack working as an interlocked production line and the 303s reduced to relay pulses and electrical hum. | *Machine* |
| **Last Bus** | UK garage. 134bpm, with the kick and clap held straight while hats, maracas and rimshots lean late around a sub that answers in the gaps. | *Night Bus* |
| **Ascend** | Trance, aimed at Rez. 138bpm, dead straight, and the arrangement *is* the composition — one layer added at a time, taken away twice. | *Wireframe* |
| **1UP** | Chiptune, for the platformer. 162bpm, and the 303 arpeggiates because a machine with one voice cannot play a chord. | *Jump Man* |
| **Rings of Saturn** | Breakbeat, after the Photek tune. 170bpm, and the only song here written in two-bar patterns rather than one — a break's whole character is that it does not repeat every bar. | *Saturn* |
| **Runner** | Upbeat, for the trench. 150bpm, propelled by toms rather than hats, and the only major-key line in the set — it leaps across two octaves where everything else here creeps. | *Trench* |
| **Cübik Olympic** | Manchester rave. 124bpm, distorted square stabs, bright answering bleeps and a rippling 808 pattern. | *Cübik* |
| **Mobilise** | Industrial electro. 90bpm, a rolling square-wave riff with toms for caterpillar tracks. | *Endless Convoy* |

The order is a listening sequence rather than the order they were written: gentle, hard,
dark, machine, abstract, dread, bright, building, breaking, fast. Acieed and Ascend used
to sit next to each other and open with literally the same four bars at different tempos,
so the set sounded like one track restarting.

The part worth noticing is that the two 303s are the same synth in all sixteen and do not
sound like the same instrument. Acid is resonance near the top with a **short** decay, so
the filter slams shut between notes and every repeat re-opens it. Darkwave is the filter
mostly closed with the envelope barely moving and a long decay — strings, not acid. That
difference is four knobs.

**Ghost notes, out of a notation that has none.** The drum grid has two velocities — accent
and normal — and a Photek break is mostly the quiet taps *between* the backbeat. Rings of
Saturn gets them by ghosting on a different, quieter **voice** rather than at a lower
velocity: an 808 rimshot doing all the in-between work a long way under a 909 snare. Which
is also how it would have been programmed on the hardware.

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

## Saying what to do next, once

Two things this app never said out loud: that it makes a sound, and that there is another
half of it behind the **vibes** button. On a phone it opens into full-screen visuals and is
a beautiful, silent picture until you find the play button; on a desktop it opens onto a
wall of grids and knobs, where the two controls you want first are a 40px square in one
corner and a pill six controls along.

So particles fall into them. Each stream is tinted like the button it lands on — the
transport's teal, the amber vibes has worn since it stopped being a ghost button — so two
of them running at once read as two destinations rather than as weather. They spiral in
rather than travelling straight, because a straight line to a target looks like a diagram,
and they fade out at the far edge so nothing pops into existence.

The rule that makes it a hint rather than decoration is that **each one stops when you have
learnt the thing**. The play stream is up only while the transport is stopped and only
until the first time you start it; the vibes stream only until the first time you go there.
Both are remembered in local storage, apart from the song autosave — resetting your song
should not make the app start explaining itself again. The desktop pair is also skipped
under `prefers-reduced-motion`, and on anything narrower than the layout breakpoint, where
you reached the console by tapping the button right next to the ones being pointed at.

## The visualiser is the instrument

**vibes** goes full screen — and on a touch device that is where you start — and the whole
screen is a filter pad — drag across for cutoff,
up for resonance, exactly where a Kaoss pad puts them. It filters *everything*, not just
the 303s: the fun of one of these is the whole record ducking away and coming back, drums
included. A 303 already has a cutoff knob on its channel strip for the other job.

It is momentary, so it glides back open when you let go, and it sits after the bus
compressor — so the compressor is not reacting to signal the filter is about to throw
away, and a resonant peak cannot be pumped by it. The metronome is downstream of it, which
means sweeping the filter shut never takes your count-in with it.

Dragging warps the picture as well as the sound. The floor lifts and ripples toward your
finger in the Sunset scene; the bodies lean toward it in Lifeforms. It is the vertex
shader bending real geometry rather than an effect laid over the top, which is why the
grid lines stretch around it.

**C** changes the scene. There are seventeen — *Sunset*, the slatted sun over a wireframe
floor; *Lifeforms*, aiming squarely at the ISDN-era Future Sound of London videos, with
translucent bodies breathing on the bass and every vertex pushed around by layered noise so
the silhouette never repeats; *Wireframe*, a hexagonal corridor you fly down, which is the Rez one; *Web*,
a sixteen-lane Tempest web where **each lane is its own band of the spectrum**, so a kick
lights one lane and a hat lights another and the shape of the mix is the picture;
*Trench*, after the vector Star Wars cabinet; *Stillwater*; *Saturn*; *Light Cycles*;
*Defcon*; *Clouds*; *Dancers*; *Machine*; *Night Bus*; *Jump Man*; *Cübik*, a paper-white field
of coloured towers; *Endless Convoy*, a column of impossible cargo under a rust-red sun;
and *Graphic Lab*, a living print-and-broadcast design system.

On *Web*, a finger is a **black hole**. The lanes fall into it, wind into a spiral as they
get close — rotation rises sharply near the centre, so the rim is barely disturbed while
the throat winds tight — and go white where the lines pile up. The hole is the whole line
of sight through the fingertip rather than a point on one plane, because the web is
thirty-four units deep and solving it on a single plane puts the singularity under your
finger only for the rings that happen to sit at that depth.

*Stillwater* is the one that reads **events** rather than a level. Everything else moves
continuously with how loud the mix is, which suits music that is continuous and does
nothing for a record that is a few sounds in a large room. Here a hit drops a ring on black
water and the ring travels out and dies; between hits nothing moves but the drift. It is
also the only scene made of points rather than lines — 25,600 of them, scattered off the
lattice, because a regular grid seen at that angle collapses into radial spokes.

*Saturn* is the only one that is an **object** rather than a place — every other scene puts
you inside something, and this one leaves you outside a body looking at it. The rings are
Keplerian, so the inner ones overtake the outer ones and the whole disc visibly shears
against itself after a few seconds; a disc that turns as one piece reads as a painted plate.
Big hits punch holes in the planet: a white flash, then a dark scar that outlives it by a
long way and fades slowly. That last part is the Shoemaker-Levy 9 reference — those impacts
were on Jupiter rather than Saturn, and the detail worth stealing is that the scars lasted
months. A flash on its own is a strobe; a flash that leaves a mark is an event.

*Light Cycles* is shot from **above** — the game board rather than the chase. Partly because
Sunset already owns "glowing grid to a horizon" and doing it again from the same angle would
just be a bluer version of a scene that exists, and partly because the point of a light
cycle is the wall it leaves behind, which you cannot read from inside it. The bikes travel
on the axes and turn ninety degrees only, and **they turn on the beat** — so the grid fills
with right angles drawn by the kick drum, and the picture is a record of what the music did
rather than a reaction to how loud it was. A big hit derezzes the arena and they start
again.

*Clouds* is the bright one, and it is the only one. Nine scenes of glowing lines in a dark
room had stopped being a style and started being a rut, so this is a blue sky in the middle
of the afternoon with nothing on it but weather. The puffs squash and stretch on the kick —
cartoon volume, so anything that flattens also widens — and a rainbow turns up when it gets
loud enough to deserve one. Nothing is a texture: the clouds are point sprites shaded in
the fragment shader, the sky is a gradient, the rainbow is seven arcs.

**Each scene picks the filter pad's colour and the size of its trail.** The pad draws over
whatever is running, and it was amber for every one of them — a colour chosen against the
sunset's own amber sun, which is exactly why it disappeared into it. The accents now
contrast rather than match, and a scene made of fine lines gets a smaller trail while one
made of big soft shapes gets a bigger one. Clouds gets the only dark accent and the only
ring: on a bright scene a filled blob reads as a smudge on the lens, whereas an outline
reads as something drawn on top.

**A meter selector, bottom right.** The oscilloscope is the right default — it is genuinely
diagnostic, since a clip shows as a flattened top and a click as a vertical step — but a
trace drawn across a busy picture is a line through it. So there are four: *wave*, *bars*
(the only one that reads the spectrum rather than the waveform, and the one that sits along
the foot of the frame instead of across the middle of it), *x/y* for the vectorscope, and
*off*. `X` cycles them from the keyboard.

*Jump Man* is an 80s platformer with the sprite work kept honest — one colour per cell, a
two-frame run cycle, parallax layers — and one thing that could not have been done then: a
pixel here is a **point in space** with its own depth and a bevel, so the sprite is a
particle system standing in formation. When he dies he does not blink out, he comes apart
into a few hundred blocks that tumble and fall. He also jumps on the kick and changes leg on
the hat, so the run cycle is the drum pattern rather than a timer running alongside it —
stop the transport and he stands still.

The platforms are the interesting part, because jumping on the beat and placing ledges at
random do not meet. Measured, they never did: he was over a platform 20% of the time and
airborne 36% of it, and the two coincided 7% — exactly the product of two independent
things. So the ledges are laid on his own landings instead. Every touchdown records where
it happened, the gaps between them are smoothed into a stride, and a new platform is spawned
where that stride says the next one falls. It needs to know nothing about the tempo or the
scroll speed, both of which move with the bass, because it is measuring him rather than
predicting him.

*Machine* is the first scene that is a **process** rather than a place, body, board or
isolated object. A solid steel production line runs under sodium light: the kick drops the
press, low mids turn an exposed flywheel and interlocked gears, hats spin the rollers, and
each stamped billet continues down the belt after the hit that made it. Repetition advances
something, which is the visual argument of the minimal-techno track paired with it.

*Night Bus* puts the camera behind wet glass on the upper deck after midnight. Three city
layers pass at different speeds, bass blooms each sodium lamp against the pane, and hats
pull two depths of rain down it. The window frame matters: without it this is a city
wallpaper, with it the viewer is sitting somewhere and travelling. Dragging wipes an
aspect-correct clear patch through the condensation rather than steering the vehicle.

*Cübik* is a paper-white room made from the four inks on the Cübik/Olympic sleeve. A field
of solid cubes is divided into logarithmic frequency rings, so a synth note lifts one
coloured band, a kick sends a second wave through the floor, and hats catch the top faces.
It is bright, filled and graphic where the early scenes are dark rooms drawn in lines.

The five in *Dancers* are not one cycle at five offsets — two do the **running man**, one
runs on the spot, two groove, and the difference lives almost entirely in the legs, which
is also true of real dancing. The running man is a run played backwards: the lifted knee
comes up in front while the standing foot slides behind, at the same moment and in opposite
directions. Do both forward and it is a jog.

*Dancers* is the only scene with a **figure** in it, which turns out to be the one subject
where the eye knows instantly whether you got it right — a tunnel can be any width and
nobody argues, but a forearm that is too long reads as wrong before you have worked out
why. They are built as **artist's mannequins**: tapered blocks for the torso and limbs,
oversized balls at every joint, mitt hands and wedge feet, and an ovoid head with no face.
A lay figure is a stack of volumes rather than a skeleton, and it is the taper that reads
as anatomy — a limb of constant width is a pipe. Nothing is keyframed: every joint is a few sinusoids of the beat phase with a
per-dancer offset, driven by the transport's own tempo, so they are dancing to the record
rather than to a loop running alongside it. They turn to face the cursor and reach toward
it when it comes close.

*Defcon* is the only scene where the music makes something **happen** rather than something
move. A kick launches a missile from one side of the board, it takes several seconds to
fly, and it lands whenever it lands — so the picture runs a couple of bars behind the
record and a launch and its arrival are separate events. The territories are generated
blobs rather than coastlines, because a recognisable world map invites you to look for your
own house and this wants to be read as a board. Green one side, red the other, white only
at the moment of impact.

In *Trench* the corridor **is** the station's equatorial groove. The hull's latitude rings
stop at the trench lip and the floor is a ring of its own at a smaller radius, so from orbit
you can see the band missing from the sphere, and flying down it is flying around the
equator. Travel is an angle going up; there is no scrolling geometry and nothing to wrap.

The approach **arcs**: the camera starts a radian or so round the station and swings to the
trench entry as it drops, so the hull turns under you and the dish comes past on the way in.

It took three goes. First the corridor was a separate object that faded up as the music
started — a cross-fade dressed as a move. Then the camera flew down into it, which is a real
move but still a move toward a different thing: you were diving at a canyon that happened to
be near a battle station. A dive into something has to be a dive into *that* thing.

*Trench* is the only scene that is a **sequence** rather than a steady state. It opens
holding station off a wireframe battle station — hull, equatorial trench, dish — and dives
into the canyon when the transport starts, so pressing play is what begins the run. Down
there the walls pump on the kick, greebles go past bolted to them, and while you hold a
finger down four cannons at the corners of the screen converge on it with bent, hue-split
beams. Both ends of those beams are derived from the camera, so they leave the actual
corners and land exactly under the fingertip at any viewport.

**Stems.** The `stems` button renders the song once per voice and saves one float WAV each
— pre-master, so they sum the way a mixer expects, and 32-bit because a pre-master stem can
exceed full scale and clipping it would be the one thing a stem must not do.

**A cursor steps through the grid as it plays** — a lit column down every row with a tick
above it, so you can see where you are even on a pattern whose top rows are empty.

**The grid follows the playhead.** Open the editor at any point and it is showing the
section you can hear, with the steps lighting up as they play, rather than whatever was
edited last. Choosing a pattern by hand takes over — a grid that jumped away from the thing
you just picked would be worse than not following at all — and loading a song hands it back.

**The visual follows the tune.** Every shipped song names the scene it was written to be
seen with, so skipping tracks changes the picture too. Changing it by hand still wins until
the next track.

The corridor is the only scene with **forward motion**, and that turns out to be most of
what separates it from the others: a fixed horizon and a drifting cluster are both places,
and this is a journey. Its speed follows the low end, so the tunnel surges on every kick.

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
shape of every voice's spec. Some of them assert real musical properties — that the 808
hats use six *inharmonic* partials, that the 909's digital metal carries a deterministic
6-bit/30kHz layer, that claps retrigger rather than firing once, and that the 909 kick is
shorter and more driven than the 808's.

What the Node tests cannot reach is measured by rendering offline and looking at the
samples. That used to mean running `docs/VERIFYING-AUDIO.md` by hand; the measurements that
come down to a number now run in Chromium as part of `npm test` —
`packages/engine/src/render.browser.test.ts` holds the levels, and
`bassline.browser.test.ts` checks that the ladder filter really loaded onto the audio thread
rather than falling back to a biquad. Rendering offline caught three things nothing else
would have:

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
is generated from scratch: there are no recorded samples, and no recordings or ROM data
from any hardware were used to make it.
