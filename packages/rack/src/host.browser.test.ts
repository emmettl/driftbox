import { describe, expect, it } from 'vitest'
import { MODULES } from './modules/index.js'
import { Rack } from './index.js'
import { renderPatch } from './render.js'
import type { Patch } from './types.js'

describe('a host-fed rack source in Web Audio', () => {
  it('crosses a stereo worklet input and follows an ordinary rack cable', async () => {
    const sampleRate = 22_050
    const context = new OfflineAudioContext(2, sampleRate / 4, sampleRate)
    const patch: Patch = {
      modules: [
        { id: 'song', type: 'groovebox' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['song', 'tr808-l'], to: ['out', 'in'] }],
    }
    const rack = new Rack(context, MODULES)
    rack.patch = patch
    expect(await rack.start()).toBe(true)
    rack.output?.connect(context.destination)

    const source = context.createConstantSource()
    source.offset.value = 0.2
    source.connect(rack.input(0)!)
    source.start(0)

    const rendered = await context.startRendering()
    const left = rendered.getChannelData(0)
    let average = 0
    for (const sample of left) average += sample
    average /= left.length

    expect(average).toBeCloseTo(0.2, 3)
    expect(rendered.getChannelData(1)).toEqual(left)
    rack.stop()
  })
})

describe('scheduling a param against a frame, in a real worklet', () => {
  // `currentFrame` is the load-bearing assumption of the whole feature and it is a global that only exists
  // inside a real AudioWorkletGlobalScope. Everything in `graph.test.ts` and `worklet.test.ts` supplies it —
  // one as an argument, one on `globalThis` — so neither can tell whether the browser actually has it. If it
  // did not, or were named something else, the worklet would throw on its first block and every patch would
  // go silent in production only. This is the only test that can say.

  it('lands the change at the frame asked for and not at the block boundary', async () => {
    const sampleRate = 22_050
    // A quarter of a second, which is plenty of blocks either side of the moment being asked for.
    const context = new OfflineAudioContext(2, sampleRate / 4, sampleRate)
    // An Offset with nothing patched into it is a DC source: `in * gain + offset` at silence is the knob.
    const patch: Patch = {
      modules: [
        { id: 'o', type: 'offset' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['o', 'out'], to: ['out', 'in'] }],
    }
    const rack = new Rack(context, MODULES)
    rack.patch = patch

    // **Scheduled before `start()`, and that is the whole reason this works.** No port message reaches an
    // OfflineAudioContext posted before `startRendering` — the audio thread is not running yet — so a
    // schedule sent afterwards is simply absent from the file. Measured: an ordinary `setParam` posted
    // here is lost the same way, which is why the plan and any loaded sample already travel as
    // `processorOptions`. A change made before the node exists is held and seeded with them.
    // Deliberately not on a block boundary: 1000 is 7 blocks and 104 samples in, so a change that landed
    // at the boundary instead would be off by more than a rounding error and this would see it.
    const frame = 1000
    rack.scheduleParam('o', 'offset', 0.5, frame)

    expect(await rack.start()).toBe(true)
    rack.output?.connect(context.destination)

    const left = (await context.startRendering()).getChannelData(0)
    // Silent before, moved after. The couple of samples either side of the seam are the ramp itself.
    expect(left[frame - 1]).toBeCloseTo(0, 4)
    expect(left[frame + 200]).toBeCloseTo(0.5, 2)
    rack.stop()
  })

  it('plays a recorded lane back into an offline render', async () => {
    // The end of the automation road, and the only test that runs all of it: a lane in the document, turned
    // into frames, seeded past the offline message trap, applied by the Graph at the sample asked for.
    //
    // An Offset with nothing patched in is a DC source, so the lane is directly the output — no filter to
    // reason about, and a level that can be read straight off the buffer.
    const sampleRate = 22_050
    const patch: Patch = {
      modules: [
        { id: 'o', type: 'offset' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['o', 'out'], to: ['out', 'in'] }],
      tempo: 120,
      // 120bpm is two beats a second, so a sixteenth is an eighth of a second: step 0 at 0s, step 4 at
      // 0.5s. Held rather than ramped, so the seam is a step and the assertions need no tolerance band.
      automation: [
        {
          target: ['o', 'offset'],
          curve: 'hold',
          points: [
            { at: 0, value: 0.2 },
            { at: 4, value: 0.8 },
          ],
        },
      ],
    }

    const rendered = await renderPatch(patch, {
      registry: MODULES,
      sampleRate,
      bars: 1,
      tail: 0,
      offline: (channels, frames, rate) => new OfflineAudioContext(channels, frames, rate),
    })
    const left = rendered.getChannelData(0)

    // Before the second point, and after it. A render that ignored the lane sits at the Offset's own knob,
    // which is zero — so this fails three different ways if any part of the chain drops the automation.
    expect(left[Math.round(sampleRate * 0.25)]).toBeCloseTo(0.2, 2)
    expect(left[Math.round(sampleRate * 0.75)]).toBeCloseTo(0.8, 2)
  })

  it('renders a playable note from one Voice module and nothing else', async () => {
    // The claim the module exists for, through a real worklet. `voice.test.ts` measures the DSP directly;
    // what only this can say is that a module taking **two** deps — the shared oscillator and the engine's
    // Ladder — serialises into an `AudioWorkletGlobalScope` and runs there. A dep that failed to cross
    // would throw on the first block and the file would come out silent, in production only.
    const sampleRate = 22_050
    const patch: Patch = {
      modules: [
        // An Offset with nothing patched in is a DC source, so it is the gate: held open for the render.
        { id: 'g', type: 'offset', params: { offset: 1 } },
        { id: 'v', type: 'voice', params: { attack: 0.001, sustain: 0.9, level: 0.6 } },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [
        { from: ['g', 'out'], to: ['v', 'gate'] },
        { from: ['v', 'out'], to: ['out', 'in'] },
      ],
      tempo: 120,
    }

    const rendered = await renderPatch(patch, {
      registry: MODULES,
      sampleRate,
      bars: 1,
      tail: 0,
      offline: (channels, frames, rate) => new OfflineAudioContext(channels, frames, rate),
    })
    const left = rendered.getChannelData(0)
    let sum = 0
    for (const sample of left) sum += sample * sample
    // Not silence: a voice whose deps had not arrived gives exactly zero.
    expect(Math.sqrt(sum / left.length)).toBeGreaterThan(0.02)
    for (const sample of left) expect(Number.isFinite(sample)).toBe(true)
  })

  it('converts a context time to the frame the audio thread will call it', () => {
    const context = new OfflineAudioContext(2, 2048, 44_100)
    const rack = new Rack(context, MODULES)
    // The one part of the contract easy to get subtly wrong — milliseconds, or a count of blocks, would
    // both be plausible and both silently put automation in the wrong place.
    expect(rack.frameFor(1)).toBe(44_100)
    expect(rack.frameFor(0.5)).toBe(22_050)
    expect(rack.frameFor(Number.NaN)).toBe(0)
    expect(rack.frameFor(-1)).toBe(0)
  })
})
