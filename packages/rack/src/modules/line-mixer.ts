import type { ModuleDef, Port, ParamDef, Processor } from '../types.js'

// Six stereo channels, two aux sends and their returns. Reason's Line Mixer 6:2.
//
// **This is the device the rack was already building by hand.** `docs/REASON-GAP.md` measured the gap and
// was careful to record it as *patchable rather than architectural*, which is true and is the whole reason
// it sat below the oscillator families in the order: splitting an outlet is free, merging is what `Mixer`
// is, a send level is a Mixer channel, and a channel strip is an `Out`. Nothing here is newly possible.
//
// What it is, is the same argument `voice.ts` makes. Six sources with pan, mute, solo and two sends each
// costs six Outs, two Mixers for the aux buses, and twelve cables before a note — and the patch that
// results is a page of wiring that says "mixer" and nothing more specific. The patching cost had to
// disappear rather than be automated.
//
// Four decisions worth keeping:
//
// **It is not terminal.** An `Out` is the end of the rack and this feeds one, exactly as Reason's mixer
// fed the hardware interface. Making it terminal would have been the obvious move and would have put two
// modules in the shipped set claiming to be the output, which `modules.test.ts` holds a line against for
// good reason: the Graph's mute and solo are facts about *the set of terminals*, and a second kind of
// terminal with its own internal solo would mean two solo systems that could disagree.
//
// **Its solo, unlike the Out's, lives in this processor** — and the contrast is the interesting part.
// `out.ts` says its solo "could not live in this processor even in principle: one channel soloed silences
// the OTHERS, and a module has no idea the others exist". That is exactly right for a terminal and exactly
// wrong here, because this module *is* the set: it can see all six channels, so soloing is arithmetic
// rather than a fact the compiler has to hand it. Same word, same behaviour, opposite implementation, for
// a reason that is about scope rather than about mixing.
//
// **The sends are post-fader, post-pan and post-mute**, which is what everybody expects and the only
// choice that makes solo behave: a channel that is muted or not soloed sends nothing, so the returns
// carry only what you are listening to rather than the whole mix through a reverb. A pre-fader send is a
// real thing on a real desk and it is a cue bus, which a rack with no headphone output has no use for.
//
// **The returns land after the channels and before the master, and do not reach the sends.** A return
// feeding the sends would be a feedback loop inside one module, arriving with no cable to explain it —
// the one kind of feedback this rack should not offer, since every other loop in it is something you
// patched and can see.
//
// The pan law is the Graph's, copied deliberately rather than shared: balance, not equal-power, so that
// centre is unity and a pan knob here means what a pan knob on an Out means. See `graph.ts` for why.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class LineMixerProcessor implements Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    // Derived rather than written down, the way `AlligatorProcessor` derives its band count: the def is
    // then the only place the channel count exists, and a def that grew a channel could not disagree with
    // a constant in here. Inlets are six stereo channels then two stereo returns, so four slots are not
    // channels and the rest are two apiece.
    const channels = (inlets.length - 4) >> 1

    const mainLeft = outlets[0]
    const mainRight = outlets[1]
    const sendALeft = outlets[2]
    const sendARight = outlets[3]
    const sendBLeft = outlets[4]
    const sendBRight = outlets[5]

    // Params are function-major — every level, then every pan, then every mute — so that a generated
    // faceplate lays out as a row of faders above a row of pans rather than as six identical clumps.
    const level = 0
    const pan = channels
    const mute = channels * 2
    const solo = channels * 3
    const sendA = channels * 4
    const sendB = channels * 5
    const master = channels * 6
    const returnA = master + 1
    const returnB = master + 2

    // The two stereo returns sit past the channels: slots 12 and 13 are Return A, 14 and 15 Return B.
    const returnASlot = channels * 2
    const returnBSlot = returnASlot + 2

    for (let i = 0; i < frames; i++) {
      // Asked per sample rather than once a block, because a param is per-sample here as everywhere else
      // and a solo dropped by an automation lane mid-block should take effect where the lane says.
      let soloed = false
      for (let c = 0; c < channels; c++) {
        if (params[solo + c][i] >= 0.5) {
          soloed = true
          break
        }
      }

      let outLeft = 0
      let outRight = 0
      let aLeft = 0
      let aRight = 0
      let bLeft = 0
      let bRight = 0

      for (let c = 0; c < channels; c++) {
        if (params[mute + c][i] >= 0.5) continue
        if (soloed && !(params[solo + c][i] >= 0.5)) continue

        const gain = params[level + c][i]
        let placement = params[pan + c][i]
        if (placement < -1) placement = -1
        else if (placement > 1) placement = 1

        const left = inlets[c * 2][i] * gain
        const right = inlets[c * 2 + 1][i] * gain
        // Balance, sample for sample what `graph.ts` does to a terminal module: unity on both at centre,
        // attenuating one side rather than moving a point source.
        const placedLeft = placement <= 0 ? left : left * (1 - placement)
        const placedRight = placement >= 0 ? right : right * (1 + placement)

        outLeft += placedLeft
        outRight += placedRight

        const a = params[sendA + c][i]
        aLeft += placedLeft * a
        aRight += placedRight * a
        const b = params[sendB + c][i]
        bLeft += placedLeft * b
        bRight += placedRight * b
      }

      const returnGainA = params[returnA][i]
      outLeft += inlets[returnASlot][i] * returnGainA
      outRight += inlets[returnASlot + 1][i] * returnGainA
      const returnGainB = params[returnB][i]
      outLeft += inlets[returnBSlot][i] * returnGainB
      outRight += inlets[returnBSlot + 1][i] * returnGainB

      const fader = params[master][i]
      mainLeft[i] = outLeft * fader
      mainRight[i] = outRight * fader
      // Sends are pre-master: the master fader is the room's volume and an effect send is not part of it.
      sendALeft[i] = aLeft
      sendARight[i] = aRight
      sendBLeft[i] = bLeft
      sendBRight[i] = bRight
    }
  }
}

/** Six, and used by the **def** only — see the note at the top of `process` about why the class works it
 *  out for itself instead of reading this. */
const CHANNELS = 6

const perChannel = <T>(make: (channel: number) => T): T[] =>
  Array.from({ length: CHANNELS }, (_, channel) => make(channel))

/** One row of the faceplate: the same control on every channel, in channel order. */
function row(id: string, name: string, rest: Omit<ParamDef, 'id' | 'name'>): ParamDef[] {
  return perChannel((channel) => ({
    id: `${id}${channel + 1}`,
    name: `${name} ${channel + 1}`,
    ...rest,
  }))
}

const inlets: Port[] = [
  ...perChannel((channel) => ({ id: `in${channel + 1}`, name: `In ${channel + 1}`, stereo: true })),
  { id: 'returnA', name: 'Return A', stereo: true },
  { id: 'returnB', name: 'Return B', stereo: true },
]

export const LINE_MIXER_MODULE: ModuleDef = {
  type: 'line-mixer',
  version: 1,
  name: 'Line Mixer',
  group: 'Mixing',
  blurb:
    'Six stereo channels with level, pan, mute and solo, two aux sends with their returns, and a stereo master. The desk the rack was patching by hand.',
  logo: {
    paths: [
      'M6 5v20M16 5v20M26 5v20M36 5v20M46 5v20M56 5v20',
      'M3 11h6M13 18h6M23 8h6M33 15h6M43 12h6M53 20h6',
      'M6 29h50',
      'M6 35h40M46 32l6 3-6 3',
    ],
  },
  guide: {
    overview:
      'Six stereo channels into one stereo pair, with two aux buses alongside. Each channel has a level, a balance, a mute and a solo; each also has an amount for Send A and Send B, which leave by their own stereo outlets. Patch a send to an effect, patch that effect back to the matching Return, and one reverb is shared by six channels at six different depths.',
    concepts: [
      {
        title: 'Sends are post-fader, and that is what makes solo work',
        body: 'A channel that is muted, or that is not the one soloed, contributes nothing to either send. So soloing a channel leaves the returns carrying only that channel’s effect, once the tail of everything else has decayed — rather than the whole mix arriving through the reverb you were trying to audition.',
      },
      {
        title: 'Solo here is not the Out’s solo',
        body: 'An Out’s solo is applied by the Graph, because one terminal module cannot know the others exist. This module is the set of channels, so its solo is ordinary arithmetic and silences only its own channels. Soloing here says nothing about any other Out in the rack, which is what you want when the mixer is one voice among several.',
      },
      {
        title: 'Returns arrive after the channels and never reach the sends',
        body: 'A return is summed into the main pair before the master fader, so the master rides the effects with everything else. It deliberately does not feed the send buses: that would be a feedback loop inside one device, with no cable anywhere to explain why the reverb was building. Patch one if you want it, and then it is visible.',
      },
    ],
    firstPatch: [
      'Patch two or three sources to In 1, In 2 and In 3, and the Main outlet to an Out.',
      'Set the balance on each channel — a mono source into a stereo inlet arrives centred until you move it.',
      'Patch Send A to a Reverb, and the Reverb back to Return A. Bring Send A up on one channel at a time.',
      'Hold Solo on a channel to hear it alone, with its own share of the reverb and nothing else’s.',
    ],
    watchFor: [
      'Six channels at once can add up past full scale. The master fader goes to 1.5 rather than 1 so that a quiet mix can be brought up, which means it can also be brought too far.',
      'There is no level CV inlet. Automation lanes and Combinator routings both reach every one of these knobs, and the plain Mixer is still the module for mixing control signals.',
    ],
  },
  inlets,
  outlets: [
    { id: 'out', name: 'Main', stereo: true },
    { id: 'sendA', name: 'Send A', stereo: true },
    { id: 'sendB', name: 'Send B', stereo: true },
  ],
  params: [
    // Function-major, so the panel reads as a desk. The processor derives every one of these offsets from
    // the channel count, so the ORDER of these blocks is load-bearing and their length is not.
    ...row('level', 'Level', { min: 0, max: 1, default: 0.7 }),
    // Balance, matching the Out's, and centre by default so a channel arrives where a mono source has
    // always arrived.
    ...row('pan', 'Pan', { min: -1, max: 1, default: 0 }),
    ...row('mute', 'Mute', {
      min: 0,
      max: 1,
      default: 0,
      stepped: true,
      labels: ['On', 'Mute'],
    }),
    ...row('solo', 'Solo', { min: 0, max: 1, default: 0, stepped: true, labels: ['—', 'Solo'] }),
    ...row('sendA', 'Send A', { min: 0, max: 1, default: 0 }),
    ...row('sendB', 'Send B', { min: 0, max: 1, default: 0 }),
    // Past unity, because six channels summed can need bringing down and a quiet mix can need bringing
    // up, and a master that could only attenuate would send you looking for a gain module.
    { id: 'master', name: 'Master', min: 0, max: 1.5, default: 1 },
    { id: 'returnLevelA', name: 'Return A', min: 0, max: 1.5, default: 1 },
    { id: 'returnLevelB', name: 'Return B', min: 0, max: 1.5, default: 1 },
  ],
  processor: LineMixerProcessor,
  // One desk, not one per voice. The same reasoning as the Out and the Delay: eight copies of a mixer is
  // eight mixers, and a shared one is the entire point — every voice reaching a channel is summed first.
  poly: false,
}
