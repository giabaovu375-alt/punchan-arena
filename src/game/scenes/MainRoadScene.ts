import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── Hằng số cấu hình ────────────────────────────────────────────────────────
const SCENE_CONFIG = {
  // Màu sắc đồng bộ tone tối với HubScene
  FOG_COLOR:        0x1a0a2e,   // tím đen huyền bí
  FOG_NEAR:         20,
  FOG_FAR:          120,
  SKY_COLOR:        0x0d0520,   // nền trời đêm

  GROUND_COLOR:     0x1c1a0f,   // đất tối, hơi vàng
  ROAD_COLOR:       0x2a1f0e,   // đường đất tối

  AMBIENT_COLOR:    0x4a2060,   // ánh sáng môi trường tím lạnh
  AMBIENT_INTENSITY: 0.4,

  // Ánh trăng lạnh
  MOON_COLOR:       0x8ab4e8,
  MOON_INTENSITY:   0.8,

  // Đuốc/đèn bên đường — màu hổ phách ấm
  TORCH_COLOR:      0xff6a1a,
  TORCH_INTENSITY:  3.5,
  TORCH_DISTANCE:   18,

  // Portal
  PORTAL_HUB_Z:       148,  // phía Bắc → về Hub
  PORTAL_BOSS_Z:     -138,  // phía Nam → vào Boss/Intro
  PORTAL_RADIUS:        3,
  PORTAL_TRIGGER:     3.5,

  // Goblin
  PATROL_PAIRS: [
    { a: new THREE.Vector3(-4, 0, -60), b: new THREE.Vector3(4, 0, -20) },
    { a: new THREE.Vector3(-4, 0,  20), b: new THREE.Vector3(4, 0,  70) },
  ],
} as const;

// ─── Kiểu nội bộ ─────────────────────────────────────────────────────────────
interface PortalData {
  mesh:     THREE.Mesh;
  ring:     THREE.Mesh;
  light:    THREE.PointLight;
  targetZ:  number;
  target:   string;
  particles: THREE.Points;
}

interface TorchData {
  light:   THREE.PointLight;
  flicker: number;   // phase offset cho hiệu ứng rung
}

// ─── MainRoadScene ────────────────────────────────────────────────────────────
export class MainRoadScene extends BaseScene {
  public  scene: THREE.Scene;

  private enemyManager!:  EnemyManager;
  private playerRef!:     THREE.Object3D;
  private cameraRef!:     THREE.Camera;

  private portals:  PortalData[] = [];
  private torches:  TorchData[]  = [];
  private elapsed = 0;

  // Particle systems
  private dustParticles!: THREE.Points;
  private fogParticles!:  THREE.Points;

  constructor() {
    super("MainRoadScene");
    this.scene = new THREE.Scene();
  }

  // ─── Public setters ──────────────────────────────────────────────────────
  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildTorches();
    this._buildPortals();
    this._buildParticles();
    await this._loadModels();
    this._spawnEnemies();

    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "MainRoadScene" });
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateTorches(dt);
    this._animatePortals(dt);
    this._animateParticles(dt);

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

  // ─── Portal check (dùng PORTAL_TRIGGER thay vì hardcode 3) ───────────────
  public checkPortals(playerPos: THREE.Vector3): string | null {
    for (const portal of this.portals) {
      const dist = playerPos.distanceTo(
        new THREE.Vector3(0, 0, portal.targetZ)
      );
      if (dist < SCENE_CONFIG.PORTAL_TRIGGER) return portal.target;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Bầu trời + sương mù huyền bí */
  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(SCENE_CONFIG.SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(SCENE_CONFIG.FOG_COLOR, 0.018);

    // Ánh sáng môi trường tím lạnh
    const ambient = new THREE.AmbientLight(
      SCENE_CONFIG.AMBIENT_COLOR,
      SCENE_CONFIG.AMBIENT_INTENSITY
    );
    this.scene.add(ambient);

    // Ánh trăng — directional, lạnh, đổ bóng
    const moon = new THREE.DirectionalLight(
      SCENE_CONFIG.MOON_COLOR,
      SCENE_CONFIG.MOON_INTENSITY
    );
    moon.position.set(-30, 80, -20);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left   = -80;
    moon.shadow.camera.right  =  80;
    moon.shadow.camera.top    =  80;
    moon.shadow.camera.bottom = -80;
    moon.shadow.bias = -0.001;
    this.scene.add(moon);

    // Rim light nhẹ từ dưới — tăng chiều sâu nhân vật
    const rimLight = new THREE.DirectionalLight(0x2a0060, 0.3);
    rimLight.position.set(0, -10, 10);
    this.scene.add(rimLight);
  }

  /** Mặt đất + đường đi */
  private _buildTerrain(): void {
    // Đất tối
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 320, 40, 40),
      new THREE.MeshStandardMaterial({
        color:     SCENE_CONFIG.GROUND_COLOR,
        roughness: 1.0,
        metalness: 0.0,
      })
    );
    ground.rotation.x  = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Đường đất tối hơn, hơi bụi
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 320),
      new THREE.MeshStandardMaterial({
        color:     SCENE_CONFIG.ROAD_COLOR,
        roughness: 0.95,
        metalness: 0.0,
      })
    );
    road.rotation.x  = -Math.PI / 2;
    road.position.set(0, 0.02, 0);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  /** Đuốc 2 bên đường — thay cột đèn cho hợp tone fantasy tối */
  private _buildTorches(): void {
    const torchPositions: [number, number][] = [];
    for (let z = -120; z <= 120; z += 22) {
      torchPositions.push([-3.8, z]);
      torchPositions.push([ 3.8, z]);
    }

    torchPositions.forEach(([x, z], i) => {
      // Cột đuốc đơn giản bằng geometry
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x3a2510, roughness: 1 })
      );
      pole.position.set(x, 1.1, z);
      pole.castShadow = true;
      this.scene.add(pole);

      // Đầu đuốc
      const head = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.10, 0.25, 8),
        new THREE.MeshStandardMaterial({
          color:     0x8b4500,
          roughness: 0.7,
          emissive:  new THREE.Color(0xff4400),
          emissiveIntensity: 0.6,
        })
      );
      head.position.set(x, 2.4, z);
      this.scene.add(head);

      // Ánh sáng điểm — flicker
      const light = new THREE.PointLight(
        SCENE_CONFIG.TORCH_COLOR,
        SCENE_CONFIG.TORCH_INTENSITY,
        SCENE_CONFIG.TORCH_DISTANCE
      );
      light.position.set(x, 2.6, z);
      this.scene.add(light);

      this.torches.push({ light, flicker: i * 0.73 });
    });
  }

  /** Portal hiển thị + ánh sáng */
  private _buildPortals(): void {
    const defs = [
      { z: SCENE_CONFIG.PORTAL_HUB_Z,   target: "HubScene",   color: 0x9b30ff }, // tím Hub
      { z: SCENE_CONFIG.PORTAL_BOSS_Z,  target: "IntroScene", color: 0xff2020 }, // đỏ nguy hiểm
    ];

    defs.forEach(({ z, target, color }) => {
      // Ring ngoài
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(SCENE_CONFIG.PORTAL_RADIUS, 0.18, 16, 64),
        new THREE.MeshStandardMaterial({
          color,
          emissive:          new THREE.Color(color),
          emissiveIntensity: 1.2,
          roughness:         0.2,
          metalness:         0.8,
        })
      );
      ring.position.set(0, SCENE_CONFIG.PORTAL_RADIUS, z);
      ring.rotation.y = Math.PI / 2;
      this.scene.add(ring);

      // Mặt portal (disk bên trong)
      const portalMat = new THREE.MeshStandardMaterial({
        color,
        emissive:          new THREE.Color(color),
        emissiveIntensity: 0.5,
        transparent:       true,
        opacity:           0.35,
        side:              THREE.DoubleSide,
        depthWrite:        false,
      });
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(SCENE_CONFIG.PORTAL_RADIUS - 0.2, 64),
        portalMat
      );
      mesh.position.set(0, SCENE_CONFIG.PORTAL_RADIUS, z);
      mesh.rotation.y = Math.PI / 2;
      this.scene.add(mesh);

      // Ánh sáng portal
      const light = new THREE.PointLight(color, 4, 20);
      light.position.set(0, SCENE_CONFIG.PORTAL_RADIUS, z);
      this.scene.add(light);

      // Particles xung quanh portal
      const particles = this._createPortalParticles(color, z);

      this.portals.push({ mesh, ring, light, targetZ: z, target, particles });
    });
  }

  /** Tạo particles nhỏ bay quanh portal */
  private _createPortalParticles(color: number, z: number): THREE.Points {
    const count  = 80;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = SCENE_CONFIG.PORTAL_RADIUS * (0.6 + Math.random() * 0.8);
      positions[i * 3 + 0] = Math.cos(angle) * 0.3;  // flat
      positions[i * 3 + 1] = Math.sin(angle) * radius + SCENE_CONFIG.PORTAL_RADIUS;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size:        0.12,
      transparent: true,
      opacity:     0.8,
      depthWrite:  false,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    return pts;
  }

  /** Bụi + hạt ma quái bay trong không khí */
  private _buildParticles(): void {
    // Hạt bụi đường
    const dustCount = 300;
    const dustPos   = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3 + 0] = (Math.random() - 0.5) * 12;
      dustPos[i * 3 + 1] = Math.random() * 3;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 280;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.dustParticles = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color:       0xc8a46e,
        size:        0.07,
        transparent: true,
        opacity:     0.4,
        depthWrite:  false,
      })
    );
    this.scene.add(this.dustParticles);

    // Hạt sương ma (xanh lá lạnh)
    const fogCount = 150;
    const fogPos   = new Float32Array(fogCount * 3);
    for (let i = 0; i < fogCount; i++) {
      fogPos[i * 3 + 0] = (Math.random() - 0.5) * 30;
      fogPos[i * 3 + 1] = Math.random() * 1.5;
      fogPos[i * 3 + 2] = (Math.random() - 0.5) * 280;
    }
    const fogGeo = new THREE.BufferGeometry();
    fogGeo.setAttribute("position", new THREE.BufferAttribute(fogPos, 3));
    this.fogParticles = new THREE.Points(
      fogGeo,
      new THREE.PointsMaterial({
        color:       0x3a7a5a,
        size:        0.18,
        transparent: true,
        opacity:     0.25,
        depthWrite:  false,
      })
    );
    this.scene.add(this.fogParticles);
  }

  /** Load GLTF models — tất cả async, không block nhau */
  private async _loadModels(): Promise<void> {
    const loader = new GLTFLoader();

    const load = (path: string): Promise<THREE.Group> =>
      new Promise((resolve, reject) => {
        loader.load(path, (g) => resolve(g.scene), undefined, reject);
      });

    /** Bật shadow cho toàn bộ mesh trong group */
    const enableShadow = (group: THREE.Group) => {
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow    = true;
          child.receiveShadow = true;
        }
      });
    };

    // ── Hàng rào: load 1 lần, clone ──────────────────────────────────────
    load("/model/stylized fence.glb").then((master) => {
      enableShadow(master);
      for (let z = -140; z <= 140; z += 10) {
        for (const sx of [-3.4, 3.4]) {
          const c = master.clone();
          c.position.set(sx, 0, z);
          c.scale.setScalar(0.8);
          this.scene.add(c);
        }
      }
    });

    // ── Cột đèn/đuốc model nếu có (optional, fallback đã có geometry) ───
    load("/model/low_poly_lamp_post.glb").then((master) => {
      enableShadow(master);
      // Dùng làm decoration thưa hơn — không làm nguồn sáng nữa
      for (let z = -120; z <= 120; z += 44) {
        const c = master.clone();
        c.position.set(4.2, 0, z);
        c.scale.setScalar(0.55);
        // Tối bớt model để hợp tone
        c.traverse((ch) => {
          const m = ch as THREE.Mesh;
          if (m.isMesh && m.material) {
            const mat = (m.material as THREE.MeshStandardMaterial).clone();
            mat.color.multiplyScalar(0.4);
            m.material = mat;
          }
        });
        this.scene.add(c);
      }
    }).catch(() => { /* model không bắt buộc */ });

    // ── Nhà ven đường ────────────────────────────────────────────────────
    load("/model/stylized medieval_house.glb").then((house) => {
      enableShadow(house);
      house.position.set(-14, 0, -90);
      house.scale.setScalar(2.0);
      // Giảm emissive để hợp tone tối
      house.traverse((ch) => {
        const m = ch as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.emissiveIntensity !== undefined)
            mat.emissiveIntensity *= 0.3;
        }
      });
      this.scene.add(house);
    });

    load("/model/stylized medieval_house 2.glb").then((house) => {
      enableShadow(house);
      house.position.set(14, 0, 75);
      house.scale.setScalar(2.0);
      house.traverse((ch) => {
        const m = ch as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.emissiveIntensity !== undefined)
            mat.emissiveIntensity *= 0.3;
        }
      });
      this.scene.add(house);
    });

    // ── Xe ngựa ──────────────────────────────────────────────────────────
    load("/model/stylized wooden_wagon.glb").then((wagon) => {
      enableShadow(wagon);
      wagon.position.set(-5, 0, -45);
      wagon.scale.setScalar(1.5);
      this.scene.add(wagon);
    });
  }

  /** Spawn goblin theo pairs patrol */
  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);

    SCENE_CONFIG.PATROL_PAIRS.forEach(({ a, b }) => {
      this.enemyManager.spawn(
        [a, b],
        { ...GOBLIN_CONFIG, scale: 4.0, chaseRange: 18 }
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE ANIMATORS (gọi trong onUpdate)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Đuốc rung — mô phỏng lửa thật */
  private _animateTorches(dt: number): void {
    this.torches.forEach((t) => {
      t.flicker += dt * 8;
      // Kết hợp 2 sin lệch pha → flicker tự nhiên hơn
      const flicker =
        Math.sin(t.flicker * 1.3) * 0.18 +
        Math.sin(t.flicker * 2.7) * 0.08;
      t.light.intensity = SCENE_CONFIG.TORCH_INTENSITY * (1 + flicker);
    });
  }

  /** Portal xoay + pulse */
  private _animatePortals(dt: number): void {
    this.portals.forEach((p, i) => {
      const t = this.elapsed;
      // Ring xoay chậm
      p.ring.rotation.z += dt * (i % 2 === 0 ? 0.4 : -0.4);

      // Disk pulse opacity
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.25 + Math.sin(t * 2 + i) * 0.12;

      // Light pulse
      p.light.intensity = 3.5 + Math.sin(t * 3 + i * 1.5) * 1.0;

      // Particles xoay quanh portal
      p.particles.rotation.y += dt * 0.3;
    });
  }

  /** Hạt bụi trôi nhẹ theo gió */
  private _animateParticles(dt: number): void {
    const dustPos = this.dustParticles.geometry.attributes
      .position as THREE.BufferAttribute;
    const fogPos  = this.fogParticles.geometry.attributes
      .position as THREE.BufferAttribute;

    for (let i = 0; i < dustPos.count; i++) {
      let y = dustPos.getY(i) + dt * 0.08;
      if (y > 3.5) y = 0;
      dustPos.setY(i, y);
      // Trôi ngang nhẹ
      let x = dustPos.getX(i) + dt * 0.04;
      if (x > 6)  x = -6;
      dustPos.setX(i, x);
    }
    dustPos.needsUpdate = true;

    for (let i = 0; i < fogPos.count; i++) {
      let x = fogPos.getX(i) + dt * 0.12;
      if (x > 15) x = -15;
      fogPos.setX(i, x);
    }
    fogPos.needsUpdate = true;
  }
        }
        
