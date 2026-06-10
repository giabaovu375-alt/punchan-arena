import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { MODEL_BASE, PROP_BASE } from "../config/models";

const CFG = {
  FOG_COLOR: 0x080510,
  SKY_COLOR: 0x050310,
  FOG_DENSITY: 0.018, // Giảm nhẹ để nhìn xa hơn chút khi model đã to ra
  AMBIENT_COLOR: 0x1a0d2e,
  AMBIENT_INTENSITY: 0.6, // Tăng nhẹ ambient để model lớn không bị chết bóng
  MOON_COLOR: 0x9ab8e8,
  MOON_INTENSITY: 0.85,
  GROUND_COLOR: 0x100c14,
  PLATFORM_COLOR: 0x1a1020,
  CRYSTAL_COLOR: 0xff44cc,
  CRYSTAL_EMISSIVE: 1.2,
  CRYSTAL_LIGHT_COLOR: 0xff44cc,
  CRYSTAL_LIGHT_INTENSITY: 3.5,
  CRYSTAL_LIGHT_DISTANCE: 35,
  PORTAL_COLOR: 0xffaa00,
  PORTAL_POS: new THREE.Vector3(30, 0, 0),
  PORTAL_TRIGGER: 3.5,
  RUNE_COLOR: 0x7733ff,
  RUNE_INTENSITY: 1.6,
  RUNE_DISTANCE: 12,
  DUST_COUNT: 400, // Tăng số lượng particle cho map lớn
  CRYSTAL_PART_COUNT: 200,
  EMBER_COUNT: 150,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function inPortalClear(x: number, z: number): boolean {
  return (
    Math.hypot(x - CFG.PORTAL_POS.x, z - CFG.PORTAL_POS.z) < 8 ||
    Math.hypot(x, z) < 12
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export class RightPlatformScene extends BaseScene {
  public scene: THREE.Scene;
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;  private crystalMesh!: THREE.Group;
  private crystalClusterMesh!: THREE.Group;
  private crystalLight!: THREE.PointLight;
  private clusterLight!: THREE.PointLight;
  private portalGroup!: THREE.Group;
  private portalRing!: THREE.Mesh;
  private portalInnerRing!: THREE.Mesh;
  private portalDisk!: THREE.Mesh;
  private portalLight!: THREE.PointLight;
  private portalParticles!: THREE.Points;
  private runes: { light: THREE.PointLight; stone: THREE.Mesh; glowPlane: THREE.Mesh; phase: number }[] = [];
  private floatingRocks: { mesh: THREE.Mesh; baseY: number; phase: number; rotSpeed: THREE.Vector3 }[] = [];
  private dustParticles!: THREE.Points;
  private crystalParticles!: THREE.Points;
  private emberParticles!: THREE.Points;
  private lightningLight!: THREE.PointLight;
  private nextLightning = 0;
  private disposables: THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[] = [];
  private loader = new GLTFLoader();

  constructor() {
    super("RightPlatformScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildFloatingRocks();
    this._buildPortal();
    this._buildRuneLights();
    this._buildParticles();
    this._buildLightning();
    await this._loadModels();
    this._spawnEnemies();
    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "RightPlatformScene" });
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateCrystals(dt);
    this._animatePortal(dt);
    this._animateRunes(dt);
    this._animateParticles(dt);    this._animateFloatingRocks(dt);
    this._animateLightning(dt);

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
    const dx = playerPos.x - CFG.PORTAL_POS.x, dz = playerPos.z - CFG.PORTAL_POS.z;
    return dx * dx + dz * dz < CFG.PORTAL_TRIGGER * CFG.PORTAL_TRIGGER ? "HubScene" : null;
  }

  // ─── Atmosphere ────────────────────────────────────────────────────────────
  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.FOG_DENSITY);
    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));

    const moon = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    moon.position.set(60, 100, 30);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -100; moon.shadow.camera.right = 100; // Mở rộng shadow box cho map to hơn
    moon.shadow.camera.top = 100; moon.shadow.camera.bottom = -100;
    moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.02;
    this.scene.add(moon);

    const rim = new THREE.DirectionalLight(0x440088, 0.4); rim.position.set(0, -8, 20); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x0a0520, 0.3); fill.position.set(-50, 20, -30); this.scene.add(fill);
  }

  // ─── Terrain ───────────────────────────────────────────────────────────────
  private _buildTerrain(): void {
    const gGeo = new THREE.PlaneGeometry(200, 200, 60, 60); // Tăng kích thước ground
    const gPos = gGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gPos.count; i++) {
      gPos.setZ(i, Math.sin(gPos.getX(i) * 0.08) * 0.4 + Math.cos(gPos.getY(i) * 0.1) * 0.3 + (Math.random() - 0.5) * 0.2);
    }    gGeo.computeVertexNormals();
    const gMat = new THREE.MeshStandardMaterial({ color: CFG.GROUND_COLOR, roughness: 1.0, metalness: 0.05, flatShading: true });
    this.disposables.push(gGeo); this.disposableMats.push(gMat);
    const ground = new THREE.Mesh(gGeo, gMat); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);

    const pGeo = new THREE.CylinderGeometry(22, 26, 0.6, 8, 2, false); // Platform to hơn
    const pPos = pGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pPos.count; i++) {
      pPos.setX(i, pPos.getX(i) + (Math.random() - 0.5) * 0.4);
      pPos.setZ(i, pPos.getZ(i) + (Math.random() - 0.5) * 0.4);
    }
    pGeo.computeVertexNormals();
    const pMat = new THREE.MeshStandardMaterial({ color: CFG.PLATFORM_COLOR, roughness: 0.95, metalness: 0.08, flatShading: true });
    this.disposables.push(pGeo); this.disposableMats.push(pMat);
    const platform = new THREE.Mesh(pGeo, pMat); platform.position.set(0, 0.3, 0);
    platform.receiveShadow = true; platform.castShadow = true; this.scene.add(platform);

    const crackMat = new THREE.MeshStandardMaterial({ color: 0x060408, roughness: 1.0, transparent: true, opacity: 0.6, depthWrite: false });
    this.disposableMats.push(crackMat);
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2, len = 8 + Math.random() * 10;
      const cGeo = new THREE.PlaneGeometry(0.15, len); this.disposables.push(cGeo);
      const crack = new THREE.Mesh(cGeo, crackMat);
      crack.rotation.x = -Math.PI / 2; crack.rotation.z = angle;
      crack.position.set(Math.cos(angle) * 9, 0.85, Math.sin(angle) * 9);
      this.scene.add(crack);
    }
  }

  private _buildFloatingRocks(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1025, roughness: 0.9, metalness: 0.1, flatShading: true });
    this.disposableMats.push(mat);
    [{ x: -30, z: -25, s: 2.0 }, { x: 35, z: 25, s: 1.5 }, { x: -20, z: 35, s: 2.2 }, { x: 40, z: -30, s: 1.2 }, { x: -12, z: -40, s: 1.8 }, { x: 25, z: -12, s: 1.0 }]
      .forEach(({ x, z, s }, i) => {
        const geo = new THREE.DodecahedronGeometry(s, 1);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let j = 0; j < pos.count; j++) {
          pos.setXYZ(j, pos.getX(j) * (0.85 + Math.random() * 0.3), pos.getY(j) * (0.85 + Math.random() * 0.3), pos.getZ(j) * (0.85 + Math.random() * 0.3));
        }
        geo.computeVertexNormals(); this.disposables.push(geo);
        const mesh = new THREE.Mesh(geo, mat); const baseY = 4.0 + Math.random() * 5; // Nâng cao hơn
        mesh.position.set(x, baseY, z); mesh.castShadow = true; this.scene.add(mesh);
        this.floatingRocks.push({ mesh, baseY, phase: i * 1.05, rotSpeed: new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2) });
      });
  }

  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();
    const oGeo = new THREE.TorusGeometry(3.0, 0.2, 20, 80); this.disposables.push(oGeo);    const oMat = new THREE.MeshStandardMaterial({ color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR), emissiveIntensity: 2.0, roughness: 0.1, metalness: 0.9 }); this.disposableMats.push(oMat);
    this.portalRing = new THREE.Mesh(oGeo, oMat); this.portalGroup.add(this.portalRing);

    const iGeo = new THREE.TorusGeometry(2.2, 0.1, 12, 60); this.disposables.push(iGeo);
    const iMat = new THREE.MeshStandardMaterial({ color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR), emissiveIntensity: 2.5, roughness: 0.05, metalness: 0.95, transparent: true, opacity: 0.75 }); this.disposableMats.push(iMat);
    this.portalInnerRing = new THREE.Mesh(iGeo, iMat); this.portalGroup.add(this.portalInnerRing);

    const dGeo = new THREE.CircleGeometry(2.8, 80); this.disposables.push(dGeo);
    const dMat = new THREE.MeshStandardMaterial({ color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR), emissiveIntensity: 0.4, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }); this.disposableMats.push(dMat);
    this.portalDisk = new THREE.Mesh(dGeo, dMat); this.portalGroup.add(this.portalDisk);

    const pC = 150; const pP = new Float32Array(pC * 3);
    for (let i = 0; i < pC; i++) { const a = (i / pC) * Math.PI * 2, r = 3.0 + (Math.random() - 0.5) * 0.6; pP[i * 3] = Math.cos(a) * r; pP[i * 3 + 1] = Math.sin(a) * r; pP[i * 3 + 2] = (Math.random() - 0.5) * 0.6; }
    const ppGeo = new THREE.BufferGeometry(); ppGeo.setAttribute("position", new THREE.BufferAttribute(pP, 3)); this.disposables.push(ppGeo);
    const ppMat = new THREE.PointsMaterial({ color: CFG.PORTAL_COLOR, size: 0.12, transparent: true, opacity: 0.8, depthWrite: false }); this.disposableMats.push(ppMat);
    this.portalParticles = new THREE.Points(ppGeo, ppMat); this.portalGroup.add(this.portalParticles);

    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 5.5, 30); this.portalGroup.add(this.portalLight);
    const gg = new THREE.PointLight(CFG.PORTAL_COLOR, 2.0, 15); gg.position.set(0, -3, 0); this.portalGroup.add(gg);
    this.portalGroup.position.set(CFG.PORTAL_POS.x, 3.0, CFG.PORTAL_POS.z); // Nâng portal lên cao hơn chút
    this.scene.add(this.portalGroup);
  }

  private _buildRuneLights(): void {
    const RUNE_RADIUS = 20; // Mở rộng vòng tròn rune
    const runeCount = 8; // Tăng số lượng rune
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x1a0035, emissive: new THREE.Color(CFG.RUNE_COLOR), emissiveIntensity: 1.0, roughness: 0.55, metalness: 0.35 });
    const glowMat = new THREE.MeshStandardMaterial({ color: CFG.RUNE_COLOR, emissive: new THREE.Color(CFG.RUNE_COLOR), emissiveIntensity: 0.6, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide });
    this.disposableMats.push(stoneMat, glowMat);

    for (let i = 0; i < runeCount; i++) {
      const angle = (i / runeCount) * Math.PI * 2 + 0.2;
      const r = RUNE_RADIUS + (Math.random() - 0.5) * 3;
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r;

      const sGeo = new THREE.DodecahedronGeometry(0.6, 0); this.disposables.push(sGeo);
      const stone = new THREE.Mesh(sGeo, stoneMat);
      stone.position.set(x, 0.4, z); stone.rotation.set(Math.random(), Math.random(), Math.random()); stone.castShadow = true;
      this.scene.add(stone);

      const gGeo = new THREE.CircleGeometry(1.8, 20); this.disposables.push(gGeo);
      const glowPlane = new THREE.Mesh(gGeo, glowMat);
      glowPlane.rotation.x = -Math.PI / 2; glowPlane.position.set(x, 0.05, z);
      this.scene.add(glowPlane);

      const light = new THREE.PointLight(CFG.RUNE_COLOR, CFG.RUNE_INTENSITY, CFG.RUNE_DISTANCE);
      light.position.set(x, 1.2, z); this.scene.add(light);

      this.runes.push({ light, stone, glowPlane, phase: i * (Math.PI * 2 / runeCount) });
    }  }

  private _buildParticles(): void {
    const dustPos = new Float32Array(CFG.DUST_COUNT * 3);
    for (let i = 0; i < CFG.DUST_COUNT; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 180; dustPos[i * 3 + 1] = Math.random() * 8; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 180; }
    const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3)); this.disposables.push(dGeo);
    const dMat = new THREE.PointsMaterial({ color: 0x554466, size: 0.12, transparent: true, opacity: 0.4, depthWrite: false }); this.disposableMats.push(dMat);
    this.dustParticles = new THREE.Points(dGeo, dMat); this.scene.add(this.dustParticles);

    const cPos = new Float32Array(CFG.CRYSTAL_PART_COUNT * 3);
    for (let i = 0; i < CFG.CRYSTAL_PART_COUNT; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 12; cPos[i * 3] = 20 + Math.cos(a) * r; cPos[i * 3 + 1] = Math.random() * 8; cPos[i * 3 + 2] = -20 + Math.sin(a) * r; }
    const cGeo = new THREE.BufferGeometry(); cGeo.setAttribute("position", new THREE.BufferAttribute(cPos, 3)); this.disposables.push(cGeo);
    const cMat = new THREE.PointsMaterial({ color: CFG.CRYSTAL_COLOR, size: 0.15, transparent: true, opacity: 0.7, depthWrite: false }); this.disposableMats.push(cMat);
    this.crystalParticles = new THREE.Points(cGeo, cMat); this.scene.add(this.crystalParticles);

    const ePos = new Float32Array(CFG.EMBER_COUNT * 3);
    for (let i = 0; i < CFG.EMBER_COUNT; i++) { ePos[i * 3] = (Math.random() - 0.5) * 100; ePos[i * 3 + 1] = Math.random() * 5; ePos[i * 3 + 2] = (Math.random() - 0.5) * 100; }
    const eGeo = new THREE.BufferGeometry(); eGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3)); this.disposables.push(eGeo);
    const eMat = new THREE.PointsMaterial({ color: CFG.RUNE_COLOR, size: 0.1, transparent: true, opacity: 0.6, depthWrite: false }); this.disposableMats.push(eMat);
    this.emberParticles = new THREE.Points(eGeo, eMat); this.scene.add(this.emberParticles);
  }

  private _buildLightning(): void {
    this.lightningLight = new THREE.PointLight(0xccaaff, 0, 300);
    this.lightningLight.position.set(0, 100, -80); this.scene.add(this.lightningLight);
    this.nextLightning = 4 + Math.random() * 6;
  }

  // ─── Models — INTENTIONAL PLACEMENT & SCALED UP ───────────────────────────
  private async _loadModels(): Promise<void> {
    const propLoad = (path: string) =>
      new Promise<THREE.Group>((res, rej) => this.loader.load(path, g => res(g.scene), undefined, rej));
    const gltfLoad = (name: string) =>
      new Promise<THREE.Group>((res, rej) => this.loader.load(`${MODEL_BASE}/${name}.gltf`, g => res(g.scene), undefined, rej));
    
    const shadow = (g: THREE.Group) =>
      g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    
    const nightify = (g: THREE.Group, s = 0.35, tint = new THREE.Color(0.7, 0.6, 0.9)) =>
      g.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(s).multiply(tint);
          mat.roughness = Math.min((mat.roughness || 0.5) + 0.1, 1.0);
          // Đảm bảo model lớn vẫn có chút phản xạ ánh sáng
          mat.metalness = Math.max(mat.metalness || 0.1, 0.2); 
          m.material = mat;
        }
      });
    // ── 1. VÒNG CỘT ĐÁ ────────────────────────
    propLoad(`${PROP_BASE}/stone_pillar.glb`).then(pillar => {
      shadow(pillar); nightify(pillar, 0.45);
      const pillarPositions = [
        { x: 15, z: 15, ry: Math.PI * 0.25 },
        { x: -15, z: 15, ry: Math.PI * 0.75 },
        { x: -15, z: -15, ry: Math.PI * 1.25 },
        { x: 15, z: -15, ry: Math.PI * 1.75 },
      ];
      pillarPositions.forEach(({ x, z, ry }) => {
        const p = pillar.clone(); 
        p.position.set(x, 0, z); 
        p.scale.setScalar(5.5); // TĂNG SCALE MẠNH (was 1.8)
        p.rotation.y = ry;
        this.scene.add(p);
      });
    }).catch(() => {});

    // ── 2. CRYSTAL CHÍNH ──────────────────────
    propLoad(`${PROP_BASE}/crystal_hong.glb`).then(crystal => {
      shadow(crystal);
      crystal.position.set(20, 0, -20); 
      crystal.scale.setScalar(4.0); // TĂNG SCALE (was 1.5)
      crystal.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive = new THREE.Color(CFG.CRYSTAL_COLOR); 
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE;
          mat.roughness = 0.15; mat.metalness = 0.4; m.material = mat;
        }
      });
      this.crystalMesh = crystal; this.scene.add(crystal);
      this.crystalLight = new THREE.PointLight(CFG.CRYSTAL_LIGHT_COLOR, CFG.CRYSTAL_LIGHT_INTENSITY, CFG.CRYSTAL_LIGHT_DISTANCE);
      this.crystalLight.position.set(20, 5, -20); 
      this.crystalLight.castShadow = true; // BẬT SHADOW CHO ÁNH SÁNG CHÍNH
      this.crystalLight.shadow.mapSize.width = 1024;
      this.crystalLight.shadow.mapSize.height = 1024;
      this.scene.add(this.crystalLight);
    }).catch(() => {});

    // Crystal cluster đối diện
    propLoad(`${PROP_BASE}/crystal_cluster.glb`).then(cluster => {
      shadow(cluster); 
      cluster.position.set(-25, 0, 25); 
      cluster.scale.setScalar(5.0); // TĂNG SCALE (was 2.0)
      cluster.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive = new THREE.Color(CFG.CRYSTAL_COLOR); 
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE * 0.8; m.material = mat;
        }
      });
      this.crystalClusterMesh = cluster; this.scene.add(cluster);
      this.clusterLight = new THREE.PointLight(CFG.CRYSTAL_LIGHT_COLOR, CFG.CRYSTAL_LIGHT_INTENSITY * 0.8, CFG.CRYSTAL_LIGHT_DISTANCE * 0.9);
      this.clusterLight.position.set(-25, 4, 25); this.scene.add(this.clusterLight);
    }).catch(() => {});

    // ── 3. CỤM ĐÁ LỚN ─────────────────────────
    propLoad(`${PROP_BASE}/Big-stone.glb`).then(bigStone => {
      shadow(bigStone); nightify(bigStone, 0.35, new THREE.Color(0.65, 0.6, 0.8));
      const stoneGroups = [
        [{ x: -35, z: -20, s: 2.5 }, { x: -30, z: -25, s: 1.8 }],
        [{ x: 35, z: 25, s: 3.0 }, { x: 40, z: 20, s: 1.5 }, { x: 32, z: 30, s: 1.2 }],
        [{ x: -25, z: 45, s: 2.2 }, { x: -20, z: 40, s: 1.4 }],
      ];
      stoneGroups.forEach(group => {
        group.forEach(({ x, z, s }) => {
          const st = bigStone.clone();
          st.position.set(x, 0, z); 
          st.scale.setScalar(s * 3.5); // TĂNG SCALE theo hệ số (was s)
          st.rotation.y = Math.random() * Math.PI * 2;
          this.scene.add(st);
        });
      });
    }).catch(() => {});

    // ── 4. ĐỐNG SỌ ────────────────────────────
    propLoad(`${PROP_BASE}/pile_of_skulls.glb`).then(skulls => {
      shadow(skulls); nightify(skulls, 0.55, new THREE.Color(0.8, 0.75, 0.7));
      [{ x: -18, z: -18 }, { x: 18, z: 25 }, { x: -30, z: 10 }].forEach(({ x, z }) => {
        const sk = skulls.clone(); 
        sk.position.set(x, 0, z); 
        sk.scale.setScalar(3.0); // TĂNG SCALE (was 1.2)
        sk.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(sk);
      });
    }).catch(() => {});

    // ── 5. STATUE (Guardian) ──────────────────
    propLoad(`${PROP_BASE}/bo_ba_nam.glb`).then(statue => {
      shadow(statue); nightify(statue, 0.45, new THREE.Color(0.6, 0.9, 0.75));
      statue.position.set(CFG.PORTAL_POS.x - 6, 0, CFG.PORTAL_POS.z + 4);
      statue.scale.setScalar(7.0); // TĂNG SCALE MẠNH ĐỂ LÀM GUARDIAN (was 2.5)
      statue.rotation.y = -Math.PI * 0.15;
      this.scene.add(statue);
    }).catch(() => {});

    // ── 6. CẦU DÂY ────────────────────────────
    propLoad(`${PROP_BASE}/old_ropebridge_low_poly.glb`).then(bridge => {
      shadow(bridge); nightify(bridge, 0.4, new THREE.Color(0.6, 0.55, 0.7));
      bridge.position.set(0, 0, -50); // Lùi xa ra chút để khớp với map to
      bridge.scale.setScalar(4.0); // TĂNG SCALE (was 1.5)
      bridge.rotation.y = 0;
      this.scene.add(bridge);
    }).catch(() => {});

    // ── 7. ĐÁ VỪA + PEBBLE ────────────────────
    const rockNames = ["Rock_Medium_1", "Rock_Medium_2", "Pebble_Square_1", "Pebble_Square_2"];
    const rockModels = await Promise.all(rockNames.map(n => gltfLoad(n).catch(() => null)));
    for (let z = -48; z < -20; z += 5) {
      for (const sideX of [-6 - Math.random() * 4, 6 + Math.random() * 4]) {
        const src = rockModels[Math.floor(Math.random() * rockModels.length)];
        if (!src) continue;
        const r = src.clone();
        r.position.set(sideX, 0, z + (Math.random() - 0.5) * 3);
        r.scale.setScalar(2.0 + Math.random() * 1.5); // TĂNG SCALE (was 0.3 - 0.8)
        r.rotation.y = Math.random() * Math.PI * 2;
        nightify(r, 0.35, new THREE.Color(0.65, 0.6, 0.8));
        this.scene.add(r);
      }
    }

    // ── 8. DEAD TREES ─────────────────────────
    const deadTreeModels = await Promise.all(
      ["DeadTree_1", "DeadTree_2", "DeadTree_3"].map(n => gltfLoad(n).catch(() => null))
    );
    const deadTreePositions = [
      { x: -50, z: -25 }, { x: 55, z: -40 }, { x: -45, z: 35 },
      { x: 50, z: 35 }, { x: -25, z: -60 }, { x: 25, z: 60 },
    ];
    deadTreePositions.forEach(({ x, z }, i) => {
      const src = deadTreeModels[i % deadTreeModels.length];
      if (!src) return;
      const t = src.clone(); shadow(t); nightify(t, 0.3, new THREE.Color(0.6, 0.55, 0.75));
      t.position.set(x, 0, z); 
      t.scale.setScalar(4.5 + Math.random() * 2.0); // TĂNG SCALE CHO CÂY CAO (was 1.4 - 2.0)
      t.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(t);
    });
  }

  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(25, 0, 20), new THREE.Vector3(-35, 0, 25)], // Điều chỉnh vị trí spawn cho map to
      { ...GOBLIN_CONFIG, scale: 1.2, chaseRange: 22, patrolRadius: 8 } // Enemy to hơn chút và nhìn xa hơn
    );
  }

  // ─── Animators ─────────────────────────────────────────────────────────────
  private _animateCrystals(dt: number): void {
    const t = this.elapsed;
    if (this.crystalMesh) {
      this.crystalMesh.rotation.y += dt * 0.15;
      this.crystalMesh.scale.setScalar(4.0 + Math.sin(t * 1.8) * 0.1); // Khớp với scale gốc 4.0
      this.crystalMesh.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = CFG.CRYSTAL_EMISSIVE * (0.8 + Math.sin(t * 2.5) * 0.25);
      });
    }
    if (this.crystalLight) this.crystalLight.intensity = CFG.CRYSTAL_LIGHT_INTENSITY * (0.82 + Math.sin(t * 2.2) * 0.22);
    
    if (this.crystalClusterMesh) this.crystalClusterMesh.scale.setScalar(5.0 + Math.cos(t * 1.4) * 0.12);
    if (this.clusterLight) this.clusterLight.intensity = CFG.CRYSTAL_LIGHT_INTENSITY * 0.8 * (0.82 + Math.cos(t * 1.9) * 0.22);
  }

  private _animatePortal(dt: number): void {
    const t = this.elapsed;
    this.portalRing.rotation.z += dt * 0.45;
    this.portalInnerRing.rotation.z -= dt * 0.75;
    this.portalInnerRing.rotation.y += dt * 0.1;
    const dMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    dMat.opacity = 0.2 + Math.sin(t * 2.5) * 0.1; dMat.emissiveIntensity = 0.28 + Math.sin(t * 1.8) * 0.14;
    this.portalLight.intensity = 4.5 + Math.sin(t * 3.2) * 1.5;
    this.portalParticles.rotation.z += dt * 0.25;
    this.portalGroup.position.y = 3.0 + Math.sin(t * 0.9) * 0.15;
  }

  private _animateRunes(dt: number): void {
    this.runes.forEach(r => {
      r.phase += dt * 1.4;
      r.light.intensity = CFG.RUNE_INTENSITY * (0.65 + Math.sin(r.phase) * 0.42);
      r.stone.position.y = 0.4 + Math.sin(r.phase * 0.8) * 0.15;
      r.stone.rotation.y += dt * 0.3;
      (r.glowPlane.material as THREE.MeshStandardMaterial).opacity = 0.1 + Math.sin(r.phase) * 0.08;
    });
  }

  private _animateFloatingRocks(dt: number): void {
    this.floatingRocks.forEach(r => {
      r.phase += dt * 0.6;
      r.mesh.position.y = r.baseY + Math.sin(r.phase) * 0.6;
      r.mesh.rotation.x += r.rotSpeed.x * dt; r.mesh.rotation.y += r.rotSpeed.y * dt; r.mesh.rotation.z += r.rotSpeed.z * dt;
    });
  }

  private _animateParticles(dt: number): void {
    const t = this.elapsed;
    const dP = this.dustParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dP.count; i++) { let x = dP.getX(i) + dt * 0.08; if (x > 90) x = -90; dP.setX(i, x); let y = dP.getY(i) + dt * 0.02; if (y > 8) y = 0; dP.setY(i, y); }
    dP.needsUpdate = true;

    const cP = this.crystalParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cP.count; i++) { let y = cP.getY(i) + dt * 0.16; if (y > 8) y = 0; cP.setY(i, y); const cx = cP.getX(i) - 20, cz = cP.getZ(i) + 20; const a = Math.atan2(cz, cx) + dt * 0.22, r = Math.sqrt(cx * cx + cz * cz); cP.setX(i, 20 + Math.cos(a) * r); cP.setZ(i, -20 + Math.sin(a) * r); }
    cP.needsUpdate = true;

    const eP = this.emberParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < eP.count; i++) { let y = eP.getY(i) + dt * 0.25; if (y > 6) y = 0; eP.setY(i, y); eP.setX(i, eP.getX(i) + Math.sin(t * 0.5 + i) * dt * 0.05); }
    eP.needsUpdate = true;
  }

  private _animateLightning(dt: number): void {
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      this.lightningLight.intensity = 4.0 + Math.random() * 5.0; // Chớp sáng mạnh hơn
      setTimeout(() => { if (this.lightningLight) this.lightningLight.intensity = 0; }, 80 + Math.random() * 120);
      if (Math.random() > 0.5) setTimeout(() => { if (this.lightningLight) { this.lightningLight.intensity = 2.5 + Math.random() * 2.5; setTimeout(() => { if (this.lightningLight) this.lightningLight.intensity = 0; }, 60); } }, 200);
      this.nextLightning = 5 + Math.random() * 8;
    }
  }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
          }
