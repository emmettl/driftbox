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
// Three things get it back, in order of how much they ask of the user:
//
//   1. The page becoming visible again. Usually enough on its own.
//   2. The context's own `statechange`, which is what fires for an interruption that is
//      not a visibility change — a call arriving while you are looking at the screen.
//   3. Any tap, anywhere. Some iOS versions refuse to resume outside a user gesture, and
//      when that happens the first two silently fail; this is the backstop, and it costs
//      nothing because the tap was going to happen anyway.
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

    const sync = () => {
      if (cancelled) return
      const { engine, running, audioStalled } = useBox.getState()
      // Only worth reporting while something is meant to be playing — a suspended
      // context before anybody has pressed play is the normal state of the world.
      const next = running && stalled(engine)
      if (next !== audioStalled) useBox.setState({ audioStalled: next })
    }

    const recover = () => {
      const { engine, running } = useBox.getState()
      if (!engine || !running || !stalled(engine)) return sync()
      void engine
        .resume()
        .then(sync)
        // A rejection here means iOS wants a gesture. The pointer handler below is what
        // eventually gets it; there is nothing useful to do with the error.
        .catch(sync)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') recover()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', recover)
    window.addEventListener('focus', recover)
    // Capture, so it runs before anything that might stop propagation, and passive
    // because it never prevents the gesture it is listening to.
    window.addEventListener('pointerdown', recover, { capture: true, passive: true })

    // The context is created lazily, so there may be nothing to listen to yet. Poll for
    // it rather than plumbing a callback through the engine — this is once a second and
    // it also catches a state change that fires no event, which iOS has been known to do.
    const poll = setInterval(sync, 1000)

    return () => {
      cancelled = true
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', recover)
      window.removeEventListener('focus', recover)
      window.removeEventListener('pointerdown', recover, { capture: true })
    }
  }, [])
}
