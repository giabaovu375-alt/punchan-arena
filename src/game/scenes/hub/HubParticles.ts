import * as THREE from "three";

export interface LeafParticleSystem {
  points: THREE.Points;
  velocities: Float32Array;
  positions: Float32Array;
  count: number;
}

export function createLeafParticles(scene: THREE.Scene): LeafParticleSystem {
  const count = 100;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 8;
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = 2 + Math.random() * 12;
    positions[i * 3 + 2] = Math.sin(angle) * r;
    velocities[i * 3] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 1] = -(0.2 + Math.random() * 0.4);
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffaa33, size: 0.15, transparent: true, opacity: 0.7,
    sizeAttenuation: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, velocities, positions, count };
}

export function tickLeafParticles(sys: LeafParticleSystem, dt: number): void {
  for (let i = 0; i < sys.count; i++) {
    sys.positions[i * 3] += sys.velocities[i * 3] * dt;
    sys.positions[i * 3 + 1] += sys.velocities[i * 3 + 1] * dt;
    sys.positions[i * 3 + 2] += sys.velocities[i * 3 + 2] * dt;
    if (sys.positions[i * 3 + 1] < 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 8;
      sys.positions[i * 3] = Math.cos(angle) * r;
      sys.positions[i * 3 + 1] = 2 + Math.random() * 12;
      sys.positions[i * 3 + 2] = Math.sin(angle) * r;
    }
  }
  (sys.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}
