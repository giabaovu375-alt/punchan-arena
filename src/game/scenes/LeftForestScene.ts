import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

function createPortalMesh(color: number, label: string): THREE.Group {
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
  inner.position.y = 0.02;
  group.add(inner);
  const light = new THREE.PointLight(color, 1.2, 10);
  light.position.y = 1;
  group.add(light);
  return group;
}

export class LeftForestScene extends BaseScene {
  private portalMarkers: any[] = [];
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;

  public scene: THREE.Scene;

  constructor() {
    super("LeftForestScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    // Rừng tối, ẩm ướt
    this.scene.background = new THREE.Color(0x1a3a1a);
    this.scene.fog = new THREE.FogExp2(0x1a3a1a, 0.035);

    const ambient = new THREE.AmbientLight(0x446644, 0.5);
    this.scene.add(ambient);
    const moon = new THREE.DirectionalLight(0xaaccff, 0.6);
    moon.position.set(30, 60, 40);
    this.scene.add(moon);

    // Mặt đất bùn lầy
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: 0x2d3a1f, roughness: 1, flatShading: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const gltfLoader = new GLTFLoader();

    // 1. Bụi cây rậm rạp (Load 1 lần, clone 15 lần + Shadow)
    gltfLoader.load("/model/bush.glb", (gltf) => {
      const masterBush = gltf.scene;
      masterBush.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      for (let i = 0; i < 15; i++) {
        const bushClone = masterBush.clone();
        bushClone.position.set(
          (Math.random() - 0.5) * 100,
          0,
          (Math.random() - 0.5) * 100
        );
        bushClone.scale.setScalar(1.2 + Math.random() * 0.5);
        bushClone.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(bushClone);
      }
    });

    // 2. Tảng đá lớn
    gltfLoader.load("/model/Big-stone.glb", (gltf) => {
      const stone = gltf.scene;
      stone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      stone.position.set(-20, 0, -20);
      stone.scale.setScalar(2.0);
      this.scene.add(stone);
    });

    // 3. Tượng cổ (Cổng dịch chuyển về Hub nằm ở đây)
    const statuePos = new THREE.Vector3(30, 0, 10);
    gltfLoader.load("/model/bo_ba_nam.glb", (gltf) => {
      const statue = gltf.scene;
      statue.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      statue.position.copy(statuePos);
      statue.scale.setScalar(3.0);
      this.scene.add(statue);
    });

    // 4. Portal về Hub (đặt trên tượng cổ)
    const portalMesh = createPortalMesh(0x00ff88, "Rừng Mật");
    portalMesh.position.copy(statuePos).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(portalMesh);
    this.portalMarkers.push({
      targetScene: "HubScene",
      position: statuePos.clone(),
      radius: 4,
      mesh: portalMesh,
    });

    // Goblin phục kích
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(15, 0, 10), new THREE.Vector3(-10, 0, -15)],
      { ...GOBLIN_CONFIG, scale: 4.5, chaseRange: 20, patrolRadius: 4 }
    );

    // Lắng nghe player tấn công
    eventBus.on(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);

    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "LeftForestScene" });
  }

  private onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    // Portal ring xoay
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0]) marker.mesh.children[0].rotation.z += dt * 0.3;
    }
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this.onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < marker.radius) return marker.targetScene;
    }
    return null;
  }
    }
