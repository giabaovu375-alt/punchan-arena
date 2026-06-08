import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { setupLighting } from "./hub/HubLighting"; // Dùng chung ánh sáng

// Tái sử dụng các helper build từ HubEnvironment
import { loadAllModels, generateScatter, buildInstancedGroup } from "./hub/HubEnvironment";
// Tái sử dụng portal
import { setupPortals, createPortalMesh } from "./hub/HubPortal";
// Tái sử dụng particles
import { createLeafParticles, tickLeafParticles } from "./hub/HubParticles";

export class WorldScene extends BaseScene {
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;
  private portalMeshes: any[] = [];

  public scene: THREE.Scene;

  constructor() {
    super("WorldScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    console.log("🌍 Đang kiến tạo thế giới AAA...");

    // ── 1. Ánh Sáng và Không Gian ───────────────────────────────────────
    setupLighting(this.scene); // Tái sử dụng HubLighting

    // ── 2. Load toàn bộ Model ───────────────────────────────────────────
    const loader = new GLTFLoader();
    const modelCache = await loadAllModels(loader);
    const enableShadows = (model: THREE.Group) => {
      model.traverse((child) => { if ((child as THREE.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    };

    // ── 3. Dựng từng khu vực ────────────────────────────────────────────
    await this.buildHub(modelCache);
    await this.buildMainRoad(modelCache, loader);
    await this.buildLeftForest(modelCache, loader);
    await this.buildRightPlatform(modelCache, loader);
    await this.buildBossArena(modelCache, loader);

    // ── 4. Spawn Quái Vật ───────────────────────────────────────────────
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.spawnEnemies();

    // ── 5. Hiệu ứng Chung ───────────────────────────────────────────────
    const leaves = createLeafParticles(this.scene, 100);

    console.log("✅ Thế giới AAA đã sẵn sàng!");
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "WorldScene" });
  }

  // ── CÁC HÀM XÂY DỰNG KHU VỰC ──────────────────────────────────────────

  private async buildHub(cache: Map<string, THREE.Group>) {
    // Khu trung tâm: Copy từ HubScene
    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.95, flatShading: true }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    const pathMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    const pathH = new THREE.Mesh(new THREE.PlaneGeometry(90, 3.5), pathMat); pathH.rotation.x = -Math.PI / 2; pathH.position.set(0, 0.01, 0); pathH.receiveShadow = true; this.scene.add(pathH);
    const pathV = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 100), pathMat); pathV.rotation.x = -Math.PI / 2; pathV.position.set(0, 0.01, 10); pathV.receiveShadow = true; this.scene.add(pathV);

    // Cây cối (dùng lại code của cậu)
    const outerScatter = generateScatter(["CommonTree_1", "CommonTree_2", "CommonTree_3", "Pine_1", "Pine_2"], 20, 40, 68, [1.2, 2.0], 100);
    const midScatter = generateScatter(["DeadTree_1", "DeadTree_2", "CommonTree_1"], 10, 18, 38, [1.0, 1.6], 200);
    const groundScatter = generateScatter(["Bush_Common", "Fern_1", "Mushroom_Laetiporus", "Plant_1", "Rock_Medium_1"], 25, 6, 55, [0.5, 1.2], 400);
    buildInstancedGroup(cache, outerScatter, "CommonTree_1", true, true, 1.0, this.scene);
    buildInstancedGroup(cache, midScatter, "DeadTree_1", true, true, 0.8, this.scene);
    buildInstancedGroup(cache, groundScatter, "Bush_Common", false, false, 0, this.scene);

    // Cây đỏ trung tâm
    const twistedScatter = [{ modelName: "TwistedTree_1", x: 0, z: 0, scale: 5.0, rotY: Math.PI * 0.15 }];
    buildInstancedGroup(cache, twistedScatter, "TwistedTree_1", true, true, 3.0, this.scene);

    // Portal đi các vùng
    const portalDefs = [
      { targetScene: "MainRoad", pos: new THREE.Vector3(0, 0, 60), color: 0x00aaff, label: "Đường Chính" },
      { targetScene: "LeftForest", pos: new THREE.Vector3(-60, 0, 0), color: 0x00ff88, label: "Rừng Mật" },
      { targetScene: "RightPlatform", pos: new THREE.Vector3(60, 0, 0), color: 0xffaa00, label: "Khu Đá" },
      { targetScene: "BossArena", pos: new THREE.Vector3(0, 0, -60), color: 0xff2200, label: "Boss" },
    ];
    this.portalMeshes = setupPortals(this.scene, portalDefs); // Hàm setupPortals cần được sửa để nhận mảng portal
  }

  private async buildMainRoad(cache: Map<string, THREE.Group>, loader: GLTFLoader) {
    // Dịch chuyển toàn bộ MainRoad về phía Nam (z: 200)
    const offset = new THREE.Vector3(0, 0, 200);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 300), new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.9, flatShading: true }));
    ground.position.copy(offset); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    // Đường đi
    const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 300), new THREE.MeshStandardMaterial({ color: 0x8B7355 }));
    road.position.copy(offset.clone().add(new THREE.Vector3(0, 0.01, 0))); road.rotation.x = -Math.PI / 2; this.scene.add(road);

    // Hàng rào và nhà (load và clone)
    const fenceUrl = "/model/stylized fence.glb";
    loader.load(fenceUrl, (gltf) => {
      const master = gltf.scene; enableShadows(master);
      for (let z = -140; z <= 140; z += 10) {
        for (const sx of [-3.2, 3.2]) {
          const clone = master.clone();
          clone.position.copy(offset.clone().add(new THREE.Vector3(sx, 0, z)));
          this.scene.add(clone);
        }
      }
    });
    // Tương tự cho nhà và đèn...
  }

  private async buildLeftForest(cache: Map<string, THREE.Group>, loader: GLTFLoader) {
    const offset = new THREE.Vector3(-200, 0, 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: 0x2d3a1f, roughness: 1, flatShading: true }));
    ground.position.copy(offset); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    // Bụi cây
    loader.load("/model/bush.glb", (gltf) => {
      const master = gltf.scene; enableShadows(master);
      for (let i = 0; i < 15; i++) {
        const clone = master.clone();
        clone.position.copy(offset.clone().add(new THREE.Vector3((Math.random() - 0.5) * 100, 0, (Math.random() - 0.5) * 100)));
        clone.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(clone);
      }
    });
  }

  private async buildRightPlatform(cache: Map<string, THREE.Group>, loader: GLTFLoader) {
    const offset = new THREE.Vector3(200, 0, 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 1, flatShading: true }));
    ground.position.copy(offset); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    // Tinh thể
    loader.load("/model/crystal hong.glb", (gltf) => {
      const crystal = gltf.scene; enableShadows(crystal);
      crystal.position.copy(offset.clone().add(new THREE.Vector3(20, 0, -20)));
      this.scene.add(crystal);
    });
  }

  private async buildBossArena(cache: Map<string, THREE.Group>, loader: GLTFLoader) {
    const offset = new THREE.Vector3(0, 0, -300);
    const arena = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.3 }));
    arena.position.copy(offset); arena.rotation.x = -Math.PI / 2; arena.receiveShadow = true; this.scene.add(arena);

    // Cầu dây nối Hub và Arena
    loader.load("/model/old_ropebridge_low_poly.glb", (gltf) => {
      const bridge = gltf.scene; enableShadows(bridge);
      bridge.position.copy(offset.clone().add(new THREE.Vector3(0, 0, -40)));
      this.scene.add(bridge);
    });
  }

  // ── SPAWN ENEMIES ──────────────────────────────────────────────────────

  private spawnEnemies() {
    // Hub
    this.enemyManager.spawn([new THREE.Vector3(10, 0, 10)], { ...GOBLIN_CONFIG, scale: 4 });
    // MainRoad
    this.enemyManager.spawn([new THREE.Vector3(0, 0, 250), new THREE.Vector3(5, 0, 150)], { ...GOBLIN_CONFIG, scale: 4, chaseRange: 20 });
    // LeftForest
    this.enemyManager.spawn([new THREE.Vector3(-210, 0, 20)], { ...GOBLIN_CONFIG, scale: 4.5, chaseRange: 18 });
    // Boss
    this.enemyManager.spawn([new THREE.Vector3(0, 0, -300)], { ...GOBLIN_CONFIG, scale: 12, maxHp: 500, chaseRange: 50, attackDamage: 25 });
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    // Cập nhật enemy
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
    // Xoay portal
    for (const p of this.portalMeshes) {
      if (p.mesh.children[0]) p.mesh.children[0].rotation.z += dt * 0.3;
    }
  }

  protected async onUnload(): Promise<void> {
    this.enemyManager?.dispose();
    collisionManager.clear();
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(): null { return null; } // Không dùng portal để chuyển vùng nữa
}
