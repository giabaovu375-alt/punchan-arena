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

// Cache helper: load một lần, clone nhiều lần
function cloneAndPlace(
  src: THREE.Group | null,
  positions: { x: number; z: number; ry?: number }[],
  scaleBase: number,
  scaleVar: number,
  nightifyParams?: [number, THREE.Color],
  disposables?: THREE.BufferGeometry[],
  disposableMats?: THREE.Material[]
) {
  if (!src || positions.length === 0) return;
  const first = src.clone();
  if (nightifyParams) nightify(first, ...nightifyParams);
  shadow(first);
  const scale = scaleBase + Math.random() * scaleVar;
  normalizeScale(first, scale);
  first.position.set(positions[0].x, 0, positions[0].z);
  first.rotation.y = positions[0].ry ?? Math.random() * Math.PI * 2;
  scene.add(first);

  // Sau lần đầu, clone nhanh hơn
  for (let i = 1; i < positions.length; i++) {
    const c = first.clone();
    c.position.set(positions[i].x, 0, positions[i].z);
    c.rotation.y = positions[i].ry ?? Math.random() * Math.PI * 2;
    // Randomize scale nhẹ
    const s = scaleBase + Math.random() * scaleVar;
    normalizeScale(c, s);
    scene.add(c);
  }
}

export async function loadAllModels(
  scene: THREE.Scene,
  disposables: THREE.BufferGeometry[],
  disposableMats: THREE.Material[],
  disposableLights: THREE.Light[]
): Promise<void> {
  const loader = new GLTFLoader();
  const gltfLoad = (name: string, base = MODEL_BASE) =>
    new Promise<THREE.Group>((res, rej) => loader.load(`${base}/${name}.gltf`, g => res(g.scene), undefined, rej));
  const propLoad = (path: string) =>
    new Promise<THREE.Group>((res, rej) => loader.load(path, g => res(g.scene), undefined, rej));

  // ── Outer trees (giảm 60 → 45) ────────────────────────────────────────────
  const outerTreeNames = ["CommonTree_1", "CommonTree_2", "Pine_1", "Pine_2", "TwistedTree_1", "TwistedTree_2"];
  const outerModels = await Promise.all(outerTreeNames.map(n => gltfLoad(n).catch(() => null)));
  const OUTER_COUNT = 45;
  for (let i = 0; i < OUTER_COUNT; i++) {
    const angle = (i / OUTER_COUNT) * Math.PI * 2 + Math.random() * 0.18;
    const r = 72 + Math.random() * 22;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    if (inClearPath(x, z)) continue;
    const src = outerModels[i % outerModels.length];
    if (!src) continue;
    const t = src.clone(); shadow(t); nightify(t, 0.32);
    const scaleH = (CFG.MODEL_SCALE.outerTreeH * 1.3) + Math.random() * (CFG.MODEL_SCALE.outerTreeJ * 1.2);
    normalizeScale(t, scaleH);
    t.position.set(x, 0, z);
    t.rotation.y = Math.random() * Math.PI * 2;
    scene.add(t);
  }

  // ── Mid trees (giảm số cluster, giảm cây/cluster) ──────────────────────────
  const midNames = ["DeadTree_1", "DeadTree_2", "TwistedTree_3", "CommonTree_3"];
  const midModels = await Promise.all(midNames.map(n => gltfLoad(n).catch(() => null)));

  const clusterAnchors = [
    { x: -30, z: -25 }, { x: -20, z: 15 }, { x: -35, z: 30 }, { x: -45, z: 0 },
    { x: 15, z: -30 }, { x: 25, z: 25 }, { x: 40, z: -5 }, { x: 38, z: 18 },
    { x: -10, z: -40 }, { x: 18, z: 45 }, { x: 50, z: -25 }, { x: -55, z: 15 },
  ].map(a => ({ x: a.x * WORLD_SCALE, z: a.z * WORLD_SCALE }));

  for (const anchor of clusterAnchors) {
    const count = 4 + Math.floor(Math.random() * 3); // Giảm 6-10 → 4-6
    for (let j = 0; j < count; j++) {
      const [x, z] = annulusPoint(anchor.x, anchor.z, 2, 11);
      if (inClearPath(x, z)) continue;
      const src = midModels[j % midModels.length];
      if (!src) continue;
      const t = src.clone(); shadow(t); nightify(t, 0.38, new THREE.Color(0.55, 0.9, 0.65));
      const scaleH = (CFG.MODEL_SCALE.midTreeH * 1.25) + Math.random() * (CFG.MODEL_SCALE.midTreeJ * 1.1);
      normalizeScale(t, scaleH);
      t.position.set(x, 0, z); t.rotation.y = Math.random() * Math.PI * 2;
      scene.add(t);
    }
  }

  // ── Undergrowth (giảm cây/cluster) ─────────────────────────────────────────
  const groundNames = ["Bush_Common", "Fern_1", "Mushroom_Common", "Mushroom_Laetiporus", "Plant_1"];
  const groundModels = await Promise.all(groundNames.map(n => gltfLoad(n).catch(() => null)));
  for (const anchor of clusterAnchors) {
    const count = 6 + Math.floor(Math.random() * 4); // Giảm 10-17 → 6-9
    for (let j = 0; j < count; j++) {
      const [x, z] = annulusPoint(anchor.x, anchor.z, 0.5, 13);
      if (inClearPath(x, z)) continue;
      const src = groundModels[j % groundModels.length];
      if (!src) continue;
      const g = src.clone(); shadow(g); nightify(g, 0.5, new THREE.Color(0.6, 1.0, 0.7));
      normalizeScale(g, CFG.MODEL_SCALE.underH + Math.random() * CFG.MODEL_SCALE.underJ);
      g.position.set(x, 0, z); g.rotation.y = Math.random() * Math.PI * 2;
      scene.add(g);
    }
  }

  // ── Rocks (giữ nguyên) ─────────────────────────────────────────────────────
  const rockNames = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
  const pebNames  = ["Pebble_Round_1", "Pebble_Round_2", "Pebble_Square_1"];
  const rockModels = await Promise.all([...rockNames, ...pebNames].map(n => gltfLoad(n).catch(() => null)));

  for (let z = -44; z < 44; z += 6) { // Tăng bước 5→6
    for (const side of [-1, 1]) {
      const count = 1; // Giảm 1-2 → 1
      for (let k = 0; k < count; k++) {
        const offsetX = 8 + Math.random() * 6;
        const x = side * offsetX;
        if (inClearPath(x * WORLD_SCALE, z * WORLD_SCALE)) continue;
        const src = rockModels[Math.floor(Math.random() * rockModels.length)];
        if (!src) continue;
        const r = src.clone(); shadow(r); nightify(r, 0.32, new THREE.Color(0.7, 0.85, 0.8));
        normalizeScale(r, (CFG.MODEL_SCALE.rockH * 1.2) + Math.random() * (CFG.MODEL_SCALE.rockJ * 1.2));
        r.position.set(
          (x + (Math.random() - 0.5) * 2) * WORLD_SCALE,
          0,
          z * WORLD_SCALE + (Math.random() - 0.5) * 3
        );
        r.rotation.y = Math.random() * Math.PI * 2;
        scene.add(r);
      }
    }
  }

  // Đá lớn (giảm 5 → 3)
  const bigRockPositions = [
    { x: -18, z: 8 }, { x: 22, z: -12 }, { x: -30, z: -38 },
  ];
  for (const pos of bigRockPositions) {
    const src = rockModels[Math.floor(Math.random() * rockNames.length)];
    if (!src) continue;
    const r = src.clone(); shadow(r); nightify(r, 0.3, new THREE.Color(0.68, 0.82, 0.78));
    normalizeScale(r, CFG.MODEL_SCALE.rockH * 2.2);
    r.position.set(pos.x * WORLD_SCALE, 0, pos.z * WORLD_SCALE);
    r.rotation.y = Math.random() * Math.PI * 2;
    scene.add(r);
  }

  // ── Focal props (giữ nguyên, tối ưu clone) ──────────────────────────────────
  propLoad(`${PROP_BASE}/pile_of_skulls.glb`).then(skulls => {
    const positions = [
      { x: -28, z: 22 }, { x: -18, z: -32 }, { x: 32, z: 28 }, { x: 20, z: -45 }
    ].map(p => ({ x: p.x * WORLD_SCALE, z: p.z * WORLD_SCALE, ry: Math.random() * Math.PI * 2 }));
    cloneAndPlace(skulls, positions, CFG.MODEL_SCALE.skulls * 1.15, 0, [0.45, new THREE.Color(0.85, 0.78, 0.7)]);
  }).catch(() => {});

  propLoad(`${PROP_BASE}/stylized_fence.glb`).then(fence => {
    const positions1 = Array.from({length: 8}, (_, i) => ({
      x: (-9 + (Math.random() - 0.5) * 1.2) * WORLD_SCALE,
      z: (-30 + i * 9 + (Math.random() - 0.5) * 1.5) * WORLD_SCALE,
      ry: Math.PI / 2 + (Math.random() - 0.5) * 0.12
    }));
    const positions2 = Array.from({length: 4}, (_, i) => ({
      x: (10 + (Math.random() - 0.5) * 1.2) * WORLD_SCALE,
      z: (5 + i * 9 + (Math.random() - 0.5) * 2) * WORLD_SCALE,
      ry: Math.PI / 2 + (Math.random() - 0.5) * 0.2
    }));
    cloneAndPlace(fence, positions1, CFG.MODEL_SCALE.fence * 1.1, 0, [0.42, new THREE.Color(0.7, 0.65, 0.55)]);
    cloneAndPlace(fence, positions2, CFG.MODEL_SCALE.fence * 1.1, 0, [0.42, new THREE.Color(0.7, 0.65, 0.55)]);
  }).catch(() => {});

  propLoad(`${PROP_BASE}/bo_ba_nam.glb`).then(statue => {
    shadow(statue); nightify(statue, 0.42, new THREE.Color(0.6, 0.95, 0.78));
    normalizeScale(statue, CFG.MODEL_SCALE.statue * 1.1);
    statue.position.set(CFG.PORTAL_POS.x - 6, 0, CFG.PORTAL_POS.z + 3);
    statue.rotation.y = Math.PI * 0.3;
    scene.add(statue);
    const upLight = new THREE.SpotLight(CFG.PORTAL_COLOR, 3.5, 20, Math.PI / 5, 0.6, 1.5);
    upLight.position.set(statue.position.x, 0.4, statue.position.z);
    upLight.target.position.set(statue.position.x, 4, statue.position.z);
    scene.add(upLight); scene.add(upLight.target);
    disposableLights.push(upLight);
  }).catch(() => {});

  propLoad(`${PROP_BASE}/Big-stone.glb`).then(stone => {
    shadow(stone); nightify(stone, 0.32, new THREE.Color(0.72, 0.85, 0.8));
    normalizeScale(stone, CFG.MODEL_SCALE.bigStone * 1.15);
    stone.position.set(-22 * WORLD_SCALE, 0, -5 * WORLD_SCALE);
    stone.rotation.y = 0.8;
    scene.add(stone);
  }).catch(() => {});

  // ── Cột đèn (giảm số lượng) ──────────────────────────────────────────────────
  propLoad(`${PROP_BASE}/low_poly_lamp_post.glb`).then(lamp => {
    shadow(lamp); nightify(lamp, 0.65, new THREE.Color(1.0, 0.88, 0.55));
    normalizeScale(lamp, CFG.MODEL_SCALE.fence * 2.2);
    const lampLeft  = [-28, -10, 8, 26]; // Giảm 6 → 4
    const lampRight = [-20, 0, 20];      // Giảm 5 → 3
    for (const z of lampLeft) {
      const l = lamp.clone();
      l.position.set(-7 * WORLD_SCALE, 0, z * WORLD_SCALE);
      scene.add(l);
      const pt = new THREE.PointLight(0xffcc55, 2.2, 14, 2);
      pt.position.set(-7 * WORLD_SCALE, 3.5, z * WORLD_SCALE);
      scene.add(pt);
      disposableLights.push(pt);
    }
    for (const z of lampRight) {
      const l = lamp.clone();
      l.position.set(7 * WORLD_SCALE, 0, z * WORLD_SCALE);
      scene.add(l);
      const pt = new THREE.PointLight(0xffcc55, 2.2, 14, 2);
      pt.position.set(7 * WORLD_SCALE, 3.5, z * WORLD_SCALE);
      scene.add(pt);
      disposableLights.push(pt);
    }
  }).catch(() => {});

  // ── Cột đá (giảm 8 → 5) ─────────────────────────────────────────────────────
  propLoad(`${PROP_BASE}/stone_pillar.glb`).then(pillar => {
    const positions = [
      { x: -16, z: -20, ry: 0.3 }, { x: 24, z: 32, ry: 0.7 },
      { x: -38, z: -8, ry: 1.8 }, { x: 8, z: -42, ry: 0.9 },
      { x: -10, z: 48, ry: 2.2 },
    ].map(p => ({ x: p.x * WORLD_SCALE, z: p.z * WORLD_SCALE, ry: p.ry }));
    cloneAndPlace(pillar, positions, CFG.MODEL_SCALE.bigStone * 1.4, 0, [0.36, new THREE.Color(0.72, 0.82, 0.78)]);
  }).catch(() => {});

  // ── Crystal cluster (giảm 6 → 4) ────────────────────────────────────────────
  propLoad(`${PROP_BASE}/crystal_cluster.glb`).then(crystal => {
    const positions = [
      { x: -24, z: -15 }, { x: 20, z: -38 }, { x: -32, z: 40 }, { x: 28, z: 18 },
    ].map(p => ({ x: p.x * WORLD_SCALE, z: p.z * WORLD_SCALE, ry: Math.random() * Math.PI * 2 }));
    cloneAndPlace(crystal, positions, CFG.MODEL_SCALE.skulls * 1.2, 0, [0.7, new THREE.Color(0.4, 1.0, 0.6)]);
    // Lights
    positions.forEach(pos => {
      const glow = new THREE.PointLight(0x44ff88, 1.5, 9, 2);
      glow.position.set(pos.x, 1.2, pos.z);
      scene.add(glow);
      disposableLights.push(glow);
    });
  }).catch(() => {});

  // ── Crystal hồng (giảm 4 → 2) ───────────────────────────────────────────────
  propLoad(`${PROP_BASE}/crystal_hong.glb`).then(crystalHong => {
    const positions = [
      { x: -8, z: -25 }, { x: 14, z: 42 },
    ].map(p => ({ x: p.x * WORLD_SCALE, z: p.z * WORLD_SCALE, ry: Math.random() * Math.PI * 2 }));
    cloneAndPlace(crystalHong, positions, CFG.MODEL_SCALE.skulls * 1.0, 0, [0.7, new THREE.Color(1.0, 0.6, 0.8)]);
    positions.forEach(pos => {
      const glow = new THREE.PointLight(0xff66aa, 1.2, 7, 2);
      glow.position.set(pos.x, 1.0, pos.z);
      scene.add(glow);
      disposableLights.push(glow);
    });
  }).catch(() => {});

  // ── Xe ngựa (giữ 2) ─────────────────────────────────────────────────────────
  propLoad(`${PROP_BASE}/stylized_wooden_wagon.glb`).then(wagon => {
    const positions = [
      { x: -18 * WORLD_SCALE, z: 12 * WORLD_SCALE, ry: 0.6 },
      { x: 22 * WORLD_SCALE, z: -20 * WORLD_SCALE, ry: 2.8 },
    ];
    cloneAndPlace(wagon, positions, CFG.MODEL_SCALE.bigStone * 1.2, 0, [0.4, new THREE.Color(0.75, 0.65, 0.5)]);
  }).catch(() => {});

  // ── Nhà hoang (giữ 2) ───────────────────────────────────────────────────────
  propLoad(`${PROP_BASE}/stylized_medieval_house.glb`).then(house => {
    shadow(house); nightify(house, 0.3, new THREE.Color(0.6, 0.8, 0.65));
    normalizeScale(house, CFG.MODEL_SCALE.bigStone * 2.5);
    house.position.set(-38 * WORLD_SCALE, 0, -30 * WORLD_SCALE);
    house.rotation.y = Math.PI * 0.75;
    scene.add(house);
  }).catch(() => {});

  propLoad(`${PROP_BASE}/stylized_medieval_house_2.glb`).then(house2 => {
    shadow(house2); nightify(house2, 0.3, new THREE.Color(0.58, 0.78, 0.62));
    normalizeScale(house2, CFG.MODEL_SCALE.bigStone * 2.2);
    house2.position.set(40 * WORLD_SCALE, 0, 35 * WORLD_SCALE);
    house2.rotation.y = Math.PI * 1.2;
    scene.add(house2);
  }).catch(() => {});

  // ── Grass cover (giảm 240 → 150) ────────────────────────────────────────────
  const grassNames = ["Grass_Common_Short", "Grass_Wispy_Short", "Clover_1", "Petal_1"];
  const grassModels = await Promise.all(grassNames.map(n => gltfLoad(n).catch(() => null)));
  for (let i = 0; i < 150; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 75;
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    const src = grassModels[i % grassModels.length];
    if (!src) continue;
    const g = src.clone();
    normalizeScale(g, CFG.MODEL_SCALE.grass + Math.random() * 0.6);
    g.position.set(x, 0, z); g.rotation.y = Math.random() * Math.PI * 2;
    nightify(g, 0.5, new THREE.Color(0.65, 1.0, 0.7));
    scene.add(g);
  }
      }
