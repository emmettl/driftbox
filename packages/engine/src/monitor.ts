// How far behind the graph the speaker is, and what to do about it.
//
// **The visuals are ahead of the music, and nothing in the app knew it.** An `AnalyserNode` reports
// what has just passed through it, but those samples have not been heard yet — they are still in
// the output buffer, on their way to a device. So a scene that flashes on the kick flashes when
// the kick reaches the analyser, which is `outputLatency` seconds before anyone hears it. Wired
// output makes that a few milliseconds and nobody could name it. Bluetooth headphones make it
// 150–300ms, which at 120bpm is most of a beat: the picture is visibly early, and "the visual
// follows the tune" stops being true on the hardware most people listen on.
//
// The fix is not to move the picture. It is to move the *reading* — feed the analyser a copy of
// the mix delayed by exactly the amount the speaker is behind, so what it reports and what the ear
// receives are the same moment. Nothing about the audio path changes; the delay is on a branch
// that never reaches the output.

/**
 * The longest delay the monitor tap can hold.
 *
 * There has to be a number: a `DelayNode`'s `maxDelayTime` is fixed when it is constructed and the
 * latency is not known until the context is running, so the buffer has to be big enough for a case
 * that has not happened yet. Half a second is well past the worst Bluetooth stack — 300ms is the
 * high end of what anybody measures — and it costs a fraction of a megabyte.
 */
export const MONITOR_MAX_DELAY = 0.5

/** Just enough of an `AudioContext` to answer the question. Typed structurally so a test can pass
 *  a plain object, and so an `OfflineAudioContext` — which has neither field — is handled by the
 *  same code rather than by a branch at the call site. */
export interface LatencyReporting {
  outputLatency?: number
  baseLatency?: number
}

/**
 * The best available estimate of how far behind the graph the output device is.
 *
 * Three sources in order, and the order is the point. `outputLatency` is the answer to exactly
 * this question — buffer to speaker — and is what Chrome and Firefox report. `baseLatency` is a
 * smaller, different number (the graph's own processing latency) and is the honest fallback for a
 * browser that has one and not the other, because it is at least the right sign and the right
 * order of magnitude. Zero is the last resort, and zero is also the correct answer for an
 * `OfflineAudioContext`, which has no device and no latency to compensate for.
 *
 * Everything is guarded rather than trusted. A suspended context can report 0, a context that has
 * never run can report `undefined`, and an implementation with a bad estimate can report something
 * absurd — none of which should turn the visualiser off, which is what an unclamped `NaN` in a
 * `delayTime` would do.
 */
export function outputLatencyOf(ctx: LatencyReporting | null | undefined): number {
  const reported = ctx?.outputLatency ?? ctx?.baseLatency ?? 0
  if (!Number.isFinite(reported) || reported <= 0) return 0
  return Math.min(reported, MONITOR_MAX_DELAY)
}
