import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, SURFACE_UNIFORMS } from './Surface'
import { useSurfaceMaterial } from '../surface-audio'

const BACKGROUND = SURFACE_UNIFORMS + /* glsl */ `
  void main() {
    vec2 p=vec2((vUv.x-0.5)*uSize.x/uSize.y,vUv.y-0.5);
    vec2 light=vec2(0.08*sin(uTravel*0.07),0.16);
    float dawn=exp(-dot(p-light,p-light)*5.0);
    vec3 col=mix(vec3(0.025,0.065,0.12),vec3(0.6,0.48,0.3),dawn*0.8);
    col+=vec3(0.14,0.14,0.12)*exp(-dot(p-light,p-light)*35.0)*(0.7+uMid);
    col+=(hash(floor(vUv*uSize))-0.5)*0.014;
    col*=0.65+0.35*smoothstep(0.04,0.24,vUv.y);
    gl_FragColor=vec4(col,1.0);
  }
`
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vPage;
  varying float vSeed;
  uniform vec2 uSize;
  void main() {
    vUv=uv;
    vSeed=instanceMatrix[3].z;
    vec4 p=instanceMatrix*vec4(position,1.0);
    vPage=p.xy;
    gl_Position=vec4(p.x*2.0/(uSize.x/uSize.y),(p.y-0.5)*2.0,0.0,1.0);
  }
`
const CRYSTAL = SURFACE_UNIFORMS + /* glsl */ `
  varying vec2 vPage;
  varying float vSeed;
  void main() {
    vec2 p=(vUv-0.5)*2.0;
    float angle=floor((atan(p.y,p.x)+0.523599)/1.047198)*1.047198;
    vec2 q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*p;
    q.y=abs(q.y);
    float growth=0.27+0.6*(0.5+0.5*sin(uTravel*0.15+vSeed*1.2))+uMid*0.14;
    float d=line(q,vec2(0.0),vec2(growth,0.0));
    for(int j=1;j<6;j++) {
      float start=float(j)*0.135;
      float reach=clamp((growth-start)*2.5,0.0,1.0);
      if(reach>0.01) {
        vec2 end=vec2(start+0.13*reach,0.22*reach);
        d=min(d,line(q,vec2(start,0.0),end));
        vec2 bud=mix(vec2(start,0.0),end,0.55);
        d=min(d,line(q,bud,bud+vec2(-0.035,0.075)*reach));
      }
    }
    float needle=1.0-smoothstep(0.002,0.007,d);
    float halo=exp(-d*65.0)*0.13;
    vec2 finger=vec2((uTouch.x-0.5)*uSize.x/uSize.y,uTouch.y);
    float warmth=exp(-dot(vPage-finger,vPage-finger)*23.0)*uTouch.z;
    float pulse=0.0;
    for(int h=0;h<8;h++) {
      float age=uTime-uHits[h].x;
      pulse+=exp(-pow((length(p)-age*0.6)*9.0,2.0))*exp(-age)*uHits[h].y;
    }
    vec3 ice=mix(vec3(0.52,0.75,0.9),vec3(0.92,0.88,0.7),warmth);
    ice+=pulse*vec3(0.18,0.2,0.2);
    float alpha=(needle*0.68+halo)*(1.0-warmth)*smoothstep(0.06,0.22,vPage.y);
    gl_FragColor=vec4(ice,alpha);
  }
`

function Crystals() {
  const mesh=useRef<THREE.InstancedMesh>(null)
  const { material, uniforms }=useSurfaceMaterial()
  const { size }=useThree()
  const aspect=size.width/size.height
  const matrices=useMemo(() => [
    [0.02,0.3,0.38], [0.04,0.65,0.34], [0.17,0.94,0.38], [0.52,1.04,0.42],
    [0.88,0.93,0.38], [0.99,0.64,0.38], [0.99,0.27,0.4], [0.66,0.02,0.32],
    [0.27,0.03,0.3], [0.26,0.47,0.19], [0.74,0.53,0.2],
  ].map(([x,y,scale],i) => new THREE.Matrix4().compose(
    new THREE.Vector3((x-0.5)*aspect,y,i),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),i*0.71),
    new THREE.Vector3(scale,scale,1),
  )),[aspect])
  useEffect(() => {
    if (!mesh.current) return
    matrices.forEach((matrix,i) => mesh.current!.setMatrixAt(i,matrix))
    mesh.current.instanceMatrix.needsUpdate=true
  },[matrices])
  return <instancedMesh ref={mesh} args={[undefined,undefined,matrices.length]} frustumCulled={false} renderOrder={1}>
    <planeGeometry args={[2,2]} />
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader={VERTEX} fragmentShader={CRYSTAL}
      transparent depthTest={false} depthWrite={false} toneMapped={false} />
  </instancedMesh>
}
export function Frost() { return <><Surface fragment={BACKGROUND} /><Crystals /></> }
