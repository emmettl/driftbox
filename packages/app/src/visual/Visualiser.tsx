import { Canvas } from '@react-three/fiber'
import { useEffect } from 'react'
import { resetSceneAudio, setSceneAudio } from './audio'
import { SCENES, type SceneId } from './scenes'

// One canvas, several scenes.
//
// The scenes share the audio reading (`levels.ts`), what they are reading it from (`audio.ts`) and the
// touch state (`touch.ts`) so they agree about what the music is doing and where the finger is.
// Everything else — geometry, palette, how the camera behaves — is theirs.
//
// **This is the boundary where a page says what the scenes are watching.** The scenes cannot take props:
// they are looked up from a registry by id, so there is nowhere to thread one through. So the page hands
// them here, and here publishes them. That makes this the only file either page needs to know about, and
// it is why a scene no longer imports the sequencer's store — see the note at the top of `audio.ts`.

interface Props {
  className?: string
  scene: SceneId
  /** The mix to read. Null before audio has started, which every scene copes with. */
  analyser?: AnalyserNode | null
  /** Whether the transport is running. Scenes that travel stand still when it is not. */
  running?: boolean
  /** The transport's tempo, so a scene can move on the beat rather than near it. */
  bpm?: number
}

export function Visualiser({ className, scene, analyser = null, running = false, bpm }: Props) {
  const Scene = (SCENES.find((s) => s.id === scene) ?? SCENES[0]).Component

  // Published in an effect rather than during render, because it is a write to something outside React
  // and a render can be thrown away. Reset on unmount so a page that puts the visualiser away does not
  // leave a dead analyser behind for the next one to read.
  useEffect(() => {
    setSceneAudio({ analyser, running, bpm })
  }, [analyser, running, bpm])
  useEffect(() => resetSceneAudio, [])

  return (
    <Canvas
      className={className}
      camera={{ fov: 60, position: [0, 1.15, 6], near: 0.1, far: 200 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      // Remounted per scene rather than swapped inside one tree. The scenes set the
      // background, the fog and the camera, and a scene that inherited half of the last
      // one's state would look subtly wrong in a way that is miserable to debug.
      key={scene}
    >
      <Scene />
    </Canvas>
  )
}
