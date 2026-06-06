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

async function loadAllModels(loader: GLTFLoader): Promise<Map<string, THREE.Group>> {
  const cache = new Map<string, THREE.Group>();
  const unique = [...new Set(ALL_MODEL_NAMES)];
  await Promise.all(unique.map(name =>
    new Promise<void>((resolve) => {
      loader.load(
        `${MODEL_BASE}/${name}.gltf`,
        (gltf) => { cache.set(name, gltf.scene); resolve(); },
        undefined,
        (err) => { console.warn(`⚠️ Không load được ${name}`, err); resolve(); }
      );
    })
  ));
  return cache;
}

export class HubScene extends BaseScene {
  private loader       = new GLTFLoader();
  private modelCache   = new Map<string, THREE.Group>();
  private portalMarkers: PortalMarker[] = [];
  private particleSystem: LeafParticleSystem | null = null;
  private elapsed      = 0;

  private enemyManager: EnemyManager | null = null;
  private playerRef:  THREE.Object3D | null = null;
  private cameraRef:  THREE.Camera   | null = null;

  public scene: THREE.Scene;

  constructor() {
    super("HubScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(player: THREE.Object3D) { this.playerRef = player; }
  public setCamera(camera: THREE.Camera)   { this.cameraRef = camera; }

  // ── Fix: đổi getRoots() → getEnemyRoots() cho đúng EnemyManager ──────
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  private onPlayerAttack = (data: {
    origin: THREE.Vector3;
    forward: THREE.Vector3;
    range: number;
    damage: number;
  }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };

  protected async onLoad(): Promise<void> {
    console.log("🌅 HubScene loading...");
    try {
      this.modelCache = await loadAllModels(this.loader);
      setupLighting(this.scene);
      setupGround(this.scene);
      optimizeHubScene(this.scene, this.modelCache);
      this.portalMarkers  = setupPortals(this.scene);
      this.particleSystem = createLeafParticles(this.scene);

      // ── Spawn goblin – dùng hudContainer đúng ──────────────────────────
      // document.body gây HP bar bị offset sai nếu canvas không fullscreen
      // → dùng container của renderer thay thế, nhưng vì HubScene không giữ
      //   ref đó, tạm dùng document.body và clip bằng CSS overflow:hidden
      this.enemyManager = new EnemyManager(this.scene, document.body);

      // Spawn rải đều xung quanh player spawn (0,0,30), cách ít nhất 8m
      // để không overlap ngay khi vào scene
      this.enemyManager.spawn(
        [
          new THREE.Vector3( 12, 0, 38),  // phải-xa
          new THREE.Vector3(-12, 0, 38),  // trái-xa
          new THREE.Vector3(  0, 0, 48),  // thẳng trước xa
          new THREE.Vector3( 18, 0, 30),  // phải-ngang
        ],
        GOBLIN_CONFIG,
      );

      eventBus.on(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);

      console.log("✅ HubScene loaded!");
      eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "HubScene" });
    } catch (error) {
      console.error("❌ Error loading HubScene:", error);
      throw error;
    }
  }

  protected async onUnload(): Promise<void> {
    console.log("🌅 HubScene unloading...");
    eventBus.off(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);
    this.enemyManager?.dispose();
    this.enemyManager = null;
    collisionManager.clear();
    this.modelCache.clear();
    this.portalMarkers  = [];
    this.particleSystem = null;
  }

  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;

    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0])
        marker.mesh.children[0].rotation.z += deltaTime * 0.3;
    }

    if (this.particleSystem) tickLeafParticles(this.particleSystem, deltaTime);

    if (this.enemyManager && this.playerRef && this.cameraRef) {
      const totalDmg = this.enemyManager.update(
        deltaTime,
        this.playerRef.position,
        this.cameraRef,
      );
      if (totalDmg > 0) {
        eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: totalDmg });
      }
    }
  }

  public update(deltaTime: number): void {
    this.onUpdate(deltaTime);
  }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    if (!this.portalMarkers.length) return null;
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < marker.radius)
        return marker.targetScene;
    }
    return null;
  }
}
