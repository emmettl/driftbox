// Timing maths, kept pure and separate from anything that makes noise.
//
// Getting this wrong is the single most audible failure mode in a sequencer, and the
// mistake is always the same: driving the sequence from setInterval and triggering
// sounds "now". JavaScript timers are not accurate to better than a few milliseconds
// and are starved outright by layout, garbage collection or a background tab — so the
// groove wobbles, and it wobbles worst exactly when the visualiser is busy.
//
// The fix is the standard one: timers only decide WHEN TO LOOK AHEAD, never when a
// sound happens. Every hit is scheduled against the audio clock, ahead of time, at a
// timestamp computed here. The audio thread then plays it sample-accurately whatever
// the main thread is doing.

/** How far ahead of the audio clock hits are scheduled. Large enough to ride out a
 *  stalled main thread, short enough that a tempo or pattern change feels immediate. */
export const LOOKAHEAD_SECONDS = 0.12

/** How often the scheduler wakes to look ahead. Comfortably more often than the
 *  lookahead window, so a late wake-up still catches everything. */
export const TICK_MS = 20

export const STEPS_PER_BEAT = 4

export function secondsPerStep(bpm: number, stepsPerBeat = STEPS_PER_BEAT): number {
  return 60 / bpm / stepsPerBeat
}

/**
 * How late a given step lands, in seconds, because of swing.
 *
 * Swing delays the off-beat sixteenths and leaves the on-beats alone, which is what
 * turns a machine-straight pattern into something with a shuffle. 0 is dead straight;
 * about 0.67 lands the off-beat on a triplet, the classic shuffle; higher gets
 * progressively more lopsided.
 */
export function swingDelay(step: number, swing: number, stepSeconds: number): number {
  const odd = ((step % 2) + 2) % 2 === 1
  if (!odd) return 0
  return Math.max(0, Math.min(1, swing)) * 0.5 * stepSeconds
}

/**
 * When step `step` happens, on the audio clock, given that step 0 of the current run
 * happened at `origin`. Steps count on without wrapping, so this stays exact over long
 * runs instead of accumulating error by repeatedly adding a step duration.
 */
export function stepTime(
  origin: number,
  step: number,
  bpm: number,
  swing: number,
  stepsPerBeat = STEPS_PER_BEAT,
): number {
  const stepSeconds = secondsPerStep(bpm, stepsPerBeat)
  return origin + step * stepSeconds + swingDelay(step, swing, stepSeconds)
}
