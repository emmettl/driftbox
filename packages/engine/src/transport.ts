import { LOOKAHEAD_SECONDS, TICK_MS, secondsPerStep } from './timing.js'

// The scheduler. See timing.ts for why this shape rather than the obvious one.

export interface StepEvent {
  /** Steps since the transport started, never wrapping. */
  absolute: number
  /** Position within the current bar. */
  index: number
  /** Bars since the transport started. */
  bar: number
  /**
   * When this step sounds, on the audio clock, with NO swing applied. Always in the
   * future.
   *
   * Straight, because swing is per voice and the transport has no business knowing
   * which voice is which. A caller shifts this by `swingDelay(index, swing, stepSeconds)`
   * for whatever it is about to play — which is what lets the hats shuffle against a
   * kick that stays on the grid.
   */
  time: number
  /** How long one step lasts at the current tempo. Supplied so a caller can work out
   *  its own swing offset without having to know the tempo. */
  stepSeconds: number
}

export interface TransportOptions {
  /**
   * Called at a bar boundary before `barLength` is read.
   *
   * A live clip launcher uses this ordering to commit every queued machine together,
   * then let the longest newly selected clip decide the incoming bar's length.
   */
  onBar?: (bar: number) => void
  /**
   * Bar length in steps, for the bar about to start.
   *
   * Read fresh at each bar boundary — and read for THAT bar, not for bar zero, or a
   * chain whose patterns are different lengths would play every one of them at the
   * length of whichever happened to be first.
   */
  barLength: (bar: number) => number
  onStep: (event: StepEvent) => void
}

// The scheduler's heartbeat, run inside a Worker.
//
// A background tab clamps setInterval to roughly once a second, which is many times
// longer than the lookahead window — so tabbing away from the sequencer would starve
// the scheduler and the audio would drop out in chunks until you came back. Worker
// timers are not clamped the same way, so the beat survives losing focus. The audio
// thread was never the problem; the thing telling it what to play next was.
const TICKER_SOURCE = `
  let id
  onmessage = (e) => {
    if (e.data.start !== undefined) { clearInterval(id); id = setInterval(() => postMessage(0), e.data.start) }
    else { clearInterval(id); id = undefined }
  }
`

function createTicker(onTick: () => void): { start: (ms: number) => void; stop: () => void } {
  try {
    const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'application/javascript' }))
    const worker = new Worker(url)
    URL.revokeObjectURL(url)
    worker.onmessage = onTick
    return {
      start: (ms) => worker.postMessage({ start: ms }),
      stop: () => worker.postMessage({ stop: true }),
    }
  } catch {
    // No Worker (or a policy that blocks blob workers): fall back to a plain timer.
    // Foreground playback is identical; only background robustness is lost.
    let id: ReturnType<typeof setInterval> | undefined
    return {
      start: (ms) => {
        clearInterval(id)
        id = setInterval(onTick, ms)
      },
      stop: () => clearInterval(id),
    }
  }
}

export class Transport {
  bpm = 120

  private ticker: { start: (ms: number) => void; stop: () => void } | undefined
  private active = false
  /** Unswung time of the next step. Advanced by one step duration at a time rather
   *  than recomputed from the origin, so a tempo change takes effect on the next step
   *  instead of retroactively rewriting where every previous step should have been. */
  private nextTime = 0
  private absolute = 0
  private index = 0
  private bar = 0
  private length = 16
  private loopStart: number | undefined
  private loopEnd: number | undefined

  private readonly ctx: BaseAudioContext
  private readonly options: TransportOptions

  constructor(ctx: BaseAudioContext, options: TransportOptions) {
    this.ctx = ctx
    this.options = options
  }

  get running(): boolean {
    return this.active
  }

  /** Where the playhead is right now, for the UI. Derived from the audio clock rather
   *  than counted in a render loop, so the highlight cannot drift away from the sound. */
  get position(): { bar: number; index: number } {
    return { bar: this.bar, index: this.index }
  }

  /**
   * Continuous steps since this transport run began, sampled against the audio clock.
   *
   * `position` is intentionally discrete because it labels the grid. A clock follower needs the
   * fraction too: if the next scheduled step is 40ms away, the transport is not "on" the previous
   * step any more, it is most of the way to the next one. This derives the answer from the next
   * scheduled step rather than from a wall-clock origin, so tempo changes keep the future schedule
   * authoritative instead of rewriting the past.
   */
  phaseSteps(time = this.ctx.currentTime): number | null {
    if (!this.active) return null
    const stepSeconds = secondsPerStep(this.bpm)
    return Math.max(0, this.absolute - (this.nextTime - time) / stepSeconds)
  }

  start(): void {
    this.startAt(0)
  }

  /** Start from an exact song position. The end is exclusive, as it is everywhere
   * else in the scheduler, so seeking to step `length` lands on the next bar instead. */
  startAt(bar: number, index = 0): void {
    if (this.active) return
    this.bar = Math.max(0, Math.floor(bar))
    this.options.onBar?.(this.bar)
    this.length = Math.max(1, Math.floor(this.options.barLength(this.bar)))
    this.absolute = 0
    this.index = Math.max(0, Math.min(this.length - 1, Math.floor(index)))
    // A beat of headroom before the first hit. Starting at exactly currentTime means
    // the first step is already in the past by the time the nodes are built, and the
    // pattern opens with a stumble.
    this.nextTime = this.ctx.currentTime + 0.06
    this.active = true
    this.tick()
    this.ticker ??= createTicker(() => this.tick())
    this.ticker.start(TICK_MS)
  }

  /** Loop whole bars. `bars <= 0` disables looping. Changes are heard at the next bar
   * boundary, so the current bar never gets cut in half. */
  setLoop(start: number, bars: number): void {
    const length = Math.floor(bars)
    if (length <= 0) {
      this.clearLoop()
      return
    }
    this.loopStart = Math.max(0, Math.floor(start))
    this.loopEnd = this.loopStart + length
  }

  clearLoop(): void {
    this.loopStart = undefined
    this.loopEnd = undefined
  }

  get loop(): { start: number; bars: number } | null {
    if (this.loopStart === undefined || this.loopEnd === undefined) return null
    return { start: this.loopStart, bars: this.loopEnd - this.loopStart }
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.ticker?.stop()
  }

  private tick(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS

    // Bounded, so a tab that was suspended for a minute does not try to schedule a
    // minute of hits in one go when it wakes.
    let guard = 0
    while (this.nextTime < horizon && guard++ < 64) {
      const stepSeconds = secondsPerStep(this.bpm)

      this.options.onStep({
        absolute: this.absolute,
        index: this.index,
        bar: this.bar,
        time: this.nextTime,
        stepSeconds,
      })

      this.nextTime += stepSeconds
      this.absolute += 1
      this.index += 1
      if (this.index >= this.length) {
        this.index = 0
        this.bar += 1
        if (
          this.loopStart !== undefined &&
          this.loopEnd !== undefined &&
          this.bar >= this.loopEnd
        ) {
          this.bar = this.loopStart
        }
        this.options.onBar?.(this.bar)
        this.length = this.options.barLength(this.bar)
      }
    }

    // If the clock ran away from us — a suspended tab, a stalled thread — do not try
    // to catch up by firing everything we missed. Skip forward to now instead.
    if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.02
  }
}
