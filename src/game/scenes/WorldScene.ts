import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

import { ALL_MODEL_NAMES, MODEL_BASE, ALL_PROP_ASSETS } from "./hub/HubConfig";
import { setupLighting } from "./hub/HubLighting";
import { optimizeHubScene } from "./hub/HubCollisionOptimizer";
import { createLeafParticles, tickLeafParticles, type LeafParticleSystem } from "./hub/HubParticles";

// ─── Zone offsets ─────────────────────────────────────────────────────────────
const ZONE = {
  HUB:            new THREE.Vector3(   0, 0,    0),
  LEFT_FOREST:    new THREE.Vector3(-120, 0,    0),
  RIGHT_PLATFORM: new THREE.Vector3( 120, 0,    0),
  BOSS_ARENA:     new THREE.Vector3(   0, 0, -160),
} as const;

// ─── WorldScene ───────────────────────────────────────────────────────────────
export class WorldScene extends BaseScene {
  public  scene: THREE.Scene;

  private loader        = new GLTFLoader();
  private treeCache     = new Map<string, THREE.Group>();
  private propCache     = new Map<string, THREE.Group>();
  private particleSystem: LeafParticleSystem | null = null;
  private elapsed       = 0;

  private enemyManager!: EnemyManager;
  private playerRef!:    THREE.Object3D;
  private cameraRef!:    THREE.Camera;

  private torches:     { light: THREE.PointLight; phase: number }[] = [];
  private wisps:       { light: THREE.PointLight; phase: number; base: THREE.Vector3 }[] = [];
  private pillarFires: { light: THREE.PointLight; phase: number }[] = [];
  private centralFire!: THREE.PointLight;

  constructor() {
    super("WorldScene");
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0d0b0a, 150, 380);
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }
  public checkPortals(): null { return null; }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    await Promise.all([
      this._loadTreeAssets(),
      this._loadPropAssets(),
    ]);

    setupLighting(this.scene);

    // Lớp nền chung cho toàn bộ thế giới
    const baseGround = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({ color: 0x2a1f1a, roughness: 1, flatShading: true })
    );
    baseGround.rotation.x = -Math.PI / 2;
    baseGround.position.y = -0.5;
    baseGround.receiveShadow = true;
    this.scene.add(baseGround);

    this._buildHub();
    this._buildLeftForest();
    this._buildRightPlatform();
    this._buildBossArena();

    this.particleSystem = createLeafParticles(this.scene);

    this.enemyManager = new EnemyManager(this.scene, document.body);
    this._spawnEnemies();

    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
  }

  protected onUpdate(dt: number): void {
    if (!this.playerRef || !this.cameraRef) return;
    this.elapsed += dt;

    if (this.particleSystem) tickLeafParticles(this.particleSystem, dt);

    this._animateTorches(dt);
    this._animateWisps(dt);
    this._animatePillarFires(dt);
    this._animateCentralFire();

    const dmg = this.enemyManager?.update(dt, this.playerRef.position, this.cameraRef) ?? 0;
    if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
    this.treeCache.clear();
    this.propCache.clear();
    this.particleSystem = null;

    [...this.torches, ...this.wisps, ...this.pillarFires].forEach(({ light }) => {
      this.scene.remove(light);
      light.dispose();
    });
    this.torches     = [];
    this.wisps       = [];
    this.pillarFires = [];
    if (this.centralFire) {
      this.scene.remove(this.centralFire);
      this.centralFire.dispose();
    }
  }

  public update(dt: number): void { this.onUpdate(dt); }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSET LOADING
  // ═══════════════════════════════════════════════════════════════════════════

  private _loadTreeAssets(): Promise<void> {
    const unique = [...new Set(ALL_MODEL_NAMES)];
    return Promise.all(unique.map((name) =>
      new Promise<void>((resolve) => {
        this.loader.load(`${MODEL_BASE}/${name}.gltf`, (g) => { this.treeCache.set(name, g.scene); resolve(); }, undefined, () => resolve());
      })
    )).then();
  }

  private _loadPropAssets(): Promise<void> {
    return Promise.all(ALL_PROP_ASSETS.map(({ name, path }) =>
      new Promise<void>((resolve) => {
        this.loader.load(path, (g) => { this.propCache.set(name, g.scene); resolve(); }, undefined, () => resolve());
      })
    )).then();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _buildHub(): void {
    this._addPlane(100, 100, 0x3d2b1f, ZONE.HUB);
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    [{ w: 3.5, h: 100, x: 0, z: 10 }, { w: 90, h: 3.5, x: 0, z: 0 }].forEach(({ w, h, x, z }) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pathMat);
      p.rotation.x = -Math.PI / 2; p.position.set(x, 0.01, z); p.receiveShadow = true; this.scene.add(p);
    });
    optimizeHubScene(this.scene, this.treeCache);
  }

  private _buildLeftForest(): void {
    const O = ZONE.LEFT_FOREST;
    this._addPlane(120, 120, 0x141f0e, O);
    [new THREE.Vector3(O.x - 15, 1.5, O.z - 20), new THREE.Vector3(O.x + 20, 2.0, O.z + 30), new THREE.Vector3(O.x - 30, 1.2, O.z + 15), new THREE.Vector3(O.x + 10, 1.8, O.z - 35)].forEach((pos, i) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({ color: 0x22ff88, emissive: new THREE.Color(0x22ff88), emissiveIntensity: 2.0 }));
      orb.position.copy(pos); this.scene.add(orb);
      if (i < 2) { const light = new THREE.PointLight(0x22ff88, 1.8, 14); light.position.copy(pos); this.scene.add(light); this.wisps.push({ light, phase: i * 1.57, base: pos.clone() }); }
    });
    this._instanceProp("bush", O, 15, 60);
    this._placeProp("Big-stone", new THREE.Vector3(O.x - 20, 0, O.z - 20), 2.0);
    this._placeProp("bo_ba_nam", new THREE.Vector3(O.x + 30, 0, O.z + 10), 3.0);
  }

  private _buildRightPlatform(): void {
    const O = ZONE.RIGHT_PLATFORM;
    this._addPlane(120, 120, 0x1a140f, O, true);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(15, 18, 0.4, 7), new THREE.MeshStandardMaterial({ color: 0x1f1820, roughness: 0.95, flatShading: true }));
    platform.position.set(O.x, 0.2, O.z); platform.receiveShadow = true; this.scene.add(platform);
    [new THREE.Vector3(O.x - 15, 0.3, O.z - 15), new THREE.Vector3(O.x + 15, 0.3, O.z + 18)].forEach((pos, i) => {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 0), new THREE.MeshStandardMaterial({ color: 0x2a0055, emissive: new THREE.Color(0x6622ff), emissiveIntensity: 0.8 }));
      stone.position.copy(pos); this.scene.add(stone);
      const rl = new THREE.PointLight(0x6622ff, 1.2, 8); rl.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0)); this.scene.add(rl); this.wisps.push({ light: rl, phase: i * 2.1 + 5, base: pos.clone() });
    });
    this._placeProp("stone_pillar", new THREE.Vector3(O.x, 0, O.z), 2.0);
    this._placeProp("crystal_hong", new THREE.Vector3(O.x + 20, 0, O.z - 15), 1.5);
    this._placeProp("crystal_cluster", new THREE.Vector3(O.x - 20, 0, O.z + 20), 2.0);
    this._placeProp("old_ropebridge_low_poly", new THREE.Vector3(O.x, 0, O.z - 35), 1.5);
  }

  private _buildBossArena(): void {
    const O = ZONE.BOSS_ARENA;
    this._addPlane(150, 150, 0x0d0808, O);
    const arena = new THREE.Mesh(new THREE.CircleGeometry(35, 64), new THREE.MeshStandardMaterial({ color: 0x1a1010, roughness: 0.75, metalness: 0.25 }));
    arena.rotation.x = -Math.PI / 2; arena.position.set(O.x, 0.02, O.z); arena.receiveShadow = true; this.scene.add(arena);
    const border = new THREE.Mesh(new THREE.RingGeometry(34, 36.5, 64), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: new THREE.Color(0x550000), emissiveIntensity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    border.rotation.x = -Math.PI / 2; border.position.set(O.x, 0.03, O.z); this.scene.add(border);
    const fireBall = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 12), new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: new THREE.Color(0xff2200), emissiveIntensity: 3.0, transparent: true, opacity: 0.85 }));
    fireBall.position.set(O.x, 1.5, O.z); this.scene.add(fireBall);
    this.centralFire = new THREE.PointLight(0xff3300, 5.0, 80); this.centralFire.position.set(O.x, 4, O.z); this.scene.add(this.centralFire);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1a0f0f, roughness: 0.6, metalness: 0.6 });
    for (let i = 0; i < 8; i++) { const angle = (i / 8) * Math.PI * 2; const px = O.x + Math.cos(angle) * 32; const pz = O.z + Math.sin(angle) * 32;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 5, 8), pillarMat); shaft.position.set(px, 2.5, pz); shaft.castShadow = true; this.scene.add(shaft);
      const fb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: new THREE.Color(0xff6600), emissiveIntensity: 2.0 })); fb.position.set(px, 5.8, pz); this.scene.add(fb);
      if (i % 2 === 0) { const fl = new THREE.PointLight(0xff6600, 2.0, 15); fl.position.set(px, 6.0, pz); this.scene.add(fl); this.pillarFires.push({ light: fl, phase: i * 0.785 }); }
    }
    this._placePropMulti("pile_of_skulls", [new THREE.Vector3(O.x + 8, 0, O.z + 8), new THREE.Vector3(O.x - 8, 0, O.z + 12), new THREE.Vector3(O.x + 6, 0, O.z - 15)], 1.0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _addPlane(w: number, h: number, color: number, center: THREE.Vector3, flatShading = false): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color, roughness: 1.0, flatShading }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(center.x, 0, center.z); mesh.receiveShadow = true; this.scene.add(mesh);
  }

  private _placeProp(name: string, pos: THREE.Vector3, scale = 1.0, rotY = 0, repeatZ = 0, stepZ = 0): void {
    const src = this.propCache.get(name); if (!src) return;
    const count = repeatZ > 0 ? repeatZ : 1;
    for (let i = 0; i < count; i++) { const clone = src.clone(); clone.position.copy(pos).add(new THREE.Vector3(0, 0, i * stepZ)); clone.scale.setScalar(scale); clone.rotation.y = rotY; clone.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } }); this.scene.add(clone); }
  }

  private _placePropMulti(name: string, positions: THREE.Vector3[], scale = 1.0): void { positions.forEach((pos) => this._placeProp(name, pos, scale)); }

  private _instanceProp(name: string, center: THREE.Vector3, count: number, spread: number): void {
    const src = this.propCache.get(name); if (!src) return;
    const dummy = new THREE.Object3D();
    src.traverse((child) => { if (!(child as THREE.Mesh).isMesh) return; const mesh = child as THREE.Mesh;
      const mat = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone();
      const im = new THREE.InstancedMesh(mesh.geometry, mat, count); im.receiveShadow = true; im.frustumCulled = true;
      for (let i = 0; i < count; i++) { const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5; const r = 8 + Math.random() * spread;
        dummy.position.set(center.x + Math.cos(angle) * r, 0, center.z + Math.sin(angle) * r); dummy.scale.setScalar(1.2 + Math.random() * 0.5); dummy.rotation.y = Math.random() * Math.PI * 2; dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }
      im.instanceMatrix.needsUpdate = true; this.scene.add(im);
    });
  }

  private _spawnEnemies(): void {
    this.enemyManager.spawn([new THREE.Vector3(12, 0, 38), new THREE.Vector3(-12, 0, 38)], { ...GOBLIN_CONFIG, chaseRange: 15 });
    this.enemyManager.spawn([new THREE.Vector3(ZONE.LEFT_FOREST.x + 15, 0, ZONE.LEFT_FOREST.z + 10), new THREE.Vector3(ZONE.LEFT_FOREST.x - 10, 0, ZONE.LEFT_FOREST.z - 15)], { ...GOBLIN_CONFIG, chaseRange: 20 });
    this.enemyManager.spawn([new THREE.Vector3(ZONE.RIGHT_PLATFORM.x + 20, 0, ZONE.RIGHT_PLATFORM.z + 15), new THREE.Vector3(ZONE.RIGHT_PLATFORM.x - 30, 0, ZONE.RIGHT_PLATFORM.z + 20)], { ...GOBLIN_CONFIG, chaseRange: 18 });
    this.enemyManager.spawn([new THREE.Vector3(ZONE.BOSS_ARENA.x, 0, ZONE.BOSS_ARENA.z - 12)], { ...GOBLIN_CONFIG, scale: 8.0, maxHp: 500, chaseRange: 50, attackDamage: 25, patrolRadius: 0 });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATORS
  // ═══════════════════════════════════════════════════════════════════════════

  private _animateTorches(dt: number): void { this.torches.forEach((t) => { t.phase += dt * 8; t.light.intensity = 3.0 * (1 + Math.sin(t.phase * 1.3) * 0.18 + Math.sin(t.phase * 2.7) * 0.08); }); }
  private _animateWisps(dt: number): void { this.wisps.forEach((w) => { w.phase += dt * 1.2; w.light.position.set(w.base.x + Math.sin(w.phase * 0.7) * 1.2, w.base.y + Math.sin(w.phase) * 0.5, w.base.z + Math.cos(w.phase * 0.5) * 1.0); w.light.intensity = 1.8 * (0.8 + Math.sin(w.phase * 2.1) * 0.25); }); }
  private _animatePillarFires(dt: number): void { this.pillarFires.forEach((p) => { p.phase += dt * 9; p.light.intensity = 1.8 * (1 + Math.sin(p.phase) * 0.25 + Math.sin(p.phase * 2.1) * 0.1); }); }
  private _animateCentralFire(): void { if (!this.centralFire) return; const t = this.elapsed; this.centralFire.intensity = 5.0 * (1 + Math.sin(t * 7.3) * 0.3 + Math.sin(t * 13.1) * 0.15); }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => { this.enemyManager?.hitInRange(data.origin, data.range, data.damage); };
        }
