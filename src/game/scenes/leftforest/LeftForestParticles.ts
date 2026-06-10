import * as THREE from "three";
import { CFG, WORLD_SCALE } from "./LeftForestConfig";

export interface ParticleSystems {
  sporeParticles: THREE.Points;
  mistParticles: THREE.Points;
  leafParticles: THREE.Points;
  leafVelocities: Float32Array;
  fireflies: THREE.Points;
  fireflySeeds: Float32Array;
  embers: THREE.Points;
  emberVelocities: Float32Array;
}

export function buildParticles(scene: THREE.Scene, disposables: THREE.BufferGeometry[], disposableMats: THREE.Material[]): ParticleSystems {
  // Mist
  const mistPos = new Float32Array(CFG.MIST_COUNT * 3);
  for (let i = 0; i < CFG.MIST_COUNT; i++) {
    mistPos[i * 3] = (Math.random() - 0.5) * 200;
    mistPos[i * 3 + 1] = Math.random() * 1.6;
    mistPos[i * 3 + 2] = (Math.random() - 0.5) * 200;
  }
  const mistGeo = new THREE.BufferGeometry(); mistGeo.setAttribute("position", new THREE.BufferAttribute(mistPos, 3)); disposables.push(mistGeo);
  const mistMat = new THREE.PointsMaterial({ color: 0x0a2015, size: 4.5, transparent: true, opacity: 0.14, depthWrite: false, sizeAttenuation: true }); disposableMats.push(mistMat);
  const mistParticles = new THREE.Points(mistGeo, mistMat); scene.add(mistParticles);

  // Leaves
  const leafPos = new Float32Array(CFG.LEAF_COUNT * 3);
  const leafVelocities = new Float32Array(CFG.LEAF_COUNT * 3);
  for (let i = 0; i < CFG.LEAF_COUNT; i++) {
    leafPos[i * 3] = (Math.random() - 0.5) * 200;
    leafPos[i * 3 + 1] = Math.random() * 24;
    leafPos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    leafVelocities[i * 3] = (Math.random() - 0.5) * 0.35;
    leafVelocities[i * 3 + 1] = -(0.3 + Math.random() * 0.5);
    leafVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
  }
  const leafGeo = new THREE.BufferGeometry(); leafGeo.setAttribute("position", new THREE.BufferAttribute(leafPos, 3)); disposables.push(leafGeo);
  const leafMat = new THREE.PointsMaterial({ color: 0x2d5e1e, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false }); disposableMats.push(leafMat);
  const leafParticles = new THREE.Points(leafGeo, leafMat); scene.add(leafParticles);

  // Spores
  const sporePos = new Float32Array(CFG.SPORE_COUNT * 3);
  for (let i = 0; i < CFG.SPORE_COUNT; i++) {
    sporePos[i * 3] = (Math.random() - 0.5) * 200;
    sporePos[i * 3 + 1] = Math.random() * 7;
    sporePos[i * 3 + 2] = (Math.random() - 0.5) * 200;
  }
  const sporeGeo = new THREE.BufferGeometry(); sporeGeo.setAttribute("position", new THREE.BufferAttribute(sporePos, 3)); disposables.push(sporeGeo);
  const sporeMat = new THREE.PointsMaterial({ color: 0x77ffbb, size: 0.1, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }); disposableMats.push(sporeMat);
  const sporeParticles = new THREE.Points(sporeGeo, sporeMat); scene.add(sporeParticles);

  // Fireflies
  const fireflyPos = new Float32Array(CFG.FIREFLY_COUNT * 3);
  const fireflySeeds = new Float32Array(CFG.FIREFLY_COUNT * 3);
  for (let i = 0; i < CFG.FIREFLY_COUNT; i++) {
    fireflyPos[i * 3] = (Math.random() - 0.5) * 180;
    fireflyPos[i * 3 + 1] = 0.8 + Math.random() * 5;
    fireflyPos[i * 3 + 2] = (Math.random() - 0.5) * 180;
    fireflySeeds[i * 3] = Math.random() * Math.PI * 2;
    fireflySeeds[i * 3 + 1] = 0.5 + Math.random() * 1.5;
    fireflySeeds[i * 3 + 2] = Math.random() * Math.PI * 2;
  }
  const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute("position", new THREE.BufferAttribute(fireflyPos, 3)); disposables.push(ffGeo);
  const ffMat = new THREE.PointsMaterial({ color: 0xb8ff70, size: 0.16, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }); disposableMats.push(ffMat);
  const fireflies = new THREE.Points(ffGeo, ffMat); scene.add(fireflies);

  // Embers
  const emberPos = new Float32Array(CFG.EMBER_COUNT * 3);
  const emberVelocities = new Float32Array(CFG.EMBER_COUNT * 3);
  for (let i = 0; i < CFG.EMBER_COUNT; i++) {
    emberPos[i * 3] = (Math.random() - 0.5) * 160;
    emberPos[i * 3 + 1] = Math.random() * 12;
    emberPos[i * 3 + 2] = (Math.random() - 0.5) * 160;
    emberVelocities[i * 3] = (Math.random() - 0.5) * 0.15;
    emberVelocities[i * 3 + 1] = 0.3 + Math.random() * 0.6;
    emberVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
  }
  const emberGeo = new THREE.BufferGeometry(); emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3)); disposables.push(emberGeo);
  const emberMat = new THREE.PointsMaterial({ color: 0x66ffaa, size: 0.08, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }); disposableMats.push(emberMat);
  const embers = new THREE.Points(emberGeo, emberMat); scene.add(embers);

  return { sporeParticles, mistParticles, leafParticles, leafVelocities, fireflies, fireflySeeds, embers, emberVelocities };
}

export function animateMist(mistParticles: THREE.Points, elapsed: number, dt: number): void {
  const pos = mistParticles.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + Math.sin(elapsed * 0.3 + i * 0.7) * dt * 0.1);
    pos.setZ(i, pos.getZ(i) + Math.cos(elapsed * 0.2 + i * 0.5) * dt * 0.08);
  }
  pos.needsUpdate = true;
}

export function animateLeaves(leafParticles: THREE.Points, leafVelocities: Float32Array, elapsed: number, dt: number): void {
  const pos = leafParticles.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) + (leafVelocities[i * 3] + Math.sin(elapsed + i) * 0.05) * dt;
    let y = pos.getY(i) + leafVelocities[i * 3 + 1] * dt;
    let z = pos.getZ(i) + (leafVelocities[i * 3 + 2] + Math.cos(elapsed * 0.8 + i) * 0.04) * dt;
    if (y < 0) {
      y = 18 + Math.random() * 6;
      x = (Math.random() - 0.5) * 200;
      z = (Math.random() - 0.5) * 200;
    }
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
}

export function animateSpores(sporeParticles: THREE.Points, elapsed: number, dt: number): void {
  const pos = sporeParticles.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i) + dt * 0.08;
    if (y > 7) y = 0;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(elapsed * 0.7 + i * 0.3) * dt * 0.06);
  }
  pos.needsUpdate = true;
}

export function animateFireflies(fireflies: THREE.Points, fireflySeeds: Float32Array, elapsed: number, dt: number): void {
  const pos = fireflies.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const sA = fireflySeeds[i * 3], sH = fireflySeeds[i * 3 + 1], sB = fireflySeeds[i * 3 + 2];
    pos.setX(i, pos.getX(i) + Math.sin(elapsed * 0.9 + sA) * dt * 0.4);
    pos.setY(i, 0.8 + sH + Math.sin(elapsed * 1.3 + sB) * 0.6);
    pos.setZ(i, pos.getZ(i) + Math.cos(elapsed * 0.7 + sB) * dt * 0.4);
  }
  pos.needsUpdate = true;
  (fireflies.material as THREE.PointsMaterial).opacity = 0.7 + Math.sin(elapsed * 4) * 0.25;
}

export function animateEmbers(embers: THREE.Points, emberVelocities: Float32Array, elapsed: number, dt: number): void {
  const pos = embers.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) + emberVelocities[i * 3] * dt;
    let y = pos.getY(i) + emberVelocities[i * 3 + 1] * dt;
    let z = pos.getZ(i) + emberVelocities[i * 3 + 2] * dt;
    if (y > 14) {
      y = 0; x = (Math.random() - 0.5) * 160; z = (Math.random() - 0.5) * 160;
    }
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
      }
