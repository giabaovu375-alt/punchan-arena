import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// Hàm khởi tạo Portal nằm bệt chuẩn chỉ dưới mặt đất
function createPortalMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.18, 12, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.7 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.01;
  group.add(inner);
  
  const light = new THREE.PointLight(color, 1.5, 12);
  light.position.y = 0.5;
  group.add(light);
  
  return group;
}

export class BossScene extends BaseScene {
  private portalMarkers: any[] = [];
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;

  public scene: THREE.Scene;

  constructor() {
    super("BossScene");
    this.scene = new THREE.Scene();
    
    // Khắc phục rò rỉ bộ nhớ: Bind cứng ngữ cảnh class cho event listener
    this.onPlayerAttack = this.onPlayerAttack.bind(this);
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    // Đấu trường tối, rực lửa độc bản
    this.scene.background = new THREE.Color(0x1a0a0a);
    this.scene.fog = new THREE.FogExp2(0x330000, 0.02);

    const fireLight = new THREE.PointLight(0xff4400, 2, 80);
    fireLight.position.set(0, 5, 0);
    this.scene.add(fireLight);
    
    const ambient = new THREE.AmbientLight(0x331111, 0.5);
    this.scene.add(ambient);

    // Sàn đấu hình tròn
    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.3 })
    );
    arena.rotation.x = -Math.PI / 2;
    arena.receiveShadow = true;
    this.scene.add(arena);

    // 8 Cột đá hỏa ngục vây quanh sân đấu
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 35;
      const z = Math.sin(angle) * 35;
      
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 8), pillarMat);
      pillar.position.set(x, 2, z);
      pillar.castShadow = true;
      this.scene.add(pillar);

      const fire = new THREE.PointLight(0xff6600, 0.8, 10);
      fire.position.set(x, 4.5, z);
      this.scene.add(fire);
    }

    // Đống đầu lâu trang trí kinh dị
    const gltfLoader = new GLTFLoader();
    gltfLoader.load("/model/pile of skulls.glb", (gltf) => {
      const skull = gltf.scene;
      skull.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      skull.position.set(10, 0, 10);
      skull.scale.setScalar(1.2);
      this.scene.add(skull);
    });

    // Portal khẩn cấp nằm ở góc xa sân đấu (Hạ trục Y bệt xuống sàn)
    const portalPos = new THREE.Vector3(0, 0, 38);
    const portalMesh = createPortalMesh(0xff2200);
    portalMesh.position.copy(portalPos).add(new THREE.Vector3(0, 0.05, 0));
    this.scene.add(portalMesh);
    
    this.portalMarkers.push({
      targetScene: "HubScene",
      position: portalPos.clone(),
      radius: 3.5,
      mesh: portalMesh,
    });

    // Khởi tạo Enemy Manager gánh trách nhiệm sinh Boss
    this.enemyManager = new EnemyManager(this.scene, document.body);

    // CHÍNH THỨC TRÌNH LÀNG: Vua Goblin Khổng Lồ (Cân chỉnh thông số bạo lực)
    this.enemyManager.spawn(
      [new THREE.Vector3(0, 0, -10)], // Đứng uy nghi ngay phía trên tâm map
      { 
        ...GOBLIN_CONFIG, 
        scale: 7.0,       // To đột biến gấp 3 lần quái thường
        chaseRange: 50,    // Quét toàn bộ diện tích sàn đấu, không cho player chạy thoát
        patrolRadius: 0    // Không thèm đi tuần, thấy player là bổ củi luôn
      }
    );

    // Đăng ký nhận sự kiện tấn công mượt mà không leak
    eventBus.on(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);

    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "BossScene" });
  }

  private onPlayerAttack(data: { origin: THREE.Vector3; range: number; damage: number }): void {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;

    // Xoay hiệu ứng lõi ma thuật của Portal
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[1]) {
        marker.mesh.children[1].rotation.z += dt * 0.4;
      }
    }

    // Cập nhật AI đấm nhau và bẫy logic Player tụt máu
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      
      if (dmg > 0) {
        // Gửi dame về UI giảm thanh máu player
        eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });

        // LOGIC ÉP THUA NGHỆ THUẬT:
        // Bạn check ở đây hoặc trong PlayerController, nếu HP sắp về 0 hoặc dính đòn chí mạng
        // Đừng chạy hàm chết của Map 1, bắn sự kiện rẽ nhánh nhảy thẳng sang Map 2 luôn:
        // eventBus.emit("TRIGGER_MAP_2_TRANSITION");
      }
    }
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
    this.portalMarkers = [];
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      if ((dx * dx + dz * dz) < marker.radius * marker.radius) {
        return marker.targetScene;
      }
    }
    return null;
  }
      }
