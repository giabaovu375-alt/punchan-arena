import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  // Tone: đêm sa mạc đá — tím đen lạnh, khác hẳn rừng xanh LeftForest
  FOG_COLOR:         0x0f0a1a,
  SKY_COLOR:         0x080612,
  FOG_DENSITY:       0.022,

  AMBIENT_COLOR:     0x2a1a40,
  AMBIENT_INTENSITY: 0.45,

  // Ánh trăng lạnh nghiêng từ góc cao
  MOON_COLOR:        0x9ab8e8,
  MOON_INTENSITY:    0.7,

  GROUND_COLOR:      0x1a140f,   // đá tối, nâu xám

  // Crystal — hồng tím phát sáng
  CRYSTAL_COLOR:     0xff44cc,
  CRYSTAL_EMISSIVE:  0.9,

  // Portal — vàng hổ phách nguy hiểm
  PORTAL_COLOR:      0xffaa00,
  PORTAL_POS:        new THREE.Vector3(30, 0, 0),
  PORTAL_TRIGGER:    3.5,

  // Ánh sáng tinh thể
  CRYSTAL_LIGHT_COLOR:    0xff44cc,
  CRYSTAL_LIGHT_INTENSITY: 2.5,
  CRYSTAL_LIGHT_DISTANCE:  20,

  // Đá phát sáng rải rác
  RUNE_COLOR:        0x6622ff,
  RUNE_INTENSITY:    1.2,
  RUNE_DISTANCE:     8,
} as const;

// ─── RightPlatformScene ───────────────────────────────────────────────────────
export class RightPlatformScene extends BaseScene {
  public  scene: THREE.Scene;

  private enemyManager!:  EnemyManager;
  private playerRef!:     THREE.Object3D;
  private cameraRef!:     THREE.Camera;
  private elapsed = 0;

  // Crystal refs để animate
  private crystalMesh!:        THREE.Group;
  private crystalClusterMesh!: THREE.Group;
  private crystalLight!:       THREE.PointLight;
  private clusterLight!:       THREE.PointLight;

  // Portal
  private portalGroup!:  THREE.Group;
  private portalRing!:   THREE.Mesh;
  private portalDisk!:   THREE.Mesh;
  private portalLight!:  THREE.PointLight;

  // Rune stones — ánh sáng tím rải rác
  private runes: { light: THREE.PointLight; phase: number }[] = [];

  // Particles — bụi đá + mảnh tinh thể
  private dustParticles!:    THREE.Points;
  private crystalParticles!: THREE.Points;

  constructor() {
    super("RightPlatformScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildPortal();
    this._buildRuneLights();
    this._buildParticles();
    await this._loadModels();
    this._spawnEnemies();

    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "RightPlatformScene" });
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateCrystals(dt);
    this._animatePortal(dt);
    this._animateRunes(dt);
    this._animateParticles(dt);

    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    // So sánh bình phương — tránh sqrt ngốn CPU
    const dx = playerPos.x - CFG.PORTAL_POS.x;
    const dz = playerPos.z - CFG.PORTAL_POS.z;
    return (dx * dx + dz * dz) < CFG.PORTAL_TRIGGER * CFG.PORTAL_TRIGGER
      ? "HubScene"
      : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.FOG_DENSITY);

    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));

    // Ánh trăng lạnh nghiêng cao — đổ bóng sắc nét trên đá
    const moon = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    moon.position.set(60, 100, 30);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left   = -80;
    moon.shadow.camera.right  =  80;
    moon.shadow.camera.top    =  80;
    moon.shadow.camera.bottom = -80;
    moon.shadow.bias = -0.001;
    this.scene.add(moon);

    // Rim light tím nhẹ từ dưới — tôn tinh thể
    const rim = new THREE.DirectionalLight(0x440088, 0.25);
    rim.position.set(0, -5, 15);
    this.scene.add(rim);
  }

  private _buildTerrain(): void {
    // Nền đá tối, flatShading tạo cảm giác rocky
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150, 40, 40),
      new THREE.MeshStandardMaterial({
        color:      CFG.GROUND_COLOR,
        roughness:  1.0,
        metalness:  0.05,
        flatShading: true,
      })
    );
    ground.rotation.x  = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Nền đá cao hơn một chút làm platform chính giữa
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 22, 0.4, 7, 1, false),
      new THREE.MeshStandardMaterial({
        color:      0x1f1820,
        roughness:  0.95,
        flatShading: true,
      })
    );
    platform.position.set(0, 0.2, 0);
    platform.receiveShadow = true;
    platform.castShadow    = true;
    this.scene.add(platform);
  }

  /** Portal vàng — đứng thẳng, hợp phong cách khu đá */
  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();

    // Vòng ngoài đứng thẳng (không nằm bệt như LeftForest)
    this.portalRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.18, 16, 64),
      new THREE.MeshStandardMaterial({
        color:             CFG.PORTAL_COLOR,
        emissive:          new THREE.Color(CFG.PORTAL_COLOR),
        emissiveIntensity: 1.2,
        roughness:         0.15,
        metalness:         0.85,
      })
    );
    this.portalGroup.add(this.portalRing);

    // Disk bên trong
    this.portalDisk = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 64),
      new THREE.MeshStandardMaterial({
        color:             CFG.PORTAL_COLOR,
        emissive:          new THREE.Color(CFG.PORTAL_COLOR),
        emissiveIntensity: 0.4,
        transparent:       true,
        opacity:           0.28,
        side:              THREE.DoubleSide,
        depthWrite:        false,
      })
    );
    this.portalGroup.add(this.portalDisk);

    // Ánh sáng vàng
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 4.0, 22);
    this.portalLight.position.set(0, 0, 0.5);
    this.portalGroup.add(this.portalLight);

    // Particles vàng xung quanh ring
    const count = 80;
    const pPos  = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r     = 2.2 + (Math.random() - 0.5) * 0.6;
      pPos[i * 3]     = Math.cos(angle) * r;
      pPos[i * 3 + 1] = Math.sin(angle) * r;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const portalPts = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        color:       CFG.PORTAL_COLOR,
        size:        0.1,
        transparent: true,
        opacity:     0.75,
        depthWrite:  false,
      })
    );
    this.portalGroup.add(portalPts);

    // Đặt portal đứng thẳng, cao 2.2 đơn vị
    this.portalGroup.position.copy(CFG.PORTAL_POS);
    this.portalGroup.position.y = 2.2;
    this.scene.add(this.portalGroup);
  }

  /** Rune stones — đá tím phát sáng rải rác khu vực */
  private _buildRuneLights(): void {
    const positions = [
      new THREE.Vector3(-18,  0.3, -18),
      new THREE.Vector3( 18,  0.3,  22),
      new THREE.Vector3(-28,  0.3,  10),
      new THREE.Vector3( 10,  0.3, -30),
      new THREE.Vector3(-10,  0.3,  35),
    ];

    positions.forEach((pos, i) => {
      // Khối đá rune nhỏ
      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.4, 0),
        new THREE.MeshStandardMaterial({
          color:             0x2a0055,
          emissive:          new THREE.Color(CFG.RUNE_COLOR),
          emissiveIntensity: 0.8,
          roughness:         0.6,
          metalness:         0.3,
        })
      );
      stone.position.copy(pos);
      stone.castShadow = true;
      this.scene.add(stone);

      const light = new THREE.PointLight(CFG.RUNE_COLOR, CFG.RUNE_INTENSITY, CFG.RUNE_DISTANCE);
      light.position.copy(pos);
      light.position.y += 0.5;
      this.scene.add(light);

      this.runes.push({ light, phase: i * 1.26 });
    });
  }

  private _buildParticles(): void {
    // Bụi đá xám trôi chậm
    const dustCount = 250;
    const dustPos   = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3]     = (Math.random() - 0.5) * 140;
      dustPos[i * 3 + 1] = Math.random() * 5;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.dustParticles = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color:       0x554466,
        size:        0.06,
        transparent: true,
        opacity:     0.35,
        depthWrite:  false,
      })
    );
    this.scene.add(this.dustParticles);

    // Mảnh tinh thể li ti — hồng tím bay lên từ crystal
    const crystalCount = 120;
    const crystalPos   = new Float32Array(crystalCount * 3);
    for (let i = 0; i < crystalCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * 8;
      crystalPos[i * 3]     = 20 + Math.cos(angle) * r;   // quanh crystal chính
      crystalPos[i * 3 + 1] = Math.random() * 4;
      crystalPos[i * 3 + 2] = -20 + Math.sin(angle) * r;
    }
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.BufferAttribute(crystalPos, 3));
    this.crystalParticles = new THREE.Points(
      cGeo,
      new THREE.PointsMaterial({
        color:       CFG.CRYSTAL_COLOR,
        size:        0.08,
        transparent: true,
        opacity:     0.6,
        depthWrite:  false,
      })
    );
    this.scene.add(this.crystalParticles);
  }

  private async _loadModels(): Promise<void> {
    const loader = new GLTFLoader();
    const load   = (p: string) => new Promise<THREE.Group>((res, rej) =>
      loader.load(p, (g) => res(g.scene), undefined, rej)
    );
    const shadow = (g: THREE.Group) => g.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });

    // Cột đá trung tâm
    load("/model/stone pillar.glb").then((pillar) => {
      shadow(pillar);
      pillar.position.set(0, 0, 0);
      pillar.scale.setScalar(2.0);
      this.scene.add(pillar);
    });

    // Tinh thể hồng — save ref để animate
    load("/model/crystal hong.glb").then((crystal) => {
      shadow(crystal);
      crystal.position.set(20, 0, -20);
      crystal.scale.setScalar(1.5);
      // Tăng emissive để crystal tự phát sáng
      crystal.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive     = new THREE.Color(CFG.CRYSTAL_COLOR);
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE;
          m.material = mat;
        }
      });
      this.crystalMesh = crystal;
      this.scene.add(crystal);

      // Ánh sáng riêng của crystal
      this.crystalLight = new THREE.PointLight(
        CFG.CRYSTAL_LIGHT_COLOR,
        CFG.CRYSTAL_LIGHT_INTENSITY,
        CFG.CRYSTAL_LIGHT_DISTANCE
      );
      this.crystalLight.position.set(20, 3, -20);
      this.scene.add(this.crystalLight);
    });

    // Cụm tinh thể — save ref
    load("/model/crystal cluster.glb").then((cluster) => {
      shadow(cluster);
      cluster.position.set(-25, 0, 25);
      cluster.scale.setScalar(2.0);
      cluster.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive     = new THREE.Color(CFG.CRYSTAL_COLOR);
          mat.emissiveIntensity = CFG.CRYSTAL_EMISSIVE * 0.7;
          m.material = mat;
        }
      });
      this.crystalClusterMesh = cluster;
      this.scene.add(cluster);

      this.clusterLight = new THREE.PointLight(
        CFG.CRYSTAL_LIGHT_COLOR,
        CFG.CRYSTAL_LIGHT_INTENSITY * 0.7,
        CFG.CRYSTAL_LIGHT_DISTANCE * 0.8
      );
      this.clusterLight.position.set(-25, 2.5, 25);
      this.scene.add(this.clusterLight);
    });

    // Cầu dây cũ kỹ
    load("/model/old_ropebridge_low_poly.glb").then((bridge) => {
      shadow(bridge);
      bridge.position.set(0, 0, -40);
      bridge.scale.setScalar(1.5);
      // Tối bớt cho hợp đêm
      bridge.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(0.5);
          m.material = mat;
        }
      });
      this.scene.add(bridge);
    });
  }

  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(20, 0, 15), new THREE.Vector3(-30, 0, 20)],
      { ...GOBLIN_CONFIG, scale: 4.0, chaseRange: 18, patrolRadius: 5 }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATORS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Crystal xoay chậm + pulse scale + light nhịp thở */
  private _animateCrystals(dt: number): void {
    const t = this.elapsed;

    if (this.crystalMesh) {
      this.crystalMesh.rotation.y += dt * 0.25;
      const pulse = 1.5 + Math.sin(t * 1.8) * 0.06;
      this.crystalMesh.scale.setScalar(pulse);
    }
    if (this.crystalLight) {
      this.crystalLight.intensity =
        CFG.CRYSTAL_LIGHT_INTENSITY * (0.85 + Math.sin(t * 2.2) * 0.2);
    }

    if (this.crystalClusterMesh) {
      const pulseCluster = 2.0 + Math.cos(t * 1.4) * 0.05;
      this.crystalClusterMesh.scale.setScalar(pulseCluster);
    }
    if (this.clusterLight) {
      this.clusterLight.intensity =
        CFG.CRYSTAL_LIGHT_INTENSITY * 0.7 * (0.85 + Math.cos(t * 1.9) * 0.2);
    }
  }

  /** Portal xoay ring + pulse opacity + light */
  private _animatePortal(dt: number): void {
    const t = this.elapsed;

    this.portalRing.rotation.z += dt * 0.5;
    this.portalRing.rotation.y += dt * 0.15;

    const diskMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    diskMat.opacity = 0.22 + Math.sin(t * 2.5) * 0.1;

    this.portalLight.intensity = 3.5 + Math.sin(t * 3.2) * 1.0;

    // Particles portal xoay quanh trục Y
    const pts = this.portalGroup.children[3] as THREE.Points;
    if (pts) pts.rotation.z += dt * 0.3;
  }

  /** Rune stones — pulse tím huyền bí */
  private _animateRunes(dt: number): void {
    this.runes.forEach((r) => {
      r.phase += dt * 1.5;
      r.light.intensity = CFG.RUNE_INTENSITY * (0.7 + Math.sin(r.phase) * 0.4);
    });
  }

  private _animateParticles(dt: number): void {
    // Bụi đá trôi ngang
    const dustPos = this.dustParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dustPos.count; i++) {
      let x = dustPos.getX(i) + dt * 0.06;
      if (x > 70) x = -70;
      dustPos.setX(i, x);
      let y = dustPos.getY(i) + dt * 0.02;
      if (y > 5) y = 0;
      dustPos.setY(i, y);
    }
    dustPos.needsUpdate = true;

    // Mảnh tinh thể bay lên
    const cPos = this.crystalParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cPos.count; i++) {
      let y = cPos.getY(i) + dt * 0.12;
      if (y > 5) y = 0;
      cPos.setY(i, y);
      // Xoáy nhẹ quanh crystal
      const x = cPos.getX(i) - 20;
      const z = cPos.getZ(i) + 20;
      const angle = Math.atan2(z, x) + dt * 0.2;
      const r     = Math.sqrt(x * x + z * z);
      cPos.setX(i, 20 + Math.cos(angle) * r);
      cPos.setZ(i, -20 + Math.sin(angle) * r);
    }
    cPos.needsUpdate = true;
  }

  // ─── Event handler ──────────────────────────────────────────────────────────
  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
  }
                                            
