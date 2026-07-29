import { useEffect, useState } from 'react'
import { useBox } from './store'
import { Arrangement } from './ui/Arrangement'
import { BassGrid } from './ui/BassGrid'
import { BassPanel } from './ui/BassPanel'
import { FxPanel } from './ui/FxPanel'
import { Sequencer } from './ui/Sequencer'
import { TransportBar } from './ui/TransportBar'
import { VoicePanel } from './ui/VoicePanel'
import { Chillwave } from './visual/Chillwave'
import { Oscilloscope, type ScopeMode } from './visual/Oscilloscope'
import './styles.css'

export default function App() {
  const performing = useBox((s) => s.performance)
  const togglePerformance = useBox((s) => s.togglePerformance)
  const toggleTransport = useBox((s) => s.toggleTransport)
  const running = useBox((s) => s.running)
  const view = useBox((s) => s.view)
  const adoptSharedSong = useBox((s) => s.adoptSharedSong)
  const [scope, setScope] = useState<ScopeMode>('wave')

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

      {performing ? (
        <div className="stage">
          <Oscilloscope mode={scope} height={260} persistence={0.42} transparent />
          <p className="stage-hint">
            {running ? '' : 'space to start · '}x switches the scope · escape returns
          </p>
        </div>
      ) : (
        <div className="console">
          <TransportBar />
          <Arrangement />
          <main>
            {view === 'bass' ? <BassGrid /> : <Sequencer />}
            <aside>
              {view === 'bass' ? <BassPanel /> : <VoicePanel />}
              <FxPanel />
              <section className="scope">
                <header>
                  <h3>Scope</h3>
                  <button
                    className="ghost"
                    onClick={() => setScope((m) => (m === 'wave' ? 'xy' : 'wave'))}
                  >
                    {scope === 'wave' ? 'wave' : 'x/y'}
                  </button>
                </header>
                <Oscilloscope mode={scope} />
              </section>
            </aside>
          </main>
        </div>
      )}
    </div>
  )
}
