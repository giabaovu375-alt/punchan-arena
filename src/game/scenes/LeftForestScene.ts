import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { MODEL_BASE, PROP_BASE } from "../config/models";

const CFG = {
  FOG_COLOR:         0x050e08,
  FOG_DENSITY:       0.022,
  SKY_COLOR:         0x03080a,
  AMBIENT_COLOR:     0x0d2218,
  AMBIENT_INTENSITY: 0.6,
  MOON_COLOR:        0x8ecfdf,
  MOON_INTENSITY:    0.7,
  RIM_COLOR:         0x1a4060,
  RIM_INTENSITY:     0.3,
  GROUND_COLOR:      0x0c1509,
  GROUND_MOSS_COLOR: 0x1a2e10,
  PORTAL_COLOR:      0x00ff88,
  PORTAL_POS:        new THREE.Vector3(30, 0, 10),
  PORTAL_TRIGGER:    4,
  WISP_COLOR:        0x33ff99,
  WISP_INTENSITY:    2.2,
  WISP_DISTANCE:     14,
  SPORE_COUNT:       300,
  MIST_COUNT:        120,
  LEAF_COUNT:        180,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Trả về true nếu điểm (x,z) nằm trong vùng "path" giữa map — để clear đường đi */
function inClearPath(x: number, z: number): boolean {
  // Path chính: thẳng từ portal (30,10) về hub spawn (0,0,-30)
  // Approximate bằng corridor rộng ~8 units dọc trục Z
  const onMainPath = Math.abs(x - 5) < 8 && z > -35 && z < 35;
  // Vùng sát portal
  const nearPortal = Math.hypot(x - CFG.PORTAL_POS.x, z - CFG.PORTAL_POS.z) < 7;
  return onMainPath || nearPortal;
}

/** Sinh điểm trong vòng annulus (ring) xung quanh center */
function annulusPoint(cx: number, cz: number, rMin: number, rMax: number): [number, number] {
  const angle = Math.random() * Math.PI * 2;
  const r     = rMin + Math.random() * (rMax - rMin);
  return [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r];
}

// ─────────────────────────────────────────────────────────────────────────────
export class LeftForestScene extends BaseScene {
  public  scene: THREE.Scene;
  private enemyManager!:  EnemyManager;
  private playerRef!:     THREE.Object3D;
  private cameraRef!:     THREE.Camera;
  private elapsed = 0;

  private portalGroup!:      THREE.Group;
  private portalRing!:       THREE.Mesh;
  private portalInnerRing!:  THREE.Mesh;
  private portalDisk!:       THREE.Mesh;
  private portalLight!:      THREE.PointLight;
  private portalParticles!:  THREE.Points;

  private wisps: { light: THREE.PointLight; phase: number; pos: THREE.Vector3; orb: THREE.Mesh; halo: THREE.Mesh }[] = [];
  private sporeParticles!: THREE.Points;
  private mistParticles!:  THREE.Points;
  private leafParticles!:  THREE.Points;
  private leafVelocities!: Float32Array;

  private disposables:    THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[]       = [];

  private loader = new GLTFLoader();

  constructor() { super("LeftForestScene"); this.scene = new THREE.Scene(); }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildWisps();
    this._buildPortal();
    this._buildMist();
    this._buildLeaves();
    this._buildSpores();
    this._buildGodRays();
    await this._loadModels();
    this._spawnEnemies();
    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateWisps(dt);
    this._animatePortal(dt);
    this._animateSpores(dt);
    this._animateMist(dt);
    this._animateLeaves(dt);
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
    this.disposables.forEach(g => g.dispose());
    this.disposableMats.forEach(m => m.dispose());
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    const dx = playerPos.x - CFG.PORTAL_POS.x;
    const dz = playerPos.z - CFG.PORTAL_POS.z;
    return (dx * dx + dz * dz) < CFG.PORTAL_TRIGGER * CFG.PORTAL_TRIGGER ? "HubScene" : null;
  }

  // ─── Atmosphere ────────────────────────────────────────────────────────────
  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.FOG_DENSITY);
    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));
    const moon = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    moon.position.set(40, 80, 30); moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -80; moon.shadow.camera.right  =  80;
    moon.shadow.camera.top  =  80; moon.shadow.camera.bottom = -80;
    moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.02;
    this.scene.add(moon);
    const rim = new THREE.DirectionalLight(CFG.RIM_COLOR, CFG.RIM_INTENSITY);
    rim.position.set(-40, 30, -40); this.scene.add(rim);
  }

  // ─── Terrain ───────────────────────────────────────────────────────────────
  private _buildTerrain(): void {
    const geo = new THREE.PlaneGeometry(160, 160, 60, 60);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getY(i);
      pos.setZ(i,
        Math.sin(x * 0.08) * 0.4 + Math.cos(z * 0.11) * 0.3 +
        Math.sin(x * 0.2 + z * 0.15) * 0.15 + (Math.random() - 0.5) * 0.12
      );
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: CFG.GROUND_COLOR, roughness: 0.98 });
    this.disposables.push(geo); this.disposableMats.push(mat);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);

    // Moss patches — dọc theo path để trông như đường mòn
    const mossMat = new THREE.MeshStandardMaterial({
      color: CFG.GROUND_MOSS_COLOR, roughness: 1.0, transparent: true, opacity: 0.7, depthWrite: false,
    });
    this.disposableMats.push(mossMat);
    // Path moss — dọc trục đi
    for (let z = -30; z < 30; z += 5) {
      const mossGeo = new THREE.PlaneGeometry(3 + Math.random() * 4, 2 + Math.random() * 3);
      this.disposables.push(mossGeo);
      const patch = new THREE.Mesh(mossGeo, mossMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set((Math.random() - 0.5) * 6, 0.01, z + (Math.random() - 0.5) * 3);
      patch.rotation.z = Math.random() * Math.PI;
      this.scene.add(patch);
    }
    // Scattered moss ngoài rìa
    for (let i = 0; i < 20; i++) {
      const mossGeo = new THREE.PlaneGeometry(2 + Math.random() * 5, 1.5 + Math.random() * 4);
      this.disposables.push(mossGeo);
      const patch = new THREE.Mesh(mossGeo, mossMat);
      patch.rotation.x = -Math.PI / 2;
      const angle = Math.random() * Math.PI * 2;
      const r     = 20 + Math.random() * 50;
      patch.position.set(Math.cos(angle) * r, 0.01, Math.sin(angle) * r);
      patch.rotation.z = Math.random() * Math.PI;
      this.scene.add(patch);
    }
  }

  // ─── Wisps ─────────────────────────────────────────────────────────────────
  private _buildWisps(): void {
    // Đặt wisps dọc path — dẫn đường cho player
    const positions = [
      new THREE.Vector3( -8, 1.5, -20),
      new THREE.Vector3(  4, 2.0,  -5),
      new THREE.Vector3( 12, 1.8,  10),
      new THREE.Vector3( 22, 1.4,  12),  // gần portal
      new THREE.Vector3(-25, 1.2,  20),  // deep forest
    ];
    const orbMat = new THREE.MeshStandardMaterial({
      color: CFG.WISP_COLOR, emissive: new THREE.Color(CFG.WISP_COLOR),
      emissiveIntensity: 3.0, transparent: true, opacity: 0.9,
    });
    const haloMat = new THREE.MeshStandardMaterial({
      color: CFG.WISP_COLOR, emissive: new THREE.Color(CFG.WISP_COLOR),
      emissiveIntensity: 0.5, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide,
    });
    this.disposableMats.push(orbMat, haloMat);
    positions.forEach((pos, i) => {
      const light = new THREE.PointLight(CFG.WISP_COLOR, CFG.WISP_INTENSITY, CFG.WISP_DISTANCE);
      light.position.copy(pos); this.scene.add(light);
      const orbGeo = new THREE.SphereGeometry(0.1, 8, 8); this.disposables.push(orbGeo);
      const orb = new THREE.Mesh(orbGeo, orbMat); orb.position.copy(pos); this.scene.add(orb);
      const haloGeo = new THREE.SphereGeometry(0.35, 10, 10); this.disposables.push(haloGeo);
      const halo = new THREE.Mesh(haloGeo, haloMat); halo.position.copy(pos); this.scene.add(halo);
      this.wisps.push({ light, phase: i * 1.57, pos: pos.clone(), orb, halo });
    });
  }

  // ─── Portal ────────────────────────────────────────────────────────────────
  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();
    const outerGeo = new THREE.TorusGeometry(2.3, 0.14, 20, 80); this.disposables.push(outerGeo);
    const outerMat = new THREE.MeshStandardMaterial({
      color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.8,
    }); this.disposableMats.push(outerMat);
    this.portalRing = new THREE.Mesh(outerGeo, outerMat);
    this.portalRing.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalRing);

    const innerGeo = new THREE.TorusGeometry(1.8, 0.06, 12, 60); this.disposables.push(innerGeo);
    const innerMat = new THREE.MeshStandardMaterial({
      color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 2.0, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.7,
    }); this.disposableMats.push(innerMat);
    this.portalInnerRing = new THREE.Mesh(innerGeo, innerMat);
    this.portalInnerRing.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalInnerRing);

    const diskGeo = new THREE.CircleGeometry(2.2, 80); this.disposables.push(diskGeo);
    const diskMat = new THREE.MeshStandardMaterial({
      color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 0.25, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false,
    }); this.disposableMats.push(diskMat);
    this.portalDisk = new THREE.Mesh(diskGeo, diskMat);
    this.portalDisk.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalDisk);

    const pCount = 80; const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const a = (i / pCount) * Math.PI * 2, r = 2.3 + (Math.random() - 0.5) * 0.4;
      pPos[i * 3] = Math.cos(a) * r; pPos[i * 3 + 1] = 0; pPos[i * 3 + 2] = Math.sin(a) * r;
    }
    const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    this.disposables.push(pGeo);
    const pMat = new THREE.PointsMaterial({ color: CFG.PORTAL_COLOR, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false });
    this.disposableMats.push(pMat);
    this.portalParticles = new THREE.Points(pGeo, pMat);
    this.portalParticles.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalParticles);

    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 4.0, 22); this.portalLight.position.y = 0.5;
    this.portalGroup.add(this.portalLight);
    const groundGlow = new THREE.PointLight(CFG.PORTAL_COLOR, 1.2, 8); groundGlow.position.y = -3;
    this.portalGroup.add(groundGlow);

    this.portalGroup.position.copy(CFG.PORTAL_POS).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(this.portalGroup);
  }

  // ─── Particles ─────────────────────────────────────────────────────────────
  private _buildMist(): void {
    const pos = new Float32Array(CFG.MIST_COUNT * 3);
    for (let i = 0; i < CFG.MIST_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 1.2; pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({ color: 0x0a2015, size: 3.5, transparent: true, opacity: 0.12, depthWrite: false, sizeAttenuation: true });
    this.disposableMats.push(mat); this.mistParticles = new THREE.Points(geo, mat); this.scene.add(this.mistParticles);
  }

  private _buildLeaves(): void {
    const pos = new Float32Array(CFG.LEAF_COUNT * 3);
    this.leafVelocities = new Float32Array(CFG.LEAF_COUNT * 3);
    for (let i = 0; i < CFG.LEAF_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 18; pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      this.leafVelocities[i * 3] = (Math.random() - 0.5) * 0.3; this.leafVelocities[i * 3 + 1] = -(0.3 + Math.random() * 0.4); this.leafVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({ color: 0x2d5e1e, size: 0.14, transparent: true, opacity: 0.65, depthWrite: false });
    this.disposableMats.push(mat); this.leafParticles = new THREE.Points(geo, mat); this.scene.add(this.leafParticles);
  }

  private _buildSpores(): void {
    const pos = new Float32Array(CFG.SPORE_COUNT * 3);
    for (let i = 0; i < CFG.SPORE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 5; pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({ color: 0x77ffbb, size: 0.08, transparent: true, opacity: 0.55, depthWrite: false });
    this.disposableMats.push(mat); this.sporeParticles = new THREE.Points(geo, mat); this.scene.add(this.sporeParticles);
  }

  private _buildGodRays(): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a4a25, emissive: new THREE.Color(0x0a2a15), emissiveIntensity: 0.4,
      transparent: true, opacity: 0.04, depthWrite: false,
    }); this.disposableMats.push(mat);
    [{ x: -18, z: -12 }, { x: 5, z: 20 }, { x: 20, z: -25 }, { x: -8, z: 8 }, { x: -28, z: 30 }]
      .forEach(({ x, z }) => {
        const h = 14 + Math.random() * 6;
        const geo = new THREE.CylinderGeometry(0.05, 1.6 + Math.random(), h, 8, 1, true);
        this.disposables.push(geo);
        const ray = new THREE.Mesh(geo, mat.clone()); // clone để dispose độc lập
        ray.position.set(x, h / 2, z);
        ray.rotation.z = (Math.random() - 0.5) * 0.15;
        this.scene.add(ray);
      });
  }

  // ─── Models — CLUSTERED PLACEMENT ─────────────────────────────────────────
  private async _loadModels(): Promise<void> {
    const gltfLoad = (name: string, base = MODEL_BASE) =>
      new Promise<THREE.Group>((res, rej) =>
        this.loader.load(`${base}/${name}.gltf`, g => res(g.scene), undefined, rej)
      );
    const propLoad = (path: string) =>
      new Promise<THREE.Group>((res, rej) =>
        this.loader.load(path, g => res(g.scene), undefined, rej)
      );

    const nightify = (g: THREE.Group, s = 0.4, tint = new THREE.Color(0.6, 1.0, 0.7)) =>
      g.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(s).multiply(tint);
          if (mat.emissiveIntensity) mat.emissiveIntensity *= 0.2;
          m.material = mat;
        }
      });
    const shadow = (g: THREE.Group) =>
      g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    // ── 1. TƯỜNG RỪNG — cây cao bao quanh rìa map ────────────────────────────
    // Không random thuần: đặt theo vòng tròn ngoài + lấp đầy gaps
    const outerTreeNames = ["CommonTree_1", "CommonTree_2", "Pine_1", "Pine_2", "TwistedTree_1", "TwistedTree_2"];
    const outerTreeModels = await Promise.all(
      outerTreeNames.map(n => gltfLoad(n).catch(() => null))
    );

    // Vòng ngoài: 24 cây cách đều nhau ở r=55-65, không che path
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const r     = 55 + Math.random() * 10;
      const x     = Math.cos(angle) * r, z = Math.sin(angle) * r;
      if (inClearPath(x, z)) continue;
      const src = outerTreeModels[i % outerTreeModels.length];
      if (!src) continue;
      const t = src.clone(); shadow(t); nightify(t, 0.35);
      t.position.set(x, 0, z);
      t.scale.setScalar(1.8 + Math.random() * 0.8);
      t.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(t);
    }

    // ── 2. CLUSTER CÂY GIỮA — tạo cụm dày, không đều ────────────────────────
    // 6 điểm anchor cố định, mỗi điểm spawn cụm 4-6 cây
    const midTreeNames  = ["DeadTree_1", "DeadTree_2", "TwistedTree_3", "CommonTree_3"];
    const midTreeModels = await Promise.all(midTreeNames.map(n => gltfLoad(n).catch(() => null)));

    const clusterAnchors = [
      { x: -30, z: -25 }, { x: -20, z:  15 }, { x:  15, z: -30 },
      { x: -35, z:  30 }, { x:  25, z:  25 }, { x: -10, z: -40 },
    ];
    for (const anchor of clusterAnchors) {
      const count = 4 + Math.floor(Math.random() * 3);
      for (let j = 0; j < count; j++) {
        const [x, z] = annulusPoint(anchor.x, anchor.z, 1.5, 7);
        if (inClearPath(x, z)) continue;
        const src = midTreeModels[j % midTreeModels.length];
        if (!src) continue;
        const t = src.clone(); shadow(t); nightify(t, 0.38, new THREE.Color(0.55, 0.9, 0.65));
        t.position.set(x, 0, z);
        t.scale.setScalar(1.2 + Math.random() * 0.6);
        t.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(t);
      }
    }

    // ── 3. UNDERGROWTH — bush/fern/mushroom theo cụm dưới cây ────────────────
    const groundNames  = ["Bush_Common", "Fern_1", "Mushroom_Common", "Mushroom_Laetiporus", "Plant_1"];
    const groundModels = await Promise.all(groundNames.map(n => gltfLoad(n).catch(() => null)));

    // Đặt undergrowth gần mỗi cluster anchor → trông tự nhiên
    for (const anchor of clusterAnchors) {
      const count = 6 + Math.floor(Math.random() * 5);
      for (let j = 0; j < count; j++) {
        const [x, z] = annulusPoint(anchor.x, anchor.z, 0.5, 9);
        if (inClearPath(x, z)) continue;
        const src = groundModels[j % groundModels.length];
        if (!src) continue;
        const g = src.clone(); shadow(g); nightify(g, 0.5, new THREE.Color(0.6, 1.0, 0.7));
        g.position.set(x, 0, z);
        g.scale.setScalar(0.8 + Math.random() * 0.5);
        g.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(g);
      }
    }

    // ── 4. ĐÁ VEN PATH — tạo cảm giác đường mòn tự nhiên ────────────────────
    const rockNames  = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
    const pebNames   = ["Pebble_Round_1", "Pebble_Round_2", "Pebble_Square_1"];
    const rockModels = await Promise.all([...rockNames, ...pebNames].map(n => gltfLoad(n).catch(() => null)));

    // Dọc path chính — đặt 2 bên
    for (let z = -28; z < 25; z += 6) {
      for (const sideX of [-6 - Math.random() * 4, 6 + Math.random() * 4]) {
        const src = rockModels[Math.floor(Math.random() * rockModels.length)];
        if (!src) continue;
        const r = src.clone(); shadow(r); nightify(r, 0.3, new THREE.Color(0.7, 0.85, 0.8));
        r.position.set(sideX, 0, z + (Math.random() - 0.5) * 3);
        r.scale.setScalar(0.4 + Math.random() * 0.6);
        r.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(r);
      }
    }

    // ── 5. FOCAL POINTS — điểm nhấn handcrafted ──────────────────────────────
    // Đống sọ deep forest — tạo mystery
    propLoad(`${PROP_BASE}/pile_of_skulls.glb`).then(skulls => {
      shadow(skulls); nightify(skulls, 0.45, new THREE.Color(0.8, 0.75, 0.7));
      // Đặt 2 cụm sọ ở hai góc rừng sâu, không trên path
      [{ x: -28, z: 22 }, { x: -18, z: -32 }].forEach(({ x, z }) => {
        const s = skulls.clone();
        s.position.set(x, 0, z);
        s.scale.setScalar(1.5);
        s.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(s);
      });
    }).catch(() => {});

    // Hàng rào mục — dẫn hướng player vào rừng
    propLoad(`${PROP_BASE}/stylized_fence.glb`).then(fence => {
      shadow(fence); nightify(fence, 0.4, new THREE.Color(0.7, 0.65, 0.55));
      // Hàng rào dọc trái path, 5 đoạn
      for (let i = 0; i < 5; i++) {
        const f = fence.clone();
        f.position.set(-9 + (Math.random() - 0.5) * 1.5, 0, -20 + i * 10 + (Math.random() - 0.5) * 2);
        f.scale.setScalar(1.2);
        f.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.15;
        this.scene.add(f);
      }
    }).catch(() => {});

    // Statue gần portal — landmark rõ ràng
    propLoad(`${PROP_BASE}/bo_ba_nam.glb`).then(statue => {
      shadow(statue); nightify(statue, 0.4, new THREE.Color(0.6, 0.9, 0.75));
      statue.position.set(CFG.PORTAL_POS.x - 4, 0, CFG.PORTAL_POS.z + 2);
      statue.scale.setScalar(3.0); statue.rotation.y = Math.PI * 0.3;
      this.scene.add(statue);
    }).catch(() => {});

    // Big stone — landmark giữa rừng
    propLoad(`${PROP_BASE}/Big-stone.glb`).then(stone => {
      shadow(stone); nightify(stone, 0.3, new THREE.Color(0.7, 0.85, 0.8));
      stone.position.set(-22, 0, -5); stone.scale.setScalar(2.5); stone.rotation.y = 0.8;
      this.scene.add(stone);
    }).catch(() => {});

    // ── 6. GROUND COVER dọc path — cỏ + hoa thưa ────────────────────────────
    const grassNames  = ["Grass_Common_Short", "Grass_Wispy_Short", "Clover_1", "Petal_1"];
    const grassModels = await Promise.all(grassNames.map(n => gltfLoad(n).catch(() => null)));
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = 3 + Math.random() * 45;
      const x     = Math.cos(angle) * r, z = Math.sin(angle) * r;
      const src   = grassModels[i % grassModels.length];
      if (!src) continue;
      const g = src.clone();
      g.position.set(x, 0, z);
      g.scale.setScalar(0.7 + Math.random() * 0.5);
      g.rotation.y = Math.random() * Math.PI * 2;
      nightify(g, 0.5, new THREE.Color(0.65, 1.0, 0.7));
      this.scene.add(g);
    }
  }

  // ─── Enemies ───────────────────────────────────────────────────────────────
  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(15, 0, 10), new THREE.Vector3(-10, 0, 18), new THREE.Vector3(22, 0, -15)],
      { ...GOBLIN_CONFIG, scale: 1.0, chaseRange: 20, patrolRadius: 5 }
    );
  }

  // ─── Animators ─────────────────────────────────────────────────────────────
  private _animateWisps(dt: number): void {
    this.wisps.forEach(w => {
      w.phase += dt * 1.1;
      const p = new THREE.Vector3(
        w.pos.x + Math.sin(w.phase * 0.6) * 1.5 + Math.sin(w.phase * 1.3) * 0.4,
        w.pos.y + Math.sin(w.phase) * 0.6,
        w.pos.z + Math.cos(w.phase * 0.5) * 1.2
      );
      w.light.position.copy(p); w.orb.position.copy(p); w.halo.position.copy(p);
      w.light.intensity = CFG.WISP_INTENSITY * (0.8 + Math.sin(w.phase * 2.3) * 0.28);
      w.orb.scale.setScalar(0.9 + Math.sin(w.phase * 3.1) * 0.15);
      w.halo.scale.setScalar(1.0 + Math.sin(w.phase * 1.8) * 0.25);
      (w.halo.material as THREE.MeshStandardMaterial).opacity = 0.12 + Math.sin(w.phase * 2.0) * 0.07;
    });
  }

  private _animatePortal(dt: number): void {
    this.portalRing.rotation.z      += dt * 0.4;
    this.portalInnerRing.rotation.z -= dt * 0.7;
    const diskMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    diskMat.opacity        = 0.14 + Math.sin(this.elapsed * 2.5) * 0.09;
    diskMat.emissiveIntensity = 0.2 + Math.sin(this.elapsed * 1.8) * 0.12;
    this.portalLight.intensity = 3.5 + Math.sin(this.elapsed * 3.2) * 1.0;
    this.portalParticles.rotation.z += dt * 0.2;
    this.portalGroup.position.y = CFG.PORTAL_POS.y + 4 + Math.sin(this.elapsed * 0.8) * 0.12;
  }

  private _animateSpores(dt: number): void {
    const pos = this.sporeParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.06; if (y > 5.5) y = 0; pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(this.elapsed * 0.7 + i * 0.3) * dt * 0.05);
    }
    pos.needsUpdate = true;
  }

  private _animateMist(dt: number): void {
    const pos = this.mistParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + Math.sin(this.elapsed * 0.3 + i * 0.7) * dt * 0.08);
      pos.setZ(i, pos.getZ(i) + Math.cos(this.elapsed * 0.2 + i * 0.5) * dt * 0.06);
    }
    pos.needsUpdate = true;
  }

  private _animateLeaves(dt: number): void {
    const pos = this.leafParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + (this.leafVelocities[i * 3]     + Math.sin(this.elapsed + i) * 0.04) * dt;
      let y = pos.getY(i) +  this.leafVelocities[i * 3 + 1] * dt;
      let z = pos.getZ(i) + (this.leafVelocities[i * 3 + 2] + Math.cos(this.elapsed * 0.8 + i) * 0.03) * dt;
      if (y < 0) { y = 15 + Math.random() * 5; x = (Math.random() - 0.5) * 120; z = (Math.random() - 0.5) * 120; }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
}
