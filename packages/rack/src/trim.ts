// What a cable's trim is, and what it is allowed to be.
//
// **A trim pot on every input**, which `docs/REASON-GAP.md` listed as the last substantive gap in the
// rack-wide table. Without one, modulating anything *by a controlled amount* — the single thing a modular
// is for — costs an inline Offset module and two extra cables. That tax is paid on every patch, which is
// why it outranked the prettier items on the same list.
//
// **An attenuverter, −1 to +1, not an attenuator.** Reason's CV inputs trim from zero to full and no
// further. Going bipolar is the one place this deliberately exceeds it, and it is not gratuitous: the
// inline Offset those cables currently need is reached for two reasons — to make a modulation smaller and
// to make it go the other way — and covering only the first would leave half the cables it was standing in
// for. Inverting is how one LFO opens a filter while closing a VCA, and how a sidechain becomes a duck.
//
// **Not past unity**, which is the other half of the range decision. A cable that could amplify is a gain
// stage hidden in a wire: you would go looking for the module making something loud and there would not be
// one. The Offset keeps its ±2 for when you genuinely want that, and it is visible on the rack when you do.
//
// **Absent means unity, and absence is free.** A cable with no trim is compiled exactly as it always was —
// its destination inlet points straight at the source's buffer, no copy and no multiply, which is the
// property the whole graph is built around. A trim is the only thing that makes an inlet pay for a buffer
// of its own, so the patch format spends nothing on the cables that do not have one, and a patch written
// before trims existed is byte-identical after a round trip.

/** Hard left of the pot: the source, inverted, at full. */
export const TRIM_MIN = -1
/** Hard right: the source, untouched. Also what a cable with no trim at all does. */
export const TRIM_MAX = 1

/**
 * A trim from something that may not be one — a hand-edited file, an older build, a NaN.
 *
 * Returns `undefined` for anything that is not a usable number, which the callers read as "no trim":
 * unity, and no cost. Repairing rather than rejecting is the standard `patch-io.ts` sets for everything
 * arriving from outside the program, and the repair here is the value the cable had before trims existed.
 */
export function readTrim(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(TRIM_MAX, Math.max(TRIM_MIN, value))
}
