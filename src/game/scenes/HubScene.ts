/**
 * HubScene - Cây Đỏ Khổng Lồ
 * Trung tâm map: kết nối MainRoad, LeftForest, RightPlatform, BossArena
 *
 * Tối ưu:
 *  - ModelCache: mỗi .gltf chỉ load 1 lần, clone() cho các instance
 *  - Batch load song song (Promise.all) trước khi scatter
 *  - InstancedMesh cho ground detail nhỏ (grass, pebble, clover...)
 *    → giảm từ ~150 draw calls xuống ~15
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_BASE = "/public/model/model cây/glTF";

export const HUB_SPAWN = new THREE.Vector3(0, 0, 30);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HubSceneHandles {
  tick: (dt: number) => void;
  checkPortals: (playerPos: THREE.Vector3) => string | null;
}

interface PortalMarker {
  targetScene: string;
  position: THREE.Vector3;
  radius: number;
  mesh: THREE.Group;
}

// ─── Model Cache ──────────────────────────────────────────────────────────────

/**
 * Load tất cả models cần thiết song song.
 * Trả về Map<modelName, THREE.Group> — dùng .clone() khi đặt vào scene.
 */
async function loadModels(
  loader: GLTFLoader,
  names: string[]
): Promise<Map<string, THREE.Group>> {
  const cache = new Map<string, THREE.Group>();
  const unique = [...new Set(names)];

  await Promise.all(
    unique.map(
      (name) =>
        new Promise<void>((resolve) => {
          loader.load(
            `${MODEL_BASE}/${name}.gltf`,
            (gltf) => {
              cache.set(name, gltf.scene);
              resolve();
            },
            undefined,
            (err) => {
              console.warn(`⚠️ HubScene: không load được ${name}`, err);
              resolve(); // không block các model khác
            }
          );
        })
    )
  );

  return cache;
}

/** Clone model từ cache, set shadow, trả về group đã sẵn sàng */
function spawnModel(
  cache: Map<string, THREE.Group>,
  name: string,
  x: number,
  y: number,
  z: number,
  scale: number,
  rotY: number,
  castShadow = true
): THREE.Group | null {
  const src = cache.get(name);
  if (!src) return null;
  const obj = src.clone();
  obj.position.set(x, y, z);
  obj.scale.setScalar(scale);
  obj.rotation.y = rotY;
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = castShadow;
      o.receiveShadow = true;
    }
  });
  return obj;
}

// ─── Seeded scatter ───────────────────────────────────────────────────────────

interface ScatterItem {
  modelName: string;
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
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

// ─── InstancedMesh cho ground detail ─────────────────────────────────────────

/**
 * Dùng InstancedMesh để render nhiều object nhỏ giống nhau (grass, pebble...)
 * với 1 draw call duy nhất.
 *
 * Lấy mesh đầu tiên tìm thấy trong group làm template.
 */
function buildInstancedGroup(
  src: THREE.Group,
  items: ScatterItem[],
  modelName: string
): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  const filtered = items.filter((i) => i.modelName === modelName);
  if (filtered.length === 0) return meshes;

  // Thu thập tất cả mesh con trong model gốc
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
    instanced.castShadow = false;
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

// ─── Portal mesh ──────────────────────────────────────────────────────────────

function createPortalMesh(color: number, label: string): THREE.Group {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.18, 12, 48),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.7,
    })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 48),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.02;
  group.add(inner);

  const light = new THREE.PointLight(color, 1.2, 10);
  light.position.y = 1;
  group.add(light);

  // Label sprite
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.roundRect(4, 4, 248, 56, 12);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  );
  sprite.position.set(0, 3.2, 0);
  sprite.scale.set(3.2, 0.8, 1);
  group.add(sprite);

  return group;
}

// ─── Path lights ──────────────────────────────────────────────────────────────

function addPathLights(scene: THREE.Scene, portalPos: THREE.Vector3, color: number): void {
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const light = new THREE.PointLight(color, 0.5, 8);
    light.position.set(portalPos.x * t, 1.2, portalPos.z * t);
    scene.add(light);
  }
}

// ─── Leaf particles ───────────────────────────────────────────────────────────

interface LeafParticleSystem {
  points: THREE.Points;
  velocities: Float32Array;
  positions: Float32Array;
  count: number;
}

function createLeafParticles(scene: THREE.Scene): LeafParticleSystem {
  const count = 120;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 10;
    positions[i * 3]     = Math.cos(angle) * r;
    positions[i * 3 + 1] = 2 + Math.random() * 14;
    positions[i * 3 + 2] = Math.sin(angle) * r;
    velocities[i * 3]     = (Math.random() - 0.5) * 0.5;
    velocities[i * 3 + 1] = -(0.3 + Math.random() * 0.5);
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xff3300,
    size: 0.18,
    transparent: true,
    opacity: 0.75,
    sizeAttenuation: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, velocities, positions, count };
}

function tickLeafParticles(sys: LeafParticleSystem, dt: number): void {
  for (let i = 0; i < sys.count; i++) {
    sys.positions[i * 3]     += sys.velocities[i * 3] * dt;
    sys.positions[i * 3 + 1] += sys.velocities[i * 3 + 1] * dt;
    sys.positions[i * 3 + 2] += sys.velocities[i * 3 + 2] * dt;
    if (sys.positions[i * 3 + 1] < 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 10;
      sys.positions[i * 3]     = Math.cos(angle) * r;
      sys.positions[i * 3 + 1] = 2 + Math.random() * 14;
      sys.positions[i * 3 + 2] = Math.sin(angle) * r;
    }
  }
  (sys.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildHubScene(
  scene: THREE.Scene,
  isMobile = false
): Promise<HubSceneHandles> {
  const loader = new GLTFLoader();

  // ── Fog & Background ──────────────────────────────────────────────────────
  scene.fog = new THREE.FogExp2(0x1a1a0a, 0.018);
  scene.background = new THREE.Color(0x1a1a0a);

  // ── Lighting ──────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xff6a00, 0x0a0a05, 0.55));

  const moon = new THREE.DirectionalLight(0xc8d8ff, 0.5);
  moon.position.set(-30, 80, 20);
  moon.castShadow = true;
  moon.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  moon.shadow.camera.left = moon.shadow.camera.bottom = -80;
  moon.shadow.camera.right = moon.shadow.camera.top = 80;
  moon.shadow.camera.far = 200;
  moon.shadow.bias = -0.0005;
  scene.add(moon);

  const warmGlow = new THREE.PointLight(0xff4400, 2.5, 35);
  warmGlow.position.set(0, 6, 0);
  scene.add(warmGlow);

  scene.add(Object.assign(new THREE.DirectionalLight(0xff8844, 0.3), {
    position: new THREE.Vector3(10, 20, -10),
  }));

  // ── Ground ────────────────────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(80, 72),
    new THREE.MeshStandardMaterial({ color: 0x1e2a10, roughness: 0.98, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(70, 82, 72),
    new THREE.MeshStandardMaterial({
      color: 0x0a0a05, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.01;
  scene.add(rim);

  // ── Paths ─────────────────────────────────────────────────────────────────
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 1 });

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

  // ── Define scatter lists (trước khi load) ─────────────────────────────────

  // Cây đỏ trung tâm + companion
  const TWISTED = ["TwistedTree_1", "TwistedTree_2", "TwistedTree_3", "TwistedTree_5"];

  // Cây viền ngoài
  const OUTER_TREES = ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5", "Pine_1", "Pine_2", "Pine_3"];
  const outerScatter = generateScatter(OUTER_TREES, 40, 40, 68, [1.2, 2.0], 100);

  // Cây mid
  const MID_TREES = ["DeadTree_1", "DeadTree_2", "DeadTree_3", "CommonTree_1"];
  const midScatter = generateScatter(MID_TREES, 18, 18, 38, [1.0, 1.6], 200);

  // Ground detail — sẽ dùng InstancedMesh
  const INSTANCED_MODELS = [
    "Grass_Common_Short", "Grass_Common_Tall",
    "Grass_Wispy_Short",  "Grass_Wispy_Tall",
    "Clover_1", "Clover_2",
    "Petal_1",  "Petal_2",
    "Pebble_Round_1", "Pebble_Round_2",
    "Pebble_Square_1",
    "Mushroom_Common",
    "Flower_3_Group", "Flower_4_Group",
  ];
  const groundScatter = generateScatter(INSTANCED_MODELS, 100, 8, 65, [0.6, 1.2], 300);

  // Clone models — load riêng (không instanced)
  const CLONE_MODELS = [
    "Bush_Common", "Bush_Common_Flowers",
    "Fern_1",
    "Mushroom_Laetiporus",
    "Plant_1", "Plant_7",
    "Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3",
    "Pebble_Round_3", "Pebble_Square_2",
  ];
  const cloneScatter = generateScatter(CLONE_MODELS, 40, 6, 55, [0.5, 1.3], 400);

  // ── Load tất cả models song song ─────────────────────────────────────────
  const allModelNames = [
    ...TWISTED,
    ...new Set(outerScatter.map((i) => i.modelName)),
    ...new Set(midScatter.map((i) => i.modelName)),
    ...INSTANCED_MODELS,
    ...new Set(cloneScatter.map((i) => i.modelName)),
  ];

  console.log(`📦 HubScene: loading ${[...new Set(allModelNames)].length} unique models...`);
  const cache = await loadModels(loader, allModelNames);
  console.log(`✅ HubScene: models loaded`);

  // ── Đặt cây đỏ trung tâm ─────────────────────────────────────────────────
  const centerTree = spawnModel(cache, "TwistedTree_1", 0, 0, 0, 5.0, Math.PI * 0.15);
  if (centerTree) scene.add(centerTree);

  const companions: [string, number, number, number, number][] = [
    ["TwistedTree_3", -6,  0,  3,  1.1],
    ["TwistedTree_5",  5,  0, -4,  2.4],
    ["TwistedTree_2", -3,  0, -6,  0.7],
  ];
  for (const [name, x, y, z, rot] of companions) {
    const t = spawnModel(cache, name, x, y, z, 2.2, rot);
    if (t) scene.add(t);
  }

  // ── Outer ring trees ──────────────────────────────────────────────────────
  for (const item of outerScatter) {
    const t = spawnModel(cache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
    if (t) scene.add(t);
  }

  // ── Mid ring trees ────────────────────────────────────────────────────────
  for (const item of midScatter) {
    const t = spawnModel(cache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
    if (t) scene.add(t);
  }

  // ── Ground detail — InstancedMesh ─────────────────────────────────────────
  for (const name of INSTANCED_MODELS) {
    const src = cache.get(name);
    if (!src) continue;
    const instanced = buildInstancedGroup(src, groundScatter, name);
    instanced.forEach((m) => scene.add(m));
  }

  // ── Clone models (bush, fern, rock...) ───────────────────────────────────
  for (const item of cloneScatter) {
    const t = spawnModel(cache, item.modelName, item.x, 0, item.z, item.scale, item.rotY, false);
    if (t) scene.add(t);
  }

  // ── Portals ────────────────────────────────────────────────────────────────
  const PORTAL_DEFS = [
    { targetScene: "MainRoadScene",     pos: new THREE.Vector3(0,   0, -30), color: 0x00aaff, label: "Đường Chính",  radius: 2.5 },
    { targetScene: "LeftForestScene",   pos: new THREE.Vector3(-40, 0,   0), color: 0x00ff88, label: "Rừng Mật",     radius: 2.5 },
    { targetScene: "RightPlatformScene",pos: new THREE.Vector3(40,  0,   0), color: 0xffaa00, label: "Khu Đá",       radius: 2.5 },
    { targetScene: "BossScene",         pos: new THREE.Vector3(0,   0,  50), color: 0xff2200, label: "Boss Arena",   radius: 2.5 },
  ];

  const portalMarkers: PortalMarker[] = [];

  for (const def of PORTAL_DEFS) {
    const mesh = createPortalMesh(def.color, def.label);
    mesh.position.copy(def.pos);
    scene.add(mesh);
    addPathLights(scene, def.pos, def.color);
    portalMarkers.push({ ...def, mesh });
  }

  // ── Particles ──────────────────────────────────────────────────────────────
  const particleSystem = createLeafParticles(scene);

  // ── Tick & handles ────────────────────────────────────────────────────────
  let elapsed = 0;

  return {
    tick(dt: number) {
      elapsed += dt;

      // Portal ring xoay
      for (const marker of portalMarkers) {
        marker.mesh.children[0].rotation.z += dt * 0.4;
      }

      // Warm glow pulse
      warmGlow.intensity = 2.0 + Math.sin(elapsed * 1.2) * 0.5;

      tickLeafParticles(particleSystem, dt);
    },

    checkPortals(playerPos: THREE.Vector3): string | null {
      for (const marker of portalMarkers) {
        const dx = playerPos.x - marker.position.x;
        const dz = playerPos.z - marker.position.z;
        if (dx * dx + dz * dz < marker.radius * marker.radius) {
          return marker.targetScene;
        }
      }
      return null;
    },
  };
}
