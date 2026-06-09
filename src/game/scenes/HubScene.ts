import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";

import { ALL_MODEL_NAMES, MODEL_BASE } from "./hub/HubConfig";
import { setupLighting } from "./hub/HubLighting";
import { setupGround } from "./hub/HubGround";
import { optimizeHubScene } from "./hub/HubCollisionOptimizer";
import { setupPortals, type PortalMarker } from "./hub/HubPortal";
import { createLeafParticles, tickLeafParticles, type LeafParticleSystem } from "./hub/HubParticles";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── Load tất cả models song song ────────────────────────────────────────────
async function loadAllModels(loader: GLTFLoader): Promise<Map<string, THREE.Group>> {
  const cache  = new Map<string, THREE.Group>();
  const unique = [...new Set(ALL_MODEL_NAMES)];

  await Promise.all(unique.map((name) =>
    new Promise<void>((resolve) => {
      loader.load(
        `${MODEL_BASE}/${name}.gltf`,
        (gltf) => { cache.set(name, gltf.scene); resolve(); },
        undefined,
        (err)  => { console.warn(`⚠️ Không load được ${name}`, err); resolve(); }
      );
    })
  ));
  return cache;
}

// ─── HubScene ─────────────────────────────────────────────────────────────────
export class HubScene extends BaseScene {
  public  scene: THREE.Scene;

  private loader       = new GLTFLoader();
  private modelCache   = new Map<string, THREE.Group>();
  private portalMarkers: PortalMarker[] = [];
  private particleSystem: LeafParticleSystem | null = null;
  private elapsed = 0;

  private enemyManager!: EnemyManager;
  private playerRef!:    THREE.Object3D;
  private cameraRef!:    THREE.Camera;

  constructor() {
    super("HubScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    this.modelCache    = await loadAllModels(this.loader);

    setupLighting(this.scene);
    setupGround(this.scene);
    optimizeHubScene(this.scene, this.modelCache);

    this.portalMarkers  = setupPortals(this.scene);
    this.particleSystem = createLeafParticles(this.scene);

    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [
        new THREE.Vector3( 12, 0, 38),
        new THREE.Vector3(-12, 0, 38),
        new THREE.Vector3(  0, 0, 48),
        new THREE.Vector3( 18, 0, 30),
      ],
      GOBLIN_CONFIG
    );

    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "HubScene" });
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
    this.modelCache.clear();
    this.portalMarkers  = [];
    this.particleSystem = null;
  }

  protected onUpdate(dt: number): void {
    // Guard: chờ player + camera sẵn sàng mới chạy logic
    if (!this.playerRef || !this.cameraRef) return;

    this.elapsed += dt;

    // Portal ring xoay
    for (const marker of this.portalMarkers) {
      const ring = marker.mesh.children[0] as THREE.Mesh | undefined;
      if (ring) ring.rotation.z += dt * 0.3;
    }

    if (this.particleSystem) tickLeafParticles(this.particleSystem, dt);

    const dmg = this.enemyManager?.update(dt, this.playerRef.position, this.cameraRef) ?? 0;
    if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
  }

  public update(dt: number): void { this.onUpdate(dt); }

  // Dùng bình phương thay sqrt — nhanh hơn, đủ chính xác
  public checkPortals(playerPos: THREE.Vector3): string | null {
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      if (dx * dx + dz * dz < marker.radius * marker.radius)
        return marker.targetScene;
    }
    return null;
  }

  // ─── Event handler ──────────────────────────────────────────────────────────
  private _onPlayerAttack = (data: {
    origin:   THREE.Vector3;
    forward:  THREE.Vector3;
    range:    number;
    damage:   number;
  }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
}
