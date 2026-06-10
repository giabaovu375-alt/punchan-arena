import * as THREE from "three";
import { CFG, WORLD_SCALE } from "./LeftForestConfig";

export interface Wisp {
  light: THREE.PointLight;
  phase: number;
  pos: THREE.Vector3;
  orb: THREE.Mesh;
  halo: THREE.Mesh;
}

export function buildWisps(scene: THREE.Scene, disposables: THREE.BufferGeometry[], disposableMats: THREE.Material[]): Wisp[] {
  const positions = [
    new THREE.Vector3( -8 * WORLD_SCALE, 2.0, -20 * WORLD_SCALE),
    new THREE.Vector3(  4 * WORLD_SCALE, 2.6,  -5 * WORLD_SCALE),
    new THREE.Vector3( 12 * WORLD_SCALE, 2.3,  10 * WORLD_SCALE),
    new THREE.Vector3( 22 * WORLD_SCALE, 1.9,  12 * WORLD_SCALE),
    new THREE.Vector3(-25 * WORLD_SCALE, 1.7,  20 * WORLD_SCALE),
    new THREE.Vector3(-15 * WORLD_SCALE, 2.2, -32 * WORLD_SCALE),
    new THREE.Vector3( 30 * WORLD_SCALE, 1.8, -18 * WORLD_SCALE),
  ];

  const orbMat = new THREE.MeshStandardMaterial({
    color: CFG.WISP_COLOR, emissive: new THREE.Color(CFG.WISP_COLOR), emissiveIntensity: 3.5, transparent: true, opacity: 0.95,
  });
  const haloMat = new THREE.MeshStandardMaterial({
    color: CFG.WISP_COLOR, emissive: new THREE.Color(CFG.WISP_COLOR), emissiveIntensity: 0.6, transparent: true, opacity: 0.18,
    depthWrite: false, side: THREE.DoubleSide,
  });
  disposableMats.push(orbMat, haloMat);

  const wisps: Wisp[] = [];
  positions.forEach((pos, i) => {
    const light = new THREE.PointLight(CFG.WISP_COLOR, CFG.WISP_INTENSITY, CFG.WISP_DISTANCE);
    light.position.copy(pos); scene.add(light);

    const orbGeo = new THREE.SphereGeometry(0.14, 10, 10); disposables.push(orbGeo);
    const orb = new THREE.Mesh(orbGeo, orbMat); orb.position.copy(pos); scene.add(orb);

    const haloGeo = new THREE.SphereGeometry(0.5, 12, 12); disposables.push(haloGeo);
    const halo = new THREE.Mesh(haloGeo, haloMat); halo.position.copy(pos); scene.add(halo);

    wisps.push({ light, phase: i * 1.57, pos: pos.clone(), orb, halo });
  });
  return wisps;
}

export function animateWisps(wisps: Wisp[], dt: number): void {
  wisps.forEach(w => {
    w.phase += dt * 1.1;
    const p = new THREE.Vector3(
      w.pos.x + Math.sin(w.phase * 0.6) * 1.8 + Math.sin(w.phase * 1.3) * 0.5,
      w.pos.y + Math.sin(w.phase) * 0.7,
      w.pos.z + Math.cos(w.phase * 0.5) * 1.5
    );
    w.light.position.copy(p);
    w.orb.position.copy(p);
    w.halo.position.copy(p);
    w.light.intensity = CFG.WISP_INTENSITY * (0.8 + Math.sin(w.phase * 2.3) * 0.3);
    w.orb.scale.setScalar(0.9 + Math.sin(w.phase * 3.1) * 0.18);
    w.halo.scale.setScalar(1.0 + Math.sin(w.phase * 1.8) * 0.28);
    (w.halo.material as THREE.MeshStandardMaterial).opacity = 0.14 + Math.sin(w.phase * 2.0) * 0.08;
  });
}
