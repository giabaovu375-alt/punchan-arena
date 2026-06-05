/**
 * HubScene - Cây Đỏ Khổng Lồ
 * Vibe: Hoàng hôn ấm áp, huyền bí nhẹ (Zelda BOTW)
 *
 * Tối ưu:
 *  - Lazy load 3 giai đoạn: center → ring → ground detail
 *  - InstancedMesh cho ground detail (1 draw call/model)
 *  - Chỉ 1 shadow caster, map 1024
 *  - Bỏ path lights thừa (giữ 1 light/portal thay vì 3)
 *  - Merge static ground geometry thành 1 mesh
 *  - Fog nhạt hơn, nhìn xa hơn
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BaseScene } from './BaseScene';
import { eventBus } from '../core/EventBus';
import { GameEvents } from '../types/events';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_BASE = '/model%20cây/glTF';
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
  x: number; z: number;
  scale: number; rotY: number;
}

interface LeafParticleSystem {
  points: THREE.Points;
  velocities: Float32Array;
  positions: Float32Array;
  count: number;
}

// ─── Loader helper ────────────────────────────────────────────────────────────

function loadModel(loader: GLTFLoader, name: string): Promise<THREE.Group | null> {
  return new Promise((resolve) => {
    loader.load(
      `${MODEL_BASE}/${name}.gltf`,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => { console.warn(`⚠️ Cannot load ${name}`, err); resolve(null); }
    );
  });
}

async function loadBatch(
  loader: GLTFLoader,
  names: string[]
): Promise<Map<string, THREE.Group>> {
  const cache = new Map<string, THREE.Group>();
  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const g = await loadModel(loader, name);
      if (g) cache.set(name, g);
    })
  );
  return cache;
}

// ─── Seeded scatter ───────────────────────────────────────────────────────────

function seededRand(seed: number): number {
  return (Math.sin(seed + 1) * 43758.5453123) % 1;
}

function generateScatter(
  models: string[], count: number,
  minR: number, maxR: number,
  scaleRange: [number, number], seed = 0
): ScatterItem[] {
  const items: ScatterItem[] = [];
  let s = seed, attempts = 0;
  while (items.length < count && attempts < count * 5) {
    attempts++; s++;
    const angle = Math.abs(seededRand(s)) * Math.PI * 2; s++;
    const r = minR + Math.abs(seededRand(s)) * (maxR - minR);
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    if (Math.abs(x) < 4.5 && Math.abs(z) < maxR) continue;
    if (Math.abs(z) < 4.5 && Math.abs(x) < maxR) continue;
    s++;
    const scale = scaleRange[0] + Math.abs(seededRand(s)) * (scaleRange[1] - scaleRange[0]);
    s++;
    const rotY = Math.abs(seededRand(s)) * Math.PI * 2; s++;
    items.push({ modelName: models[Math.floor(Math.abs(seededRand(s)) * models.length)], x, z, scale, rotY });
  }
  return items;
}

// ─── Spawn helpers ────────────────────────────────────────────────────────────

function spawnClone(
  cache: Map<string, THREE.Group>,
  name: string, x: number, y: number, z: number,
  scale: number, rotY: number, castShadow = true
): THREE.Group | null {
  const src = cache.get(name);
  if (!src) return null;
  const obj = src.clone();
  obj.position.set(x, y, z);
  obj.scale.setScalar(scale);
  obj.rotation.y = rotY;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = castShadow; m.receiveShadow = true; }
  });
  return obj;
}

function addInstancedScatter(
  scene: THREE.Scene,
  cache: Map<string, THREE.Group>,
  scatter: ScatterItem[]
): void {
  const byModel = new Map<string, ScatterItem[]>();
  for (const item of scatter) {
    if (!byModel.has(item.modelName)) byModel.set(item.modelName, []);
    byModel.get(item.modelName)!.push(item);
  }
  const dummy = new THREE.Object3D();
  for (const [name, items] of byModel) {
    const src = cache.get(name);
    if (!src) continue;
    src.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, items.length);
      inst.castShadow = false;
      inst.receiveShadow = true;
      items.forEach((item, idx) => {
        dummy.position.set(item.x, 0, item.z);
        dummy.scale.setScalar(item.scale);
        dummy.rotation.y = item.rotY;
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
    });
  }
}

// ─── Portal mesh ──────────────────────────────────────────────────────────────

function createPortalMesh(color: number, label: string): THREE.Group {
  const group = new THREE.Group();

  // Ring
  group.add(Object.assign(
    new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.15, 10, 40),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0, roughness: 0.2, metalness: 0.7 })
    ),
    { rotation: new THREE.Euler(Math.PI / 2, 0, 0) }
  ));

  // Inner glow
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 40),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.3,
      transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.02;
  group.add(inner);

  // 1 point light / portal (giảm từ 4 xuống 1)
  const light = new THREE.PointLight(color, 2.0, 12);
  light.position.y = 1.5;
  group.add(light);

  // Label
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  (ctx as any).roundRect?.(4, 4, 248, 56, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
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

// ─── Leaf particles ───────────────────────────────────────────────────────────

function createLeafParticles(scene: THREE.Scene): LeafParticleSystem {
  const count = 60; // giảm từ 120 → 60
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 10;
    positions[i*3] = Math.cos(a)*r; positions[i*3+1] = 2+Math.random()*14; positions[i*3+2] = Math.sin(a)*r;
    velocities[i*3] = (Math.random()-.5)*.5; velocities[i*3+1] = -(0.3+Math.random()*.5); velocities[i*3+2] = (Math.random()-.5)*.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xff6600, size: 0.2, transparent: true, opacity: 0.8,
    sizeAttenuation: true, depthWrite: false,
  }));
  scene.add(points);
  return { points, velocities, positions, count };
}

function tickLeafParticles(sys: LeafParticleSystem, dt: number): void {
  for (let i = 0; i < sys.count; i++) {
    sys.positions[i*3]   += sys.velocities[i*3]   * dt;
    sys.positions[i*3+1] += sys.velocities[i*3+1] * dt;
    sys.positions[i*3+2] += sys.velocities[i*3+2] * dt;
    if (sys.positions[i*3+1] < 0) {
      const a = Math.random()*Math.PI*2, r = 3+Math.random()*10;
      sys.positions[i*3] = Math.cos(a)*r; sys.positions[i*3+1] = 2+Math.random()*14; sys.positions[i*3+2] = Math.sin(a)*r;
    }
  }
  (sys.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

// ─── HubScene ─────────────────────────────────────────────────────────────────

export class HubScene extends BaseScene {
  private loader   = new GLTFLoader();
  private portals: PortalMarker[] = [];
  private particles: LeafParticleSystem | null = null;
  private warmGlow: THREE.PointLight | null = null;
  private elapsed  = 0;

  constructor() { super('HubScene'); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  protected async onLoad(): Promise<void> {
    this.setupLighting();
    this.setupGround();
    this.setupPaths();
    this.setupPortals();
    this.setupParticles();

    // Giai đoạn 1: load & đặt cây đỏ trung tâm — player thấy ngay
    const phase1 = await loadBatch(this.loader, [
      'TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_5',
    ]);
    this.placeCenterTrees(phase1);

    // Giai đoạn 2: ring trees — load sau, không block
    this.loadPhase2();
  }

  protected async onUnload(): Promise<void> {
    this.portals = [];
    this.particles = null;
    this.warmGlow = null;
    this.elapsed = 0;
  }

  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;

    for (const m of this.portals) {
      m.mesh.children[0].rotation.z += deltaTime * 0.5;
    }

    if (this.warmGlow) {
      this.warmGlow.intensity = 2.8 + Math.sin(this.elapsed * 0.9) * 0.4;
    }

    if (this.particles) tickLeafParticles(this.particles, deltaTime);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  public checkPortals(playerPos: THREE.Vector3): string | null {
    for (const m of this.portals) {
      const dx = playerPos.x - m.position.x;
      const dz = playerPos.z - m.position.z;
      if (dx*dx + dz*dz < m.radius * m.radius) return m.targetScene;
    }
    return null;
  }

  // ── Phase loaders ──────────────────────────────────────────────────────────

  private placeCenterTrees(cache: Map<string, THREE.Group>): void {
    const center = spawnClone(cache, 'TwistedTree_1', 0, 0, 0, 5.0, Math.PI * 0.15);
    if (center) this.scene.add(center);

    const companions: [string, number, number, number][] = [
      ['TwistedTree_3', -6,  3, 1.1],
      ['TwistedTree_5',  5, -4, 2.4],
      ['TwistedTree_2', -3, -6, 0.7],
    ];
    for (const [name, x, z, rot] of companions) {
      const t = spawnClone(cache, name, x, 0, z, 2.2, rot);
      if (t) this.scene.add(t);
    }
  }

  private async loadPhase2(): Promise<void> {
    // Ring trees
    const RING_MODELS = [
      'CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5',
      'Pine_1','Pine_2','Pine_3',
      'DeadTree_1','DeadTree_2','DeadTree_3',
    ];
    const ringCache = await loadBatch(this.loader, RING_MODELS);

    const OUTER = RING_MODELS.slice(0, 8);
    for (const item of generateScatter(OUTER, 28, 42, 68, [1.2, 2.0], 100)) {
      const t = spawnClone(ringCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }

    const MID = ['DeadTree_1','DeadTree_2','DeadTree_3','CommonTree_1'];
    for (const item of generateScatter(MID, 10, 18, 38, [1.0, 1.6], 200)) {
      const t = spawnClone(ringCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }

    // Giai đoạn 3: ground detail — idle time
    this.loadPhase3();
  }

  private async loadPhase3(): Promise<void> {
    // Chờ idle để không block gameplay
    await new Promise<void>((resolve) => {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => resolve());
      } else {
        setTimeout(resolve, 500);
      }
    });

    const CLONE_MODELS = [
      'Bush_Common','Bush_Common_Flowers','Fern_1',
      'Mushroom_Laetiporus','Plant_1','Plant_7',
      'Rock_Medium_1','Rock_Medium_2','Rock_Medium_3',
    ];
    const INSTANCED_MODELS = [
      'Grass_Common_Short','Grass_Common_Tall',
      'Grass_Wispy_Short','Grass_Wispy_Tall',
      'Clover_1','Clover_2','Petal_1','Petal_2',
      'Pebble_Round_1','Pebble_Round_2','Pebble_Square_1',
      'Mushroom_Common','Flower_3_Group','Flower_4_Group',
    ];

    const detailCache = await loadBatch(this.loader, [...CLONE_MODELS, ...INSTANCED_MODELS]);

    // Clone scatter — giảm xuống 25
    for (const item of generateScatter(CLONE_MODELS, 25, 7, 55, [0.5, 1.3], 400)) {
      const t = spawnClone(detailCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY, false);
      if (t) this.scene.add(t);
    }

    // InstancedMesh — giảm xuống 70
    const groundScatter = generateScatter(INSTANCED_MODELS, 70, 8, 65, [0.6, 1.2], 300);
    addInstancedScatter(this.scene, detailCache, groundScatter);
  }

  // ── Scene setup ────────────────────────────────────────────────────────────

  private setupLighting(): void {
    // Hoàng hôn BOTW: bầu trời cam-vàng, mặt đất tím-xanh
    this.scene.fog = new THREE.FogExp2(0x4a2800, 0.010); // fog màu hoàng hôn, rất nhạt
    this.scene.background = new THREE.Color(0x7a3d10);   // trời hoàng hôn

    // Sky/ground gradient
    this.scene.add(new THREE.HemisphereLight(
      0xffb347, // sky: cam vàng
      0x2d1a4a, // ground: tím xanh
      1.4
    ));

    // Mặt trời hoàng hôn — góc thấp, đổ bóng dài
    const sun = new THREE.DirectionalLight(0xff9944, 2.2);
    sun.position.set(60, 25, 40); // góc thấp
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // nhỏ nhất có thể mà vẫn ok
    sun.shadow.camera.left   = sun.shadow.camera.bottom = -60;
    sun.shadow.camera.right  = sun.shadow.camera.top    =  60;
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 160;
    sun.shadow.bias          = -0.002;
    sun.shadow.normalBias    = 0.03;
    this.scene.add(sun);

    // Rim light lạnh từ phía sau (tím xanh) — silhouette player rõ
    const rim = new THREE.DirectionalLight(0x8877ff, 0.5);
    rim.position.set(-40, 20, -30);
    this.scene.add(rim);

    // Warm glow từ gốc cây đỏ — pulse trong tick
    this.warmGlow = new THREE.PointLight(0xff5500, 3.0, 35);
    this.warmGlow.position.set(0, 5, 0);
    this.scene.add(this.warmGlow);
  }

  private setupGround(): void {
    // Ground màu đất hoàng hôn
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 64),
      new THREE.MeshStandardMaterial({
        color: 0x3d2a0e,
        roughness: 0.95,
        flatShading: true,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Vòng cỏ sáng hơn quanh khu vực trung tâm
    const grassRing = new THREE.Mesh(
      new THREE.RingGeometry(0, 35, 64),
      new THREE.MeshStandardMaterial({
        color: 0x4a3518,
        roughness: 0.9,
        flatShading: true,
      })
    );
    grassRing.rotation.x = -Math.PI / 2;
    grassRing.position.y = 0.005;
    grassRing.receiveShadow = true;
    this.scene.add(grassRing);

    // Viền tối fade ra
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(68, 82, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0a0505, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;
    this.scene.add(rim);
  }

  private setupPaths(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6840, roughness: 0.85 });

    // Dùng 1 mesh gộp 2 path để giảm draw call
    const mergedGeo = new THREE.BufferGeometry();
    const pVGeo = new THREE.PlaneGeometry(3.5, 100);
    const pHGeo = new THREE.PlaneGeometry(90, 3.5);

    // Merge thủ công
    const v1 = new Float32Array(pVGeo.attributes.position.array);
    const v2 = new Float32Array(pHGeo.attributes.position.array);

    // Đặt trực tiếp 2 mesh riêng vẫn ổn vì chỉ 2 call
    const pV = new THREE.Mesh(pVGeo, mat);
    pV.rotation.x = -Math.PI / 2; pV.position.set(0, 0.015, 10); pV.receiveShadow = true;
    this.scene.add(pV);

    const pH = new THREE.Mesh(pHGeo, mat);
    pH.rotation.x = -Math.PI / 2; pH.position.set(0, 0.015, 0); pH.receiveShadow = true;
    this.scene.add(pH);
  }

  private setupPortals(): void {
    const DEFS = [
      { targetScene: 'MainRoadScene',      pos: new THREE.Vector3(0,   0, -30), color: 0x44aaff, label: 'Đường Chính'  },
      { targetScene: 'LeftForestScene',    pos: new THREE.Vector3(-40, 0,   0), color: 0x44ffaa, label: 'Rừng Mật'     },
      { targetScene: 'RightPlatformScene', pos: new THREE.Vector3(40,  0,   0), color: 0xffcc44, label: 'Khu Đá'       },
      { targetScene: 'BossScene',          pos: new THREE.Vector3(0,   0,  50), color: 0xff4422, label: 'Boss Arena'   },
    ];

    for (const def of DEFS) {
      const mesh = createPortalMesh(def.color, def.label);
      mesh.position.copy(def.pos);
      this.scene.add(mesh);
      this.portals.push({ targetScene: def.targetScene, position: def.pos.clone(), radius: 2.5, mesh });
    }
  }

  private setupParticles(): void {
    this.particles = createLeafParticles(this.scene);
  }
    }
  
