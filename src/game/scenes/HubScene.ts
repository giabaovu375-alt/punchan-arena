import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BaseScene } from './BaseScene';
import { eventBus } from '../core/EventBus';
import { GameEvents } from '../types/events';

// ─── Constants ───────────────────────────────────────────────────────────────
const MODEL_BASE = '/model-tree'; // Thư mục thực tế trong public
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
              resolve();
            }
          );
        })
    )
  );

  return cache;
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

/**
 * Tạo InstancedMesh từ một model gốc và danh sách ScatterItem.
 * Trả về mảng InstancedMesh (mỗi mesh con một InstancedMesh).
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
    const light = new THREE.PointLight(color, 0.4, 6);
    light.position.set(portalPos.x * t, 1.0, portalPos.z * t);
    scene.add(light);
  }
}

function createLeafParticles(scene: THREE.Scene): LeafParticleSystem {
  const count = 100;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 8;
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = 2 + Math.random() * 12;
    positions[i * 3 + 2] = Math.sin(angle) * r;
    velocities[i * 3] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 1] = -(0.2 + Math.random() * 0.4);
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffaa33,   // màu lá mùa thu
    size: 0.15,
    transparent: true,
    opacity: 0.7,
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
      const r = 3 + Math.random() * 8;
      sys.positions[i * 3] = Math.cos(angle) * r;
      sys.positions[i * 3 + 1] = 2 + Math.random() * 12;
      sys.positions[i * 3 + 2] = Math.sin(angle) * r;
    }
  }
  (sys.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

// ─── Main HubScene Class ─────────────────────────────────────────────────────
export class HubScene extends BaseScene {
  private loader: GLTFLoader;
  private modelCache: Map<string, THREE.Group> = new Map();
  private portalMarkers: PortalMarker[] = [];
  private particleSystem: LeafParticleSystem | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private elapsed = 0;

  public scene: THREE.Scene; // public để GameEngine gán

  constructor() {
    super('HubScene');
    this.loader = new GLTFLoader();
    this.scene = new THREE.Scene();
  }

  protected async onLoad(): Promise<void> {
    console.log('🌅 HubScene loading...');

    try {
      await this.loadAllModels();
      this.setupLighting();
      this.setupGround();
      this.setupPaths();
      this.setupTrees();
      this.setupPortals();
      this.setupParticles();

      console.log('✅ HubScene loaded (sunset edition)!');
      eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: 'HubScene' });
    } catch (error) {
      console.error('Error loading HubScene:', error);
      throw error;
    }
  }

  protected async onUnload(): Promise<void> {
    console.log('🌅 HubScene unloading...');
    this.modelCache.clear();
    this.portalMarkers = [];
    this.particleSystem = null;
  }

  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;

    // Portal ring xoay
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0]) {
        marker.mesh.children[0].rotation.z += deltaTime * 0.3;
      }
    }

    // Particles
    if (this.particleSystem) {
      tickLeafParticles(this.particleSystem, deltaTime);
    }
  }

  public update(deltaTime: number): void {
    if (typeof (this as any).onUpdate === 'function') {
      (this as any).onUpdate(deltaTime);
    } else {
      this.onUpdate(deltaTime);
    }
  }

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

  // ── Private setup methods ─────────────────────────────────────────────────
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
      'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3',
      'Pebble_Square_1', 'Pebble_Square_2',
      'Flower_3_Group', 'Flower_4_Group',
    ];

    const unique = [...new Set(allNames)];
    console.log(`📦 HubScene: loading ${unique.length} unique models...`);
    this.modelCache = await loadModels(this.loader, unique);
    console.log('✅ Models loaded!');
  }

  private setupLighting(): void {
    // Hoàng hôn: bầu trời hồng cam, fog ấm
    this.scene.background = new THREE.Color(0x2d1b2e); // tím đậm
    this.scene.fog = new THREE.FogExp2(0x2d1b2e, 0.025);

    // Ánh sáng môi trường nhẹ, tông tím
    this.scene.add(new THREE.HemisphereLight(0xff9966, 0x1a0033, 0.7));

    // Mặt trời lặn (cam mạnh)
    this.sunLight = new THREE.DirectionalLight(0xff6633, 1.4);
    this.sunLight.position.set(-60, 25, 40);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.left = -70;
    this.sunLight.shadow.camera.right = 70;
    this.sunLight.shadow.camera.top = 70;
    this.sunLight.shadow.camera.bottom = -70;
    this.sunLight.shadow.camera.far = 200;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Ánh sáng phụ (fill) hồng nhạt
    const fillLight = new THREE.DirectionalLight(0xff8899, 0.5);
    fillLight.position.set(30, 10, -50);
    this.scene.add(fillLight);

    // Không dùng PointLight ở gốc cây nữa, để dành hiệu năng
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 64),
      new THREE.MeshStandardMaterial({
        color: 0x3d2b1f,
        roughness: 0.95,
        flatShading: true,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(70, 82, 64),
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
      color: 0x4a3a2a,
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
    // Giảm số lượng đáng kể để tối ưu
    const OUTER_TREES = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'Pine_1', 'Pine_2'];
    const outerScatter = generateScatter(OUTER_TREES, 25, 40, 68, [1.2, 2.0], 100);

    const MID_TREES = ['DeadTree_1', 'DeadTree_2', 'CommonTree_1'];
    const midScatter = generateScatter(MID_TREES, 10, 18, 38, [1.0, 1.6], 200);

    const GROUND_ITEMS = ['Bush_Common', 'Fern_1', 'Mushroom_Laetiporus', 'Plant_1', 'Rock_Medium_1', 'Rock_Medium_2'];
    const groundScatter = generateScatter(GROUND_ITEMS, 30, 6, 55, [0.5, 1.2], 400);

    // Cây đỏ trung tâm (dùng InstancedMesh 1 instance)
    const twistedScatter = generateScatter(['TwistedTree_1'], 1, 0, 0, [5.0, 5.0], 0);
    // Đặt lại thủ công cho đẹp
    twistedScatter[0].x = 0; twistedScatter[0].z = 0;

    // Hàm nhỏ dùng InstancedMesh cho từng loại cây
    const addInstanced = (items: ScatterItem[], castShadow: boolean) => {
      const modelNames = [...new Set(items.map(i => i.modelName))];
      for (const name of modelNames) {
        const src = this.modelCache.get(name);
        if (!src) continue;
        const meshes = buildInstancedGroup(src, items, name, castShadow);
        meshes.forEach(m => this.scene.add(m));
      }
    };

    // Thêm vào scene
    addInstanced(outerScatter, true);
    addInstanced(midScatter, true);
    addInstanced(groundScatter, false); // không đổ bóng cho bụi cỏ

    // Cây đỏ trung tâm (InstancedMesh)
    addInstanced(twistedScatter, true);

    // Các cây TwistedTree phụ
    const companions: { name: string; x: number; z: number; scale: number; rotY: number }[] = [
      { name: 'TwistedTree_3', x: -6, z: 3, scale: 2.8, rotY: 1.1 },
      { name: 'TwistedTree_5', x: 5, z: -4, scale: 2.2, rotY: 2.4 },
      { name: 'TwistedTree_2', x: -3, z: -6, scale: 1.8, rotY: 0.7 },
    ];

    const compItems: ScatterItem[] = companions.map(c => ({
      modelName: c.name,
      x: c.x,
      z: c.z,
      scale: c.scale,
      rotY: c.rotY,
    }));

    addInstanced(compItems, true);
  }

  private setupPortals(): void {
    const PORTAL_DEFS = [
      { targetScene: 'MainRoadScene', pos: new THREE.Vector3(0, 0, -30), color: 0xff6600, label: 'Đường Chính' },
      { targetScene: 'LeftForestScene', pos: new THREE.Vector3(-40, 0, 0), color: 0xcc44cc, label: 'Rừng Mật' },
      { targetScene: 'RightPlatformScene', pos: new THREE.Vector3(40, 0, 0), color: 0x44aacc, label: 'Khu Đá' },
      { targetScene: 'BossScene', pos: new THREE.Vector3(0, 0, 50), color: 0xff3333, label: 'Boss Arena' },
    ];

    this.portalMarkers = [];

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
