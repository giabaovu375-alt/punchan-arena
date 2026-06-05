import * as THREE from "three";

export function setupLighting(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x2d1b2e);
  scene.fog = new THREE.FogExp2(0x2d1b2e, 0.025);

  scene.add(new THREE.HemisphereLight(0xff9966, 0x1a0033, 0.7));

  const sun = new THREE.DirectionalLight(0xff6633, 1.4);
  sun.position.set(-60, 25, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fillLight = new THREE.DirectionalLight(0xff8899, 0.5);
  fillLight.position.set(30, 10, -50);
  scene.add(fillLight);
}
