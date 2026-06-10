import * as THREE from "three";
import { CFG } from "./LeftForestConfig";

export interface PortalGroup {
  group: THREE.Group;
  ring: THREE.Mesh;
  innerRing: THREE.Mesh;
  disk: THREE.Mesh;
  core: THREE.Mesh;
  light: THREE.PointLight;
  particles: THREE.Points;
  swirl: THREE.Points;
  rayCones: THREE.Mesh[];
  shockwaves: { mesh: THREE.Mesh; born: number }[];
}

export function buildPortal(scene: THREE.Scene, disposables: THREE.BufferGeometry[], disposableMats: THREE.Material[]): PortalGroup {
  const group = new THREE.Group();
  const COL = new THREE.Color(CFG.PORTAL_COLOR);

  // Outer torus
  const outerGeo = new THREE.TorusGeometry(3.2, 0.22, 24, 96); disposables.push(outerGeo);
  const outerMat = new THREE.MeshStandardMaterial({ color: COL, emissive: COL, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.85 }); disposableMats.push(outerMat);
  const ring = new THREE.Mesh(outerGeo, outerMat); ring.rotation.x = Math.PI / 2; group.add(ring);

  // Inner torus
  const innerGeo = new THREE.TorusGeometry(2.5, 0.09, 16, 72); disposables.push(innerGeo);
  const innerMat = new THREE.MeshStandardMaterial({ color: COL, emissive: COL, emissiveIntensity: 2.6, roughness: 0.05, metalness: 0.95, transparent: true, opacity: 0.8 }); disposableMats.push(innerMat);
  const innerRing = new THREE.Mesh(innerGeo, innerMat); innerRing.rotation.x = Math.PI / 2; group.add(innerRing);

  // Disk
  const diskGeo = new THREE.CircleGeometry(3.05, 96); disposables.push(diskGeo);
  const diskMat = new THREE.MeshStandardMaterial({ color: COL, emissive: COL, emissiveIntensity: 0.35, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }); disposableMats.push(diskMat);
  const disk = new THREE.Mesh(diskGeo, diskMat); disk.rotation.x = Math.PI / 2; group.add(disk);

  // Core
  const coreGeo = new THREE.CircleGeometry(1.1, 48); disposables.push(coreGeo);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xcfffe8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); disposableMats.push(coreMat);
  const core = new THREE.Mesh(coreGeo, coreMat); core.rotation.x = Math.PI / 2; group.add(core);

  // Particle ring
  const pCount = 140; const pPos = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount; i++) {
    const a = (i / pCount) * Math.PI * 2, r = 3.2 + (Math.random() - 0.5) * 0.6;
    pPos[i * 3] = Math.cos(a) * r; pPos[i * 3 + 1] = 0; pPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); disposables.push(pGeo);
  const pMat = new THREE.PointsMaterial({ color: COL, size: 0.11, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }); disposableMats.push(pMat);
  const particles = new THREE.Points(pGeo, pMat); particles.rotation.x = Math.PI / 2; group.add(particles);

  // Swirl
  const sCount = 200; const sPos = new Float32Array(sCount * 3);
  for (let i = 0; i < sCount; i++) {
    const r = Math.random() * 2.6, a = Math.random() * Math.PI * 2;
    sPos[i * 3] = Math.cos(a) * r; sPos[i * 3 + 1] = (Math.random() - 0.5) * 0.4; sPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3)); disposables.push(sGeo);
  const sMat = new THREE.PointsMaterial({ color: 0xa8ffd4, size: 0.06, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }); disposableMats.push(sMat);
  const swirl = new THREE.Points(sGeo, sMat); swirl.rotation.x = Math.PI / 2; group.add(swirl);

  // God rays
  const rayMat = new THREE.MeshBasicMaterial({ color: COL, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); disposableMats.push(rayMat);
  const rayCones: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const h = 14 + i * 4;
    const rGeo = new THREE.ConeGeometry(2.4 + i * 0.6, h, 24, 1, true); disposables.push(rGeo);
    const cone = new THREE.Mesh(rGeo, rayMat); // clone material mỗi cone? Tốt hơn dùng chung một material
    cone.position.y = h / 2;
    rayCones.push(cone); group.add(cone);
  }

  // Lights
  const light = new THREE.PointLight(CFG.PORTAL_COLOR, 6.0, 32); light.position.y = 0.5; group.add(light);
  const groundGlow = new THREE.PointLight(CFG.PORTAL_COLOR, 2.0, 12); groundGlow.position.y = -3; group.add(groundGlow);

  group.position.copy(CFG.PORTAL_POS).add(new THREE.Vector3(0, 5, 0));
  scene.add(group);

  return { group, ring, innerRing, disk, core, light, particles, swirl, rayCones, shockwaves: [] };
}

export function animatePortal(portal: PortalGroup, elapsed: number, dt: number): void {
  portal.ring.rotation.z += dt * 0.5;
  portal.innerRing.rotation.z -= dt * 0.85;
  portal.core.rotation.z += dt * 1.8;

  const diskMat = portal.disk.material as THREE.MeshStandardMaterial;
  diskMat.opacity = 0.18 + Math.sin(elapsed * 2.5) * 0.1;
  diskMat.emissiveIntensity = 0.3 + Math.sin(elapsed * 1.8) * 0.14;
  (portal.core.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(elapsed * 3.4) * 0.18;

  portal.light.intensity = 5.5 + Math.sin(elapsed * 3.2) * 1.4;
  portal.particles.rotation.z += dt * 0.25;
  portal.swirl.rotation.z -= dt * 0.55;

  portal.rayCones.forEach((c, i) => {
    c.rotation.y += dt * (0.15 + i * 0.05);
    (c.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(elapsed * 1.5 + i) * 0.04;
  });

  portal.group.position.y = CFG.PORTAL_POS.y + 5 + Math.sin(elapsed * 0.8) * 0.15;

  // Shockwave logic có thể ở ngoài, nhưng để đây cho tiện
}

export function spawnShockwave(portal: PortalGroup, disposables: THREE.BufferGeometry[], disposableMats: THREE.Material[], elapsed: number): void {
  const geo = new THREE.RingGeometry(0.6, 0.8, 64); disposables.push(geo);
  const mat = new THREE.MeshBasicMaterial({ color: CFG.PORTAL_COLOR, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }); disposableMats.push(mat);
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(portal.group.position.x, 0.05, portal.group.position.z);
  portal.group.parent?.add(ring); // Thêm vào scene (portal.group.parent là scene)
  portal.shockwaves.push({ mesh: ring, born: elapsed });
}

export function updateShockwaves(portal: PortalGroup, elapsed: number): void {
  const DUR = 1.8;
  for (let i = portal.shockwaves.length - 1; i >= 0; i--) {
    const sw = portal.shockwaves[i];
    const t = (elapsed - sw.born) / DUR;
    if (t >= 1) {
      sw.mesh.parent?.remove(sw.mesh);
      portal.shockwaves.splice(i, 1);
      continue;
    }
    const s = 1 + t * 10;
    sw.mesh.scale.set(s, s, s);
    (sw.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
  }
  }
