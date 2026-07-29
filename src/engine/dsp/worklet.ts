import { Ladder } from './ladder'

// Getting the ladder onto the audio thread.
//
// A BiquadFilterNode runs natively; anything else has to be an AudioWorklet, which
// means shipping the DSP as a separate script that gets loaded into a global scope with
// no module graph of its own. The usual way to do that is a second build entry point,
// which would mean the engine could no longer be imported as one module — and being
// importable as one module is the whole reason the engine boundary exists.
//
// So the processor's source is assembled here from `Ladder.toString()` and handed over
// as a blob URL, the same way `transport.ts` builds its ticker Worker. The filter is
// therefore written ONCE, in ordinary TypeScript, unit-tested as ordinary arithmetic,
// and the audio thread gets that exact code rather than a second copy of it that can
// drift.
//
// The one rule this imposes: `Ladder` must not reference anything outside itself. The
// AudioWorkletGlobalScope shares no scope with this module, so a captured constant
// would be a ReferenceError at the point the first note plays. Binding the stringified
// class to a `const` also means a minifier renaming it does no harm — the source stays
// self-consistent whatever it calls itself.

export const LADDER_PROCESSOR = 'driftbox-ladder'

const SOURCE = `
const Ladder = ${Ladder.toString()}

class LadderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // a-rate on both, because on a 303 the cutoff is being swept by an envelope on
      // every note. A k-rate parameter only updates once per 128-sample block, which
      // on a fast decay is audibly steppy — a zipper on the front of each note.
      { name: 'frequency', defaultValue: 800, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonance', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
    ]
  }

  constructor() {
    super()
    this.filters = []
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    const frequency = parameters.frequency
    const resonance = parameters.resonance

    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel]
      const target = output[channel]
      let filter = this.filters[channel]
      if (!filter) filter = this.filters[channel] = new Ladder(sampleRate)

      for (let i = 0; i < target.length; i++) {
        target[i] = filter.process(
          source ? source[i] : 0,
          frequency.length > 1 ? frequency[i] : frequency[0],
          resonance.length > 1 ? resonance[i] : resonance[0],
        )
      }
    }

    // Never retire. A self-oscillating filter keeps making sound with no input at all,
    // so the usual "no input, no output, shut down" optimisation would silence the
    // squelch exactly at the top of the resonance knob where it matters.
    return true
  }
}

registerProcessor(${JSON.stringify(LADDER_PROCESSOR)}, LadderProcessor)
`

/** One load per context. `addModule` on an already-registered name throws, and every
 *  303 voice on the same context wants the same processor. */
const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>()

/**
 * Make sure the ladder processor is registered on this context.
 *
 * Resolves `false` rather than throwing when worklets are unavailable — an old browser,
 * or a Content-Security-Policy that will not run a blob script. The caller falls back to
 * biquads in that case, which is a worse filter but not a silent app.
 */
export function loadLadder(ctx: BaseAudioContext): Promise<boolean> {
  const existing = loaded.get(ctx)
  if (existing) return existing

  const attempt = (async () => {
    if (!ctx.audioWorklet) return false
    try {
      const url = URL.createObjectURL(new Blob([SOURCE], { type: 'application/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      return true
    } catch {
      return false
    }
  })()

  loaded.set(ctx, attempt)
  return attempt
}
