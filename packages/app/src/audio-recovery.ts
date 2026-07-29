import { useEffect } from 'react'
import { useBox } from './store'

// Getting the sound back after iOS takes it away.
//
// Backgrounding Safari suspends the AudioContext, and a phone call or another app
// claiming audio does the same. Nothing here ever asked for it back, so the symptom was
// that audio stopped when you navigated away and never returned — the transport carried
// on ticking in its Worker the whole time, scheduling into a context that was not
// running, so it looked alive and was silent.
//
// Four things get it back, in order of how much they ask of the user:
//
//   1. The page becoming visible again. Sometimes enough on its own.
//   2. The context's own `statechange`, which is what fires for an interruption that is
//      not a visibility change — a call arriving while you are looking at the screen.
//   3. A retry every second for as long as it is still stalled.
//   4. Any tap, anywhere. Some iOS versions refuse to resume outside a user gesture, and
//      when that happens the first three silently fail; this is the backstop, and it costs
//      nothing because the tap was going to happen anyway.
//
// **Three and two are the whole fix, and the first version had neither.** It described
// both in a comment and registered neither: there was no `statechange` listener at all,
// and the one-second poll called the function that *reports* the stall rather than the one
// that clears it. So recovery was a single attempt fired from `visibilitychange` — which
// on iOS lands while the context is still `interrupted`, fails, and is never tried again.
// One missed attempt and the audio was gone until a tap, and if that tap's attempt failed
// too there was nothing left. Retrying is not a nicety here; an interruption ends when iOS
// decides it ends, and the only way to find out is to keep asking.
//
// What this does NOT do is keep audio playing in the background. Safari does not allow a
// Web Audio page to do that, and pretending otherwise with a silent looping <audio>
// element is a trick that works on some versions and not others. Coming straight back
// when you return is the honest version of the feature.

/** Safari reports a non-standard 'interrupted' alongside the spec's states, so the test
 *  is "not running" rather than a list of the ones we know about. */
function stalled(engine: { ctx: AudioContext } | null): boolean {
  return engine !== null && engine.ctx.state !== 'running'
}

export function useAudioRecovery(): void {
  useEffect(() => {
    let cancelled = false
    /** The context we have a statechange listener on, so it is attached exactly once and
     *  moved if the engine is ever rebuilt. */
    let watched: AudioContext | null = null

    const sync = () => {
      if (cancelled) return
      const { engine, running, audioStalled } = useBox.getState()
      // Only worth reporting while something is meant to be playing — a suspended
      // context before anybody has pressed play is the normal state of the world.
      const next = running && stalled(engine)
      if (next !== audioStalled) useBox.setState({ audioStalled: next })
    }

    const recover = () => {
      if (cancelled) return
      const { engine, running } = useBox.getState()
      if (!engine) return

      // The context is created lazily, so the listener cannot be attached from the effect
      // body — the first chance to do it is whenever we next look and find one.
      if (watched !== engine.ctx) {
        watched?.removeEventListener('statechange', recover)
        watched = engine.ctx
        watched.addEventListener('statechange', recover)
      }

      if (!running || !stalled(engine)) return sync()

      // `ctx.resume()` is reached synchronously from here, so when this is called from a
      // pointer handler the user gesture is still live. Anything awaited first would
      // spend it, which is the classic way to make a resume work everywhere but iOS.
      void engine
        .resume()
        // Resolving is not the same as running: an interrupted context on iOS will settle
        // this promise and stay interrupted. `sync` re-reads the real state, so a failed
        // attempt leaves the prompt up and the next retry still comes.
        .then(sync)
        .catch(sync)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') recover()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', recover)
    window.addEventListener('focus', recover)
    // Capture, so it runs before anything that might stop propagation, and passive
    // because it never prevents the gesture it is listening to. All three of these, not
    // just one: which events count as a gesture for `resume()` has differed between iOS
    // versions, and they are idempotent when the context is already running.
    const gestures = ['pointerdown', 'touchend', 'click'] as const
    for (const type of gestures) {
      window.addEventListener(type, recover, { capture: true, passive: true })
    }

    // Keep asking. This is the one that actually gets the sound back when the interruption
    // outlasts the events, and it also catches a state change that fires no event at all,
    // which iOS has been known to do.
    const poll = setInterval(recover, 1000)
    recover()

    return () => {
      cancelled = true
      clearInterval(poll)
      watched?.removeEventListener('statechange', recover)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', recover)
      window.removeEventListener('focus', recover)
      for (const type of gestures) {
        window.removeEventListener(type, recover, { capture: true })
      }
    }
  }, [])
}
