import { useState } from 'react'
import { useBox } from '../store'

/** Confirmation that lives for a moment and then goes away. Sharing and saving both
 *  succeed silently otherwise, and a button that appears to do nothing gets pressed
 *  again — which for "reset" is the one place that matters. */
function useFlash(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null)
  return [
    message,
    (next: string) => {
      setMessage(next)
      setTimeout(() => setMessage((current) => (current === next ? null : current)), 2200)
    },
  ]
}

export function TransportBar() {
  const running = useBox((s) => s.running)
  const song = useBox((s) => s.song)
  const view = useBox((s) => s.view)
  const editing = useBox((s) => s.editing)
  const toggleTransport = useBox((s) => s.toggleTransport)
  const setBpm = useBox((s) => s.setBpm)
  const setSwing = useBox((s) => s.setSwing)
  const setView = useBox((s) => s.setView)
  const setEditing = useBox((s) => s.setEditing)
  const clearPattern = useBox((s) => s.clearPattern)
  const togglePerformance = useBox((s) => s.togglePerformance)
  const exportSong = useBox((s) => s.exportSong)
  const importSong = useBox((s) => s.importSong)
  const copyShareLink = useBox((s) => s.copyShareLink)
  const resetSong = useBox((s) => s.resetSong)
  const [flash, showFlash] = useFlash()

  return (
    <header className="transport">
      <button
        className={`play${running ? ' on' : ''}`}
        onClick={toggleTransport}
        title="Play / stop (space)"
      >
        {running ? '■' : '▶'}
      </button>

      <label className="field">
        <span>BPM</span>
        <input
          type="range"
          min={60}
          max={180}
          step={1}
          value={song.bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
        />
        <b>{song.bpm}</b>
      </label>

      <label className="field">
        <span>Swing</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={song.swing}
          onChange={(e) => setSwing(Number(e.target.value))}
        />
        <b>{Math.round(song.swing * 100)}</b>
      </label>

      <div className="machines">
        <button
          className={view === 'tr808' ? 'on eight' : 'eight'}
          onClick={() => setView('tr808')}
        >
          808
        </button>
        <button
          className={view === 'tr909' ? 'on nine' : 'nine'}
          onClick={() => setView('tr909')}
        >
          909
        </button>
        <button className={view === 'bass' ? 'on three' : 'three'} onClick={() => setView('bass')}>
          303
        </button>
      </div>

      <div className="patterns">
        {song.patterns.map((p) => (
          <button
            key={p.id}
            className={p.id === editing ? 'on' : ''}
            onClick={() => setEditing(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <button className="ghost" onClick={clearPattern} title="Clear this pattern">
        clear
      </button>
      <button className="ghost" onClick={togglePerformance} title="Performance mode (V)">
        visuals
      </button>

      <div className="song-tools">
        <button
          className="ghost"
          onClick={() => void copyShareLink().then(() => showFlash('link copied'))}
          title="Copy a link with this song in it"
        >
          share
        </button>
        <button className="ghost" onClick={exportSong} title="Save this song to a file">
          save
        </button>
        <button
          className="ghost"
          onClick={() => void importSong().then((ok) => ok && showFlash('loaded'))}
          title="Load a song from a file"
        >
          load
        </button>
        <button
          className="ghost"
          onClick={() => {
            // The one destructive control here — it throws away the autosave as well as
            // what is on screen, so it asks first.
            if (confirm('Discard this song and start again from the shipped patterns?')) {
              resetSong()
              showFlash('reset')
            }
          }}
          title="Back to the shipped song"
        >
          reset
        </button>
        {flash && <span className="flash">{flash}</span>}
      </div>
    </header>
  )
}
