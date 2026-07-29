import { useEffect, useRef, useState } from 'react'
import { useAudioRecovery } from './audio-recovery'
import { useFollowPlayhead } from './ui/useFollowPlayhead'
import { useBox } from './store'
import { Arrangement } from './ui/Arrangement'
import { BassGrid } from './ui/BassGrid'
import { KaossPad } from './ui/KaossPad'
import { Keys } from './ui/Keys'
import { NowPlaying } from './ui/NowPlaying'
import { Panel } from './ui/Panel'
import { BassPanel } from './ui/BassPanel'
import { FxPanel } from './ui/FxPanel'
import { Sequencer } from './ui/Sequencer'
import { TransportBar } from './ui/TransportBar'
import { VoicePanel } from './ui/VoicePanel'
import { PlayBeacon, type BeaconTarget } from './ui/PlayBeacon'
import { useFirstRun, useMedia } from './ui/useFirstRun'
import { Visualiser } from './visual/Visualiser'
import { SCENES, nextScene } from './visual/scenes'
import { Oscilloscope } from './visual/Oscilloscope'
import { SCOPE_LABELS, nextScope } from './visual/scope'
import './styles.css'

/** How long the console takes to fold into the edit button. Matches `--fold` in the
 *  stylesheet; they have to agree or the console either vanishes early or lingers. */
const FOLD_MS = 260

/** The stream colours, matched to the buttons: the transport's teal, and the amber that
 *  vibes has worn since it stopped being a ghost button. */
const TEAL = '95, 240, 208'
const AMBER = '255, 176, 46'

export default function App() {
  const performing = useBox((s) => s.performance)
  const togglePerformance = useBox((s) => s.togglePerformance)
  const toggleTransport = useBox((s) => s.toggleTransport)
  const running = useBox((s) => s.running)
  const view = useBox((s) => s.view)
  const adoptSharedSong = useBox((s) => s.adoptSharedSong)
  const scope = useBox((s) => s.scope)
  const setScope = useBox((s) => s.setScope)
  // Lives in the store now, because loading a song changes it — each shipped song names
  // the visual it was written to be seen with.
  const scene = useBox((s) => s.scene)
  const setScene = useBox((s) => s.setScene)
  const playButton = useRef<HTMLButtonElement>(null)
  const consolePlay = useRef<HTMLButtonElement>(null)
  const vibesButton = useRef<HTMLButtonElement>(null)
  const audioStalled = useBox((s) => s.audioStalled)

  // iOS suspends the audio context when Safari goes to the background, and never resumes
  // it on its own. Without this the app comes back looking like it is playing and is
  // silent for good.
  useAudioRecovery()
  useFollowPlayhead()

  // Two things the console never said out loud: that it makes a sound, and that there is a
  // whole other half of the app behind the vibes button. Both are obvious once you have
  // done them once, so both are recorded the first time and never pointed at again.
  const [learnt, learn] = useFirstRun()
  const roomy = useMedia('(min-width: 900px)')
  // A stream of particles across a working editor is exactly what this setting is for. The
  // buttons keep their own glow either way.
  const stillness = useMedia('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    if (running) learn('played')
  }, [running, learn])
  useEffect(() => {
    if (performing) learn('vibed')
  }, [performing, learn])

  // Fewer particles and a shorter throw than the phone's, because these land on a 40px
  // button in a room already full of controls rather than on an empty picture.
  const consoleBeacons: BeaconTarget[] = []
  if (roomy && !stillness && !performing) {
    if (!running && !learnt.has('played')) {
      consoleBeacons.push({ key: 'play', target: consolePlay, tint: TEAL, count: 34, spawn: 5 })
    }
    if (!learnt.has('vibed')) {
      consoleBeacons.push({ key: 'vibes', target: vibesButton, tint: AMBER, count: 34, spawn: 5 })
    }
  }

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
      if (event.key.toLowerCase() === 'x') setScope(nextScope(useBox.getState().scope))
      if (event.key.toLowerCase() === 'c') {
        setScene(nextScene(useBox.getState().scene))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTransport, togglePerformance, performing, setScene, setScope])

  return (
    <div className={`app${performing ? ' performing' : ''}`}>
      <Visualiser className="backdrop" scene={scene} />

      {performing && (
        <div className="stage">
          {/* The pad is the whole screen and sits UNDER everything else, so a finger
              anywhere lands on it. The rest is pointer-transparent apart from its
              buttons. */}
          <KaossPad />

          <div className="stage-scope">
            <Oscilloscope mode={scope} height={260} persistence={0.42} transparent />
            <NowPlaying />
            <p className="stage-hint">drag anywhere to filter</p>
          </div>

          {/* Bottom right, opposite the play button. The oscilloscope suits most scenes
              and actively fights a few — a trace drawn across a busy picture is a line
              through it — so this is the way out, without it being a setting nobody
              finds. */}
          <button
            className="stage-meter"
            onClick={() => setScope(nextScope(scope))}
            aria-label={`Meter: ${SCOPE_LABELS[scope]}`}
            title="Change the meter"
          >
            {SCOPE_LABELS[scope]}
          </button>

          {/* Vibes mode had no transport at all — it relied on the space bar, which does
              not exist on a phone. Since touch devices now open here, that made the app
              start silent with no way to start it. */}
          {/* Only while stopped: a permanent effect is decoration, one that exists only
              while there is something to say is an instruction. */}
          {/* Said out loud, because the alternative is an app that looks like it is
              playing and makes no sound. A tap anywhere resumes it — the handler is
              global — so this is telling you, not asking you to aim at it. */}
          {audioStalled && <div className="audio-stalled">tap anywhere to resume</div>}

          <PlayBeacon
            targets={running ? [] : [{ key: 'stage', target: playButton, tint: TEAL }]}
          />
          <button
            ref={playButton}
            className={`stage-play${running ? ' on' : ' calling'}`}
            onClick={toggleTransport}
            aria-label={running ? 'Stop' : 'Play'}
          >
            {running ? '■' : '▶'}
          </button>

          <button
            className="stage-scene"
            onClick={() =>
              setScene(nextScene(scene))
            }
            title="Change the scene (C)"
          >
            {SCENES.find((s) => s.id === scene)?.name}
          </button>

          {/* The way back to the console, and the thing the console appears to come out
              of. No longer the loudest thing on screen while stopped — the play button
              has taken that job, since starting it is what you want first. */}
          <button
            className="stage-edit"
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
          <TransportBar playRef={consolePlay} vibesRef={vibesButton} />
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
                  <button className="ghost" onClick={() => setScope(nextScope(scope))}>
                    {SCOPE_LABELS[scope]}
                  </button>
                }
              >
                <Oscilloscope mode={scope} />
              </Panel>
            </aside>
          </main>

          {/* Docked under the grid, across the whole console. It plays whichever 303 is
              selected, from any view — you reach for it while writing a drum pattern as
              often as while writing a bassline. */}
          <Keys />
        </div>
      )}

      {/* Outside the console rather than in it, because the console flies in and out on a
          transform and a canvas inside it would be drawn in the transformed space while
          reading its targets in viewport space — the particles would swim away from the
          buttons for the length of the animation. */}
      <PlayBeacon className="console-beacon" targets={consoleBeacons} />
    </div>
  )
}
