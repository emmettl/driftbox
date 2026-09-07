import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, SURFACE_UNIFORMS } from './Surface'
import { useSurfaceMaterial } from '../surface-audio'

// The glass and ironwork occupy a single surface. Leaves are instanced cards: a leaf
// shader runs only where that leaf is drawn, instead of evaluating every leaf
// at every pixel of the screen. The canopy still shares the other scenes' audio signals.
// Shared by the stems and their leaves: the whole plant leans, with its root fixed.
const PLANT_MOTION = /* glsl */ `
  vec2 plantSway(float n, float depth) {
    float side = mod(n,2.0)*2.0-1.0;
    float breeze = sin(uTravel*0.95+n*0.83)*(0.025+depth*0.055);
    float bassLean = side*uBass*(0.014+depth*0.035);
    float lift = sin(uTravel*0.72+n*0.61)*0.014*(0.3+depth)*(0.4+uMid);
    return vec2(breeze+bassLean,lift);
  }
`

const GLASS = /* glsl */ `
  vec3 glass(vec3 col, vec2 p) {
    float aspect = uSize.x/uSize.y;
    vec2 uv = vec2(p.x/aspect+0.5,p.y);
    vec2 finger = vec2((uTouch.x-0.5)*aspect,uTouch.y);
    float wipe = exp(-dot(p-finger,p-finger)*18.0)*uTouch.z;
    float mist = (0.09+0.13*sin(p.x*3.0+p.y*2.0))*(1.0-wipe);
    col = mix(col,vec3(0.76,0.79,0.64),mist);
    vec2 drops = p*vec2(72.0,50.0);
    vec2 id = floor(drops), f = fract(drops)-0.5;
    f -= (vec2(hash(id),hash(id+4.0))-0.5)*0.55;
    float d = length(f*vec2(1.0,0.7));
    float droplet = (1.0-smoothstep(0.06,0.11,d))*step(0.76,hash(id+7.0))*(1.0-wipe);
    col += droplet*vec3(0.13,0.15,0.12);
    col += hash(floor(uv*uSize))*0.028;
    return col*(0.84+0.16*sqrt(max(0.0,1.0-length((uv-0.5)*1.2))));
  }
`

const BACKGROUND = SURFACE_UNIFORMS + PLANT_MOTION + GLASS + /* glsl */ `
  void main() {
    float aspect = uSize.x/uSize.y;
    vec2 p = vec2((vUv.x-0.5)*aspect,vUv.y);
    vec3 col = mix(vec3(0.13,0.24,0.19),vec3(0.86,0.72,0.4),pow(vUv.y,0.75));
    float sun = exp(-length((p-vec2(aspect*0.2,0.79))*vec2(2.0,1.0))*5.0);
    col += vec3(0.28,0.18,0.06)*sun;
    // Receding iron ribs, with a central roof ridge. No raymarching.
    for(int i=0;i<7;i++) {
      float z = float(i)/6.0;
      float w = 0.12+z*z*max(0.65,aspect*0.62);
      float roof = 0.64+z*0.44;
      float eave = 0.6+z*0.17;
      float rib = min(line(p,vec2(-w,-0.1),vec2(-w,eave)),line(p,vec2(w,-0.1),vec2(w,eave)));
      rib = min(rib,line(p,vec2(-w,eave),vec2(0.0,roof)));
      rib = min(rib,line(p,vec2(w,eave),vec2(0.0,roof)));
      col = mix(col,vec3(0.18,0.27,0.21),(1.0-smoothstep(0.002,0.004+z*0.003,rib))*(0.18+z*0.44));
    }
    float path = 1.0-smoothstep(0.04,0.07,abs(p.x)/max(0.08,0.65-p.y));
    col = mix(col,vec3(0.48,0.45,0.3),path*(1.0-smoothstep(0.5,0.59,p.y))*0.5);
    for(int i=0;i<12;i++) {
      float n = float(i), side = mod(n,2.0)*2.0-1.0, depth = floor(n/2.0)/6.0;
      vec2 root = vec2(side*(0.07+depth*min(aspect*0.65,0.8)),0.45-depth*0.52);
      vec2 tip = root+vec2(side*(0.035+depth*0.12),0.13+depth*0.67);
      tip += plantSway(n,depth);
      float stem = 1.0-smoothstep(0.001,0.003,line(p,root,tip));
      col = mix(col,vec3(0.2,0.32,0.16),stem);
    }
    gl_FragColor = vec4(glass(col,p),1.0);
  }
`

const LEAF_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vPage;
  varying float vSeed;
  uniform vec2 uSize;
  uniform float uTravel;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
` + PLANT_MOTION + /* glsl */ `
  void main() {
    vUv = uv;
    vSeed = instanceMatrix[3].z;
    vec4 p = instanceMatrix*vec4(position,1.0);
    float n = floor(vSeed), branch = floor(fract(vSeed)*10.0+0.5);
    float depth = floor(n/2.0)/6.0;
    float at = 0.42+branch*0.22;
    // Hinge at the leaf's attachment to the stem, rather than sliding the card loose.
    vec2 attachment = instanceMatrix[3].xy-instanceMatrix[1].xy*0.585;
    vec2 leaf = p.xy-attachment;
    float angle = sin(uTravel*1.3+n*1.4+branch*0.8)*(0.12+uMid*0.12)
      +(mod(n,2.0)*2.0-1.0)*uBass*0.16
      +sin(uTravel*6.0+vSeed)*uHigh*0.04;
    leaf *= 1.0+uMid*0.09;
    leaf = mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*leaf;
    p.xy = attachment+leaf+plantSway(n,depth)*at;
    vPage = p.xy;
    gl_Position = vec4(p.x*2.0/(uSize.x/uSize.y),(p.y-0.5)*2.0,0.0,1.0);
  }
`
const LEAF_FRAGMENT = SURFACE_UNIFORMS + GLASS + /* glsl */ `
  varying vec2 vPage;
  varying float vSeed;
  void main() {
    vec2 q = (vUv-0.5)*2.0;
    float profile = length(vec2(q.x*(1.0+0.4*abs(q.y)),q.y));
    float alpha = 1.0-smoothstep(0.94,1.0,profile);
    if(alpha<0.01) discard;
    float mainVein = 1.0-smoothstep(0.015,0.04,abs(q.x));
    float branches = 1.0-smoothstep(0.025,0.06,abs(fract(q.y*4.5-abs(q.x)*2.4)-0.5));
    float vein = max(mainVein,branches*0.5);
    float glow = 0.0;
    for(int h=0;h<8;h++) {
      float age = uTime-uHits[h].x;
      glow += exp(-pow((vPage.y+0.1-age*0.85)*8.0,2.0))*exp(-age*0.7)*uHits[h].y;
    }
    vec3 green = mix(vec3(0.18,0.36,0.23),vec3(0.43,0.5,0.23),hash(vec2(vSeed,19.0)));
    green *= 0.7+0.3*(1.0-profile);
    green += vein*(vec3(0.08,0.1,0.02)+vec3(1.25,0.83,0.2)*glow);
    green += vec3(0.08,0.06,0.01)*glow;
    green += vec3(0.04,0.045,0.0)*q.x;
    gl_FragColor = vec4(glass(green,vPage),alpha*0.93);
  }
`

function Canopy() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const { material, uniforms } = useSurfaceMaterial()
  const { size } = useThree()
  const aspect = size.width / size.height
  const leaves = useMemo(() => Array.from({ length: 36 }, (_, index) => {
    const n = Math.floor(index / 3), branch = index % 3
    const side = (n % 2) * 2 - 1, depth = Math.floor(n / 2) / 6
    const x = side * (0.07 + depth * Math.min(aspect * 0.65, 0.8))
    const y = 0.45 - depth * 0.52
    const tipX = side * (0.035 + depth * 0.12), tipY = 0.13 + depth * 0.67
    const at = 0.42 + branch * 0.22
    const angle = side * (0.7 + branch * 0.52) + Math.sin(n) * 0.3
    const scale = 0.035 + depth * 0.12
    const center = new THREE.Vector3(
      x + tipX * at - Math.sin(angle) * scale * 0.75,
      y + tipY * at + Math.cos(angle) * scale * 0.75,
      n + branch * 0.1,
    )
    return new THREE.Matrix4().compose(center,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle),
      new THREE.Vector3(scale / 1.7, scale / 0.78, 1))
  }), [aspect])
  useEffect(() => {
    if (!mesh.current) return
    leaves.forEach((matrix, index) => mesh.current!.setMatrixAt(index, matrix))
    mesh.current.instanceMatrix.needsUpdate = true
  }, [leaves])
  return <instancedMesh ref={mesh} args={[undefined, undefined, leaves.length]} frustumCulled={false} renderOrder={1}>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader={LEAF_VERTEX} fragmentShader={LEAF_FRAGMENT}
      transparent depthTest={false} depthWrite={false} toneMapped={false} />
  </instancedMesh>
}

export function Hothouse() {
  return <><Surface fragment={BACKGROUND} /><Canopy /></>
}
