import { describe, expect, it } from 'vitest'
import { LINE_MIXER_MODULE, LineMixerProcessor } from './line-mixer.js'
import { slotCount } from '../stereo.js'

// A mixer is arithmetic, so almost everything here is an exact number rather than a threshold. What that
// buys is the ability to test the parts that are *decisions* — that a send is post-fader, that solo silences
// the sends too, that a return does not reach them — as equalities rather than as "it got quieter".

const FRAMES = 64
const CHANNELS = 6

/** Param block offsets, mirroring what the processor derives. Written out rather than imported so that a
 *  reordering of the def's rows fails here instead of being followed silently. */
const LEVEL = 0
const PAN = CHANNELS
const MUTE = CHANNELS * 2
const SOLO = CHANNELS * 3
const SEND_A = CHANNELS * 4
const SEND_B = CHANNELS * 5
const MASTER = CHANNELS * 6
const RETURN_A = MASTER + 1
const RETURN_B = MASTER + 2

interface Setup {
  /** `[channel]` → the constant fed to both of its input channels, or an `[left, right]` pair. */
  inputs?: Record<number, number | [number, number]>
  returnA?: number | [number, number]
  returnB?: number | [number, number]
  params?: Record<number, number>
}

function run(setup: Setup) {
  const inlets = Array.from({ length: slotCount(LINE_MIXER_MODULE.inlets) }, () =>
    new Float32Array(FRAMES),
  )
  for (const [channel, value] of Object.entries(setup.inputs ?? {})) {
    const [left, right] = typeof value === 'number' ? [value, value] : value
    inlets[Number(channel) * 2].fill(left)
    inlets[Number(channel) * 2 + 1].fill(right)
  }
  for (const [slot, value] of [
    [CHANNELS * 2, setup.returnA],
    [CHANNELS * 2 + 2, setup.returnB],
  ] as const) {
    if (value === undefined) continue
    const [left, right] = typeof value === 'number' ? [value, value] : value
    inlets[slot].fill(left)
    inlets[slot + 1].fill(right)
  }

  const params = LINE_MIXER_MODULE.params.map((param) => new Float32Array(FRAMES).fill(param.default))
  for (const [index, value] of Object.entries(setup.params ?? {})) {
    params[Number(index)].fill(value)
  }

  const outlets = Array.from({ length: slotCount(LINE_MIXER_MODULE.outlets) }, () =>
    new Float32Array(FRAMES),
  )
  new LineMixerProcessor().process(inlets, outlets, params, FRAMES)

  // One sample from the middle: every signal here is constant, so the block is one number per outlet.
  const at = (slot: number) => outlets[slot][FRAMES >> 1]
  return {
    main: [at(0), at(1)] as const,
    sendA: [at(2), at(3)] as const,
    sendB: [at(4), at(5)] as const,
  }
}

describe('the line mixer', () => {
  it('sums its channels through their levels and the master', () => {
    const mix = run({
      inputs: { 0: 0.5, 1: 0.25 },
      params: { [LEVEL]: 1, [LEVEL + 1]: 0.5, [MASTER]: 1 },
    })
    expect(mix.main[0]).toBeCloseTo(0.5 + 0.125, 6)
    expect(mix.main[1]).toBeCloseTo(0.5 + 0.125, 6)

    // The master is one multiply over everything, applied after the sum rather than per channel.
    const quieter = run({
      inputs: { 0: 0.5, 1: 0.25 },
      params: { [LEVEL]: 1, [LEVEL + 1]: 0.5, [MASTER]: 0.5 },
    })
    expect(quieter.main[0]).toBeCloseTo((0.5 + 0.125) * 0.5, 6)
  })

  it('pans by balance, the same law the Graph applies to an Out', () => {
    // Unity on both at centre — so that a patch that never touches this knob is unchanged — and hard over
    // attenuates the far side to nothing rather than moving a point source. `graph.ts` argues the choice;
    // this is the assertion that the two agree.
    const centred = run({ inputs: { 0: 1 }, params: { [LEVEL]: 1, [MASTER]: 1, [PAN]: 0 } })
    expect(centred.main[0]).toBeCloseTo(1, 6)
    expect(centred.main[1]).toBeCloseTo(1, 6)

    const right = run({ inputs: { 0: 1 }, params: { [LEVEL]: 1, [MASTER]: 1, [PAN]: 1 } })
    expect(right.main[0]).toBeCloseTo(0, 6)
    expect(right.main[1]).toBeCloseTo(1, 6)

    const half = run({ inputs: { 0: 1 }, params: { [LEVEL]: 1, [MASTER]: 1, [PAN]: -0.5 } })
    expect(half.main[0]).toBeCloseTo(1, 6)
    expect(half.main[1]).toBeCloseTo(0.5, 6)
  })

  it('keeps a stereo channel stereo, and centres a mono one', () => {
    // The compiler feeds a mono source's single buffer to both slots of a stereo inlet — `stereo.ts` rule
    // two — so a mono channel arrives with left and right equal and must stay that way.
    const stereo = run({ inputs: { 0: [1, 0] }, params: { [LEVEL]: 1, [MASTER]: 1 } })
    expect(stereo.main[0]).toBeCloseTo(1, 6)
    expect(stereo.main[1]).toBeCloseTo(0, 6)
  })

  it('sends post-fader, post-pan and pre-master', () => {
    const mix = run({
      inputs: { 0: 1 },
      params: { [LEVEL]: 0.5, [PAN]: 1, [SEND_A]: 0.5, [MASTER]: 0.25 },
    })
    // Post-fader and post-pan: the send carries the channel as it reaches the mix bus, hard right at half
    // level, times the send amount.
    expect(mix.sendA[0]).toBeCloseTo(0, 6)
    expect(mix.sendA[1]).toBeCloseTo(0.5 * 0.5, 6)
    // Pre-master: turning the room down must not turn the reverb send down with it.
    expect(mix.main[1]).toBeCloseTo(0.5 * 0.25, 6)
  })

  it('keeps its two sends independent', () => {
    const mix = run({
      inputs: { 0: 1, 1: 1 },
      params: {
        [LEVEL]: 1,
        [LEVEL + 1]: 1,
        [SEND_A]: 1,
        [SEND_A + 1]: 0,
        [SEND_B]: 0,
        [SEND_B + 1]: 0.25,
      },
    })
    expect(mix.sendA[0]).toBeCloseTo(1, 6)
    expect(mix.sendB[0]).toBeCloseTo(0.25, 6)
  })

  it('mutes a channel out of the mix and out of both sends', () => {
    // Post-fader sends make this fall out for free, and it is the behaviour people rely on without
    // thinking: a muted channel that went on feeding the reverb would be audible through the return.
    const mix = run({
      inputs: { 0: 1, 1: 1 },
      params: { [LEVEL]: 1, [LEVEL + 1]: 1, [SEND_A]: 1, [SEND_A + 1]: 1, [MUTE]: 1 },
    })
    expect(mix.main[0]).toBeCloseTo(1, 6)
    expect(mix.sendA[0]).toBeCloseTo(1, 6)
  })

  it('solos within itself, silencing the other channels and their sends', () => {
    const mix = run({
      inputs: { 0: 1, 1: 1, 2: 1 },
      params: {
        [LEVEL]: 1,
        [LEVEL + 1]: 1,
        [LEVEL + 2]: 1,
        [SEND_A]: 1,
        [SEND_A + 1]: 1,
        [SEND_A + 2]: 1,
        [SOLO + 1]: 1,
      },
    })
    // Only channel 2's contribution survives, in the mix and on the send.
    expect(mix.main[0]).toBeCloseTo(1, 6)
    expect(mix.sendA[0]).toBeCloseTo(1, 6)

    // Two soloed channels are both heard, which is what solo means on a desk and is not the same as a
    // "select one channel" control.
    const two = run({
      inputs: { 0: 1, 1: 1, 2: 1 },
      params: {
        [LEVEL]: 1,
        [LEVEL + 1]: 1,
        [LEVEL + 2]: 1,
        [SOLO + 1]: 1,
        [SOLO + 2]: 1,
      },
    })
    expect(two.main[0]).toBeCloseTo(2, 6)
  })

  it('lets mute win over solo on the same channel', () => {
    // Both up is a contradiction somebody will produce by accident, and silence is the safe reading: a
    // muted channel is one you have asked not to hear.
    const mix = run({
      inputs: { 0: 1 },
      params: { [LEVEL]: 1, [MUTE]: 1, [SOLO]: 1 },
    })
    expect(mix.main[0]).toBeCloseTo(0, 6)
  })

  it('returns into the main pair, after the channels and before the master', () => {
    const mix = run({
      inputs: { 0: 1 },
      returnA: 0.5,
      params: { [LEVEL]: 1, [MASTER]: 0.5, [RETURN_A]: 1 },
    })
    expect(mix.main[0]).toBeCloseTo((1 + 0.5) * 0.5, 6)

    // And through their own level.
    const louder = run({ returnB: 0.5, params: { [MASTER]: 1, [RETURN_B]: 1.5 } })
    expect(louder.main[0]).toBeCloseTo(0.75, 6)
  })

  it('never lets a return reach a send', () => {
    // The one feedback path a device can create on its own, with no cable anywhere to explain it. A reverb
    // patched send-to-return would build without limit, and the patch would look innocent.
    const mix = run({
      returnA: 1,
      returnB: 1,
      params: { [RETURN_A]: 1, [RETURN_B]: 1, [SEND_A]: 1, [SEND_B]: 1 },
    })
    expect(mix.main[0]).toBeCloseTo(2, 6)
    expect(mix.sendA[0]).toBe(0)
    expect(mix.sendB[0]).toBe(0)
  })

  it('is silent with nothing patched, at every default', () => {
    // An unconnected inlet is the graph's zero buffer, so a mixer that added anything of its own would put
    // it into every patch containing one.
    const mix = run({})
    expect([...mix.main, ...mix.sendA, ...mix.sendB]).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('declares a def whose layout the processor actually reads', () => {
    // The processor derives every offset from the channel count and indexes positionally from there, so
    // the ORDER of the param rows and the position of the returns are both load-bearing.
    const ids = LINE_MIXER_MODULE.params.map((param) => param.id)
    for (let channel = 0; channel < CHANNELS; channel++) {
      expect(ids[LEVEL + channel]).toBe(`level${channel + 1}`)
      expect(ids[PAN + channel]).toBe(`pan${channel + 1}`)
      expect(ids[MUTE + channel]).toBe(`mute${channel + 1}`)
      expect(ids[SOLO + channel]).toBe(`solo${channel + 1}`)
      expect(ids[SEND_A + channel]).toBe(`sendA${channel + 1}`)
      expect(ids[SEND_B + channel]).toBe(`sendB${channel + 1}`)
    }
    expect(ids[MASTER]).toBe('master')
    expect(ids[RETURN_A]).toBe('returnLevelA')
    expect(ids[RETURN_B]).toBe('returnLevelB')
    expect(ids).toHaveLength(CHANNELS * 6 + 3)

    // Channels first, then the two returns — which is how the processor knows that four of its sixteen
    // inlet slots are not channels.
    const inlets = LINE_MIXER_MODULE.inlets
    for (let channel = 0; channel < CHANNELS; channel++) {
      expect(inlets[channel].id).toBe(`in${channel + 1}`)
      expect(inlets[channel].stereo).toBe(true)
    }
    expect(inlets[CHANNELS].id).toBe('returnA')
    expect(inlets[CHANNELS + 1].id).toBe('returnB')
    expect(slotCount(inlets)).toBe(CHANNELS * 2 + 4)

    expect(LINE_MIXER_MODULE.outlets.map((port) => port.id)).toEqual(['out', 'sendA', 'sendB'])
    for (const port of LINE_MIXER_MODULE.outlets) expect(port.stereo).toBe(true)

    // One desk, not one per voice, and not a second terminal.
    expect(LINE_MIXER_MODULE.poly).toBe(false)
    expect(LINE_MIXER_MODULE.terminal).toBeUndefined()
  })

  it('still works when serialised into a scope of its own', () => {
    // `worklet.ts` ships this class to the audio thread as `LineMixerProcessor.toString()`. The channel
    // count is derived inside `process` rather than read from the module constant precisely so that this
    // passes; a reference to `CHANNELS` would be a ReferenceError here and silence in the browser.
    const Rebuilt = new Function(
      `"use strict"; return ${LineMixerProcessor.toString()}`,
    )() as typeof LineMixerProcessor

    const inlets = Array.from({ length: slotCount(LINE_MIXER_MODULE.inlets) }, (_, slot) =>
      new Float32Array(FRAMES).fill(0.1 * (slot + 1)),
    )
    const params = LINE_MIXER_MODULE.params.map((param, index) =>
      new Float32Array(FRAMES).fill(param.default + index * 0.001),
    )
    const before = Array.from({ length: 6 }, () => new Float32Array(FRAMES))
    const after = Array.from({ length: 6 }, () => new Float32Array(FRAMES))

    new LineMixerProcessor().process(inlets, before, params, FRAMES)
    new Rebuilt().process(inlets, after, params, FRAMES)
    expect(after.map((buffer) => [...buffer])).toEqual(before.map((buffer) => [...buffer]))
  })
})
