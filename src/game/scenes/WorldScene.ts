import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { setupLighting } from "./hub/HubLighting";
import { loadAllModels, setupEnvironment } from "./hub/HubEnvironment"; // Chỉ dùng 2 hàm này

export class WorldScene extends BaseScene {
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;

  public scene: THREE.Scene;

  constructor() {
    super("WorldScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    console.log("Đang khởi tạo map");

    // ── 1. Ánh Sáng ─────────────────────────────────────────────────────
    setupLighting(this.scene);

    // ── 2. Load toàn bộ Model ───────────────────────────────────────────
    const loader = new GLTFLoader();
    const modelCache = await loadAllModels(loader);

    // ── 3. Dựng Hub (trung tâm) trước ────────────────────────────────────
    await setupEnvironment(this.scene, modelCache);

    // ── 4. Dựng các khu vực còn lại với offset ──────────────────────────
    this.buildMainRoad(modelCache);
    this.buildLeftForest(modelCache);
    this.buildRightPlatform(modelCache);
    this.buildBossArena(modelCache);

    // ── 5. Spawn Quái Vật ───────────────────────────────────────────────
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.spawnEnemies();

    console.log("Khởi tạo map thành công");
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "WorldScene" });
  }

  private buildMainRoad(cache: Map<string, THREE.Group>) {
    const offset = new THREE.Vector3(0, 0, 200);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 300),
      new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.9, flatShading: true })
    );
    ground.position.copy(offset);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Đường đi
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 300),
      new THREE.MeshStandardMaterial({ color: 0x8B7355 })
    );
    road.position.copy(offset.clone().add(new THREE.Vector3(0, 0.01, 0)));
    road.rotation.x = -Math.PI / 2;
    this.scene.add(road);
  }

  private buildLeftForest(cache: Map<string, THREE.Group>) {
    const offset = new THREE.Vector3(-200, 0, 0);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x2d3a1f, roughness: 1, flatShading: true })
    );
    ground.position.copy(offset);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildRightPlatform(cache: Map<string, THREE.Group>) {
    const offset = new THREE.Vector3(200, 0, 0);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 1, flatShading: true })
    );
    ground.position.copy(offset);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildBossArena(cache: Map<string, THREE.Group>) {
    const offset = new THREE.Vector3(0, 0, -300);

    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.3 })
    );
    arena.position.copy(offset);
    arena.rotation.x = -Math.PI / 2;
    arena.receiveShadow = true;
    this.scene.add(arena);

    // Cột lửa
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 35;
      const z = Math.sin(angle) * 35;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 8), pillarMat);
      pillar.position.copy(offset.clone().add(new THREE.Vector3(x, 2, z)));
      pillar.castShadow = true;
      this.scene.add(pillar);

      const fire = new THREE.PointLight(0xff6600, 0.8, 10);
      fire.position.copy(offset.clone().add(new THREE.Vector3(x, 4.5, z)));
      this.scene.add(fire);
    }
  }

  private spawnEnemies() {
    // Hub
    this.enemyManager.spawn(
      [new THREE.Vector3(10, 0, 10), new THREE.Vector3(-10, 0, -10)],
      { ...GOBLIN_CONFIG, scale: 4, chaseRange: 15 }
    );
    // MainRoad
    this.enemyManager.spawn(
      [new THREE.Vector3(0, 0, 250), new THREE.Vector3(5, 0, 150)],
      { ...GOBLIN_CONFIG, scale: 4, chaseRange: 20 }
    );
    // LeftForest
    this.enemyManager.spawn(
      [new THREE.Vector3(-210, 0, 20), new THREE.Vector3(-190, 0, -20)],
      { ...GOBLIN_CONFIG, scale: 4.5, chaseRange: 18 }
    );
    // RightPlatform
    this.enemyManager.spawn(
      [new THREE.Vector3(210, 0, 30), new THREE.Vector3(190, 0, -30)],
      { ...GOBLIN_CONFIG, scale: 4, chaseRange: 18 }
    );
    // Boss Arena
    this.enemyManager.spawn(
      [new THREE.Vector3(0, 0, -300)],
      { ...GOBLIN_CONFIG, scale: 12, maxHp: 500, chaseRange: 50, attackDamage: 25 }
    );
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
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

  public checkPortals(): null { return null; }
  }
