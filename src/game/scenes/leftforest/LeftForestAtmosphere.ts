import * as THREE from "three";
import { CFG } from "./LeftForestConfig";

export function setupAtmosphere(scene: THREE.Scene): { moonLight: THREE.DirectionalLight; fillLight: THREE.DirectionalLight; lightningLight: THREE.DirectionalLight } {
  scene.background = new THREE.Color(CFG.SKY_COLOR);
  scene.fog = new THREE.Fog(CFG.FOG_COLOR, CFG.FOG_NEAR, CFG.FOG_FAR);

  scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));
  scene.add(new THREE.HemisphereLight(CFG.HEMI_SKY, CFG.HEMI_GROUND, CFG.HEMI_INTENSITY));

  // Moon light
  const moonLight = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
  moonLight.position.set(60, 110, 50);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(4096, 4096);
  const s = 120;
  moonLight.shadow.camera.left = -s; moonLight.shadow.camera.right = s;
  moonLight.shadow.camera.top = s; moonLight.shadow.camera.bottom = -s;
  moonLight.shadow.camera.near = 1; moonLight.shadow.camera.far = 260;
  moonLight.shadow.bias = -0.0004; moonLight.shadow.normalBias = 0.025;
  scene.add(moonLight);

  // Rim light
  const rim = new THREE.DirectionalLight(CFG.RIM_COLOR, CFG.RIM_INTENSITY);
  rim.position.set(-60, 40, -60);
  scene.add(rim);

  // Fill light
  const fillLight = new THREE.DirectionalLight(CFG.FILL_COLOR, CFG.FILL_INTENSITY);
  fillLight.position.set(20, 25, -50);
  scene.add(fillLight);

  // Lightning light
  const lightningLight = new THREE.DirectionalLight(0xbfd8ff, 0);
  lightningLight.position.set(-30, 100, 40);
  scene.add(lightningLight);

  // Moon disk
  const moonGroup = new THREE.Group();
  const diskGeo = new THREE.CircleGeometry(6, 48);
  const diskMat = new THREE.MeshBasicMaterial({ color: 0xdfeaff, transparent: true, opacity: 0.95 });
  moonGroup.add(new THREE.Mesh(diskGeo, diskMat));
  const haloGeo = new THREE.CircleGeometry(13, 48);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x8ecfdf, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
  moonGroup.add(new THREE.Mesh(haloGeo, haloMat));
  moonGroup.position.set(80, 70, -110);
  moonGroup.lookAt(0, 0, 0);
  scene.add(moonGroup);

  return { moonLight, fillLight, lightningLight };
}
