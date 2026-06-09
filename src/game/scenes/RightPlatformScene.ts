import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
  // Atmosphere — đêm đá tím đen, lạnh và nguy hiểm
  FOG_COLOR:         0x080510,
  SKY_COLOR:         0x050310,
  FOG_DENSITY:       0.020,

  AMBIENT_COLOR:     0x1a0d2e,
  AMBIENT_INTENSITY: 0.5,

  // Trăng lạnh xanh trắng
  MOON_COLOR:        0x9ab8e8,
  MOON_INTENSITY:    0.75,

  // Ground
  GROUND_COLOR:      0x100c14,
  PLATFORM_COLOR:    0x1a1020,

  // Crystal hồng tím
  CRYSTAL_COLOR:     0xff44cc,
  CRYSTAL_EMISSIVE:  1.1,
  CRYSTAL_LIGHT_COLOR:     0xff44cc,
  CRYSTAL_LIGHT_INTENSITY: 2.8,
  CRYSTAL_LIGHT_DISTANCE:  22,

  // Portal vàng hổ phách
  PORTAL_COLOR:      0xffaa00,
  PORTAL_POS:        new THREE.Vector3(30, 0, 0),
  PORTAL_TRIGGER:    3.5,

  // Rune tím
  RUNE_COLOR:        0x7733ff,
  RUNE_INTENSITY:    1.4,
  RUNE_DISTANCE:     9,

  // Particles
  DUST_COUNT:        280,
  CRYSTAL_PART_COUNT: 150,
  EMBER_COUNT:       100,
} as const;

// ─── SCENE ────────────────────────────────────────────────────────────────────
export class RightPlatformScene extends BaseScene {
  public  scene: THREE.Scene;

  private enemyManager!: EnemyManager;
  private playerRef!:    THREE.Object3D;
  private cameraRef!:    THREE.Camera;
  private elapsed = 0;

  // Crystal
  private crystalMesh!:        THREE.Group;
  private crystalClusterMesh!: THREE.Group;
  private crystalLight!:       THREE.PointLight;
  private clusterLight!:       THREE.PointLight;

  // Portal
  private portalGroup!:      THREE.Group;
  private portalRing!:       THREE.Mesh;
  private portalInnerRing!:  THREE.Mesh;
  private portalDisk!:       THREE.Mesh;
  private portalLight!:      THREE.PointLight;
  private portalParticles!:  THREE.Points;

  // Rune stones
  private runes: {
    light: THREE.PointLight;
    stone: THREE.Mesh;
    glowPlane: THREE.Mesh;
    phase: number;
  }[] = [];

  // Floating rocks
  private floatingRocks: {
    mesh: THREE.Mesh;
    baseY: number;
    phase: number;
    rotSpeed: THREE.Vector3;
  }[] = [];

  // Particles
  private dustParticles!:    THREE.Points;
  private crystalParticles!: THREE.Points;
  private emberParticles!:   THREE.Points;

  // Lightning
  private lightningLight!:   THREE.PointLight;
  private nextLightning = 0;

  // Dispose tracking
  private disposables:    THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[]       = [];

  constructor() {
    super("RightPlatformScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // ─── LIFECYCLE ───────────────────────────────────────────────────────────
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
    this._animateParticles(dt);
    this._animateFloatingRocks(dt);
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
    const dx = playerPos.x - CFG.PORTAL_POS.x;
    const dz = playerPos.z - CFG.PORTAL_POS.z;
    return (dx * dx + dz * dz) < CFG.PORTAL_TRIGGER * CFG.PORTAL_TRIGGER
      ? "HubScene" : null;
      
  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.FOG_DENSITY);

    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));

    // Trăng chính — bóng sắc nét trên đá
    const moon = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    moon.position.set(60, 100, 30);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left   = -80; moon.shadow.camera.right  = 80;
    moon.shadow.camera.top    =  80; moon.shadow.camera.bottom = -80;
    moon.shadow.camera.near   = 1;   moon.shadow.camera.far    = 220;
    moon.shadow.bias          = -0.0005;
    moon.shadow.normalBias    = 0.02;
    this.scene.add(moon);

    // Rim tím từ dưới — tôn crystal và viền đá
    const rim = new THREE.DirectionalLight(0x440088, 0.3);
    rim.position.set(0, -8, 20);
    this.scene.add(rim);

    // Fill lạnh từ bên đối diện
    const fill = new THREE.DirectionalLight(0x0a0520, 0.2);
    fill.position.set(-50, 20, -30);
    this.scene.add(fill);
  }

  private _buildTerrain(): void {
    // Ground với vertex displacement nhẹ — cảm giác đá thô
    const groundGeo = new THREE.PlaneGeometry(160, 160, 50, 50);
    const gPos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gPos.count; i++) {
      const x = gPos.getX(i), z = gPos.getY(i);
      gPos.setZ(i,
        Math.sin(x * 0.1) * 0.35 +
        Math.cos(z * 0.13) * 0.25 +
        (Math.random() - 0.5) * 0.18
      );
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
      color: CFG.GROUND_COLOR, roughness: 1.0, metalness: 0.05, flatShading: true,
    });
    this.disposables.push(groundGeo);
    this.disposableMats.push(groundMat);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Platform chính — heptagon (7 cạnh) thô, cảm giác dungeon
    const platGeo = new THREE.CylinderGeometry(18, 22, 0.5, 7, 2, false);
    const platPos = platGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < platPos.count; i++) {
      platPos.setX(i, platPos.getX(i) + (Math.random() - 0.5) * 0.3);
      platPos.setZ(i, platPos.getZ(i) + (Math.random() - 0.5) * 0.3);
    }
    platGeo.computeVertexNormals();
    const platMat = new THREE.MeshStandardMaterial({
      color: CFG.PLATFORM_COLOR, roughness: 0.95, metalness: 0.08, flatShading: true,
    });
    this.disposables.push(platGeo);
    this.disposableMats.push(platMat);
    const platform = new THREE.Mesh(platGeo, platMat);
    platform.position.set(0, 0.2, 0);
    platform.receiveShadow = true;
    platform.castShadow    = true;
    this.scene.add(platform);

    // Viền crack lines — vệt tối dọc platform
    const crackMat = new THREE.MeshStandardMaterial({
      color: 0x060408, roughness: 1.0, transparent: true, opacity: 0.6, depthWrite: false,
    });
    this.disposableMats.push(crackMat);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const len   = 6 + Math.random() * 8;
      const cGeo  = new THREE.PlaneGeometry(0.12, len);
      this.disposables.push(cGeo);
      const crack = new THREE.Mesh(cGeo, crackMat);
      crack.rotation.x = -Math.PI / 2;
      crack.rotation.z = angle;
      crack.position.set(Math.cos(angle) * 7, 0.72, Math.sin(angle) * 7);
      this.scene.add(crack);
    }
  }

  // Đá trôi nổi xung quanh platform — hiệu ứng dungeon magic
  private _buildFloatingRocks(): void {
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x1a1025, roughness: 0.9, metalness: 0.1, flatShading: true,
    });
    this.disposableMats.push(rockMat);

    const configs = [
      { x: -22, z: -18, s: 1.2 }, { x:  25, z:  20, s: 0.9 },
      { x: -15, z:  28, s: 1.5 }, { x:  30, z: -22, s: 0.8 },
      { x:  -8, z: -32, s: 1.1 }, { x:  18, z:  -8, s: 0.7 },
    ];

    configs.forEach(({ x, z, s }, i) => {
      const geo = new THREE.DodecahedronGeometry(s, 1);
      // Distort vertices
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        pos.setXYZ(j,
          pos.getX(j) * (0.85 + Math.random() * 0.3),
          pos.getY(j) * (0.85 + Math.random() * 0.3),
          pos.getZ(j) * (0.85 + Math.random() * 0.3)
        );
      }
      geo.computeVertexNormals();
      this.disposables.push(geo);

      const mesh = new THREE.Mesh(geo, rockMat);
      const baseY = 2.5 + Math.random() * 3;
      mesh.position.set(x, baseY, z);
      mesh.castShadow = true;
      this.scene.add(mesh);

      this.floatingRocks.push({
        mesh, baseY,
        phase: i * 1.05,
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.3
        ),
      });
    });
  }

  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();

// Outer ring
    const outerGeo = new THREE.TorusGeometry(2.3, 0.15, 20, 80);
    this.disposables.push(outerGeo);
    const outerMat = new THREE.MeshStandardMaterial({
      color:             CFG.PORTAL_COLOR,
      emissive:          new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 1.8,
      roughness:         0.1,
      metalness:         0.9,
    });
    this.disposableMats.push(outerMat);
    this.portalRing = new THREE.Mesh(outerGeo, outerMat);
    this.portalGroup.add(this.portalRing);

    // Inner ring — counter spins
    const innerGeo = new THREE.TorusGeometry(1.75, 0.07, 12, 60);
    this.disposables.push(innerGeo);
    const innerMat = new THREE.MeshStandardMaterial({
      color:             CFG.PORTAL_COLOR,
      emissive:          new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 2.2,
      roughness:         0.05,
      metalness:         0.95,
      transparent:       true,
      opacity:           0.75,
    });
    this.disposableMats.push(innerMat);
    this.portalInnerRing = new THREE.Mesh(innerGeo, innerMat);
    this.portalGroup.add(this.portalInnerRing);

    // Disk
    const diskGeo = new THREE.CircleGeometry(2.1, 80);
    this.disposables.push(diskGeo);
    const diskMat = new THREE.MeshStandardMaterial({
      color:             CFG.PORTAL_COLOR,
      emissive:          new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 0.35,
      transparent:       true,
      opacity:           0.25,
      side:              THREE.DoubleSide,
      depthWrite:        false,
    });
    this.disposableMats.push(diskMat);
    this.portalDisk = new THREE.Mesh(diskGeo, diskMat);
    this.portalGroup.add(this.portalDisk);

    // Particle ring — xoay theo trục Z (portal đứng thẳng)
    const pCount = 100;
    const pPos   = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const angle = (i / pCount) * Math.PI * 2;
      const r     = 2.3 + (Math.random() - 0.5) * 0.5;
      pPos[i * 3]     = Math.cos(angle) * r;
      pPos[i * 3 + 1] = Math.sin(angle) * r;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    this.disposables.push(pGeo);
    const pMat = new THREE.PointsMaterial({
      color: CFG.PORTAL_COLOR, size: 0.09, transparent: true, opacity: 0.8, depthWrite: false,
    });
    this.disposableMats.push(pMat);
    this.portalParticles = new THREE.Points(pGeo, pMat);
    this.portalGroup.add(this.portalParticles);

    // Lights
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 4.5, 24);
    this.portalGroup.add(this.portalLight);
    // Ground glow
    const groundGlow = new THREE.PointLight(CFG.PORTAL_COLOR, 1.5, 10);
    groundGlow.position.set(0, -2, 0);
    this.portalGroup.add(groundGlow);

    this.portalGroup.position.set(CFG.PORTAL_POS.x, 2.2, CFG.PORTAL_POS.z);
    this.scene.add(this.portalGroup);
  }

  private _buildRuneLights(): void {
    const positions = [
      new THREE.Vector3(-18, 0.3, -18),
      new THREE.Vector3( 18, 0.3,  22),
      new THREE.Vector3(-28, 0.3,  10),
      new THREE.Vector3( 10, 0.3, -30),
      new THREE.Vector3(-10, 0.3,  35),
      new THREE.Vector3( 32, 0.3, -15), // extra
    ];

    const stoneMat = new THREE.MeshStandardMaterial({
      color:             0x1a0035,
      emissive:          new THREE.Color(CFG.RUNE_COLOR),
      emissiveIntensity: 0.9,
      roughness:         0.55,
      metalness:         0.35,
    });
    this.disposableMats.push(stoneMat);

    // Ground glow plane shared mat
    const glowMat = new THREE.MeshStandardMaterial({
      color:       CFG.RUNE_COLOR,
      emissive:    new THREE.Color(CFG.RUNE_COLOR),
      emissiveIntensity: 0.5,
      transparent: true,
      opacity:     0.15,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    this.disposableMats.push(glowMat);

    positions.forEach((pos, i) => {
      // Rune stone mesh
      const stoneGeo = new THREE.DodecahedronGeometry(0.45, 0);
      this.disposables.push(stoneGeo);
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.copy(pos);
      stone.rotation.set(Math.random(), Math.random(), Math.random());
      stone.castShadow = true;
      this.scene.add(stone);

      // Ground glow projection circle
      const glowGeo = new THREE.CircleGeometry(1.4, 20);
      this.disposables.push(glowGeo);
      const glowPlane = new THREE.Mesh(glowGeo, glowMat);
      glowPlane.rotation.x = -Math.PI / 2;
      glowPlane.position.copy(pos);
      glowPlane.position.y = 0.05;
      this.scene.add(glowPlane);

      // Point light
      const light = new THREE.PointLight(CFG.RUNE_COLOR, CFG.RUNE_INTENSITY, CFG.RUNE_DISTANCE);
      light.position.copy(pos);
      light.position.y += 0.6;
      this.scene.add(light);

      this.runes.push({ light, stone, glowPlane, phase: i * 1.26 });
    });
  }

  private _buildParticles(): void {
    // ── Bụi đá xám tím trôi ngang ───────────────────────────────────────────
    const dustPos = new Float32Array(CFG.DUST_COUNT * 3);
    for (let i = 0; i < CFG.DUST_COUNT; i++) {
      dustPos[i * 3]     = (Math.random() - 0.5) * 140;
      dustPos[i * 3 + 1] = Math.random() * 5;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.disposables.push(dustGeo);
    const dustMat = new THREE.PointsMaterial({
      color: 0x554466, size: 0.07, transparent: true, opacity: 0.38, depthWrite: false,
    });
    this.disposableMats.push(dustMat);
    this.dustParticles = new THREE.Points(dustGeo, dustMat);
    this.scene.add(this.dustParticles);

    // ── Mảnh tinh thể hồng bay lên xoáy ─────────────────────────────────────
    const crystalPos = new Float32Array(CFG.CRYSTAL_PART_COUNT * 3);
    for (let i = 0; i < CFG.CRYSTAL_PART_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * 9;
      crystalPos[i * 3]     = 20 + Math.cos(angle) * r;
      crystalPos[i * 3 + 1] = Math.random() * 5;
      crystalPos[i * 3 + 2] = -20 + Math.sin(angle) * r;
    }
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.BufferAttribute(crystalPos, 3));
    this.disposables.push(cGeo);
    const cMat = new THREE.PointsMaterial({
      color: CFG.CRYSTAL_COLOR, size: 0.09, transparent: true, opacity: 0.65, depthWrite: false,
    });
    this.disposableMats.push(cMat);
    this.crystalParticles = new THREE.Points(cGeo, cMat);
    this.scene.add(this.crystalParticles);

    // ── Ember tia sáng tím bay lên từ rune stones ────────────────────────────
    const emberPos = new Float32Array(CFG.EMBER_COUNT * 3);
    for (let i = 0; i < CFG.EMBER_COUNT; i++) {
      emberPos[i * 3]     = (Math.random() - 0.5) * 80;
      emberPos[i * 3 + 1] = Math.random() * 3;
      emberPos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    this.disposables.push(eGeo);
    const eMat = new THREE.PointsMaterial({
      color: CFG.RUNE_COLOR, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.disposableMats.push(eMat);
    this.emberParticles = new THREE.Points(eGeo, eMat);
    this.scene.add(this.emberParticles);
  }

  // Lightning flash ẩn — hiệu ứng bầu trời xa
  private _buildLightning(): void {
    this.lightningLight = new THREE.PointLight(0xccaaff, 0, 200);
    this.lightningLight.position.set(0, 80, -60);
    this.scene.add(this.lightningLight);
    this.nextLightning = 4 + Math.random() * 6;
  }

  private async _loadModels(): Promise<void> {
    const loader = new GLTFLoader();
    const load   = (p: string) =>
      new Promise<THREE.Group>((res, rej) =>
        loader.load(p, (g) => res(g.scene), undefined, rej)
      );
    const shadow = (g: THREE.Group) =>
      g.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; }
      });
    const nightify = (g: THREE.Group, s = 0.35, tint = new THREE.Color(0.7, 0.6, 0.9)) =>
      g.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(s).multiply(tint);
          mat.roughness = Math.min((mat.roughness || 0.5) + 0.1, 1.0);
          m.material = mat;
        }
      });
// Cột đá trung tâm
    load("/model/stone pillar.glb").then((pillar) => {
      shadow(pillar); nightify(pillar, 0.4);
      pillar.scale.setScalar(2.0);
      this.scene.add(pillar);
    }).catch(() => {});

    // Crystal chính — hồng tím
    load("/model/crystal hong.glb").then((crystal) => {
      shadow(crystal);
      crystal.position.set(20, 0, -20);
      crystal.scale.setScalar(1.5);
      crystal.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive          = new THREE.Color(CFG.CRYSTAL_COLOR);
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE;
          mat.roughness         = 0.15;
          mat.metalness         = 0.3;
          m.material = mat;
        }
      });
      this.crystalMesh = crystal;
      this.scene.add(crystal);
      this.crystalLight = new THREE.PointLight(
        CFG.CRYSTAL_LIGHT_COLOR, CFG.CRYSTAL_LIGHT_INTENSITY, CFG.CRYSTAL_LIGHT_DISTANCE
      );
      this.crystalLight.position.set(20, 3, -20);
      this.scene.add(this.crystalLight);
    }).catch(() => {});

   // Crystal cluster
    load("/model/crystal cluster.glb").then((cluster) => {
      shadow(cluster);
      cluster.position.set(-25, 0, 25);
      cluster.scale.setScalar(2.0);
      cluster.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive          = new THREE.Color(CFG.CRYSTAL_COLOR);
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE * 0.7;
          mat.roughness         = 0.2;
          m.material = mat;
        }
      });
      this.crystalClusterMesh = cluster;
      this.scene.add(cluster);
      this.clusterLight = new THREE.PointLight(
        CFG.CRYSTAL_LIGHT_COLOR,
        CFG.CRYSTAL_LIGHT_INTENSITY * 0.7,
        CFG.CRYSTAL_LIGHT_DISTANCE * 0.8
      );
      this.clusterLight.position.set(-25, 2.5, 25);
      this.scene.add(this.clusterLight);
    }).catch(() => {});

    // Cầu dây — tối cho phù hợp đêm
    load("/model/old_ropebridge_low_poly.glb").then((bridge) => {
      shadow(bridge); nightify(bridge, 0.35, new THREE.Color(0.6, 0.55, 0.7));
      bridge.position.set(0, 0, -40);
      bridge.scale.setScalar(1.5);
      this.scene.add(bridge);
    }).catch(() => {});
  }

  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(20, 0, 15), new THREE.Vector3(-30, 0, 20)],
      { ...GOBLIN_CONFIG, scale: 4.0, chaseRange: 18, patrolRadius: 5 }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATORS
  // ═══════════════════════════════════════════════════════════════════════════

  private _animateCrystals(dt: number): void {
    const t = this.elapsed;

    if (this.crystalMesh) {
      this.crystalMesh.rotation.y += dt * 0.22;
      const pulse = 1.5 + Math.sin(t * 1.8) * 0.055;
      this.crystalMesh.scale.setScalar(pulse);
      // Subtle color shift in emissive
      this.crystalMesh.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.emissive) mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE * (0.8 + Math.sin(t * 2.5) * 0.25);
        }
      });
    }
    if (this.crystalLight) {
      this.crystalLight.intensity = CFG.CRYSTAL_LIGHT_INTENSITY * (0.82 + Math.sin(t * 2.2) * 0.22);
    }
    if (this.crystalClusterMesh) {
      this.crystalClusterMesh.scale.setScalar(2.0 + Math.cos(t * 1.4) * 0.05);
    }
    if (this.clusterLight) {
      this.clusterLight.intensity = CFG.CRYSTAL_LIGHT_INTENSITY * 0.7 * (0.82 + Math.cos(t * 1.9) * 0.22);
    }
  }

  private _animatePortal(dt: number): void {
    const t = this.elapsed;
    this.portalRing.rotation.z      += dt * 0.45;
    this.portalInnerRing.rotation.z -= dt * 0.75; // counter-spin
    this.portalInnerRing.rotation.y += dt * 0.1;

    const diskMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    diskMat.opacity           = 0.2 + Math.sin(t * 2.5) * 0.1;
    diskMat.emissiveIntensity = 0.28 + Math.sin(t * 1.8) * 0.14;

    this.portalLight.intensity = 3.8 + Math.sin(t * 3.2) * 1.1;
    this.portalParticles.rotation.z += dt * 0.25;

    // Bob
    this.portalGroup.position.y = 2.2 + Math.sin(t * 0.9) * 0.1;
  }

  private _animateRunes(dt: number): void {
    this.runes.forEach((r) => {
      r.phase += dt * 1.4;
      const intensity = CFG.RUNE_INTENSITY * (0.65 + Math.sin(r.phase) * 0.42);
      r.light.intensity = intensity;
      // Stone levitate slightly
      r.stone.position.y += Math.sin(r.phase * 0.8) * dt * 0.15;
      r.stone.rotation.y += dt * 0.3;
      // Ground glow pulse
      const gMat = r.glowPlane.material as THREE.MeshStandardMaterial;
      gMat.opacity = 0.1 + Math.sin(r.phase) * 0.08;
    });
  }

  private _animateFloatingRocks(dt: number): void {
    this.floatingRocks.forEach((r) => {
      r.phase += dt * 0.6;
      r.mesh.position.y = r.baseY + Math.sin(r.phase) * 0.5;
      r.mesh.rotation.x += r.rotSpeed.x * dt;
      r.mesh.rotation.y += r.rotSpeed.y * dt;
      r.mesh.rotation.z += r.rotSpeed.z * dt;
    });
  }

  private _animateParticles(dt: number): void {
    const t = this.elapsed;

    // Bụi đá trôi ngang chậm
    const dPos = this.dustParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dPos.count; i++) {
      let x = dPos.getX(i) + dt * 0.07;
      if (x > 70) x = -70;
      dPos.setX(i, x);
      let y = dPos.getY(i) + dt * 0.015;
      if (y > 6) y = 0;
      dPos.setY(i, y);
    }
    dPos.needsUpdate = true;

    // Crystal mảnh — xoáy lên
    const cPos = this.crystalParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cPos.count; i++) {
      let y = cPos.getY(i) + dt * 0.14;
      if (y > 6) y = 0;
      cPos.setY(i, y);
      const cx = cPos.getX(i) - 20, cz = cPos.getZ(i) + 20;
      const angle = Math.atan2(cz, cx) + dt * 0.22;
      const r     = Math.sqrt(cx * cx + cz * cz);
      cPos.setX(i, 20 + Math.cos(angle) * r);
      cPos.setZ(i, -20 + Math.sin(angle) * r);
    }
    cPos.needsUpdate = true;
// Ember bay lên rồi reset
    const ePos = this.emberParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ePos.count; i++) {
      let y = ePos.getY(i) + dt * 0.2;
      if (y > 4) { y = 0; }
      ePos.setY(i, y);
      ePos.setX(i, ePos.getX(i) + Math.sin(t * 0.5 + i) * dt * 0.04);
    }
    ePos.needsUpdate = true;
  }

  // Lightning flicker xa — random interval
  private _animateLightning(dt: number): void {
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      // Flash nhanh
      this.lightningLight.intensity = 3.5 + Math.random() * 4;
      setTimeout(() => {
        if (this.lightningLight) this.lightningLight.intensity = 0;
      }, 80 + Math.random() * 120);
      // Double flash đôi khi
      if (Math.random() > 0.5) {
        setTimeout(() => {
          if (this.lightningLight) {
            this.lightningLight.intensity = 2.0 + Math.random() * 2;
            setTimeout(() => { if (this.lightningLight) this.lightningLight.intensity = 0; }, 60);
          }
        }, 200);
      }
      this.nextLightning = 5 + Math.random() * 8;
    }
  }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
      }
