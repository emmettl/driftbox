import { Canvas } from '@react-three/fiber'
import { SCENES, type SceneId } from './scenes'

// One canvas, several scenes.
//
// The scenes share the audio reading (`levels.ts`) and the touch state (`touch.ts`) so
// they agree about what the music is doing and where the finger is. Everything else —
// geometry, palette, how the camera behaves — is theirs.

export function Visualiser({ className, scene }: { className?: string; scene: SceneId }) {
  const Scene = (SCENES.find((s) => s.id === scene) ?? SCENES[0]).Component

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
