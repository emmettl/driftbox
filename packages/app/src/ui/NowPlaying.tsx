import { useState } from 'react'
import { SONGS, chainPositionAt } from '@driftbox/engine'
import { useBox } from '../store'
import { usePlayhead } from './usePlayhead'

// The bit that makes vibes mode a player rather than a preview.
//
// Not everybody who opens this wants to sequence anything. For them the whole app is:
// what is this, and what else is there. So — the name of the song, the section it is
// currently in, and a way to the next one, without ever going near the grid.

export function NowPlaying() {
  const song = useBox((s) => s.song)
  const preset = useBox((s) => s.preset)
  const stepPreset = useBox((s) => s.stepPreset)
  const pristine = useBox((s) => s.pristine)
  const running = useBox((s) => s.running)
  const [flash, setFlash] = useState<string | null>(null)

  const playhead = usePlayhead()
  const position = playhead ? chainPositionAt(song, playhead.bar) : undefined
  const section = position ? song.patterns.find((p) => p.id === position.step.pattern) : undefined

  // A song that is not one of the shipped ones is somebody's own — theirs, and unnamed.
  const name = SONGS.find((s) => s.id === preset)?.name ?? 'Your song'

  const step = (delta: number) => {
    // Only asks when there is something to lose. Somebody listening has edited nothing,
    // and making them confirm a skip would be absurd; somebody who HAS edited would
    // otherwise lose it silently, since loading overwrites the autosave too.
    if (!pristine() && !confirm('Load the next song? Your changes to this one will be lost.')) {
      return
    }
    const landed = stepPreset(delta)
    if (!landed) return
    setFlash(landed)
    setTimeout(() => setFlash((f) => (f === landed ? null : f)), 1800)
  }

  return (
    <div className="now-playing">
      <button className="np-step" onClick={() => step(-1)} aria-label="Previous song">
        ‹‹
      </button>

      <div className="np-title">
        <span className="np-name">{name}</span>
        <span className="np-detail">
          {/* The section, and how far through it — which is the thing that tells you this
              is an arrangement rather than a loop, without explaining anything. */}
          {running && section && position
            ? `${section.name} · ${position.barWithin + 1}/${position.step.repeat}`
            : running
              ? 'playing'
              : 'paused'}
        </span>
      </div>

      <button className="np-step" onClick={() => step(1)} aria-label="Next song">
        ››
      </button>

      {flash && <span className="np-flash">{flash}</span>}
    </div>
  )
}
