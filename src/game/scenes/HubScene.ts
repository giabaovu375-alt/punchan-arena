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

// Hàm load asset chạy song song tối ưu hóa thời gian loading screen
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

  // Cờ đánh dấu trạng thái nạp cảnh tĩnh
  private isLoaded = false;

  public scene: THREE.Scene;

  constructor() {
    super("HubScene");
    this.scene = new THREE.Scene();
  }

  // Nhận thực thể Player từ GameEngine bốc qua
  public setPlayer(player: THREE.Object3D) {
    this.playerRef = player;
    console.log("✅ HubScene: playerRef set");
  }

  // Nhận Camera điều hướng từ GameEngine bốc qua
  public setCamera(camera: THREE.Camera) {
    this.cameraRef = camera;
    console.log("✅ HubScene: cameraRef set");
  }

  // Trả về danh sách quái cho CombatController quét vùng đánh (Hitbox)
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // Lắng nghe sự kiện Player vung kiếm/đấm đá để xử lý trừ máu quái
  private onPlayerAttack = (data: {
    origin: THREE.Vector3;
    forward: THREE.Vector3;
    range: number;
    damage: number;
  }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };

  // Khởi tạo vòng đời nạp Asset của Map
  protected async onLoad(): Promise<void> {
    console.log("🌅 HubScene loading...");
    try {
      this.modelCache = await loadAllModels(this.loader);
      setupLighting(this.scene);
      setupGround(this.scene);
      optimizeHubScene(this.scene, this.modelCache);
      this.portalMarkers  = setupPortals(this.scene);
      this.particleSystem = createLeafParticles(this.scene);

      this.enemyManager = new EnemyManager(this.scene, document.body);

      // Spawn đống Goblin lính lác canh giữ tế đàn
      this.enemyManager.spawn(
        [
          new THREE.Vector3( 12, 0, 38),
          new THREE.Vector3(-12, 0, 38),
          new THREE.Vector3(  0, 0, 48),
          new THREE.Vector3( 18, 0, 30),
        ],
        GOBLIN_CONFIG,
      );

      eventBus.on(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);

      this.isLoaded = true; // Đánh dấu hoàn tất
      console.log("✅ HubScene loaded!");
      eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "HubScene" });
    } catch (error) {
      console.error("❌ Error loading HubScene:", error);
      throw error;
    }
  }

  // Dọn dẹp bộ nhớ khi chuyển đổi Map để tránh tràn RAM (Memory Leak)
  protected async onUnload(): Promise<void> {
    console.log("🌅 HubScene unloading...");
    this.isLoaded = false;
    eventBus.off(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);
    this.enemyManager?.dispose();
    this.enemyManager = null;
    collisionManager.clear();
    this.modelCache.clear();
    this.portalMarkers  = [];
    this.particleSystem = null;
  }

  // Vòng lặp logic nội tại của riêng Hub Map
  protected onUpdate(deltaTime: number): void {
    // TỐI ƯU CỐT LÕI: Guard clause chặn đứng hoàn toàn việc chạy logic quái/hiệu ứng 
    // khi data hoặc liên kết nhân vật chưa sẵn sàng. Chống lỗi crash "cannot read property of undefined".
    if (!this.isLoaded || !this.playerRef || !this.cameraRef) return;

    this.elapsed += deltaTime;

    // Xoay vòng các Gate Portal cho đẹp mắt
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0])
        marker.mesh.children[0].rotation.z += deltaTime * 0.3;
    }

    // Cập nhật hệ thống hạt (lá rơi quanh cây đại thụ)
    if (this.particleSystem) tickLeafParticles(this.particleSystem, deltaTime);

    // Xử lý AI quái dí theo và tẩn Player
    if (this.enemyManager) {
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

  // Kiểm tra xem tọa độ của Player có đang đè lên vùng Gate Portal nào không
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
