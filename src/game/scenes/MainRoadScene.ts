import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

export class MainRoadScene extends BaseScene {
  private portalMarkers: any[] = [];
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;

  public scene: THREE.Scene;

  constructor() {
    super("MainRoadScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera) { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    // Ánh sáng ban ngày
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 30, 200);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, 80, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
    this.scene.add(sun);

    // Mặt đất cỏ xanh
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 300),
      new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.9, flatShading: true })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Đường đi
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 300), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, 0);
    road.receiveShadow = true;
    this.scene.add(road);

    // Hàng rào gỗ 2 bên
    const fenceLoader = new GLTFLoader();
    for (let z = -140; z <= 140; z += 10) {
      for (const sx of [-3.2, 3.2]) {
        fenceLoader.load("/model/stylized fence.glb", (gltf) => {
          const fence = gltf.scene;
          fence.position.set(sx, 0, z);
          fence.scale.setScalar(0.8);
          this.scene.add(fence);
        });
      }
    }

    // Cột đèn
    const lampLoader = new GLTFLoader();
    for (let z = -120; z <= 120; z += 25) {
      lampLoader.load("/model/low_poly_lamp_post.glb", (gltf) => {
        const lamp = gltf.scene;
        lamp.position.set(3.5, 0, z);
        lamp.scale.setScalar(0.6);
        this.scene.add(lamp);
      });
    }

    // Nhà ven đường
    const houseLoader = new GLTFLoader();
    houseLoader.load("/model/stylized medieval_house.glb", (gltf) => {
      const house = gltf.scene;
      house.position.set(-12, 0, -100);
      house.scale.setScalar(2.0);
      this.scene.add(house);
    });
    houseLoader.load("/model/stylized medieval_house 2.glb", (gltf) => {
      const house = gltf.scene;
      house.position.set(12, 0, 80);
      house.scale.setScalar(2.0);
      this.scene.add(house);
    });

    // Xe ngựa
    const wagonLoader = new GLTFLoader();
    wagonLoader.load("/model/stylized wooden_wagon.glb", (gltf) => {
      const wagon = gltf.scene;
      wagon.position.set(-5, 0, -50);
      wagon.scale.setScalar(1.5);
      this.scene.add(wagon);
    });

    // Goblin tuần tra
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(-4, 0, -80), new THREE.Vector3(4, 0, 30)],
      { ...GOBLIN_CONFIG, scale: 4.0, chaseRange: 18 }
    );

    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "MainRoadScene" });
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

  public checkPortals(playerPos: THREE.Vector3): string | null {
    const distToHub = playerPos.distanceTo(new THREE.Vector3(0, 0, 150));
    if (distToHub < 3) return "HubScene";
    const distToIntro = playerPos.distanceTo(new THREE.Vector3(0, 0, -140));
    if (distToIntro < 3) return "IntroScene";
    return null;
  }
}
