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

  start(): void {
    if (this.active) return
    this.length = this.options.barLength(0)
    this.absolute = 0
    this.index = 0
    this.bar = 0
    // A beat of headroom before the first hit. Starting at exactly currentTime means
    // the first step is already in the past by the time the nodes are built, and the
    // pattern opens with a stumble.
    this.nextTime = this.ctx.currentTime + 0.06
    this.active = true
    this.tick()
    this.ticker ??= createTicker(() => this.tick())
    this.ticker.start(TICK_MS)
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
        this.length = this.options.barLength(this.bar)
      }
    }

    // If the clock ran away from us — a suspended tab, a stalled thread — do not try
    // to catch up by firing everything we missed. Skip forward to now instead.
    if (this.nextTime < this.ctx.currentTime) this.nextTime = this.ctx.currentTime + 0.02
  }
}
