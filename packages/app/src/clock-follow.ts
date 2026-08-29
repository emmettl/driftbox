import { TICKS_PER_QUARTER, TICKS_PER_STEP, type ClockFollower, type ParsedClock } from '@driftbox/engine'

// What the sequencer does about somebody else's clock.
//
// The measurement lives in the engine, in `midi-clock.ts`, because it is arithmetic. This is the
// other half: the rules about which messages move the transport and when a new tempo is worth
// applying. It is separated for the same reason `midiTargets` is — Chrome refuses Web MIDI under
// automation, so the handler that would otherwise hold these rules cannot be driven in a browser
// at all, and a rule left inside it could not be verified anywhere.

/** What the host should do, if anything. Every field is optional and most messages produce none. */
export interface ClockCommand {
  /** Play at this tempo. Not the same as setting the song's tempo — see `followTempo`. */
  bpm?: number
  /** `start` rewinds first; `resume` carries on from where the transport already is. */
  transport?: 'start' | 'resume' | 'stop'
  /** Song-position step for a resume, in MIDI sixteenth notes from the top. */
  step?: number
  /** Hand the tempo back to the song. Sent when the clock goes away. */
  release?: true
}

export interface LocalClockState {
  /** The tempo currently applied to the local transport. */
  bpm: number
  /** Local continuous MIDI-clock ticks, sampled at `time`. Omitted while stopped. */
  ticks?: number | null
  /** Timestamp, in the same `performance.now()` timeline as the MIDI event. */
  time?: number
}

/**
 * How much the estimate has to move before it is worth applying.
 *
 * Ticks arrive twenty-four times a beat — forty times a second at 100bpm — and every applied
 * tempo re-syncs the tempo-locked delay, which rebuilds its timing. Pushing an estimate that has
 * moved by a thousandth of a beat per minute forty times a second is all cost and no audible
 * difference.
 *
 * A twentieth of a beat per minute is far below anything anybody can hear against another
 * instrument and well above the estimator's own residual noise on a clean stream, so a steady
 * clock settles and stops writing while a real tempo change still gets through immediately.
 */
const TEMPO_EPSILON = 0.05

/**
 * How patiently phase error is corrected.
 *
 * One tick late at 120bpm is about 21ms. Closing that over two bars adds 0.625bpm: enough to
 * stop long-take drift, small enough that the correction reads as lock rather than a tempo wobble.
 */
const PHASE_CORRECTION_TICKS = TICKS_PER_QUARTER * 8

/** Errors smaller than this are below the main thread jitter the estimator was built to reject. */
const PHASE_EPSILON_TICKS = 0.25

/** A correction above this is a seek/start problem, not a tempo-following problem. */
const MAX_PHASE_BPM_CORRECTION = 2

/**
 * Feed one clock message in, get the host's move out.
 *
 * The follower is mutated — it is a running measurement, not a value — and the command describes
 * only what changed. Deliberately not `void` with callbacks: returning the decision is what makes
 * every rule below testable without an engine, an AudioContext or a MIDI port.
 */
export function followClock(
  message: ParsedClock,
  time: number,
  follower: ClockFollower,
  current: LocalClockState,
): ClockCommand {
  switch (message.message) {
    case 'tick': {
      const { bpm } = follower.tick(time)
      if (bpm === null) return {}
      const next = phaseLockedBpm(bpm, follower, current, time)
      // Applied whether or not the sender's transport is running. Gear that streams clock
      // continuously is the common case, and arriving at the right tempo *before* play is pressed
      // is the difference between starting together and starting together a second late.
      if (Math.abs(next - current.bpm) < TEMPO_EPSILON) return {}
      return { bpm: next }
    }

    case 'start':
      // Rewind, then play. A start means the top of the sender's song, and a follower that
      // resumed from wherever it happened to be would be a bar out for the rest of the take.
      follower.start()
      return { transport: 'start', ...tempoOf(follower) }

    case 'continue':
      follower.continue_()
      return { transport: 'resume', step: follower.step, ...tempoOf(follower) }

    case 'stop':
      follower.stop()
      return { transport: 'stop' }

    case 'position':
      // A playhead move while stopped. Recorded so that the `continue` which usually follows it
      // knows where it is; nothing to do to the transport yet.
      follower.locate(message.step ?? 0)
      return {}
  }
}

function phaseLockedBpm(
  bpm: number,
  follower: ClockFollower,
  current: LocalClockState,
  eventTime: number,
): number {
  if (current.ticks === undefined || current.ticks === null) return bpm
  const external = follower.positionAt(current.time ?? eventTime)
  if (external === null) return bpm

  const error = phaseError(external, current.ticks)
  if (Math.abs(error) < PHASE_EPSILON_TICKS) return bpm

  const correction = Math.max(
    -MAX_PHASE_BPM_CORRECTION,
    Math.min(MAX_PHASE_BPM_CORRECTION, (bpm * error) / PHASE_CORRECTION_TICKS),
  )
  return bpm + correction
}

function phaseError(externalTicks: number, localTicks: number): number {
  const half = TICKS_PER_STEP / 2
  const period = TICKS_PER_STEP
  return ((((externalTicks - localTicks + half) % period) + period) % period) - half
}

/** The tempo to apply alongside a transport change, if one is known. After a start or continue the
 *  follower has deliberately forgotten its fit — the gap either side of a stop is not a tempo — so
 *  usually there is nothing here and the next few ticks supply it. */
function tempoOf(follower: ClockFollower): { bpm?: number } {
  const { bpm } = follower.state
  return bpm === null ? {} : { bpm }
}

/**
 * Whether to give the tempo back to the song, having heard nothing for a while.
 *
 * Senders do not reliably say goodbye: a pulled cable, a closed laptop and a quit DAW all end the
 * stream in silence. Without this the sequencer would keep playing at a tempo whose source no
 * longer exists, and the song's own tempo would never come back.
 */
export function clockLost(follower: ClockFollower, now: number): ClockCommand {
  return follower.lost(now) ? { release: true } : {}
}
