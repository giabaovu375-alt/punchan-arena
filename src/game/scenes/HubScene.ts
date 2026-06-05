/**
 * HubScene - Cây Đỏ Khổng Lồ
 * Vibe: Hoàng hôn ấm áp, huyền bí nhẹ (Zelda BOTW)
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

// ─── Helper Functions ─────────────────────────────────────────────────────────

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
            (gltf) => { cache.set(name, gltf.scene); resolve(); },
            undefined,
            (err) => { console.warn(`⚠️ HubScene: không load được ${name}`, err); resolve(); }
          );
        })
    )
  );

  return cache;
}

function spawnModel(
  cache: Map<string, THREE.Group>,
  name: string,
  x: number, y: number, z: number,
  scale: number, rotY: number,
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

function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

function generateScatter(
  models: string[], count: number,
  minR: number, maxR: number,
  scaleRange: [number, number], seed = 0
): ScatterItem[] {
  const items: ScatterItem[] = [];
  let s = seed, attempts = 0;

  while (items.length < count && attempts < count * 4) {
    attempts++; s++;
    const angle = seededRand(s) * Math.PI * 2; s++;
    const r = minR + seededRand(s) * (maxR - minR);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (Math.abs(x) < 4.5 && Math.abs(z) < maxR) continue;
    if (Math.abs(z) < 4.5 && Math.abs(x) < maxR) continue;
    s++;
    const scale = scaleRange[0] + seededRand(s) * (scaleRange[1] - scaleRange[0]);
    s++;
    const rotY = seededRand(s) * Math.PI * 2; s++;
    items.push({ modelName: models[Math.floor(seededRand(s) * models.length)], x, z, scale, rotY });
  }
  return items;
}

function buildInstancedGroup(
  src: THREE.Group, items: ScatterItem[], modelName: string
): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  const filtered = items.filter((i) => i.modelName === modelName);
  if (filtered.length === 0) return meshes;

  const srcMeshes: THREE.Mesh[] = [];
  src.traverse((o) => { if ((o as THREE.Mesh).isMesh) srcMeshes.push(o as THREE.Mesh); });

  const dummy = new THREE.Object3D();
  for (const srcMesh of srcMeshes) {
    const instanced = new THREE.InstancedMesh(srcMesh.geometry, srcMesh.material, filtered.length);
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

function createPortalMesh(color: number, label: string): THREE.Group {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.18, 12, 48),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.9,
      roughness: 0.2, metalness: 0.7,
    })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 48),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.3,
      transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.02;
  group.add(inner);

  // 1 light/portal thay vì 4
  const light = new THREE.PointLight(color, 2.0, 12);
  light.position.y = 1.5;
  group.add(light);

  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  (ctx as any).roundRect(4, 4, 248, 56, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true })
  );
  sprite.position.set(0, 3.2, 0);
  sprite.scale.set(3.2, 0.8, 1);
  group.add(sprite);

  return group;
}

function createLeafParticles(scene: THREE.Scene): LeafParticleSystem {
  const count = 60;
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
    color: 0xff6600, size: 0.2,
    transparent: true, opacity: 0.8,
    sizeAttenuation: true, depthWrite: false,
  }));
  scene.add(points);
  return { points, velocities, positions, count };
}

function tickLeafParticles(sys: LeafParticleSystem, dt: number): void {
  for (let i = 0; i < sys.count; i++) {
    sys.positions[i * 3]     += sys.velocities[i * 3]     * dt;
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

// ─── Main Scene Class ─────────────────────────────────────────────────────────

export class HubScene extends BaseScene {
  private loader: GLTFLoader;
  private modelCache: Map<string, THREE.Group> = new Map();
  private portalMarkers: PortalMarker[] = [];
  private particleSystem: LeafParticleSystem | null = null;
  private warmGlow: THREE.PointLight | null = null;
  private elapsed = 0;

  constructor() {
    super('HubScene');
    this.loader = new GLTFLoader();
  }

  protected async onLoad(): Promise<void> {
    console.log('🌳 HubScene loading...');
    try {
      await this.loadAllModels();
      this.setupLighting();
      this.setupGround();
      this.setupPaths();
      this.setupTrees();
      this.setupPortals();
      this.setupParticles();
      console.log('✅ HubScene loaded!');
    } catch (error) {
      console.error('❌ Error loading HubScene:', error);
      throw error;
    }
  }

  protected async onUnload(): Promise<void> {
    this.modelCache.clear();
    this.portalMarkers = [];
    this.particleSystem = null;
    this.warmGlow = null;
    this.elapsed = 0;
  }

  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;

    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0]) {
        marker.mesh.children[0].rotation.z += deltaTime * 0.4;
      }
    }

    if (this.warmGlow) {
      this.warmGlow.intensity = 2.8 + Math.sin(this.elapsed * 0.9) * 0.4;
    }

    if (this.particleSystem) {
      tickLeafParticles(this.particleSystem, deltaTime);
    }
  }

  // ── Private Setup ──────────────────────────────────────────────────────────

  private async loadAllModels(): Promise<void> {
    const allNames = [
      'TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_5',
      'CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5',
      'Pine_1', 'Pine_2', 'Pine_3',
      'DeadTree_1', 'DeadTree_2', 'DeadTree_3',
      'Bush_Common', 'Bush_Common_Flowers', 'Fern_1',
      'Mushroom_Common', 'Mushroom_Laetiporus',
      'Plant_1', 'Plant_7',
      'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
      'Grass_Common_Short', 'Grass_Common_Tall',
      'Grass_Wispy_Short', 'Grass_Wispy_Tall',
      'Clover_1', 'Clover_2', 'Petal_1', 'Petal_2',
      'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Square_1',
      'Flower_3_Group', 'Flower_4_Group',
    ];

    console.log(`📦 HubScene: loading ${allNames.length} unique models...`);
    this.modelCache = await loadModels(this.loader, allNames);
    console.log('✅ Models loaded!');
  }

  private setupLighting(): void {
    // Hoàng hôn BOTW
    this.scene.fog = new THREE.FogExp2(0x4a2800, 0.010);
    this.scene.background = new THREE.Color(0x7a3d10);

    // Sky cam-vàng / ground tím xanh
    this.scene.add(new THREE.HemisphereLight(0xffb347, 0x2d1a4a, 1.4));

    // Mặt trời hoàng hôn — góc thấp, 1 shadow duy nhất, map 1024
    const sun = new THREE.DirectionalLight(0xff9944, 2.2);
    sun.position.set(60, 25, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left   = sun.shadow.camera.bottom = -60;
    sun.shadow.camera.right  = sun.shadow.camera.top    =  60;
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 160;
    sun.shadow.bias          = -0.002;
    sun.shadow.normalBias    = 0.03;
    this.scene.add(sun);

    // Rim light lạnh — silhouette player rõ
    const rim = new THREE.DirectionalLight(0x8877ff, 0.5);
    rim.position.set(-40, 20, -30);
    this.scene.add(rim);

    // Warm glow từ gốc cây đỏ
    this.warmGlow = new THREE.PointLight(0xff5500, 3.0, 35);
    this.warmGlow.position.set(0, 5, 0);
    this.scene.add(this.warmGlow);

    // Fill từ dưới — giảm bóng cứng dưới chân
    this.scene.add(Object.assign(new THREE.PointLight(0xff9944, 0.6, 20), {
      position: new THREE.Vector3(0, 0.5, 0),
    }));
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 64),
      new THREE.MeshStandardMaterial({ color: 0x3d2a0e, roughness: 0.95, flatShading: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Vòng sáng hơn ở trung tâm
    const grassRing = new THREE.Mesh(
      new THREE.RingGeometry(0, 35, 64),
      new THREE.MeshStandardMaterial({ color: 0x4a3518, roughness: 0.9, flatShading: true })
    );
    grassRing.rotation.x = -Math.PI / 2;
    grassRing.position.y = 0.005;
    this.scene.add(grassRing);

    // Viền tối fade ra
    const fade = new THREE.Mesh(
      new THREE.RingGeometry(68, 82, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0a0505, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    fade.rotation.x = -Math.PI / 2;
    fade.position.y = 0.01;
    this.scene.add(fade);
  }

  private setupPaths(): void {
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x7a6040, roughness: 0.85 });

    const pathV = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 100), pathMat);
    pathV.rotation.x = -Math.PI / 2;
    pathV.position.set(0, 0.015, 10);
    pathV.receiveShadow = true;
    this.scene.add(pathV);

    const pathH = new THREE.Mesh(new THREE.PlaneGeometry(90, 3.5), pathMat);
    pathH.rotation.x = -Math.PI / 2;
    pathH.position.set(0, 0.015, 0);
    pathH.receiveShadow = true;
    this.scene.add(pathH);
  }

  private setupTrees(): void {
    const OUTER_TREES = [
      'CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5',
      'Pine_1', 'Pine_2', 'Pine_3',
    ];
    const MID_TREES   = ['DeadTree_1', 'DeadTree_2', 'DeadTree_3', 'CommonTree_1'];
    const CLONE_MODELS = [
      'Bush_Common', 'Bush_Common_Flowers', 'Fern_1',
      'Mushroom_Laetiporus', 'Plant_1', 'Plant_7',
      'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
    ];
    const INSTANCED_MODELS = [
      'Grass_Common_Short', 'Grass_Common_Tall',
      'Grass_Wispy_Short', 'Grass_Wispy_Tall',
      'Clover_1', 'Clover_2', 'Petal_1', 'Petal_2',
      'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Square_1',
      'Mushroom_Common', 'Flower_3_Group', 'Flower_4_Group',
    ];

    // Cây đỏ trung tâm
    const center = spawnModel(this.modelCache, 'TwistedTree_1', 0, 0, 0, 5.0, Math.PI * 0.15);
    if (center) this.scene.add(center);

    const companions: [string, number, number, number][] = [
      ['TwistedTree_3', -6,  3, 1.1],
      ['TwistedTree_5',  5, -4, 2.4],
      ['TwistedTree_2', -3, -6, 0.7],
    ];
    for (const [name, x, z, rot] of companions) {
      const t = spawnModel(this.modelCache, name, x, 0, z, 2.2, rot);
      if (t) this.scene.add(t);
    }

    // Outer ring — giảm 40 → 28
    for (const item of generateScatter(OUTER_TREES, 28, 42, 68, [1.2, 2.0], 100)) {
      const t = spawnModel(this.modelCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }

    // Mid ring — giảm 18 → 12
    for (const item of generateScatter(MID_TREES, 12, 18, 38, [1.0, 1.6], 200)) {
      const t = spawnModel(this.modelCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }

    // Clone scatter — giảm 40 → 20
    for (const item of generateScatter(CLONE_MODELS, 20, 7, 55, [0.5, 1.3], 400)) {
      const t = spawnModel(this.modelCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY, false);
      if (t) this.scene.add(t);
    }

    // InstancedMesh — giảm 90 → 60, 1 draw call/model
    const groundScatter = generateScatter(INSTANCED_MODELS, 60, 8, 65, [0.6, 1.2], 300);
    for (const name of INSTANCED_MODELS) {
      const src = this.modelCache.get(name);
      if (!src) continue;
      buildInstancedGroup(src, groundScatter, name).forEach((m) => this.scene.add(m));
    }
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
      this.portalMarkers.push({
        targetScene: def.targetScene,
        position: def.pos.clone(),
        radius: 2.5,
        mesh,
      });
    }
  }

  private setupParticles(): void {
    this.particleSystem = createLeafParticles(this.scene);
  }
      }
      
