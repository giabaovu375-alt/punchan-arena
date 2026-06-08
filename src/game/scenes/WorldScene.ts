import * as THREE from "three";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { loadAllModels, generateScatter, buildInstancedGroup } from "./hub/HubEnvironment"; // Tái sử dụng helper
import { setupPortals } from "./hub/HubPortal";
import { createLeafParticles, tickLeafParticles } from "./hub/HubParticles";
import { collisionManager } from "../core/CollisionManager";

export class WorldScene extends BaseScene {
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;
  private particleSystems: any[] = [];

  public scene: THREE.Scene;

  constructor() {
    super("WorldScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    // ── 1. ÁNH SÁNG CHUNG (Hoàng hôn nhẹ) ─────────────────────────────
    this.scene.background = new THREE.Color(0x2d1b2e);
    this.scene.fog = new THREE.FogExp2(0x2d1b2e, 0.01); // fog xa hơn để thấy toàn cảnh

    // Mặt trời chính
    const sun = new THREE.DirectionalLight(0xff9966, 1.2);
    sun.position.set(100, 150, 100);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
    sun.shadow.camera.far = 500;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x443322, 0.5));

    // ── 2. LOAD MODELS ─────────────────────────────────────────────────
    const loader = new THREE.GLTFLoader();
    const modelCache = await loadAllModels(loader);

    // ── 3. DỰNG TỪNG KHU VỰC ───────────────────────────────────────────
    // Mỗi khu vực được bọc trong một Group để dễ di chuyển
    this.buildHub(modelCache);
    this.buildMainRoad(modelCache);
    this.buildLeftForest(modelCache);
    this.buildRightPlatform(modelCache);
    this.buildBossArena(modelCache);

    // ── 4. QUÁI VẬT ────────────────────────────────────────────────────
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.spawnEnemies();

    // ── 5. HIỆU ỨNG ────────────────────────────────────────────────────
    const leaves = createLeafParticles(this.scene, 100);
    this.particleSystems.push(leaves);

    console.log("✅ WorldScene (Map 1) loaded!");
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "WorldScene" });
  }

  // ── BUILDERS CHO TỪNG KHU ──────────────────────────────────────────────

  private buildHub(cache: Map<string, THREE.Group>) {
    const hubGroup = new THREE.Group();
    hubGroup.position.set(0, 0, 0);

    // Mặt đất
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 64),
      new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1, flatShading: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    hubGroup.add(ground);

    // Cây cối (dùng helper từ HubEnvironment)
    // Cậu tự điều chỉnh vị trí scatter để khớp với hub
    const items = generateScatter(["TwistedTree_1", "CommonTree_1"], 20, 5, 70, [1, 2]);
    buildInstancedGroup(cache, items, true, true, 1.0);

    this.scene.add(hubGroup);
  }

  private buildMainRoad(cache: Map<string, THREE.Group>) {
    const roadGroup = new THREE.Group();
    roadGroup.position.set(0, 0, -200); // Nằm phía Nam Hub

    // Mặt đất xanh
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 400),
      new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    roadGroup.add(ground);

    // Đường đi
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 400),
      new THREE.MeshStandardMaterial({ color: 0x8B7355 })
    );
    path.rotation.x = -Math.PI / 2;
    path.position.y = 0.01;
    roadGroup.add(path);

    // Hàng rào, cột đèn... (cậu tự thêm)

    this.scene.add(roadGroup);
  }

  private buildLeftForest(cache: Map<string, THREE.Group>) {
    const forestGroup = new THREE.Group();
    forestGroup.position.set(-120, 0, 0); // Nằm phía Tây Hub

    // Mặt đất tối
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x2d3a1f, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    forestGroup.add(ground);

    // Cây rừng, bụi rậm...
    // (cậu tự thêm)

    // Ánh sáng cục bộ (tối hơn)
    const forestLight = new THREE.AmbientLight(0x224422, 0.3);
    forestGroup.add(forestLight);

    this.scene.add(forestGroup);
  }

  private buildRightPlatform(cache: Map<string, THREE.Group>) {
    const platformGroup = new THREE.Group();
    platformGroup.position.set(120, 0, 0); // Nằm phía Đông Hub

    // Mặt đất đá
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    platformGroup.add(ground);

    // Cột đá, tinh thể...
    // (cậu tự thêm)

    this.scene.add(platformGroup);
  }

  private buildBossArena(cache: Map<string, THREE.Group>) {
    const arenaGroup = new THREE.Group();
    arenaGroup.position.set(0, 0, 200); // Nằm phía Bắc Hub

    // Sàn đấu
    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(50, 64),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.5 })
    );
    arena.rotation.x = -Math.PI / 2;
    arena.receiveShadow = true;
    arenaGroup.add(arena);

    // Cột lửa xung quanh
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 45;
      const z = Math.sin(angle) * 45;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1.2, 5, 8),
        new THREE.MeshStandardMaterial({ color: 0x444444 })
      );
      pillar.position.set(x, 2.5, z);
      pillar.castShadow = true;
      arenaGroup.add(pillar);

      const fire = new THREE.PointLight(0xff4400, 1, 15);
      fire.position.set(x, 5, z);
      arenaGroup.add(fire);
    }

    // Ánh sáng rực lửa
    const fireLight = new THREE.PointLight(0xff4400, 2, 60);
    fireLight.position.set(0, 5, 0);
    arenaGroup.add(fireLight);

    this.scene.add(arenaGroup);
  }

  // ── SPAWN ENEMIES ──────────────────────────────────────────────────────

  private spawnEnemies() {
    // Goblin trong Hub
    this.enemyManager.spawn(
      [new THREE.Vector3(10, 0, 10), new THREE.Vector3(-10, 0, -10)],
      { ...GOBLIN_CONFIG, scale: 4, chaseRange: 15 }
    );
    // Goblin trên đường chính
    this.enemyManager.spawn(
      [new THREE.Vector3(0, 0, -250), new THREE.Vector3(5, 0, -150)],
      { ...GOBLIN_CONFIG, scale: 4, chaseRange: 20 }
    );
    // Goblin trong rừng
    this.enemyManager.spawn(
      [new THREE.Vector3(-130, 0, 20), new THREE.Vector3(-110, 0, -20)],
      { ...GOBLIN_CONFIG, scale: 4.5, chaseRange: 18 }
    );
    // Goblin khu đá
    this.enemyManager.spawn(
      [new THREE.Vector3(110, 0, 30), new THREE.Vector3(130, 0, -30)],
      { ...GOBLIN_CONFIG, scale: 4, chaseRange: 18 }
    );
    // Boss trong đấu trường
    this.enemyManager.spawn(
      [new THREE.Vector3(0, 0, 200)],
      { ...GOBLIN_CONFIG, scale: 12, maxHp: 500, chaseRange: 50, attackDamage: 25 }
    );
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    // Cập nhật enemy
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
    // Cập nhật hiệu ứng
    for (const sys of this.particleSystems) {
      tickLeafParticles(sys, dt);
    }
  }

  protected async onUnload(): Promise<void> {
    this.enemyManager?.dispose();
    collisionManager.clear();
  }

  public update(dt: number): void { this.onUpdate(dt); }

  // Không còn portal nữa
  public checkPortals(): null { return null; }
      }
