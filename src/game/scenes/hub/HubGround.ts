import * as THREE from 'three';

export function setupGround(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(80, 64),
    new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.95, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Đường đi dọc & ngang
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
  const pathV = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 100), pathMat);
  pathV.rotation.x = -Math.PI / 2;
  pathV.position.set(0, 0.01, 10);
  pathV.receiveShadow = true;
  scene.add(pathV);

  const pathH = new THREE.Mesh(new THREE.PlaneGeometry(90, 3.5), pathMat);
  pathH.rotation.x = -Math.PI / 2;
  pathH.position.set(0, 0.01, 0);
  pathH.receiveShadow = true;
  scene.add(pathH);
}
