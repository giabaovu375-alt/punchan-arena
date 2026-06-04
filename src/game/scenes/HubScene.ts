import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BaseScene } from './BaseScene';
import { eventBus } from '../core/EventBus';
import { GameEvents } from '../types/events';

// ─── Constants ───────────────────────────────────────────────────────────────
// Đường dẫn đúng từ thư mục public (bỏ 'public', mã hóa khoảng trắng)
const MODEL_BASE = '/model%20cây/glTF';
export const HUB_SPAWN = new THREE.Vector3(0, 0, 30);

// ─── Types ───────────────────────────────────────────────────────────────────
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
async function loadModels(loader: GLTFLoader, names: string[]): Promise<Map<string, THREE.Group>> {
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
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  (ctx as any).roundRect(4, 4, 248, 56, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
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

function addPathLights(scene: THREE.Scene, portalPos: THREE.Vector3, color: number): void {
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const light = new THREE.PointLight(color, 0.5, 8);
    light.position.set(portalPos.x * t, 1.2, portalPos.z * t);
    scene.add(light);
  }
}

function createLeafParticles(scene: THREE.Scene): LeafParticleSystem {
  const count = 120;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 10;
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = 2 + Math.random() * 14;
    positions[i * 3 + 2] = Math.sin(angle) * r;
    velocities[i * 3] = (Math.random() - 0.5) * 0.5;
    velocities[i * 3 + 1] = -(0.3 + Math.random() * 0.5);
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
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
    sys.positions[i * 3] += sys.velocities[i * 3] * dt;
    sys.positions[i * 3 + 1] += sys.velocities[i * 3 + 1] * dt;
    sys.positions[i * 3 + 2] += sys.velocities[i * 3 + 2] * dt;
    if (sys.positions[i * 3 + 1] < 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 10;
      sys.positions[i * 3] = Math.cos(angle) * r;
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

  // Cho phép GameEngine truyền scene vào (nếu BaseScene chưa có)
  public scene: THREE.Scene; // public để gán từ bên ngoài

  constructor() {
    super('HubScene');
    this.loader = new GLTFLoader();
    this.scene = new THREE.Scene(); // tạm tạo scene, GameEngine sẽ ghi đè
  }

  /**
   * Load scene - gọi khi scene được chuyển đến
   */
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
      eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: 'HubScene' });
    } catch (error) {
      console.error('Error loading HubScene:', error);
      throw error;
    }
  }

  /**
   * Unload scene - gọi khi chuyển sang scene khác
   */
  protected async onUnload(): Promise<void> {
    console.log('🌳 HubScene unloading...');
    this.modelCache.clear();
    this.portalMarkers = [];
    this.particleSystem = null;
  }

  /**
   * Update logic mỗi frame (được gọi từ BaseScene.update)
   */
  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;

    // Portal ring xoay
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0]) {
        marker.mesh.children[0].rotation.z += deltaTime * 0.4;
      }
    }

    // Warm glow pulse
    if (this.warmGlow) {
      this.warmGlow.intensity = 2.0 + Math.sin(this.elapsed * 1.2) * 0.5;
    }

    // Particles
    if (this.particleSystem) {
      tickLeafParticles(this.particleSystem, deltaTime);
    }
  }

  /**
   * Public method để GameEngine gọi update (tương thích với cách gọi hiện tại)
   */
  public update(deltaTime: number): void {
    // Gọi onUpdate thông qua BaseScene (nếu có) hoặc trực tiếp
    if (typeof (this as any).onUpdate === 'function') {
      (this as any).onUpdate(deltaTime);
    } else {
      this.onUpdate(deltaTime);
    }
  }

  /**
   * Kiểm tra xem player có đứng trong vùng portal không.
   * Trả về tên scene nếu có, ngược lại null.
   */
  public checkPortals(playerPos: THREE.Vector3): string | null {
    if (!this.portalMarkers || this.portalMarkers.length === 0) return null;
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < marker.radius) {
        return marker.targetScene;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Setup Methods
  // ─────────────────────────────────────────────────────────────────────────

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
      'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall',
      'Clover_1', 'Clover_2', 'Petal_1', 'Petal_2',
      'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Square_1', 'Pebble_Square_2',
      'Flower_3_Group', 'Flower_4_Group',
    ];

    const unique = [...new Set(allNames)];
    console.log(`📦 HubScene: loading ${unique.length} unique models...`);
    this.modelCache = await loadModels(this.loader, unique);
    console.log('✅ Models loaded!');
  }

  private setupLighting(): void {
    this.scene.fog = new THREE.FogExp2(0x1a1a0a, 0.018);
    this.scene.background = new THREE.Color(0x1a1a0a);

    this.scene.add(new THREE.HemisphereLight(0xff6a00, 0x0a0a05, 0.55));

    const moon = new THREE.DirectionalLight(0xc8d8ff, 0.5);
    moon.position.set(-30, 80, 20);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = moon.shadow.camera.bottom = -80;
    moon.shadow.camera.right = moon.shadow.camera.top = 80;
    moon.shadow.camera.far = 200;
    moon.shadow.bias = -0.0005;
    this.scene.add(moon);

    this.warmGlow = new THREE.PointLight(0xff4400, 2.5, 35);
    this.warmGlow.position.set(0, 6, 0);
    this.scene.add(this.warmGlow);

    const fillLight = new THREE.DirectionalLight(0xff8844, 0.3);
    fillLight.position.set(10, 20, -10);
    this.scene.add(fillLight);
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 72),
      new THREE.MeshStandardMaterial({
        color: 0x1e2a10,
        roughness: 0.98,
        flatShading: true,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(70, 82, 72),
      new THREE.MeshStandardMaterial({
        color: 0x0a0a05,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;
    this.scene.add(rim);
  }

  private setupPaths(): void {
    const pathMat = new THREE.MeshStandardMaterial({
      color: 0x5a4a30,
      roughness: 1,
    });

    const pathV = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 100), pathMat);
    pathV.rotation.x = -Math.PI / 2;
    pathV.position.set(0, 0.01, 10);
    pathV.receiveShadow = true;
    this.scene.add(pathV);

    const pathH = new THREE.Mesh(new THREE.PlaneGeometry(90, 3.5), pathMat);
    pathH.rotation.x = -Math.PI / 2;
    pathH.position.set(0, 0.01, 0);
    pathH.receiveShadow = true;
    this.scene.add(pathH);
  }

  private setupTrees(): void {
    const TWISTED = ['TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_5'];
    const OUTER_TREES = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'Pine_1', 'Pine_2', 'Pine_3'];
    const outerScatter = generateScatter(OUTER_TREES, 40, 40, 68, [1.2, 2.0], 100);
    const MID_TREES = ['DeadTree_1', 'DeadTree_2', 'DeadTree_3', 'CommonTree_1'];
    const midScatter = generateScatter(MID_TREES, 18, 18, 38, [1.0, 1.6], 200);
    const CLONE_MODELS = ['Bush_Common', 'Bush_Common_Flowers', 'Fern_1', 'Mushroom_Laetiporus', 'Plant_1', 'Plant_7', 'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3', 'Pebble_Round_3', 'Pebble_Square_2'];
    const cloneScatter = generateScatter(CLONE_MODELS, 40, 6, 55, [0.5, 1.3], 400);

    const centerTree = spawnModel(this.modelCache, 'TwistedTree_1', 0, 0, 0, 5.0, Math.PI * 0.15);
    if (centerTree) this.scene.add(centerTree);

    const companions: [string, number, number, number, number][] = [
      ['TwistedTree_3', -6, 0, 3, 1.1],
      ['TwistedTree_5', 5, 0, -4, 2.4],
      ['TwistedTree_2', -3, 0, -6, 0.7],
    ];
    for (const [name, x, y, z, rot] of companions) {
      const t = spawnModel(this.modelCache, name, x, y, z, 2.2, rot);
      if (t) this.scene.add(t);
    }

    for (const item of outerScatter) {
      const t = spawnModel(this.modelCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }
    for (const item of midScatter) {
      const t = spawnModel(this.modelCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY);
      if (t) this.scene.add(t);
    }
    for (const item of cloneScatter) {
      const t = spawnModel(this.modelCache, item.modelName, item.x, 0, item.z, item.scale, item.rotY, false);
      if (t) this.scene.add(t);
    }
  }

  private setupPortals(): void {
    const PORTAL_DEFS = [
      { targetScene: 'MainRoadScene', pos: new THREE.Vector3(0, 0, -30), color: 0x00aaff, label: 'Đường Chính' },
      { targetScene: 'LeftForestScene', pos: new THREE.Vector3(-40, 0, 0), color: 0x00ff88, label: 'Rừng Mật' },
      { targetScene: 'RightPlatformScene', pos: new THREE.Vector3(40, 0, 0), color: 0xffaa00, label: 'Khu Đá' },
      { targetScene: 'BossScene', pos: new THREE.Vector3(0, 0, 50), color: 0xff2200, label: 'Boss Arena' },
    ];

    this.portalMarkers = []; // đảm bảo khởi tạo

    for (const def of PORTAL_DEFS) {
      const mesh = createPortalMesh(def.color, def.label);
      mesh.position.copy(def.pos);
      this.scene.add(mesh);
      addPathLights(this.scene, def.pos, def.color);

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
