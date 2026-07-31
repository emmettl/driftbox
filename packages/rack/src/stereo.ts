import type { Port } from './types.js'

// What a stereo cable is, in one file, because it is three rules and all of the mistakes are in them.
//
// **A stereo port is one jack that owns two buffers.** Not two ports, not a second cable, and not a flag on
// the cable. `docs/RACK.md` opened by saying audio and CV are the same `Float32Array` and nothing enforces
// which is which; that stays true. What a port now declares is how MANY of them it has.
//
// The alternative — a second signal type, or a channel count that propagates along cables the way VCV's
// polyphony does — was rejected for the reason the patch's single `voices` count was: a count that
// propagates needs a rule for every place two counts meet, a pass to compute it, and a plan format that
// carries it. Declared per port, the answer is known at compile time from the two defs alone.
//
// Three rules, and the compiler applies them without asking anything else:
//
//   stereo → stereo   both channels, in order. The point of the feature.
//   mono   → stereo   the one buffer feeds both channels. A mono source is centred, which is what it was.
//   stereo → mono     the LEFT channel, and the right is not heard.
//
// **That last rule is Reason's, and it is worth saying why it is not a sum.** Reason labels the jack "L
// (Mono)" and a mono device patched to it takes the left channel; that convention is thirty years old and
// people arrive already knowing it. A sum would need a scratch buffer and a copy per folded inlet every
// block — the machinery the polyphonic collapse already pays for — and it would add 6dB to any centred
// signal, because summing two identical channels is doubling. The Mixer is one module away for anybody who
// wants the sum, and it is visible in the patch when they do.
//
// The compiler records the fold in `plan.notes`, because a patch that behaves unlike its picture is worse
// than one that admits it — the same rule that makes a delayed cable draw differently.

/** How many buffers this port owns. */
export function channelCount(port: Port): number {
  return port.stereo === true ? 2 : 1
}

/**
 * How many buffers a whole side of a module owns.
 *
 * This is what makes a processor's `inlets`/`outlets` arrays longer than its def's port list: a stereo port
 * occupies two consecutive slots. A module that declares no stereo port sees exactly what it saw before,
 * which is why this change costs the other twenty-seven modules nothing.
 */
export function slotCount(ports: readonly Port[]): number {
  let total = 0
  for (const port of ports) total += channelCount(port)
  return total
}

/**
 * The buffers a destination port reads, given the buffers its source writes.
 *
 * Total for every input: an unconnected inlet arrives as `[ZERO]` and comes back as one or two zero
 * buffers, so no module has to branch on whether it is patched — which is the property the zero buffer
 * exists to give and the one thing this must not break.
 */
export function wire(source: readonly number[], want: number): number[] {
  const left = source[0] ?? 0
  if (want === 1) return [left]
  // A mono source centres: the same buffer read twice. No copy, no allocation — two slots pointing at one
  // array, which the Graph is already comfortable with because every unconnected inlet in the patch shares
  // the zero buffer that way.
  return [left, source[1] ?? left]
}

/** Does connecting these two ports lose a channel? Used only to explain it, never to prevent it. */
export function folds(source: Port, dest: Port): boolean {
  return channelCount(source) === 2 && channelCount(dest) === 1
}
