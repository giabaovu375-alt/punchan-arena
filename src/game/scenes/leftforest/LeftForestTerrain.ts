import * as THREE from "three";
import { WORLD_SCALE, CFG, fbm } from "./LeftForestConfig";

export function buildTerrain(scene: THREE.Scene, disposables: THREE.BufferGeometry[], disposableMats: THREE.Material[]): void {
  const SIZE = 220, SEG = 140;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getY(i);
    const inPath = Math.abs(x - 5 * WORLD_SCALE) < 11;
    const h = fbm(x, z) * 0.9 + (Math.random() - 0.5) * 0.08;
    pos.setZ(i, inPath ? h * 0.25 : h);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: CFG.GROUND_COLOR, roughness: 0.98, metalness: 0.0 });
  disposables.push(geo); disposableMats.push(mat);
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Moss
  const mossMat = new THREE.MeshStandardMaterial({ color: CFG.GROUND_MOSS_COLOR, roughness: 1.0, transparent: true, opacity: 0.7, depthWrite: false });
  disposableMats.push(mossMat);
  for (let z = -45; z < 45; z += 5) {
    const mossGeo = new THREE.PlaneGeometry(4 + Math.random() * 5, 3 + Math.random() * 4);
    disposables.push(mossGeo);
    const patch = new THREE.Mesh(mossGeo, mossMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(5 * WORLD_SCALE + (Math.random() - 0.5) * 9, 0.02, z * WORLD_SCALE + (Math.random() - 0.5) * 4);
    patch.rotation.z = Math.random() * Math.PI;
    scene.add(patch);
  }
  for (let i = 0; i < 32; i++) {
    const mossGeo = new THREE.PlaneGeometry(3 + Math.random() * 6, 2 + Math.random() * 5);
    disposables.push(mossGeo);
    const patch = new THREE.Mesh(mossGeo, mossMat);
    patch.rotation.x = -Math.PI / 2;
    const angle = Math.random() * Math.PI * 2;
    const r = 25 + Math.random() * 70;
    patch.position.set(Math.cos(angle) * r, 0.02, Math.sin(angle) * r);
    patch.rotation.z = Math.random() * Math.PI;
    scene.add(patch);
  }

  // Mountain silhouettes
  const mountainMat = new THREE.MeshBasicMaterial({ color: 0x05101a, transparent: true, opacity: 0.85, fog: true, side: THREE.DoubleSide });
  disposableMats.push(mountainMat);
  for (let i = 0; i < 16; i++) {
    const w = 28 + Math.random() * 30, h = 14 + Math.random() * 18;
    const geo = new THREE.ConeGeometry(w * 0.5, h, 5, 1);
    disposables.push(geo);
    const m = new THREE.Mesh(geo, mountainMat);
    const a = (i / 16) * Math.PI * 2;
    const r = 145 + Math.random() * 25;
    m.position.set(Math.cos(a) * r, h * 0.5 - 2, Math.sin(a) * r);
    m.rotation.y = Math.random() * Math.PI;
    scene.add(m);
  }
}
