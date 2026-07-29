import { useState } from 'react'
import { SONGS } from '@driftbox/engine'
import { useBox } from '../store'
import { PatternBar } from './PatternBar'

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
  const clearPattern = useBox((s) => s.clearPattern)
  const togglePerformance = useBox((s) => s.togglePerformance)
  const exportSong = useBox((s) => s.exportSong)
  const importSong = useBox((s) => s.importSong)
  const copyShareLink = useBox((s) => s.copyShareLink)
  const resetSong = useBox((s) => s.resetSong)
  const setPatternLength = useBox((s) => s.setPatternLength)
  const loadPreset = useBox((s) => s.loadPreset)
  const metronome = useBox((s) => s.metronome)
  const countIn = useBox((s) => s.countIn)
  const toggleMetronome = useBox((s) => s.toggleMetronome)
  const toggleCountIn = useBox((s) => s.toggleCountIn)
  const [flash, showFlash] = useFlash()
  const [more, setMore] = useState(false)

  const pattern = song.patterns.find((p) => p.id === editing)

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

      <PatternBar />

      {/* Not a ghost button. This is the way into the best thing the app does — the
          full-screen visuals with the filter pad on them — and it spent its life looking
          like "clear" and "load". Kept out of the collapsing group below: on a phone it
          is the most likely reason to have opened the app at all. */}
      <button
        className="vibes"
        onClick={togglePerformance}
        title="Full-screen visuals and filter pad (V)"
      >
        <span className="vibes-dot" />
        vibes
      </button>

      {/* On a phone the transport was taking half the screen. Everything you do not need
          while it is playing collapses behind one button; on anything wider it is always
          open and the toggle is hidden. */}
      <button
        className={`ghost transport-toggle${more ? ' on' : ''}`}
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        title="More controls"
      >
        ···
      </button>

      <div className={`transport-more${more ? ' open' : ''}`}>
      {/* Pattern length. The model always supported any length; this is the control that
          was missing, and polymetric loops — a 15-step hat line against a 16-step kick —
          come free from it. */}
      <label className="field">
        <span>Steps</span>
        <input
          type="number"
          min={1}
          max={64}
          step={1}
          value={pattern?.length ?? 16}
          onChange={(e) => setPatternLength(Number(e.target.value))}
          title="Steps in this pattern"
        />
      </label>

      <button
        className={`ghost${metronome ? ' on' : ''}`}
        onClick={toggleMetronome}
        title="Click on every beat"
      >
        click
      </button>
      <button
        className={`ghost${countIn ? ' on' : ''}`}
        onClick={toggleCountIn}
        title="Count one bar in before playing"
      >
        1·2·3·4
      </button>

      <button className="ghost" onClick={clearPattern} title="Clear this pattern">
        clear
      </button>
      {/* Loading a preset throws away whatever is on screen, and there is no undo
          anywhere in this app — so it asks, and only when there is something to lose. */}
      <label className="field">
        <span>Song</span>
        <select
          className="song-pick"
          value=""
          onChange={(e) => {
            const preset = SONGS.find((s) => s.id === e.target.value)
            if (!preset) return
            e.target.value = ''
            if (confirm(`Load "${preset.name}"? This replaces the song you have open.`)) {
              loadPreset(preset.id)
              showFlash(`loaded ${preset.name}`)
            }
          }}
          title="Load one of the shipped songs"
        >
          <option value="">load a song…</option>
          {SONGS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} — {preset.blurb}
            </option>
          ))}
        </select>
      </label>

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
      </div>
    </header>
  )
}
