import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  MODEL_BASE,
  ALL_MODEL_NAMES,
  OUTER_TREES,
  MID_TREES,
  GROUND_ITEMS
} from './HubConfig';

export interface Collider {
  center: THREE.Vector3;
  radius: number;
}

// ── Loaders & Cache ─────────────────────────────────────────────
export async function loadAllModels(loader: GLTFLoader): Promise<Map<string, THREE.Group>> {
  const cache = new Map<string, THREE.Group>();
  const unique = [...new Set(ALL_MODEL_NAMES)];

  await Promise.all(
    unique.map((name) =>
      new Promise<void>((resolve) => {
        loader.load(
          `${MODEL_BASE}/${name}.gltf`,
          (gltf) => { cache.set(name, gltf.scene); resolve(); },
          undefined,
          (err) => { console.warn(`⚠️ HubEnvironment: không load được ${name}`, err); resolve(); }
        );
      })
    )
  );
  return cache;
}

// ── Helpers ──────────────────────────────────────────────────────
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

interface ScatterItem {
  modelName: string;
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

function generateScatter(
  models: string[],
  count: number,
  minR: number,
  maxR: number,
  scaleRange: [number, number],
  seed = 0
): ScatterItem[] {
  const items: ScatterItem[] = [];
  let s = seed;
  let attempts = 0;

  while (items.length < count && attempts < count * 4) {
    attempts++;
    s++;
    const angle = seededRand(s) * Math.PI * 2;
    s++;
    const r = minR + seededRand(s) * (maxR - minR);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    // Tránh đường path dọc (x≈0) và ngang (z≈0)
    if (Math.abs(x) < 4.5 && Math.abs(z) < maxR) continue;
    if (Math.abs(z) < 4.5 && Math.abs(x) < maxR) continue;

    s++;
    const scale = scaleRange[0] + seededRand(s) * (scaleRange[1] - scaleRange[0]);
    s++;
    const rotY = seededRand(s) * Math.PI * 2;
    s++;
    const modelName = models[Math.floor(seededRand(s) * models.length)];

    items.push({ modelName, x, z, scale, rotY });
  }

  return items;
}

/**
 * Dùng InstancedMesh để render nhiều object cùng loại.
 * Trả về mảng InstancedMesh (mỗi sub-mesh một InstancedMesh).
 */
function buildInstancedGroup(
  src: THREE.Group,
  items: ScatterItem[],
  modelName: string,
  castShadow: boolean
): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  const filtered = items.filter((i) => i.modelName === modelName);
  if (filtered.length === 0) return meshes;

  const srcMeshes: THREE.Mesh[] = [];
  src.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) srcMeshes.push(o as THREE.Mesh);
  });

  const dummy = new THREE.Object3D();

  for (const srcMesh of srcMeshes) {
    const instanced = new THREE.InstancedMesh(
      srcMesh.geometry,
      srcMesh.material,
      filtered.length
    );
    instanced.castShadow = castShadow;
    instanced.receiveShadow = true;

    filtered.forEach((item, idx) => {
      dummy.position.set(item.x, 0, item.z);
      dummy.scale.setScalar(item.scale);
      dummy.rotation.y = item.rotY;
      dummy.updateMatrix();
      instanced.setMatrixAt(idx, dummy.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    meshes.push(instanced);
  }

  return meshes;
}

// ── Main Setup ───────────────────────────────────────────────────
export async function setupEnvironment(
  scene: THREE.Scene,
  cache: Map<string, THREE.Group>
): Promise<Collider[]> {
  const colliders: Collider[] = [];

  // --- Tạo scatter items ---
  const outerScatter = generateScatter(OUTER_TREES, 25, 40, 68, [1.2, 2.0], 100);
  const midScatter = generateScatter(MID_TREES, 10, 18, 38, [1.0, 1.6], 200);
  const groundScatter = generateScatter(GROUND_ITEMS, 30, 6, 55, [0.5, 1.2], 400);

  // Cây TwistedTree trung tâm
  const twistedScatter: ScatterItem[] = [
    { modelName: 'TwistedTree_1', x: 0, z: 0, scale: 5.0, rotY: Math.PI * 0.15 }
  ];
  // Các cây TwistedTree phụ
  const companions: ScatterItem[] = [
    { modelName: 'TwistedTree_3', x: -6, z: 3, scale: 2.8, rotY: 1.1 },
    { modelName: 'TwistedTree_5', x: 5, z: -4, scale: 2.2, rotY: 2.4 },
    { modelName: 'TwistedTree_2', x: -3, z: -6, scale: 1.8, rotY: 0.7 },
  ];

  // Hàm addInstanced giúp thêm nhanh
  const addInstanced = (items: ScatterItem[], castShadow: boolean, addCollider = false, colliderRadiusBase = 1.0) => {
    const modelNames = [...new Set(items.map(i => i.modelName))];
    for (const name of modelNames) {
      const src = cache.get(name);
      if (!src) continue;
      const meshes = buildInstancedGroup(src, items, name, castShadow);
      meshes.forEach(m => scene.add(m));

      if (addCollider) {
        // Tạo collider cho từng item của loại này
        const filtered = items.filter(i => i.modelName === name);
        for (const item of filtered) {
          colliders.push({
            center: new THREE.Vector3(item.x, 0, item.z),
            radius: item.scale * colliderRadiusBase // ước lượng bán kính cây
          });
        }
      }
    }
  };

  // Thêm các nhóm cây, bụi
  addInstanced(outerScatter, true, true, 1.0);    // cây to, cần collider
  addInstanced(midScatter, true, true, 0.8);
  addInstanced(groundScatter, false, false);       // bụi nhỏ, không collider
  addInstanced(twistedScatter, true, true, 2.5);   // cây đỏ khổng lồ
  addInstanced(companions, true, true, 1.5);

  return colliders;
  }
