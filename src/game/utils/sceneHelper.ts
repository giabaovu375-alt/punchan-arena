/**
 * Scene Helper Utilities
 */

import * as THREE from 'three';

/**
 * Tạo ground plane đơn giản
 */
export function createGround(
  width: number,
  height: number,
  color: number = 0x6b8e4e
): THREE.Mesh {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ 
      color, 
      roughness: 0.95, 
      flatShading: true 
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

/**
 * Tạo path/road
 */
export function createPath(
  width: number,
  length: number,
  color: number = 0xa89368
): THREE.Mesh {
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({ 
      color, 
      roughness: 1 
    })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.01;
  path.receiveShadow = true;
  return path;
}

/**
 * Setup basic lighting
 */
export function setupLighting(scene: THREE.Scene, isMobile: boolean = false): {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
} {
  const hemi = new THREE.HemisphereLight(0xfff1d9, 0x3a4a2a, 0.7);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d0, 1.4);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;
  
  const shadowRes = isMobile ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 250;
  sun.shadow.bias = -0.0005;
  
  scene.add(sun);

  return { sun, hemi };
}

/**
 * Create cylinder collider visualizer (debug)
 */
export function createColliderVisualizer(
  x: number,
  z: number,
  radius: number
): THREE.Mesh {
  const collider = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.2, 16),
    new THREE.MeshBasicMaterial({ 
      color: 0xff0000, 
      transparent: true, 
      opacity: 0.3 
    })
  );
  collider.position.set(x, 0.1, z);
  return collider;
}
