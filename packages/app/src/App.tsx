import { useEffect, useState } from 'react'
import { useBox } from './store'
import { Arrangement } from './ui/Arrangement'
import { BassGrid } from './ui/BassGrid'
import { KaossPad } from './ui/KaossPad'
import { Panel } from './ui/Panel'
import { BassPanel } from './ui/BassPanel'
import { FxPanel } from './ui/FxPanel'
import { Sequencer } from './ui/Sequencer'
import { TransportBar } from './ui/TransportBar'
import { VoicePanel } from './ui/VoicePanel'
import { Chillwave } from './visual/Chillwave'
import { Oscilloscope, type ScopeMode } from './visual/Oscilloscope'
import './styles.css'

/** How long the console takes to fold into the edit button. Matches `--fold` in the
 *  stylesheet; they have to agree or the console either vanishes early or lingers. */
const FOLD_MS = 260

export default function App() {
  const performing = useBox((s) => s.performance)
  const togglePerformance = useBox((s) => s.togglePerformance)
  const toggleTransport = useBox((s) => s.toggleTransport)
  const running = useBox((s) => s.running)
  const view = useBox((s) => s.view)
  const adoptSharedSong = useBox((s) => s.adoptSharedSong)
  const [scope, setScope] = useState<ScopeMode>('wave')

  // The console flies out of the edit button, and folds back into it.
  //
  // Going in is easy — it mounts and animates. Coming out is the part that needs state:
  // unmounting immediately would make it vanish rather than fold away, so it is held
  // mounted for exactly as long as the animation runs.
  const [consoleMounted, setConsoleMounted] = useState(!performing)

  useEffect(() => {
    if (!performing) {
      setConsoleMounted(true)
      return
    }
    const timer = setTimeout(() => setConsoleMounted(false), FOLD_MS)
    return () => clearTimeout(timer)
  }, [performing])

  // A song in the URL wins over the autosaved session, because arriving on a link and
  // getting somebody else's song is the whole point of the link. Decoding is async — it
  // goes through DecompressionStream — so it cannot be part of the store's initial
  // state and has to land here instead.
  useEffect(() => {
    void adoptSharedSong()
  }, [adoptSharedSong])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not while typing in a control — space on a focused slider should not also
      // start the transport.
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return

      if (event.code === 'Space') {
        event.preventDefault()
        toggleTransport()
      }
      if (event.key.toLowerCase() === 'v') togglePerformance()
      if (event.key === 'Escape' && performing) togglePerformance()
      if (event.key.toLowerCase() === 'x') setScope((m) => (m === 'wave' ? 'xy' : 'wave'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTransport, togglePerformance, performing])

  return (
    <div className={`app${performing ? ' performing' : ''}`}>
      <Chillwave className="backdrop" />

      {performing && (
        <div className="stage">
          {/* The pad is the whole screen and sits UNDER everything else, so a finger
              anywhere lands on it. The rest is pointer-transparent apart from its
              buttons. */}
          <KaossPad />

          <div className="stage-scope">
            <Oscilloscope mode={scope} height={260} persistence={0.42} transparent />
            <p className="stage-hint">drag anywhere to filter</p>
          </div>

          {/* Vibes mode had no transport at all — it relied on the space bar, which does
              not exist on a phone. Since touch devices now open here, that made the app
              start silent with no way to start it. */}
          <button
            className={`stage-play${running ? ' on' : ''}`}
            onClick={toggleTransport}
            aria-label={running ? 'Stop' : 'Play'}
          >
            {running ? '■' : '▶'}
          </button>

          {/* The way back to the console, and the thing the console appears to come out
              of. It pulses while stopped, because on a phone this is the only clue that
              there is anything here besides a picture. */}
          <button
            className={`stage-edit${running ? '' : ' calling'}`}
            onClick={togglePerformance}
            aria-label="Edit the song"
          >
            <span className="stage-edit-glyph">▦</span>
            <span className="stage-edit-label">edit</span>
          </button>
        </div>
      )}

      {consoleMounted && (
        <div className={`console${performing ? ' folding' : ''}`}>
          <TransportBar />
          <Arrangement />
          <main>
            {view === 'bass' ? <BassGrid /> : <Sequencer />}
            <aside>
              {view === 'bass' ? <BassPanel /> : <VoicePanel />}
              <FxPanel />
              <Panel
                id="scope"
                className="scope"
                title="Scope"
                aside={
                  <button
                    className="ghost"
                    onClick={() => setScope((m) => (m === 'wave' ? 'xy' : 'wave'))}
                  >
                    {scope === 'wave' ? 'wave' : 'x/y'}
                  </button>
                }
              >
                <Oscilloscope mode={scope} />
              </Panel>
            </aside>
          </main>
        </div>
      )}
    </div>
  )
}
