import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MODEL_BASE, PROP_BASE } from "../../config/models";
import { WORLD_SCALE, CFG, inClearPath, annulusPoint } from "./LeftForestConfig";

function normalizeScale(g: THREE.Group, targetH: number, multiplier = 1.0) {
  const bbox = new THREE.Box3().setFromObject(g);
  const h = bbox.max.y - bbox.min.y;
  if (h < 0.001) return;
  g.scale.setScalar((targetH / h) * multiplier);
}

function nightify(g: THREE.Group, s = 0.4, tint = new THREE.Color(0.6, 1.0, 0.7)) {
  g.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.material) {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color.multiplyScalar(s).multiply(tint);
      if (mat.emissiveIntensity) mat.emissiveIntensity *= 0.2;
      m.material = mat;
    }
  });
}

function shadow(g: THREE.Group) {
  g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

export async function loadAllModels(scene: THREE.Scene, disposables: THREE.BufferGeometry[], disposableMats: THREE.Material[]): Promise<void> {
  const loader = new GLTFLoader();
  const gltfLoad = (name: string, base = MODEL_BASE) =>
    new Promise<THREE.Group>((res, rej) => loader.load(`${base}/${name}.gltf`, g => res(g.scene), undefined, rej));
  const propLoad = (path: string) =>
    new Promise<THREE.Group>((res, rej) => loader.load(path, g => res(g.scene), undefined, rej));

  // Outer trees
  const outerTreeNames = ["CommonTree_1", "CommonTree_2", "Pine_1", "Pine_2", "TwistedTree_1", "TwistedTree_2"];
  const outerModels = await Promise.all(outerTreeNames.map(n => gltfLoad(n).catch(() => null)));
  for (let i = 0; i < 38; i++) {
    const angle = (i / 38) * Math.PI * 2 + Math.random() * 0.12;
    const r = 75 + Math.random() * 18;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    if (inClearPath(x, z)) continue;
    const src = outerModels[i % outerModels.length];
    if (!src) continue;
    const t = src.clone(); shadow(t); nightify(t, 0.32);
    normalizeScale(t, CFG.MODEL_SCALE.outerTreeH + Math.random() * CFG.MODEL_SCALE.outerTreeJ);
    t.position.set(x, 0, z);
    t.rotation.y = Math.random() * Math.PI * 2;
    scene.add(t);
  }

  // Mid trees
  const midNames = ["DeadTree_1", "DeadTree_2", "TwistedTree_3", "CommonTree_3"];
  const midModels = await Promise.all(midNames.map(n => gltfLoad(n).catch(() => null)));
  const clusterAnchors = [
    { x: -30, z: -25 }, { x: -20, z: 15 }, { x: 15, z: -30 },
    { x: -35, z: 30 }, { x: 25, z: 25 }, { x: -10, z: -40 },
    { x: 40, z: -5 }, { x: -45, z: 0 }, { x: 18, z: 45 },
  ].map(a => ({ x: a.x * WORLD_SCALE, z: a.z * WORLD_SCALE }));
  for (const anchor of clusterAnchors) {
    const count = 5 + Math.floor(Math.random() * 4);
    for (let j = 0; j < count; j++) {
      const [x, z] = annulusPoint(anchor.x, anchor.z, 2, 10);
      if (inClearPath(x, z)) continue;
      const src = midModels[j % midModels.length];
      if (!src) continue;
      const t = src.clone(); shadow(t); nightify(t, 0.38, new THREE.Color(0.55, 0.9, 0.65));
      normalizeScale(t, CFG.MODEL_SCALE.midTreeH + Math.random() * CFG.MODEL_SCALE.midTreeJ);
      t.position.set(x, 0, z); t.rotation.y = Math.random() * Math.PI * 2;
      scene.add(t);
    }
  }

  // Undergrowth
  const groundNames = ["Bush_Common", "Fern_1", "Mushroom_Common", "Mushroom_Laetiporus", "Plant_1"];
  const groundModels = await Promise.all(groundNames.map(n => gltfLoad(n).catch(() => null)));
  for (const anchor of clusterAnchors) {
    const count = 8 + Math.floor(Math.random() * 6);
    for (let j = 0; j < count; j++) {
      const [x, z] = annulusPoint(anchor.x, anchor.z, 0.5, 12);
      if (inClearPath(x, z)) continue;
      const src = groundModels[j % groundModels.length];
      if (!src) continue;
      const g = src.clone(); shadow(g); nightify(g, 0.5, new THREE.Color(0.6, 1.0, 0.7));
      normalizeScale(g, CFG.MODEL_SCALE.underH + Math.random() * CFG.MODEL_SCALE.underJ);
      g.position.set(x, 0, z); g.rotation.y = Math.random() * Math.PI * 2;
      scene.add(g);
    }
  }

  // Rocks & pebbles
  const rockNames = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
  const pebNames = ["Pebble_Round_1", "Pebble_Round_2", "Pebble_Square_1"];
  const rockModels = await Promise.all([...rockNames, ...pebNames].map(n => gltfLoad(n).catch(() => null)));
  for (let z = -42; z < 40; z += 6) {
    for (const sideX of [-8 - Math.random() * 5, 8 + Math.random() * 5]) {
      const src = rockModels[Math.floor(Math.random() * rockModels.length)];
      if (!src) continue;
      const r = src.clone(); shadow(r); nightify(r, 0.32, new THREE.Color(0.7, 0.85, 0.8));
      normalizeScale(r, CFG.MODEL_SCALE.rockH + Math.random() * CFG.MODEL_SCALE.rockJ);
      r.position.set((5 + sideX) * WORLD_SCALE, 0, z * WORLD_SCALE + (Math.random() - 0.5) * 4);
      r.rotation.y = Math.random() * Math.PI * 2;
      scene.add(r);
    }
  }

  // Focal props
  propLoad(`${PROP_BASE}/pile_of_skulls.glb`).then(skulls => {
    shadow(skulls); nightify(skulls, 0.45, new THREE.Color(0.85, 0.78, 0.7));
    normalizeScale(skulls, CFG.MODEL_SCALE.skulls);
    [{ x: -28, z: 22 }, { x: -18, z: -32 }, { x: 32, z: 28 }].forEach(({ x, z }) => {
      const s = skulls.clone(); s.position.set(x * WORLD_SCALE, 0, z * WORLD_SCALE); s.rotation.y = Math.random() * Math.PI * 2; scene.add(s);
    });
  }).catch(() => {});

  propLoad(`${PROP_BASE}/stylized_fence.glb`).then(fence => {
    shadow(fence); nightify(fence, 0.42, new THREE.Color(0.7, 0.65, 0.55));
    normalizeScale(fence, CFG.MODEL_SCALE.fence);
    for (let i = 0; i < 6; i++) {
      const f = fence.clone(); f.position.set((-9 + (Math.random() - 0.5) * 1.5) * WORLD_SCALE, 0, (-25 + i * 11 + (Math.random() - 0.5) * 2) * WORLD_SCALE); f.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.15; scene.add(f);
    }
  }).catch(() => {});

  propLoad(`${PROP_BASE}/bo_ba_nam.glb`).then(statue => {
    shadow(statue); nightify(statue, 0.42, new THREE.Color(0.6, 0.95, 0.78));
    normalizeScale(statue, CFG.MODEL_SCALE.statue);
    statue.position.set(CFG.PORTAL_POS.x - 6, 0, CFG.PORTAL_POS.z + 3);
    statue.rotation.y = Math.PI * 0.3; scene.add(statue);
    const upLight = new THREE.SpotLight(CFG.PORTAL_COLOR, 3.0, 18, Math.PI / 5, 0.6, 1.5);
    upLight.position.set(statue.position.x, 0.4, statue.position.z);
    upLight.target.position.set(statue.position.x, 4, statue.position.z);
    scene.add(upLight); scene.add(upLight.target);
  }).catch(() => {});

  propLoad(`${PROP_BASE}/Big-stone.glb`).then(stone => {
    shadow(stone); nightify(stone, 0.32, new THREE.Color(0.72, 0.85, 0.8));
    normalizeScale(stone, CFG.MODEL_SCALE.bigStone);
    stone.position.set(-22 * WORLD_SCALE, 0, -5 * WORLD_SCALE); stone.rotation.y = 0.8; scene.add(stone);
  }).catch(() => {});

  // Grass cover
  const grassNames = ["Grass_Common_Short", "Grass_Wispy_Short", "Clover_1", "Petal_1"];
  const grassModels = await Promise.all(grassNames.map(n => gltfLoad(n).catch(() => null)));
  for (let i = 0; i < 140; i++) {
    const angle = Math.random() * Math.PI * 2, r = 4 + Math.random() * 70;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    const src = grassModels[i % grassModels.length];
    if (!src) continue;
    const g = src.clone(); normalizeScale(g, CFG.MODEL_SCALE.grass + Math.random() * 0.5);
    g.position.set(x, 0, z); g.rotation.y = Math.random() * Math.PI * 2;
    nightify(g, 0.5, new THREE.Color(0.65, 1.0, 0.7));
    scene.add(g);
  }
       }
