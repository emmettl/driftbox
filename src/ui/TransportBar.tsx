import { useBox } from '../store'

export function TransportBar() {
  const running = useBox((s) => s.running)
  const song = useBox((s) => s.song)
  const machine = useBox((s) => s.machine)
  const editing = useBox((s) => s.editing)
  const toggleTransport = useBox((s) => s.toggleTransport)
  const setBpm = useBox((s) => s.setBpm)
  const setSwing = useBox((s) => s.setSwing)
  const setMachine = useBox((s) => s.setMachine)
  const setEditing = useBox((s) => s.setEditing)
  const clearPattern = useBox((s) => s.clearPattern)
  const togglePerformance = useBox((s) => s.togglePerformance)

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
          className={machine === 'tr808' ? 'on eight' : 'eight'}
          onClick={() => setMachine('tr808')}
        >
          808
        </button>
        <button
          className={machine === 'tr909' ? 'on nine' : 'nine'}
          onClick={() => setMachine('tr909')}
        >
          909
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
    </header>
  )
}
