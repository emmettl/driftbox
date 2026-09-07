import { useSurfaceMaterial } from '../surface-audio'

// The material studies share a screen-sized canvas and audio sampling, but each
// paints its own world. Hit history is bounded: echoes leave marks after a transient dies.
export const SURFACE_UNIFORMS = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uSize;
  uniform float uTime;
  uniform float uTravel;
  uniform float uBeat;
  uniform float uScoreBeat;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform vec3 uTouch;
  uniform vec2 uHits[8];
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float line(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p-a, ba = b-a;
    return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0));
  }
`

export function Surface({ fragment }: { fragment: string }) {
  const { material, uniforms } = useSurfaceMaterial()
  return <mesh frustumCulled={false}>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial ref={material} uniforms={uniforms} fragmentShader={fragment}
      vertexShader={/* glsl */ `varying vec2 vUv; void main() {
        vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0);
      }`}
      depthTest={false} depthWrite={false} toneMapped={false} />
  </mesh>
}
