/**
 * HubScene - Cây Đỏ Khổng Lồ
 *
 * Tối ưu:
 *  - Share geometry + material qua InstancedMesh (ground detail, outer ring)
 *  - Clone chỉ dùng cho cây lớn cần shadow riêng
 *  - Chỉ 1 DirectionalLight có shadow (map 1024 mobile / 1536 desktop)
 *  - Lighting sáng hơn, tương phản cao để player dễ thấy nhân vật
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BaseScene } from './BaseScene';
import { eventBus } from '../core/EventBus';
import { GameEvents } from '../types/events';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_BASE = '/model-tree';
export const HUB_SPAWN = new THREE.Vector3(0, 0, 30);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalMarker {
  targetScene: string;
  position: THREE.Vector3;
  radius: number;
  mesh: THREE.Group;
}

interface ScatterItem {
  modelName: string;
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

interface LeafParticleSystem {
  points: THREE.Points;
  velocities: Float32Array;
  positions: Float32Array;
  count: number;
}

// ─── Model loader ─────────────────────────────────────────────────────────────

async function loadModels(
  loader: GLTFLoader,
  names: string[]
): Promise<Map<string, THREE.Group>> {
  const cache = new Map<string, THREE.Group>();
  await Promise.all(
    [...new Set(names)].map(
      (name) =>
        new Promise<void>((resolve) => {
          loader.load(
            `${MODEL_BASE}/${name}.gltf`,
            (gltf) => { cache.set(name, gltf.scene); resolve(); },
            undefined,
            (err) => { console.warn(`⚠️ HubScene: cannot load ${name}`, err); resolve(); }
          );
        })
    )
  );
  return cache;
}

// ─── Seeded scatter ───────────────────────────────────────────────────────────

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
  while (items.length < count && attempts < count * 5) {
    attempts++;
    s++;
    const angle = seededRand(s) * Math.PI * 2;
    s++;
    const r = minR + seededRand(s) * (maxR - minR);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    // tránh path dọc & ngang
    if (Math.abs(x) < 4.5 && Math.abs(z) < maxR) continue;
    if (Math.abs(z) < 4.5 && Math.abs(x) < maxR) continue;
    s++;
    const scale = scaleRange[0] + seededRand(s) * (scaleRange[1] - scaleRange[0]);
    s++;
    const rotY = seededRand(s) * Math.PI * 2;
    s++;
    items.push({ modelName: models[Math.floor(seededRand(s) * models.length)], x, z, scale, rotY });
  }
  return items;
}

// ─── InstancedMesh builder ───────────────────────────────────────────────────

/**
 * Với mỗi model trong danh sách INSTANCED_MODELS,
 * tạo 1 InstancedMesh duy nhất chứa toàn bộ instances của model đó.
 * → 1 draw call / model thay vì N draw calls.
 */
function addInstancedScatter(
  scene: THREE.Scene,
  cache: Map<string, THREE.Group>,
  scatter: ScatterItem[]
): void {
  // Gom scatter theo modelName
  const byModel = new Map<string, ScatterItem[]>();
  for (const item of scatter) {
    if (!byModel.has(item.modelName)) byModel.set(item.modelName, []);
    byModel.get(item.modelName)!.push(item);
  }

  const dummy = new THREE.Object3D();

  for (const [name, items] of byModel) {
    const src = cache.get(name);
    if (!src) continue;

    // Thu thập tất cả mesh con
    src.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const instanced = new THREE.InstancedMesh(
        mesh.geometry,
        mesh.material,
        items.length
      );
      instanced.castShadow = false;
      instanced.receiveShadow = true;

      items.forEach((item, idx) => {
        dummy.position.set(item.x, 0, item.z);
        dummy.scale.setScalar(item.scale);
        dummy.rotation.y = item.rotY;
        dummy.updateMatrix();
        instanced.setMatrixAt(idx, dummy.matrix);
      });

      instanced.instanceMatrix.needsUpdate = true;
      scene.add(instanced);
    });
  }
}

// ─── Clone builder (cây lớn cần shadow) ──────────────────────────────────────

function spawnClone(
  cache: Map<string, THREE.Group>,
  name: string,
  x: number, y: number, z: number,
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

// ─── Portal mesh ──────────────────────────────────────────────────────────────

function createPortalMesh(color: number, label: string): THREE.Group {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.18, 12, 48),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.9,
      roughness: 0.2, metalness: 0.8,
    })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 48),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.35,
      transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.02;
  group.add(inner);

  // Glow mạnh hơn để dễ thấy
  const light = new THREE.PointLight(color, 2.5, 14);
  light.position.y = 1.5;
  group.add(light);

  // Label sprite
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  (ctx as any).roundRect(4, 4, 248, 56, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true })
  );
  sprite.position.set(0, 3.4, 0);
  sprite.scale.set(3.2, 0.8, 1);
  group.add(sprite);

  return group;
}

function addPathLights(scene: THREE.Scene, portalPos: THREE.Vector3, color: number): void {
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const light = new THREE.PointLight(color, 0.8, 10);
    light.position.set(portalPos.x * t, 1.2, portalPos.z * t);
    scene.add(light);
  }
}

// ─── Leaf particles ───────────────────────────────────────────────────────────

function createLeafParticles(scene: THREE.Scene): LeafParticleSystem {
  const count = 80; // giảm từ 120 → 80 để nhẹ hơn
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
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xff4400, size: 0.22,
    transparent: true, opacity: 0.85,
    sizeAttenuation: true, depthWrite: false,
  }));
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

// ─── HubScene class ───────────────────────────────────────────────────────────

export class HubScene extends BaseScene {
  private loader   = new GLTFLoader();
  private cache    = new Map<string, THREE.Group>();
  private portals: PortalMarker[] = [];
  private particles: LeafParticleSystem | null = null;
  private warmGlow: THREE.PointLight | null = null;
  private elapsed  = 0;

  constructor() { super('HubScene'); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  protected async onLoad(): Promise<void> {
    const ALL_MODELS = [
      // Cây đỏ trung tâm
      'TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_5',
      // Outer ring
      'CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5',
      'Pine_1', 'Pine_2', 'Pine_3',
      // Mid ring
      'DeadTree_1', 'DeadTree_2', 'DeadTree_3',
      // Clone scatter (bush, fern, rock — cần shadow riêng)
      'Bush_Common', 'Bush_Common_Flowers', 'Fern_1',
      'Mushroom_Laetiporus', 'Plant_1', 'Plant_7',
      'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
      // Instanced scatter (ground detail nhỏ — dùng InstancedMesh)
      'Grass_Common_Short', 'Grass_Common_Tall',
      'Grass_Wispy_Short',  'Grass_Wispy_Tall',
      'Clover_1', 'Clover_2',
      'Petal_1',  'Petal_2',
      'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Square_1',
      'Mushroom_Common', 'Flower_3_Group', 'Flower_4_Group',
    ];

    console.log(`📦 HubScene: loading ${ALL_MODELS.length} unique models...`);
    this.cache = await loadModels(this.loader, ALL_MODELS);
    console.log('✅ HubScene models loaded');

    this.setupLighting();
    this.setupGround();
    this.setupPaths();
    this.setupTrees();
    this.setupPortals();
    this.setupParticles();
  }

  protected async onUnload(): Promise<void> {
    this.cache.clear();
    this.portals = [];
    this.particles = null;
    this.warmGlow = null;
    this.elapsed = 0;
  }

  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;

    // Portal ring xoay
    for (const m of this.portals) {
      m.mesh.children[0].rotation.z += deltaTime * 0.4;
    }

    // Warm glow pulse — nhẹ hơn, không tối quá
    if (this.warmGlow) {
      this.warmGlow.intensity = 3.0 + Math.sin(this.elapsed * 1.2) * 0.6;
    }

    if (this.particles) tickLeafParticles(this.particles, deltaTime);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  public checkPortals(playerPos: THREE.Vector3): string | null {
    for (const m of this.portals) {
      const dx = playerPos.x - m.position.x;
      const dz = playerPos.z - m.position.z;
      if (dx * dx + dz * dz < m.radius * m.radius) return m.targetScene;
    }
    return null;
  }

  // ── Private setup ──────────────────────────────────────────────────────────

  private setupLighting(): void {
    this.scene.fog = new THREE.FogExp2(0x0d1208, 0.014); // fog nhạt hơn → nhìn xa hơn
    this.scene.background = new THREE.Color(0x0d1208);

    // Ambient sáng hơn hẳn — player dễ thấy nhân vật
    this.scene.add(new THREE.HemisphereLight(
      0xffe0a0, // sky: ấm vàng
      0x203010, // ground: xanh tối
      1.2       // intensity cao hơn (cũ: 0.55)
    ));

    // ✦ Chỉ 1 DirectionalLight có shadow — đây là cái duy nhất cast shadow
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.8); // sáng, ấm
    sun.position.set(20, 60, 30);
    sun.castShadow = true;
    // Shadow map nhỏ hơn → nhẹ hơn nhiều
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left   = sun.shadow.camera.bottom = -70;
    sun.shadow.camera.right  = sun.shadow.camera.top    =  70;
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 180;
    sun.shadow.bias          = -0.001;
    sun.shadow.normalBias    = 0.02;
    this.scene.add(sun);

    // Rim light lạnh từ phía sau — tạo tương phản silhouette cho player
    const rim = new THREE.DirectionalLight(0x8ab4ff, 0.6);
    rim.position.set(-20, 30, -40);
    this.scene.add(rim);

    // Warm glow từ gốc cây đỏ — sáng hơn (cũ: 2.5)
    this.warmGlow = new THREE.PointLight(0xff5500, 3.5, 40);
    this.warmGlow.position.set(0, 5, 0);
    this.scene.add(this.warmGlow);

    // Fill từ dưới lên — giảm bóng cứng dưới nhân vật
    const fillUp = new THREE.PointLight(0xff9944, 0.8, 25);
    fillUp.position.set(0, 0.5, 0);
    this.scene.add(fillUp);
  }

  private setupGround(): void {
    // Ground sáng hơn → tương phản với nhân vật
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 72),
      new THREE.MeshStandardMaterial({
        color: 0x2a3d18, // sáng hơn (cũ: 0x1e2a10)
        roughness: 0.95,
        flatShading: true,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Vòng tối nhẹ ở viền — vignette đơn giản
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(68, 82, 72),
      new THREE.MeshStandardMaterial({
        color: 0x050805, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;
    this.scene.add(rim);
  }

  private setupPaths(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a6040, roughness: 0.9 });

    // Path dọc (Main Road ↔ Boss)
    const pV = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 100), mat);
    pV.rotation.x = -Math.PI / 2;
    pV.position.set(0, 0.015, 10);
    pV.receiveShadow = true;
    this.scene.add(pV);

    // Path ngang (Left ↔ Right)
    const pH = new THREE.Mesh(new THREE.PlaneGeometry(90, 3.5), mat);
    pH.rotation.x = -Math.PI / 2;
    pH.position.set(0, 0.015, 0);
    pH.receiveShadow = true;
    this.scene.add(pH);
  }

  private setupTrees(): void {
    // ── Cây đỏ trung tâm ────────────────────────────────────────────────────
    const center = spawnClone(this.cache, 'TwistedTree_1', 0, 0, 0, 5.0, Math.PI * 0.15);
    if (center) this.scene.add(center);

    const companions: [string, number, number, number][] = [
      ['TwistedTree_3', -6,  3, 1.1],
      ['TwistedTree_5',  5, -4, 2.4],
      ['TwistedTree_2', -3, -6, 0.7],
    ];
    for (const [name, x, z, rot] of companions) {
      const t = spawnClone(this.cache, name, x, 0, z, 2.2, rot);
      if (t) this.scene.add(t);
    }

    // ── Outer ring — clone (cần shadow) ─────────────────────────────────────
    const OUTER = ['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5','Pine_1','Pine_2','Pine_3'];
    for (const item of generateScatter(OUTER, 36, 42, 68, [1.2, 2.0], 100)) {
      const t = spawnClone(this.cache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }

    // ── Mid ring — clone ─────────────────────────────────────────────────────
    const MID = ['DeadTree_1','DeadTree_2','DeadTree_3','CommonTree_1'];
    for (const item of generateScatter(MID, 14, 18, 38, [1.0, 1.6], 200)) {
      const t = spawnClone(this.cache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }

    // ── Clone scatter: bush, fern, rock ─────────────────────────────────────
    const CLONES = ['Bush_Common','Bush_Common_Flowers','Fern_1','Mushroom_Laetiporus','Plant_1','Plant_7','Rock_Medium_1','Rock_Medium_2','Rock_Medium_3'];
    for (const item of generateScatter(CLONES, 35, 7, 55, [0.5, 1.3], 400)) {
      const t = spawnClone(this.cache, item.modelName, item.x, 0, item.z, item.scale, item.rotY, false);
      if (t) this.scene.add(t);
    }

    // ── InstancedMesh: ground detail nhỏ (1 draw call / model) ───────────────
    const INSTANCED = [
      'Grass_Common_Short','Grass_Common_Tall','Grass_Wispy_Short','Grass_Wispy_Tall',
      'Clover_1','Clover_2','Petal_1','Petal_2',
      'Pebble_Round_1','Pebble_Round_2','Pebble_Square_1',
      'Mushroom_Common','Flower_3_Group','Flower_4_Group',
    ];
    const groundScatter = generateScatter(INSTANCED, 90, 8, 65, [0.6, 1.2], 300);
    addInstancedScatter(this.scene, this.cache, groundScatter);
  }

  private setupPortals(): void {
    const DEFS = [
      { targetScene: 'MainRoadScene',      pos: new THREE.Vector3(0,   0, -30), color: 0x00aaff, label: 'Đường Chính'  },
      { targetScene: 'LeftForestScene',    pos: new THREE.Vector3(-40, 0,   0), color: 0x00ff88, label: 'Rừng Mật'     },
      { targetScene: 'RightPlatformScene', pos: new THREE.Vector3(40,  0,   0), color: 0xffaa00, label: 'Khu Đá'       },
      { targetScene: 'BossScene',          pos: new THREE.Vector3(0,   0,  50), color: 0xff2200, label: 'Boss Arena'   },
    ];

    for (const def of DEFS) {
      const mesh = createPortalMesh(def.color, def.label);
      mesh.position.copy(def.pos);
      this.scene.add(mesh);
      addPathLights(this.scene, def.pos, def.color);
      this.portals.push({ targetScene: def.targetScene, position: def.pos.clone(), radius: 2.5, mesh });
    }
  }

  private setupParticles(): void {
    this.particles = createLeafParticles(this.scene);
  }
                 }
        
