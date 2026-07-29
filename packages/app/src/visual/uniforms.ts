import type { RefObject } from 'react'
import type { ShaderMaterial } from 'three'

/**
 * The uniforms a material is *actually* using.
 *
 * The obvious way to drive a shader from `useFrame` is to build a uniforms object with
 * `useMemo`, hand it to `<shaderMaterial uniforms={...} />`, and then mutate that object
 * every frame. It reads correctly and it does not work: under React StrictMode the
 * material ends up holding a different object from the one the frame loop is writing to,
 * and the shader sees its initial values forever.
 *
 * There is no error and no warning. Worse, the scene still *moves* — the camera is
 * animated from JS, so a corridor still flies and a web still spins. All that is missing
 * is every reaction to the music, which is the one thing a visualiser is for. Three of the
 * four scenes shipped in this state and it was only caught by reading the live uniform
 * values off the material and finding them pinned at zero while the transport ran.
 *
 * So: pass the memoised object as the *initial* value, then never touch it again. Write
 * through the material, which is the only object the GPU has ever heard of.
 */
export function uniformsOf(ref: RefObject<ShaderMaterial | null>) {
  return ref.current?.uniforms ?? null
}
