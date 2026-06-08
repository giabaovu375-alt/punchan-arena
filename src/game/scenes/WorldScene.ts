import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { setupLighting } from "./hub/HubLighting";
import { loadAllModels, setupEnvironment } from "./hub/HubEnvironment";

// ─── Offset từng khu vực trong WorldScene ────────────────────────────────────
const ZONE = {
  HUB:           new THREE.Vector3(   0,  0,    0),
  MAIN_ROAD:     new THREE.Vector3(   0,  0,  220),
  LEFT_FOREST:   new THREE.Vector3(-210,  0,    0),
  RIGHT_PLATFORM:new THREE.Vector3( 210,  0,    0),
  BOSS_ARENA:    new THREE.Vector3(   0,  0, -300),
} as const;

// ─── Màu sắc từng khu — đồng bộ với scene riêng ─────────────────────────────
const ZONE_COLOR = {
  MAIN_ROAD_GROUND:  0x1c1a0f,
  MAIN_ROAD_ROAD:    0x2a1f0e,
  LEFT_FOREST:       0x141f0e,
  RIGHT_PLATFORM:    0x1a140f,
  BOSS_ARENA:        0x1a1010,
  BOSS_BORDER:       0x330000,
  PILLAR:            0x1a0f0f,
} as const;

// ─── Enemy spawn config ───────────────────────────────────────────────────────
const SPAWNS = [
  {
    label: "Hub",
    points: [new THREE.Vector3(10, 0, 10), new THREE.Vector3(-10, 0, -10)],
    cfg: { scale: 4.0, chaseRange: 15 },
  },
  {
    label: "MainRoad",
    points: [new THREE.Vector3(0, 0, 255), new THREE.Vector3(5, 0, 170)],
    cfg: { scale: 4.0, chaseRange: 20 },
  },
  {
    label: "LeftForest",
    points: [new THREE.Vector3(-215, 0, 20), new THREE.Vector3(-195, 0, -20)],
    cfg: { scale: 4.5, chaseRange: 18 },
  },
  {
    label: "RightPlatform",
    points: [new THREE.Vector3(215, 0, 25), new THREE.Vector3(195, 0, -25)],
    cfg: { scale: 4.0, chaseRange: 18 },
  },
  {
    label: "BossArena",
    points: [ZONE.BOSS_ARENA.clone()],
    cfg: { scale: 12.0, maxHp: 500, chaseRange: 50, attackDamage: 25, patrolRadius: 0 },
  },
] as const;

// ─── WorldScene ───────────────────────────────────────────────────────────────
export class WorldScene extends BaseScene {
  public  scene: THREE.Scene;

  private enemyManager!: EnemyManager;
  private playerRef!:    THREE.Object3D;
  private cameraRef!:    THREE.Camera;
  private elapsed = 0;

  // Refs để animate
  private pillarFires:  { light: THREE.PointLight; phase: number }[] = [];
  private torches:      { light: THREE.PointLight; phase: number }[] = [];
  private wisps:        { light: THREE.PointLight; phase: number; base: THREE.Vector3 }[] = [];
  private centralFire!: THREE.PointLight;

  // Particles toàn cục
  private emberParticles!: THREE.Points;
  private sporeParticles!: THREE.Points;
  private dustParticles!:  THREE.Points;

  constructor() {
    super("WorldScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }
  public checkPortals(): null { return null; }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    this._setupGlobalAtmosphere();

    // Hub — dùng lại HubLighting + HubEnvironment
    setupLighting(this.scene);
    const loader     = new GLTFLoader();
    const modelCache = await loadAllModels(loader);
    await setupEnvironment(this.scene, modelCache);

    // Các khu vực còn lại
    this._buildMainRoad();
    this._buildLeftForest();
    this._buildRightPlatform();
    this._buildBossArena();

    // Particles toàn cục
    this._buildParticles();

    // Spawn quái
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this._spawnAllEnemies();

    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "WorldScene" });
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateTorches(dt);
    this._animateWisps(dt);
    this._animatePillarFires(dt);
    this._animateCentralFire(dt);
    this._animateParticles(dt);

    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
  }

  protected async onUnload(): Promise<void> {
    this.enemyManager?.dispose();
    collisionManager.clear();
  }

  public update(dt: number): void { this.onUpdate(dt); }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Atmosphere chung — tối, huyền bí, bao trùm toàn bộ world */
  private _setupGlobalAtmosphere(): void {
    this.scene.background = new THREE.Color(0x060410);
    // FogExp2 bao phủ toàn world — các khu xa mờ dần tự nhiên
    this.scene.fog = new THREE.FogExp2(0x0d0520, 0.004);
    this.scene.add(new THREE.AmbientLight(0x1a0a30, 0.35));
  }

  // ─── MainRoad ──────────────────────────────────────────────────────────────
  private _buildMainRoad(): void {
    const O = ZONE.MAIN_ROAD;

    // Nền đất tối
    this._addPlane(200, 320, ZONE_COLOR.MAIN_ROAD_GROUND, O, 0, 1.0);

    // Đường
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 320),
      new THREE.MeshStandardMaterial({ color: ZONE_COLOR.MAIN_ROAD_ROAD, roughness: 0.95 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.copy(O).add(new THREE.Vector3(0, 0.02, 0));
    this.scene.add(road);

    // Đuốc 2 bên đường
    for (let z = -120; z <= 120; z += 22) {
      for (const sx of [-3.8, 3.8]) {
        this._addTorch(new THREE.Vector3(O.x + sx, 0, O.z + z));
      }
    }

    // Ánh trăng khu đường
    const moon = new THREE.DirectionalLight(0x9ab8e8, 0.6);
    moon.position.set(O.x - 30, 80, O.z - 20);
    this.scene.add(moon);
  }

  // ─── LeftForest ────────────────────────────────────────────────────────────
  private _buildLeftForest(): void {
    const O = ZONE.LEFT_FOREST;

    this._addPlane(150, 150, ZONE_COLOR.LEFT_FOREST, O, 0, 1.0);

    // Sương mù cục bộ — PointLight tím xanh mờ thay FogExp2
    // (WorldScene dùng fog chung nên không override)

    // Wisp lights đặc trưng của rừng
    const wispPositions = [
      new THREE.Vector3(O.x - 15, 1.5, O.z - 20),
      new THREE.Vector3(O.x + 10, 2.0, O.z + 30),
      new THREE.Vector3(O.x - 30, 1.2, O.z + 15),
    ];
    wispPositions.forEach((pos, i) => {
      const light = new THREE.PointLight(0x22ff88, 1.8, 14);
      light.position.copy(pos);
      this.scene.add(light);

      // Orb visual
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0x22ff88,
          emissive: new THREE.Color(0x22ff88),
          emissiveIntensity: 2.0,
        })
      );
      orb.position.copy(pos);
      this.scene.add(orb);

      this.wisps.push({ light, phase: i * 1.57, base: pos.clone() });
    });

    // Ambient xanh lá nhẹ cho khu rừng
    const forestAmb = new THREE.PointLight(0x1a3320, 0.8, 80);
    forestAmb.position.copy(O).add(new THREE.Vector3(0, 5, 0));
    this.scene.add(forestAmb);
  }

  // ─── RightPlatform ─────────────────────────────────────────────────────────
  private _buildRightPlatform(): void {
    const O = ZONE.RIGHT_PLATFORM;

    this._addPlane(150, 150, ZONE_COLOR.RIGHT_PLATFORM, O, 0, 1.0, true);

    // Platform trung tâm heptagonal
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 22, 0.4, 7),
      new THREE.MeshStandardMaterial({ color: 0x1f1820, roughness: 0.95, flatShading: true })
    );
    platform.position.copy(O).add(new THREE.Vector3(0, 0.2, 0));
    platform.castShadow = true;
    this.scene.add(platform);

    // Rune stones tím
    const runePositions = [
      new THREE.Vector3(O.x - 18, 0.3, O.z - 18),
      new THREE.Vector3(O.x + 18, 0.3, O.z + 22),
      new THREE.Vector3(O.x - 28, 0.3, O.z + 10),
    ];
    runePositions.forEach((pos, i) => {
      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.4, 0),
        new THREE.MeshStandardMaterial({
          color:             0x2a0055,
          emissive:          new THREE.Color(0x6622ff),
          emissiveIntensity: 0.8,
        })
      );
      stone.position.copy(pos);
      this.scene.add(stone);

      const runeLight = new THREE.PointLight(0x6622ff, 1.2, 8);
      runeLight.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
      this.scene.add(runeLight);
      // Dùng wisps array để animate (cùng logic lắc lư)
      this.wisps.push({ light: runeLight, phase: i * 2.1 + 5, base: pos.clone() });
    });

    // Ánh trăng riêng cho khu đá
    const moonRock = new THREE.DirectionalLight(0x9ab8e8, 0.55);
    moonRock.position.set(O.x + 60, 100, O.z + 30);
    this.scene.add(moonRock);
  }

  // ─── BossArena ─────────────────────────────────────────────────────────────
  private _buildBossArena(): void {
    const O = ZONE.BOSS_ARENA;

    // Nền ngoài
    this._addPlane(200, 200, 0x0d0808, O, 0, 1.0);

    // Sàn đấu chính
    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(40, 72),
      new THREE.MeshStandardMaterial({
        color:     ZONE_COLOR.BOSS_ARENA,
        roughness: 0.75,
        metalness: 0.25,
      })
    );
    arena.rotation.x  = -Math.PI / 2;
    arena.position.copy(O).add(new THREE.Vector3(0, 0.02, 0));
    arena.receiveShadow = true;
    this.scene.add(arena);

    // Vành đai đỏ phát sáng
    const border = new THREE.Mesh(
      new THREE.RingGeometry(39, 41.5, 72),
      new THREE.MeshStandardMaterial({
        color:             ZONE_COLOR.BOSS_BORDER,
        emissive:          new THREE.Color(0x550000),
        emissiveIntensity: 0.4,
        side:              THREE.DoubleSide,
        depthWrite:        false,
      })
    );
    border.rotation.x  = -Math.PI / 2;
    border.position.copy(O).add(new THREE.Vector3(0, 0.03, 0));
    this.scene.add(border);

    // Lửa trung tâm Arena
    const fireBall = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 12, 12),
      new THREE.MeshStandardMaterial({
        color:             0xff4400,
        emissive:          new THREE.Color(0xff2200),
        emissiveIntensity: 3.0,
        transparent:       true,
        opacity:           0.85,
      })
    );
    fireBall.position.copy(O).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.add(fireBall);

    this.centralFire = new THREE.PointLight(0xff3300, 5.0, 100);
    this.centralFire.position.copy(O).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(this.centralFire);

    // 8 cột lửa vành đai
    const pillarMat = new THREE.MeshStandardMaterial({
      color: ZONE_COLOR.PILLAR, roughness: 0.6, metalness: 0.6,
    });
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const px    = O.x + Math.cos(angle) * 36;
      const pz    = O.z + Math.sin(angle) * 36;

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.65, 5.5, 8), pillarMat
      );
      shaft.position.set(px, 2.75, pz);
      shaft.castShadow = true;
      this.scene.add(shaft);

      const fireBallPillar = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0xff6600, emissive: new THREE.Color(0xff6600), emissiveIntensity: 2.0,
        })
      );
      fireBallPillar.position.set(px, 6.3, pz);
      this.scene.add(fireBallPillar);

      const fire = new THREE.PointLight(0xff6600, 1.8, 14);
      fire.position.set(px, 6.5, pz);
      this.scene.add(fire);
      this.pillarFires.push({ light: fire, phase: i * 0.785 });
    }

    // Ambient đỏ địa ngục cho Boss zone
    const hellAmb = new THREE.PointLight(0x660000, 1.5, 120);
    hellAmb.position.copy(O).add(new THREE.Vector3(0, 8, 0));
    this.scene.add(hellAmb);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Tạo plane + đặt vị trí nhanh */
  private _addPlane(
    w: number, h: number, color: number,
    center: THREE.Vector3, yOffset = 0, roughness = 1.0, flatShading = false
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ color, roughness, flatShading })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(center).add(new THREE.Vector3(0, yOffset, 0));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /** Tạo đuốc geometry + PointLight */
  private _addTorch(pos: THREE.Vector3): void {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2510, roughness: 1 })
    );
    pole.position.copy(pos).add(new THREE.Vector3(0, 1.1, 0));
    pole.castShadow = true;
    this.scene.add(pole);

    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.10, 0.25, 8),
      new THREE.MeshStandardMaterial({
        color: 0x8b4500, roughness: 0.7,
        emissive: new THREE.Color(0xff4400), emissiveIntensity: 0.6,
      })
    );
    head.position.copy(pos).add(new THREE.Vector3(0, 2.4, 0));
    this.scene.add(head);

    const light = new THREE.PointLight(0xff6a1a, 3.5, 18);
    light.position.copy(pos).add(new THREE.Vector3(0, 2.6, 0));
    this.scene.add(light);

    this.torches.push({ light, phase: this.torches.length * 0.73 });
  }

  // ─── Particles toàn world ──────────────────────────────────────────────────
  private _buildParticles(): void {
    // Bụi đường — quanh MainRoad
    const dustCount = 200;
    const dustPos   = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3]     = ZONE.MAIN_ROAD.x + (Math.random() - 0.5) * 12;
      dustPos[i * 3 + 1] = Math.random() * 3;
      dustPos[i * 3 + 2] = ZONE.MAIN_ROAD.z + (Math.random() - 0.5) * 280;
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.dustParticles = new THREE.Points(
      dGeo,
      new THREE.PointsMaterial({ color: 0xc8a46e, size: 0.07, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.scene.add(this.dustParticles);

    // Bào tử rừng — quanh LeftForest
    const sporeCount = 150;
    const sporePos   = new Float32Array(sporeCount * 3);
    for (let i = 0; i < sporeCount; i++) {
      sporePos[i * 3]     = ZONE.LEFT_FOREST.x + (Math.random() - 0.5) * 120;
      sporePos[i * 3 + 1] = Math.random() * 4;
      sporePos[i * 3 + 2] = ZONE.LEFT_FOREST.z + (Math.random() - 0.5) * 120;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute("position", new THREE.BufferAttribute(sporePos, 3));
    this.sporeParticles = new THREE.Points(
      sGeo,
      new THREE.PointsMaterial({ color: 0x88ffbb, size: 0.09, transparent: true, opacity: 0.45, depthWrite: false })
    );
    this.scene.add(this.sporeParticles);

    // Ember — quanh BossArena
    const emberCount = 120;
    const emberPos   = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * 8;
      emberPos[i * 3]     = ZONE.BOSS_ARENA.x + Math.cos(angle) * r;
      emberPos[i * 3 + 1] = Math.random() * 8;
      emberPos[i * 3 + 2] = ZONE.BOSS_ARENA.z + Math.sin(angle) * r;
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    this.emberParticles = new THREE.Points(
      eGeo,
      new THREE.PointsMaterial({ color: 0xff4400, size: 0.1, transparent: true, opacity: 0.7, depthWrite: false })
    );
    this.scene.add(this.emberParticles);
  }

  // ─── Spawn enemies ─────────────────────────────────────────────────────────
  private _spawnAllEnemies(): void {
    SPAWNS.forEach(({ points, cfg }) => {
      this.enemyManager.spawn(
        points as unknown as THREE.Vector3[],
        { ...GOBLIN_CONFIG, ...cfg }
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATORS
  // ═══════════════════════════════════════════════════════════════════════════

  private _animateTorches(dt: number): void {
    this.torches.forEach((t) => {
      t.phase += dt * 8;
      t.light.intensity = 3.5 * (1 + Math.sin(t.phase * 1.3) * 0.18 + Math.sin(t.phase * 2.7) * 0.08);
    });
  }

  private _animateWisps(dt: number): void {
    this.wisps.forEach((w) => {
      w.phase += dt * 1.2;
      w.light.position.set(
        w.base.x + Math.sin(w.phase * 0.7) * 1.2,
        w.base.y + Math.sin(w.phase) * 0.5,
        w.base.z + Math.cos(w.phase * 0.5) * 1.0,
      );
      w.light.intensity = 1.8 * (0.8 + Math.sin(w.phase * 2.1) * 0.25);
    });
  }

  private _animatePillarFires(dt: number): void {
    this.pillarFires.forEach((p) => {
      p.phase += dt * 9;
      p.light.intensity = 1.8 * (1 + Math.sin(p.phase) * 0.25 + Math.sin(p.phase * 2.1) * 0.1);
    });
  }

  private _animateCentralFire(dt: number): void {
    if (!this.centralFire) return;
    const t = this.elapsed;
    this.centralFire.intensity =
      5.0 * (1 + Math.sin(t * 7.3) * 0.3 + Math.sin(t * 13.1) * 0.15);
  }

  private _animateParticles(dt: number): void {
    const t = this.elapsed;

    // Bụi đường trôi ngang
    const dp = this.dustParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) {
      let x = dp.getX(i) + dt * 0.05; if (x > ZONE.MAIN_ROAD.x + 6)  x = ZONE.MAIN_ROAD.x - 6;
      let y = dp.getY(i) + dt * 0.06; if (y > 3.5) y = 0;
      dp.setXY(i, x, y);
    }
    dp.needsUpdate = true;

    // Bào tử bay lên lắc lư
    const sp = this.sporeParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      let y = sp.getY(i) + dt * 0.05; if (y > 4.5) y = 0;
      sp.setY(i, y);
      sp.setX(i, sp.getX(i) + Math.sin(t + i) * dt * 0.04);
    }
    sp.needsUpdate = true;

    // Ember bay lên xoáy
    const ep = this.emberParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ep.count; i++) {
      let y = ep.getY(i) + dt * (0.4 + Math.sin(t + i) * 0.15);
      if (y > 9) y = 0;
      ep.setY(i, y);
      const x = ep.getX(i) - ZONE.BOSS_ARENA.x;
      const z = ep.getZ(i) - ZONE.BOSS_ARENA.z;
      const angle = Math.atan2(z, x) + dt * 0.1;
      const r     = Math.sqrt(x * x + z * z);
      ep.setX(i, ZONE.BOSS_ARENA.x + Math.cos(angle) * r);
      ep.setZ(i, ZONE.BOSS_ARENA.z + Math.sin(angle) * r);
    }
    ep.needsUpdate = true;
  }
      }
