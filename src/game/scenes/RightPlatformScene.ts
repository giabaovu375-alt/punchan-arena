import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// Hàm tạo Portal chuyển map xịn sò của bro
function createPortalMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  
  // Vòng ngoài Torus
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.18, 12, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.7 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  
  // Tâm xoáy Circle
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.01; // Chống Z-fighting nhẹ
  group.add(inner);
  
  // Ánh sáng lập lòe từ Portal
  const light = new THREE.PointLight(color, 1.2, 10);
  light.position.y = 0.5;
  group.add(light);
  
  return group;
}

export class RightPlatformScene extends BaseScene {
  private portalMarkers: any[] = [];
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;

  private crystalMesh: THREE.Group | null = null;
  private crystalClusterMesh: THREE.Group | null = null;

  public scene: THREE.Scene;

  constructor() {
    super("RightPlatformScene");
    this.scene = new THREE.Scene();
    
    // Khắc phục triệt để lỗi Memory Leak: Bind ngữ cảnh `this` cố định cho hàm event
    this.onPlayerAttack = this.onPlayerAttack.bind(this);
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    // Khu đá khô cằn
    this.scene.background = new THREE.Color(0x4a3728);
    this.scene.fog = new THREE.Fog(0x4a3728, 20, 100);

    const sun = new THREE.DirectionalLight(0xffcc88, 1.5);
    sun.position.set(100, 120, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x887766, 0.4));

    // Mặt đất đá
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 1, flatShading: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const gltfLoader = new GLTFLoader();

    const enableShadows = (model: THREE.Group) => {
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    };

    // 1. Cột đá
    gltfLoader.load("/model/stone pillar.glb", (gltf) => {
      const pillar = gltf.scene;
      pillar.position.set(0, 0, 0);
      pillar.scale.setScalar(2.0);
      enableShadows(pillar);
      this.scene.add(pillar);
    });

    // 2. Tinh thể hồng
    gltfLoader.load("/model/crystal hong.glb", (gltf) => {
      this.crystalMesh = gltf.scene;
      this.crystalMesh.position.set(20, 0, -20);
      this.crystalMesh.scale.setScalar(1.5);
      enableShadows(this.crystalMesh);
      this.scene.add(this.crystalMesh);
    });

    // 3. Cụm tinh thể
    gltfLoader.load("/model/crystal cluster.glb", (gltf) => {
      this.crystalClusterMesh = gltf.scene;
      this.crystalClusterMesh.position.set(-25, 0, 25);
      this.crystalClusterMesh.scale.setScalar(2.0);
      enableShadows(this.crystalClusterMesh);
      this.scene.add(this.crystalClusterMesh);
    });

    // 4. Cầu dây
    gltfLoader.load("/model/old_ropebridge_low_poly.glb", (gltf) => {
      const bridge = gltf.scene;
      bridge.position.set(0, 0, -40);
      bridge.scale.setScalar(1.5);
      enableShadows(bridge);
      this.scene.add(bridge);
    });

    // 5. Portal về Hub (FIX: Hạ độ cao trục Y xuống sát đất)
    const portalPos = new THREE.Vector3(30, 0, 0);
    const portalMesh = createPortalMesh(0xffaa00);
    portalMesh.position.copy(portalPos).add(new THREE.Vector3(0, 0.05, 0)); // Nằm bệt chuẩn chỉ trên mặt đất
    this.scene.add(portalMesh);
    
    this.portalMarkers.push({
      targetScene: "HubScene",
      position: portalPos.clone(),
      radius: 3.5,
      mesh: portalMesh,
    });

    // Goblin leo trèo
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(20, 0, 15), new THREE.Vector3(-30, 0, 20)],
      { ...GOBLIN_CONFIG, scale: 4.0, chaseRange: 18, patrolRadius: 5 }
    );

    // Đăng ký Event bằng hàm đã được bind context
    eventBus.on(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);

    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "RightPlatformScene" });
  }

  // Khai báo method chuẩn của Class
  private onPlayerAttack(data: { origin: THREE.Vector3; range: number; damage: number }): void {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;

    // Hiệu ứng vòng xoáy ma thuật của Portal
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[1]) {
        // Xoay tấm Circle inner ở lõi để tạo cảm giác xoáy ma thuật
        marker.mesh.children[1].rotation.z += dt * 0.5;
      }
    }

    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }

    // Hiệu ứng nhịp thở tinh thể
    if (this.crystalMesh) {
      this.crystalMesh.rotation.y += 0.3 * dt;
      const pulse = 1.5 + Math.sin(this.elapsed * 2) * 0.05;
      this.crystalMesh.scale.setScalar(pulse);
    }

    if (this.crystalClusterMesh) {
      const pulseCluster = 2.0 + Math.cos(this.elapsed * 1.5) * 0.04;
      this.crystalClusterMesh.scale.setScalar(pulseCluster);
    }
  }

  protected async onUnload(): Promise<void> {
    // Gỡ bỏ chính xác handler để tránh rò rỉ bộ nhớ
    eventBus.off(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
    this.crystalMesh = null;
    this.crystalClusterMesh = null;
    this.portalMarkers = [];
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      // Tối ưu toán học: Dùng bình phương khoảng cách để check nhanh hơn dùng hàm Sqrt (Căn bậc hai) ngốn CPU
      if ((dx * dx + dz * dz) < marker.radius * marker.radius) {
        return marker.targetScene;
      }
    }
    return null;
  }
}
