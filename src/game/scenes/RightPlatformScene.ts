// ─────────────────────────────────────────────────────────────────────────────
//  RightPlatformScene — AAA pass
//  Mục tiêu: nâng chất lượng hình ảnh tiệm cận AAA mà vẫn giữ nguyên API public
//  (constructor, setPlayer/setCamera, onLoad/onUpdate/onUnload, checkPortals…)
//  Drop-in thay thế file cũ. Không đổi import path, không đổi event contract.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { MODEL_BASE, PROP_BASE } from "../config/models";

// ─── Config ──────────────────────────────────────────────────────────────────
// Tăng scale tổng thể của khu vực ~1.6x so với bản cũ + bump model scale.
const WORLD_SCALE = 1.6;

const CFG = {
  // Atmosphere
  FOG_COLOR:         0x0a0612,
  SKY_COLOR:         0x03020a,
  FOG_DENSITY:       0.014,           // loãng hơn để thấy được depth xa
  AMBIENT_COLOR:     0x1c1238,
  AMBIENT_INTENSITY: 0.35,
  HEMI_SKY:          0x6a4ab8,
  HEMI_GROUND:       0x180820,
  HEMI_INTENSITY:    0.55,

  // Key / fill / rim (3-point cinematic)
  MOON_COLOR:        0xb8caff,
  MOON_INTENSITY:    1.15,
  RIM_COLOR:         0xff44cc,
  RIM_INTENSITY:     0.85,
  FILL_COLOR:        0x2a1255,
  FILL_INTENSITY:    0.45,

  // Ground / platform
  GROUND_COLOR:      0x0d0a14,
  PLATFORM_COLOR:    0x1e1428,

  // Crystals
  CRYSTAL_COLOR:     0xff44cc,
  CRYSTAL_EMISSIVE:  1.6,
  CRYSTAL_LIGHT_COLOR:     0xff66dd,
  CRYSTAL_LIGHT_INTENSITY: 4.2,
  CRYSTAL_LIGHT_DISTANCE:  34,

  // Portal
  PORTAL_COLOR:      0xffaa33,
  PORTAL_CORE_COLOR: 0xfff0c4,
  PORTAL_POS:        new THREE.Vector3(30 * WORLD_SCALE, 0, 0),
  PORTAL_TRIGGER:    4.0,

  // Runes
  RUNE_COLOR:        0x9966ff,
  RUNE_INTENSITY:    2.2,
  RUNE_DISTANCE:     13,
  RUNE_RADIUS:       18 * WORLD_SCALE,
  RUNE_COUNT:        8,

  // Particles
  DUST_COUNT:        520,
  CRYSTAL_PART_COUNT: 280,
  EMBER_COUNT:       220,
  FIREFLY_COUNT:     90,

  // Models — phóng to ~1.8–2.2x so với bản cũ
  MODEL_SCALE: {
    PILLAR:   3.4,
    CRYSTAL:  2.8,
    CLUSTER:  3.6,
    BIGSTONE: 2.6,
    SKULLS:   2.1,
    STATUE:   4.4,
    BRIDGE:   2.6,
    DEADTREE: 2.4,
  },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function inPortalClear(x: number, z: number): boolean {
  return (
    Math.hypot(x - CFG.PORTAL_POS.x, z - CFG.PORTAL_POS.z) < 10 ||
    Math.hypot(x, z) < 14
  );
}
function annulusPoint(cx: number, cz: number, rMin: number, rMax: number): [number, number] {
  const a = Math.random() * Math.PI * 2;
  const r = rMin + Math.random() * (rMax - rMin);
  return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
}
// fBm noise đơn giản cho terrain
function fbm(x: number, y: number): number {
  let v = 0, a = 1, f = 1;
  for (let i = 0; i < 4; i++) {
    v += a * (Math.sin(x * f * 0.13 + y * f * 0.07) + Math.cos(y * f * 0.11 - x * f * 0.09)) * 0.5;
    f *= 2.0; a *= 0.5;
  }
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
export class RightPlatformScene extends BaseScene {
  public  scene: THREE.Scene;
  private enemyManager!: EnemyManager;
  private playerRef!:    THREE.Object3D;
  private cameraRef!:    THREE.Camera;
  private elapsed = 0;

  // Crystals
  private crystalMesh!:        THREE.Group;
  private crystalClusterMesh!: THREE.Group;
  private crystalLight!:       THREE.PointLight;
  private clusterLight!:       THREE.PointLight;
  private crystalShards!:      THREE.InstancedMesh;

  // Portal
  private portalGroup!:      THREE.Group;
  private portalRing!:       THREE.Mesh;
  private portalInnerRing!:  THREE.Mesh;
  private portalDisk!:       THREE.Mesh;
  private portalCore!:       THREE.Mesh;
  private portalLight!:      THREE.PointLight;
  private portalGodRay!:     THREE.Mesh;
  private portalShockwave!:  THREE.Mesh;
  private portalParticles!:  THREE.Points;
  private portalSwirl!:      THREE.Points;
  private shockwavePhase = 0;

  // Runes
  private runes: {
    light: THREE.PointLight;
    stone: THREE.Mesh;
    glowPlane: THREE.Mesh;
    pulse: THREE.Mesh;
    phase: number;
  }[] = [];
  private runePulseClock = 0;

  // Misc
  private floatingRocks: { mesh: THREE.Mesh; baseY: number; phase: number; rotSpeed: THREE.Vector3 }[] = [];
  private fireflies!: THREE.Points;
  private dustParticles!:    THREE.Points;
  private crystalParticles!: THREE.Points;
  private emberParticles!:   THREE.Points;
  private groundMist!:       THREE.Mesh;
  private distantMountains!: THREE.Mesh;

  private lightningLight!:  THREE.PointLight;
  private lightningTimeouts: number[] = [];
  private nextLightning = 0;

  private disposables:    THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[]       = [];
  private loader = new GLTFLoader();

  constructor() { super("RightPlatformScene"); this.scene = new THREE.Scene(); }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildDistantSilhouettes();
    this._buildGroundMist();
    this._buildFloatingRocks();
    this._buildCrystalShards();
    this._buildPortal();
    this._buildRuneCircle();
    this._buildParticles();
    this._buildFireflies();
    this._buildLightning();
    await this._loadModels();
    this._spawnEnemies();
    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "RightPlatformScene" });
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateCrystals(dt);
    this._animateCrystalShards(dt);
    this._animatePortal(dt);
    this._animateRunes(dt);
    this._animateParticles(dt);
    this._animateFireflies(dt);
    this._animateFloatingRocks(dt);
    this._animateGroundMist(dt);
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
    this.lightningTimeouts.forEach(id => clearTimeout(id));
    this.lightningTimeouts = [];
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

    // Ambient + hemisphere cho color bounce hợp lý
    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));
    this.scene.add(new THREE.HemisphereLight(CFG.HEMI_SKY, CFG.HEMI_GROUND, CFG.HEMI_INTENSITY));

    // KEY: Moon — directional light shadow lớn, soft
    const moon = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    moon.position.set(80, 140, 60);
    moon.castShadow = true;
    moon.shadow.mapSize.set(4096, 4096);
    const S = 120;
    moon.shadow.camera.left = -S; moon.shadow.camera.right  =  S;
    moon.shadow.camera.top  =  S; moon.shadow.camera.bottom = -S;
    moon.shadow.camera.near = 0.5; moon.shadow.camera.far = 400;
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.025;
    moon.shadow.radius = 4; // PCF soft
    this.scene.add(moon);

    // RIM magenta — chiếu ngược từ phía crystal cluster
    const rim = new THREE.DirectionalLight(CFG.RIM_COLOR, CFG.RIM_INTENSITY);
    rim.position.set(-40, 20, 40);
    this.scene.add(rim);

    // FILL tím lạnh — phía đối diện key
    const fill = new THREE.DirectionalLight(CFG.FILL_COLOR, CFG.FILL_INTENSITY);
    fill.position.set(-60, 30, -40);
    this.scene.add(fill);

    // Moon disk visual (sprite mỏng cho cảm giác có nguồn sáng thật)
    const moonGeo = new THREE.CircleGeometry(6, 48);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xe8f0ff, transparent: true, opacity: 0.85, depthWrite: false,
    });
    this.disposables.push(moonGeo); this.disposableMats.push(moonMat);
    const moonDisk = new THREE.Mesh(moonGeo, moonMat);
    moonDisk.position.set(70, 95, -120);
    moonDisk.lookAt(0, 0, 0);
    this.scene.add(moonDisk);

    // Moon halo
    const haloGeo = new THREE.CircleGeometry(14, 48);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x8aa6ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposables.push(haloGeo); this.disposableMats.push(haloMat);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(moonDisk.position);
    halo.lookAt(0, 0, 0);
    this.scene.add(halo);
  }

  // ─── Terrain ───────────────────────────────────────────────────────────────
  private _buildTerrain(): void {
    const SZ = 220 * 1.2;
    const gGeo = new THREE.PlaneGeometry(SZ, SZ, 140, 140);
    const gPos = gGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gPos.count; i++) {
      const x = gPos.getX(i), y = gPos.getY(i);
      // multi-octave + crater toward edges
      const edge = Math.min(1, Math.hypot(x, y) / (SZ * 0.5));
      const h = fbm(x, y) * 0.9 + Math.pow(edge, 2.4) * 4.5 + (Math.random() - 0.5) * 0.25;
      gPos.setZ(i, h);
    }
    gGeo.computeVertexNormals();

    const gMat = new THREE.MeshStandardMaterial({
      color: CFG.GROUND_COLOR,
      roughness: 0.98,
      metalness: 0.06,
      flatShading: true,
    });
    this.disposables.push(gGeo); this.disposableMats.push(gMat);
    const ground = new THREE.Mesh(gGeo, gMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Platform trung tâm — hexagonal stepped
    const baseR = 22 * WORLD_SCALE;
    const pGeo = new THREE.CylinderGeometry(baseR * 0.82, baseR, 0.7, 7, 3, false);
    const pPos = pGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pPos.count; i++) {
      pPos.setX(i, pPos.getX(i) + (Math.random() - 0.5) * 0.35);
      pPos.setZ(i, pPos.getZ(i) + (Math.random() - 0.5) * 0.35);
    }
    pGeo.computeVertexNormals();
    const pMat = new THREE.MeshStandardMaterial({
      color: CFG.PLATFORM_COLOR,
      roughness: 0.92, metalness: 0.1, flatShading: true,
    });
    this.disposables.push(pGeo); this.disposableMats.push(pMat);
    const platform = new THREE.Mesh(pGeo, pMat);
    platform.position.set(0, 0.25, 0);
    platform.receiveShadow = true;
    platform.castShadow = true;
    this.scene.add(platform);

    // Tier 2 — viền platform thấp hơn
    const pGeo2 = new THREE.CylinderGeometry(baseR * 1.05, baseR * 1.15, 0.35, 7, 1, false);
    const pMat2 = pMat.clone();
    this.disposables.push(pGeo2); this.disposableMats.push(pMat2);
    const platform2 = new THREE.Mesh(pGeo2, pMat2);
    platform2.position.set(0, -0.05, 0);
    platform2.receiveShadow = true;
    this.scene.add(platform2);

    // Crack lines — rạn nứt phát quang nhẹ
    const crackMat = new THREE.MeshStandardMaterial({
      color: 0x110820,
      emissive: new THREE.Color(CFG.RUNE_COLOR),
      emissiveIntensity: 0.25,
      roughness: 1.0, transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.disposableMats.push(crackMat);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const len = 7 + Math.random() * 11;
      const cGeo = new THREE.PlaneGeometry(0.16, len);
      this.disposables.push(cGeo);
      const crack = new THREE.Mesh(cGeo, crackMat);
      crack.rotation.x = -Math.PI / 2;
      crack.rotation.z = angle;
      crack.position.set(Math.cos(angle) * 8, 0.62, Math.sin(angle) * 8);
      this.scene.add(crack);
    }
  }

  // ─── Distant silhouettes (parallax depth) ──────────────────────────────────
  private _buildDistantSilhouettes(): void {
    // Vành đai núi xa: cylinder ngược, vertex tạo skyline
    const R = 220, H = 60;
    const geo = new THREE.CylinderGeometry(R, R, H, 96, 4, true);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // chỉ deform các đỉnh phía trên
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0) {
        const x = pos.getX(i), z = pos.getZ(i);
        const a = Math.atan2(z, x);
        const peak = Math.abs(Math.sin(a * 7.3)) * 18 + Math.abs(Math.sin(a * 3.1 + 0.7)) * 12 + Math.random() * 4;
        pos.setY(i, y + peak);
      }
    }
    geo.computeVertexNormals();
    this.disposables.push(geo);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x07050f, side: THREE.BackSide, fog: true, transparent: true, opacity: 0.95,
    });
    this.disposableMats.push(mat);
    this.distantMountains = new THREE.Mesh(geo, mat);
    this.distantMountains.position.y = 0;
    this.scene.add(this.distantMountains);
  }

  // ─── Ground mist ───────────────────────────────────────────────────────────
  private _buildGroundMist(): void {
    const geo = new THREE.PlaneGeometry(260, 260, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2a1f4a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.disposables.push(geo); this.disposableMats.push(mat);
    this.groundMist = new THREE.Mesh(geo, mat);
    this.groundMist.rotation.x = -Math.PI / 2;
    this.groundMist.position.y = 0.6;
    this.scene.add(this.groundMist);
  }

  // ─── Floating rocks ────────────────────────────────────────────────────────
  private _buildFloatingRocks(): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1c1230, roughness: 0.88, metalness: 0.12, flatShading: true,
    });
    this.disposableMats.push(mat);

    const list = [
      { x: -32, z: -26, s: 2.2 }, { x:  36, z:  28, s: 1.6 },
      { x: -22, z:  38, s: 2.6 }, { x:  44, z: -30, s: 1.4 },
      { x: -12, z: -44, s: 1.9 }, { x:  26, z: -14, s: 1.2 },
      { x:  -6, z:  46, s: 1.7 }, { x: -38, z:  18, s: 1.3 },
    ];
    list.forEach(({ x, z, s }, i) => {
      const geo = new THREE.DodecahedronGeometry(s, 1);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        pos.setXYZ(
          j,
          pos.getX(j) * (0.82 + Math.random() * 0.36),
          pos.getY(j) * (0.82 + Math.random() * 0.36),
          pos.getZ(j) * (0.82 + Math.random() * 0.36),
        );
      }
      geo.computeVertexNormals();
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      const baseY = 4 + Math.random() * 5;
      mesh.position.set(x, baseY, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.floatingRocks.push({
        mesh, baseY, phase: i * 1.05,
        rotSpeed: new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3),
      });
    });
  }

  // ─── Crystal shards (instanced) — bay quanh crystal chính ──────────────────
  private _buildCrystalShards(): void {
    const COUNT = 24;
    const geo = new THREE.OctahedronGeometry(0.35, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: CFG.CRYSTAL_COLOR,
      emissive: new THREE.Color(CFG.CRYSTAL_COLOR),
      emissiveIntensity: 1.8,
      roughness: 0.15, metalness: 0.4,
      transparent: true, opacity: 0.9,
    });
    this.disposables.push(geo); this.disposableMats.push(mat);
    this.crystalShards = new THREE.InstancedMesh(geo, mat, COUNT);
    this.crystalShards.castShadow = false;
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2;
      const r = 3.5 + Math.random() * 2.5;
      m.makeTranslation(20 * WORLD_SCALE + Math.cos(a) * r, 2 + Math.random() * 3, -20 * WORLD_SCALE + Math.sin(a) * r);
      this.crystalShards.setMatrixAt(i, m);
    }
    this.crystalShards.instanceMatrix.needsUpdate = true;
    this.scene.add(this.crystalShards);
  }

  // ─── Portal ────────────────────────────────────────────────────────────────
  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();

    // Outer ornate ring
    const oGeo = new THREE.TorusGeometry(3.0, 0.22, 24, 96);
    const oMat = new THREE.MeshStandardMaterial({
      color: CFG.PORTAL_COLOR,
      emissive: new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 2.4,
      roughness: 0.12, metalness: 0.92,
    });
    this.disposables.push(oGeo); this.disposableMats.push(oMat);
    this.portalRing = new THREE.Mesh(oGeo, oMat);
    this.portalRing.castShadow = true;
    this.portalGroup.add(this.portalRing);

    // Inner counter-rotating ring
    const iGeo = new THREE.TorusGeometry(2.25, 0.09, 16, 80);
    const iMat = new THREE.MeshStandardMaterial({
      color: CFG.PORTAL_CORE_COLOR,
      emissive: new THREE.Color(CFG.PORTAL_CORE_COLOR),
      emissiveIntensity: 2.8,
      roughness: 0.05, metalness: 0.95,
      transparent: true, opacity: 0.85,
    });
    this.disposables.push(iGeo); this.disposableMats.push(iMat);
    this.portalInnerRing = new THREE.Mesh(iGeo, iMat);
    this.portalGroup.add(this.portalInnerRing);

    // Vortex disk
    const dGeo = new THREE.CircleGeometry(2.7, 96);
    const dMat = new THREE.MeshStandardMaterial({
      color: CFG.PORTAL_COLOR,
      emissive: new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 0.6,
      transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
    });
    this.disposables.push(dGeo); this.disposableMats.push(dMat);
    this.portalDisk = new THREE.Mesh(dGeo, dMat);
    this.portalGroup.add(this.portalDisk);

    // Bright core
    const cGeo = new THREE.CircleGeometry(0.9, 48);
    const cMat = new THREE.MeshBasicMaterial({
      color: CFG.PORTAL_CORE_COLOR,
      transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.disposables.push(cGeo); this.disposableMats.push(cMat);
    this.portalCore = new THREE.Mesh(cGeo, cMat);
    this.portalCore.position.z = 0.02;
    this.portalGroup.add(this.portalCore);

    // God-ray cone (volumetric fake)
    const grGeo = new THREE.ConeGeometry(2.6, 9, 32, 1, true);
    const grMat = new THREE.MeshBasicMaterial({
      color: CFG.PORTAL_COLOR, transparent: true, opacity: 0.12,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.disposables.push(grGeo); this.disposableMats.push(grMat);
    this.portalGodRay = new THREE.Mesh(grGeo, grMat);
    this.portalGodRay.rotation.x = Math.PI / 2;
    this.portalGodRay.position.z = -4.5;
    this.portalGroup.add(this.portalGodRay);

    // Shockwave ring (lan ra theo chu kỳ)
    const swGeo = new THREE.RingGeometry(0.1, 0.2, 64);
    const swMat = new THREE.MeshBasicMaterial({
      color: CFG.PORTAL_CORE_COLOR, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposables.push(swGeo); this.disposableMats.push(swMat);
    this.portalShockwave = new THREE.Mesh(swGeo, swMat);
    this.portalShockwave.rotation.x = -Math.PI / 2;
    this.portalShockwave.position.set(0, -2.0, 0);
    this.portalGroup.add(this.portalShockwave);

    // Outer particles (orbit)
    const pC = 200;
    const pP = new Float32Array(pC * 3);
    for (let i = 0; i < pC; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.9 + (Math.random() - 0.5) * 0.7;
      pP[i * 3] = Math.cos(a) * r;
      pP[i * 3 + 1] = Math.sin(a) * r;
      pP[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    }
    const ppGeo = new THREE.BufferGeometry();
    ppGeo.setAttribute("position", new THREE.BufferAttribute(pP, 3));
    this.disposables.push(ppGeo);
    const ppMat = new THREE.PointsMaterial({
      color: CFG.PORTAL_COLOR, size: 0.12, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(ppMat);
    this.portalParticles = new THREE.Points(ppGeo, ppMat);
    this.portalGroup.add(this.portalParticles);

    // Inner swirl
    const sC = 140;
    const sP = new Float32Array(sC * 3);
    for (let i = 0; i < sC; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.4;
      sP[i * 3] = Math.cos(a) * r;
      sP[i * 3 + 1] = Math.sin(a) * r;
      sP[i * 3 + 2] = 0.01 + Math.random() * 0.05;
    }
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(sP, 3));
    this.disposables.push(spGeo);
    const spMat = new THREE.PointsMaterial({
      color: CFG.PORTAL_CORE_COLOR, size: 0.08, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(spMat);
    this.portalSwirl = new THREE.Points(spGeo, spMat);
    this.portalGroup.add(this.portalSwirl);

    // Lights
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 6.5, 36);
    this.portalGroup.add(this.portalLight);
    const ground = new THREE.PointLight(CFG.PORTAL_COLOR, 2.2, 14);
    ground.position.set(0, -2.5, 0);
    this.portalGroup.add(ground);

    this.portalGroup.position.set(CFG.PORTAL_POS.x, 2.8, CFG.PORTAL_POS.z);
    this.scene.add(this.portalGroup);
  }

  // ─── Rune circle ───────────────────────────────────────────────────────────
  private _buildRuneCircle(): void {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x1a0035,
      emissive: new THREE.Color(CFG.RUNE_COLOR),
      emissiveIntensity: 1.1,
      roughness: 0.55, metalness: 0.35,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: CFG.RUNE_COLOR, transparent: true, opacity: 0.18,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const pulseMat = new THREE.MeshBasicMaterial({
      color: CFG.RUNE_COLOR, transparent: true, opacity: 0.0,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(stoneMat, glowMat, pulseMat);

    for (let i = 0; i < CFG.RUNE_COUNT; i++) {
      const angle = (i / CFG.RUNE_COUNT) * Math.PI * 2 + 0.18;
      const r = CFG.RUNE_RADIUS + (Math.random() - 0.5) * 1.8;
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r;

      // Obelisk thay vì dodec nhỏ — cao hơn, monolithic
      const sGeo = new THREE.BoxGeometry(0.7, 2.2, 0.7);
      this.disposables.push(sGeo);
      const stone = new THREE.Mesh(sGeo, stoneMat);
      stone.position.set(x, 1.1, z);
      stone.rotation.y = Math.random() * Math.PI * 2;
      stone.castShadow = true;
      stone.receiveShadow = true;
      this.scene.add(stone);

      const gGeo = new THREE.CircleGeometry(1.8, 24);
      this.disposables.push(gGeo);
      const glowPlane = new THREE.Mesh(gGeo, glowMat.clone());
      this.disposableMats.push(glowPlane.material as THREE.Material);
      glowPlane.rotation.x = -Math.PI / 2;
      glowPlane.position.set(x, 0.06, z);
      this.scene.add(glowPlane);

      // Pulse ring per-rune
      const pGeo = new THREE.RingGeometry(0.2, 0.35, 48);
      this.disposables.push(pGeo);
      const pulse = new THREE.Mesh(pGeo, pulseMat.clone());
      this.disposableMats.push(pulse.material as THREE.Material);
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.set(x, 0.08, z);
      this.scene.add(pulse);

      const light = new THREE.PointLight(CFG.RUNE_COLOR, CFG.RUNE_INTENSITY, CFG.RUNE_DISTANCE);
      light.position.set(x, 1.8, z);
      this.scene.add(light);

      this.runes.push({ light, stone, glowPlane, pulse, phase: i * (Math.PI * 2 / CFG.RUNE_COUNT) });
    }

    // Vòng tròn ma thuật nối các rune (dây sáng chạy quanh)
    const ringGeo = new THREE.RingGeometry(CFG.RUNE_RADIUS - 0.15, CFG.RUNE_RADIUS + 0.15, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: CFG.RUNE_COLOR, transparent: true, opacity: 0.35,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.disposables.push(ringGeo); this.disposableMats.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    this.scene.add(ring);
  }

  // ─── Particles ─────────────────────────────────────────────────────────────
  private _buildParticles(): void {
    // Dust toàn cảnh
    const dustPos = new Float32Array(CFG.DUST_COUNT * 3);
    for (let i = 0; i < CFG.DUST_COUNT; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 200;
      dustPos[i * 3 + 1] = Math.random() * 8;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.disposables.push(dGeo);
    const dMat = new THREE.PointsMaterial({
      color: 0x7a6688, size: 0.09, transparent: true, opacity: 0.42,
      depthWrite: false,
    });
    this.disposableMats.push(dMat);
    this.dustParticles = new THREE.Points(dGeo, dMat);
    this.scene.add(this.dustParticles);

    // Crystal swirl quanh crystal chính
    const cPos = new Float32Array(CFG.CRYSTAL_PART_COUNT * 3);
    const cx = 20 * WORLD_SCALE, cz = -20 * WORLD_SCALE;
    for (let i = 0; i < CFG.CRYSTAL_PART_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 11;
      cPos[i * 3]     = cx + Math.cos(a) * r;
      cPos[i * 3 + 1] = Math.random() * 7;
      cPos[i * 3 + 2] = cz + Math.sin(a) * r;
    }
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
    this.disposables.push(cGeo);
    const cMat = new THREE.PointsMaterial({
      color: CFG.CRYSTAL_COLOR, size: 0.12, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(cMat);
    this.crystalParticles = new THREE.Points(cGeo, cMat);
    this.scene.add(this.crystalParticles);

    // Embers tím trôi nhẹ
    const ePos = new Float32Array(CFG.EMBER_COUNT * 3);
    for (let i = 0; i < CFG.EMBER_COUNT; i++) {
      ePos[i * 3] = (Math.random() - 0.5) * 110;
      ePos[i * 3 + 1] = Math.random() * 5;
      ePos[i * 3 + 2] = (Math.random() - 0.5) * 110;
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
    this.disposables.push(eGeo);
    const eMat = new THREE.PointsMaterial({
      color: CFG.RUNE_COLOR, size: 0.08, transparent: true, opacity: 0.6,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(eMat);
    this.emberParticles = new THREE.Points(eGeo, eMat);
    this.scene.add(this.emberParticles);
  }

  private _buildFireflies(): void {
    const pos = new Float32Array(CFG.FIREFLY_COUNT * 3);
    for (let i = 0; i < CFG.FIREFLY_COUNT; i++) {
      let x: number, z: number;
      do { x = (Math.random() - 0.5) * 140; z = (Math.random() - 0.5) * 140; } while (inPortalClear(x, z));
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.6 + Math.random() * 3.4;
      pos[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color: 0xa6f8d4, size: 0.18, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(mat);
    this.fireflies = new THREE.Points(geo, mat);
    this.scene.add(this.fireflies);
  }

  private _buildLightning(): void {
    this.lightningLight = new THREE.PointLight(0xccaaff, 0, 280);
    this.lightningLight.position.set(0, 110, -80);
    this.scene.add(this.lightningLight);
    this.nextLightning = 4 + Math.random() * 6;
  }

  // ─── Models (giữ nguyên nguồn file .glb, chỉ tăng scale + nightify mới) ───
  private async _loadModels(): Promise<void> {
    const propLoad = (path: string) =>
      new Promise<THREE.Group>((res, rej) => this.loader.load(path, g => res(g.scene), undefined, rej));
    const gltfLoad = (name: string) =>
      new Promise<THREE.Group>((res, rej) => this.loader.load(`${MODEL_BASE}/${name}.gltf`, g => res(g.scene), undefined, rej));

    const shadow = (g: THREE.Group) =>
      g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    const nightify = (g: THREE.Group, s = 0.4, tint = new THREE.Color(0.7, 0.6, 0.95)) =>
      g.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(s).multiply(tint);
          mat.roughness = Math.min((mat.roughness ?? 0.5) + 0.12, 1.0);
          mat.metalness = Math.max((mat.metalness ?? 0.0) * 0.8, 0.05);
          // bump emissive nhẹ theo tint cho cảm giác có moonlight bám
          mat.emissive = tint.clone().multiplyScalar(0.06);
          mat.emissiveIntensity = 1.0;
          m.material = mat;
        }
      });

    const MS = CFG.MODEL_SCALE;

    // 1. Vòng cột đá nghi lễ — to & uy nghi
    propLoad(`${PROP_BASE}/stone_pillar.glb`).then(pillar => {
      shadow(pillar); nightify(pillar, 0.45);
      const R = 14 * WORLD_SCALE;
      const pillarPositions = [
        { x:  R, z:  R, ry: Math.PI * 0.25 },
        { x: -R, z:  R, ry: Math.PI * 0.75 },
        { x: -R, z: -R, ry: Math.PI * 1.25 },
        { x:  R, z: -R, ry: Math.PI * 1.75 },
        { x:  0, z:  R * 1.41, ry: 0 },
        { x:  0, z: -R * 1.41, ry: Math.PI },
      ];
      pillarPositions.forEach(({ x, z, ry }) => {
        const p = pillar.clone();
        p.position.set(x, 0, z);
        p.scale.setScalar(MS.PILLAR);
        p.rotation.y = ry;
        this.scene.add(p);
      });
    }).catch(() => {});

    // 2. Crystal chính — focal hero prop
    propLoad(`${PROP_BASE}/crystal_hong.glb`).then(crystal => {
      shadow(crystal);
      crystal.position.set(20 * WORLD_SCALE, 0, -20 * WORLD_SCALE);
      crystal.scale.setScalar(MS.CRYSTAL);
      crystal.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive = new THREE.Color(CFG.CRYSTAL_COLOR);
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE;
          mat.roughness = 0.12; mat.metalness = 0.35;
          mat.transparent = true; mat.opacity = 0.96;
          m.material = mat;
        }
      });
      this.crystalMesh = crystal;
      this.scene.add(crystal);
      this.crystalLight = new THREE.PointLight(CFG.CRYSTAL_LIGHT_COLOR, CFG.CRYSTAL_LIGHT_INTENSITY, CFG.CRYSTAL_LIGHT_DISTANCE);
      this.crystalLight.position.set(20 * WORLD_SCALE, 4, -20 * WORLD_SCALE);
      this.crystalLight.castShadow = false;
      this.scene.add(this.crystalLight);
    }).catch(() => {});

    // Crystal cluster đối diện
    propLoad(`${PROP_BASE}/crystal_cluster.glb`).then(cluster => {
      shadow(cluster);
      cluster.position.set(-22 * WORLD_SCALE, 0, 22 * WORLD_SCALE);
      cluster.scale.setScalar(MS.CLUSTER);
      cluster.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive = new THREE.Color(CFG.CRYSTAL_COLOR);
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE * 0.75;
          mat.roughness = 0.18; mat.metalness = 0.32;
          m.material = mat;
        }
      });
      this.crystalClusterMesh = cluster;
      this.scene.add(cluster);
      this.clusterLight = new THREE.PointLight(
        CFG.CRYSTAL_LIGHT_COLOR,
        CFG.CRYSTAL_LIGHT_INTENSITY * 0.75,
        CFG.CRYSTAL_LIGHT_DISTANCE * 0.85,
      );
      this.clusterLight.position.set(-22 * WORLD_SCALE, 3.5, 22 * WORLD_SCALE);
      this.scene.add(this.clusterLight);
    }).catch(() => {});

    // 3. Cụm đá lớn — scatter theo cụm
    propLoad(`${PROP_BASE}/Big-stone.glb`).then(bigStone => {
      shadow(bigStone); nightify(bigStone, 0.32, new THREE.Color(0.65, 0.6, 0.85));
      const stoneGroups = [
        [{ x: -34, z: -18, s: 2.6 }, { x: -28, z: -22, s: 1.8 }, { x: -38, z: -14, s: 1.4 }],
        [{ x:  32, z:  22, s: 2.8 }, { x:  38, z:  16, s: 1.6 }, { x:  28, z:  26, s: 1.2 }],
        [{ x: -22, z:  42, s: 2.2 }, { x: -16, z:  38, s: 1.3 }],
        [{ x:  44, z: -10, s: 1.9 }, { x:  48, z:  -4, s: 1.1 }],
      ];
      stoneGroups.forEach(group => {
        group.forEach(({ x, z, s }) => {
          if (inPortalClear(x, z)) return;
          const st = bigStone.clone();
          st.position.set(x, 0, z);
          st.scale.setScalar(MS.BIGSTONE * s * 0.6);
          st.rotation.y = Math.random() * Math.PI * 2;
          this.scene.add(st);
        });
      });
    }).catch(() => {});

    // 4. Đống sọ — lễ vật cạnh rune
    propLoad(`${PROP_BASE}/pile_of_skulls.glb`).then(skulls => {
      shadow(skulls); nightify(skulls, 0.55, new THREE.Color(0.85, 0.78, 0.72));
      [
        { x: -14, z: -17 }, { x: 15, z: 20 }, { x: -24, z: 10 },
        { x: 22, z: -14 }, { x: 6, z: 24 },
      ].forEach(({ x, z }) => {
        const sk = skulls.clone();
        sk.position.set(x, 0, z);
        sk.scale.setScalar(MS.SKULLS);
        sk.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(sk);
      });
    }).catch(() => {});

    // 5. Statue — guardian trước portal
    propLoad(`${PROP_BASE}/bo_ba_nam.glb`).then(statue => {
      shadow(statue); nightify(statue, 0.42, new THREE.Color(0.6, 0.95, 0.78));
      statue.position.set(CFG.PORTAL_POS.x - 7, 0, CFG.PORTAL_POS.z + 4);
      statue.scale.setScalar(MS.STATUE);
      statue.rotation.y = -Math.PI * 0.15;
      this.scene.add(statue);

      // Spotlight ngầm hắt vào statue
      const spot = new THREE.SpotLight(0xaaffdd, 2.5, 18, Math.PI / 6, 0.5, 1.2);
      spot.position.set(CFG.PORTAL_POS.x - 7, 12, CFG.PORTAL_POS.z + 4);
      spot.target = statue;
      this.scene.add(spot);
    }).catch(() => {});

    // 6. Cầu dây
    propLoad(`${PROP_BASE}/old_ropebridge_low_poly.glb`).then(bridge => {
      shadow(bridge); nightify(bridge, 0.38, new THREE.Color(0.6, 0.55, 0.75));
      bridge.position.set(0, 0, -52 * WORLD_SCALE);
      bridge.scale.setScalar(MS.BRIDGE);
      bridge.rotation.y = 0;
      this.scene.add(bridge);
    }).catch(() => {});

    // 7. Đá viền path
    const rockNames = ["Rock_Medium_1", "Rock_Medium_2", "Pebble_Square_1", "Pebble_Square_2"];
    const rockModels = await Promise.all(rockNames.map(n => gltfLoad(n).catch(() => null)));
    const pathStart = -52 * WORLD_SCALE, pathEnd = -22 * WORLD_SCALE;
    for (let z = pathStart; z < pathEnd; z += 3.5) {
      for (const sideX of [-5 - Math.random() * 3, 5 + Math.random() * 3]) {
        const src = rockModels[Math.floor(Math.random() * rockModels.length)];
        if (!src) continue;
        const r = src.clone();
        r.position.set(sideX, 0, z + (Math.random() - 0.5) * 2);
        r.scale.setScalar(0.55 + Math.random() * 0.8);
        r.rotation.y = Math.random() * Math.PI * 2;
        nightify(r, 0.32, new THREE.Color(0.65, 0.6, 0.82));
        shadow(r);
        this.scene.add(r);
      }
    }

    // 8. Dead trees — viền xa, tăng số lượng
    const deadTreeModels = await Promise.all(
      ["DeadTree_1", "DeadTree_2", "DeadTree_3"].map(n => gltfLoad(n).catch(() => null)),
    );
    const deadTreePositions = [
      { x: -55, z: -28 }, { x:  58, z: -42 }, { x: -50, z:  38 },
      { x:  52, z:  38 }, { x: -28, z: -58 }, { x:  28, z:  62 },
      { x: -68, z:  -8 }, { x:  68, z:   8 }, { x:  -8, z:  64 },
      { x:   8, z: -66 }, { x: -42, z:  56 }, { x:  46, z: -52 },
    ];
    deadTreePositions.forEach(({ x, z }, i) => {
      const src = deadTreeModels[i % deadTreeModels.length];
      if (!src) return;
      const t = src.clone();
      shadow(t);
      nightify(t, 0.28, new THREE.Color(0.6, 0.55, 0.78));
      t.position.set(x, 0, z);
      t.scale.setScalar(MS.DEADTREE * (0.85 + Math.random() * 0.4));
      t.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(t);
    });
  }

  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [
        new THREE.Vector3(20, 0, 15),
        new THREE.Vector3(-30, 0, 20),
        new THREE.Vector3(15, 0, -25),
        new THREE.Vector3(-20, 0, -28),
      ],
      { ...GOBLIN_CONFIG, scale: 1.0, chaseRange: 22, patrolRadius: 6 },
    );
  }

  // ─── Animators ─────────────────────────────────────────────────────────────
  private _animateCrystals(dt: number): void {
    const t = this.elapsed;
    if (this.crystalMesh) {
      this.crystalMesh.rotation.y += dt * 0.25;
      this.crystalMesh.position.y = 0.2 + Math.sin(t * 1.4) * 0.18;
      const base = CFG.MODEL_SCALE.CRYSTAL;
      this.crystalMesh.scale.setScalar(base + Math.sin(t * 1.8) * base * 0.04);
      this.crystalMesh.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.MeshStandardMaterial).emissiveIntensity =
          CFG.CRYSTAL_EMISSIVE * (0.85 + Math.sin(t * 2.5) * 0.28);
      });
    }
    if (this.crystalLight)
      this.crystalLight.intensity = CFG.CRYSTAL_LIGHT_INTENSITY * (0.82 + Math.sin(t * 2.2) * 0.24);

    if (this.crystalClusterMesh) {
      const base = CFG.MODEL_SCALE.CLUSTER;
      this.crystalClusterMesh.rotation.y += dt * 0.08;
      this.crystalClusterMesh.scale.setScalar(base + Math.cos(t * 1.4) * base * 0.035);
    }
    if (this.clusterLight)
      this.clusterLight.intensity = CFG.CRYSTAL_LIGHT_INTENSITY * 0.75 * (0.82 + Math.cos(t * 1.9) * 0.22);
  }

  private _animateCrystalShards(dt: number): void {
    if (!this.crystalShards) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const t = this.elapsed;
    const cx = 20 * WORLD_SCALE, cz = -20 * WORLD_SCALE;
    const COUNT = this.crystalShards.count;
    for (let i = 0; i < COUNT; i++) {
      const baseA = (i / COUNT) * Math.PI * 2;
      const a = baseA + t * 0.35;
      const r = 3.8 + Math.sin(t * 0.8 + i) * 0.6;
      const y = 2.2 + Math.sin(t * 1.2 + i * 0.7) * 1.2;
      q.setFromEuler(new THREE.Euler(t * 0.6 + i, t * 0.8, 0));
      m.compose(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r), q, s);
      this.crystalShards.setMatrixAt(i, m);
    }
    this.crystalShards.instanceMatrix.needsUpdate = true;
  }

  private _animatePortal(dt: number): void {
    const t = this.elapsed;
    this.portalRing.rotation.z      += dt * 0.5;
    this.portalInnerRing.rotation.z -= dt * 0.9;
    this.portalInnerRing.rotation.y += dt * 0.15;

    const dMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    dMat.opacity = 0.28 + Math.sin(t * 2.5) * 0.12;
    dMat.emissiveIntensity = 0.5 + Math.sin(t * 1.8) * 0.25;

    const coreMat = this.portalCore.material as THREE.MeshBasicMaterial;
    coreMat.opacity = 0.7 + Math.sin(t * 3.5) * 0.2;
    this.portalCore.scale.setScalar(1 + Math.sin(t * 2.2) * 0.12);

    this.portalLight.intensity = 5.5 + Math.sin(t * 3.2) * 1.6;
    this.portalParticles.rotation.z += dt * 0.3;
    this.portalSwirl.rotation.z     -= dt * 0.9;

    this.portalGroup.position.y = 2.8 + Math.sin(t * 0.9) * 0.14;

    // Shockwave loop (~2.4s)
    this.shockwavePhase += dt / 2.4;
    if (this.shockwavePhase >= 1) this.shockwavePhase -= 1;
    const k = this.shockwavePhase;
    this.portalShockwave.scale.setScalar(0.4 + k * 18);
    (this.portalShockwave.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.55;
  }

  private _animateRunes(dt: number): void {
    this.runePulseClock += dt;
    const wavePeriod = 3.2;
    const waveK = (this.runePulseClock % wavePeriod) / wavePeriod;

    this.runes.forEach((r, i) => {
      r.phase += dt * 1.4;
      r.light.intensity = CFG.RUNE_INTENSITY * (0.7 + Math.sin(r.phase) * 0.45);
      r.stone.position.y = 1.1 + Math.sin(r.phase * 0.8) * 0.08;
      r.stone.rotation.y += dt * 0.25;
      (r.glowPlane.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(r.phase) * 0.1;

      // Pulse cá nhân chạy lệch pha theo index
      const localK = (waveK + i / this.runes.length) % 1;
      r.pulse.scale.setScalar(0.3 + localK * 9);
      (r.pulse.material as THREE.MeshBasicMaterial).opacity = (1 - localK) * 0.5;
    });
  }

  private _animateFloatingRocks(dt: number): void {
    this.floatingRocks.forEach(r => {
      r.phase += dt * 0.6;
      r.mesh.position.y = r.baseY + Math.sin(r.phase) * 0.55;
      r.mesh.rotation.x += r.rotSpeed.x * dt;
      r.mesh.rotation.y += r.rotSpeed.y * dt;
      r.mesh.rotation.z += r.rotSpeed.z * dt;
    });
  }

  private _animateGroundMist(dt: number): void {
    if (!this.groundMist) return;
    const t = this.elapsed;
    this.groundMist.position.y = 0.55 + Math.sin(t * 0.4) * 0.12;
    (this.groundMist.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(t * 0.6) * 0.04;
  }

  private _animateParticles(dt: number): void {
    const t = this.elapsed;
    // Dust
    const dP = this.dustParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dP.count; i++) {
      let x = dP.getX(i) + dt * 0.09; if (x > 100) x = -100; dP.setX(i, x);
      let y = dP.getY(i) + dt * 0.02; if (y > 8) y = 0; dP.setY(i, y);
    }
    dP.needsUpdate = true;

    // Crystal swirl
    const cx = 20 * WORLD_SCALE, cz = -20 * WORLD_SCALE;
    const cP = this.crystalParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cP.count; i++) {
      let y = cP.getY(i) + dt * 0.18; if (y > 7) y = 0; cP.setY(i, y);
      const rx = cP.getX(i) - cx, rz = cP.getZ(i) - cz;
      const a = Math.atan2(rz, rx) + dt * 0.25;
      const r = Math.sqrt(rx * rx + rz * rz);
      cP.setX(i, cx + Math.cos(a) * r);
      cP.setZ(i, cz + Math.sin(a) * r);
    }
    cP.needsUpdate = true;

    // Embers
    const eP = this.emberParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < eP.count; i++) {
      let y = eP.getY(i) + dt * 0.25; if (y > 5) y = 0; eP.setY(i, y);
      eP.setX(i, eP.getX(i) + Math.sin(t * 0.5 + i) * dt * 0.05);
    }
    eP.needsUpdate = true;
  }

  private _animateFireflies(dt: number): void {
    if (!this.fireflies) return;
    const t = this.elapsed;
    const p = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      p.setX(i, p.getX(i) + Math.sin(t * 0.6 + i * 0.7) * dt * 0.4);
      p.setY(i, 1.2 + Math.sin(t * 0.8 + i) * 0.6 + (p.getY(i) - 1.2) * 0.985);
      p.setZ(i, p.getZ(i) + Math.cos(t * 0.5 + i * 0.9) * dt * 0.4);
    }
    p.needsUpdate = true;
    (this.fireflies.material as THREE.PointsMaterial).opacity = 0.75 + Math.sin(t * 1.5) * 0.2;
  }

  private _animateLightning(dt: number): void {
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      // Flash 1
      this.lightningLight.intensity = 4.5 + Math.random() * 5;
      const id1 = window.setTimeout(() => {
        if (this.lightningLight) this.lightningLight.intensity = 0;
      }, 80 + Math.random() * 120);
      this.lightningTimeouts.push(id1);

      // Flash 2 (double-flash 50% chance)
      if (Math.random() > 0.5) {
        const id2 = window.setTimeout(() => {
          if (!this.lightningLight) return;
          this.lightningLight.intensity = 2.5 + Math.random() * 2.5;
          const id3 = window.setTimeout(() => {
            if (this.lightningLight) this.lightningLight.intensity = 0;
          }, 60);
          this.lightningTimeouts.push(id3);
        }, 200);
        this.lightningTimeouts.push(id2);
      }

      // Sync rune flash
      this.runes.forEach(r => { r.light.intensity = CFG.RUNE_INTENSITY * 2.2; });
      const idR = window.setTimeout(() => {
        this.runes.forEach(r => { r.light.intensity = CFG.RUNE_INTENSITY; });
      }, 160);
      this.lightningTimeouts.push(idR);

      this.nextLightning = 5 + Math.random() * 8;
    }
  }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
}
