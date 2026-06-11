import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  // Atmosphere
  SKY_COLOR:          0x060002,
  FOG_COLOR:          0x1a0000,
  FOG_DENSITY:        0.016,

  // Lighting
  AMBIENT_COLOR:      0x3a0808,
  AMBIENT_INTENSITY:  0.35,

  // Central fire
  FIRE_COLOR:         0xff3300,
  FIRE_INTENSITY:     4.5,
  FIRE_DISTANCE:      95,

  // Pillars
  PILLAR_COUNT:       8,
  PILLAR_RADIUS:      34,
  PILLAR_FIRE_COLOR:  0xff6600,
  PILLAR_FIRE_INTENSITY: 1.6,
  PILLAR_FIRE_DISTANCE:  16,

  // Arena
  ARENA_RADIUS:       38,
  ARENA_COLOR:        0x1a1010,

  // Portal (back to hub)
  PORTAL_COLOR:       0xff2200,
  PORTAL_POS:         new THREE.Vector3(0, 0, 35),
  PORTAL_TRIGGER:     3.5,

  // Boss
  BOSS_POS:           new THREE.Vector3(0, 0, -10),
  BOSS_SCALE:         2.5,   // ✅ fixed từ 7.0
  BOSS_HP:            500,
  BOSS_DAMAGE:        25,
  BOSS_CHASE:         50,

  // Rune
  RUNE_COLOR:         0xff0000,
  RUNE_EMISSIVE:      0.65,
} as const;

// ─── BossScene ────────────────────────────────────────────────────────────────
export class BossScene extends BaseScene {
  public  scene: THREE.Scene;
  private enemyManager!: EnemyManager;
  private playerRef!:    THREE.Object3D;
  private cameraRef!:    THREE.Camera;
  private elapsed = 0;

  // Lights & meshes
  private centralFireLight!: THREE.PointLight;
  private centralFireMesh!:  THREE.Mesh;
  private pillarFires: { light: THREE.PointLight; phase: number; mesh: THREE.Mesh }[] = [];

  // Portal
  private portalGroup!: THREE.Group;
  private portalRing!:  THREE.Mesh;
  private portalDisk!:  THREE.Mesh;
  private portalLight!: THREE.PointLight;

  // Rune floor
  private runeRings: THREE.Mesh[] = [];

  // Particles
  private emberParticles!: THREE.Points;
  private ashParticles!:   THREE.Points;

  // Lava cracks (emissive meshes)
  private lavaCracks: THREE.Mesh[] = [];

  constructor() {
    super("BossScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    this.enemyManager = new EnemyManager(this.scene, document.body);

    this._setupAtmosphere();
    this._buildArena();
    this._buildLavaCracks();
    this._buildPillars();
    this._buildRuneFloor();
    this._buildCentralFire();
    this._buildPortal();
    this._buildParticles();

    await this._loadModels();
    this._spawnBoss();

    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateCentralFire();
    this._animatePillarFires(dt);
    this._animatePortal(dt);
    this._animateRuneFloor();
    this._animateParticles(dt);
    this._animateLavaCracks();

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
    const dx = playerPos.x - CFG.PORTAL_POS.x;
    const dz = playerPos.z - CFG.PORTAL_POS.z;
    return (dx * dx + dz * dz) < CFG.PORTAL_TRIGGER * CFG.PORTAL_TRIGGER ? "HubScene" : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.FOG_DENSITY);

    // Ambient
    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));

    // Rim từ dưới — hiệu ứng địa ngục
    const hellRim = new THREE.DirectionalLight(0x660000, 0.35);
    hellRim.position.set(0, -6, 0);
    this.scene.add(hellRim);

    // Rim từ sau boss
    const backRim = new THREE.DirectionalLight(0xff1100, 0.18);
    backRim.position.set(0, 10, -50);
    this.scene.add(backRim);

    // Thêm fill nhẹ từ trên xuống tránh model boss quá tối
    const topFill = new THREE.DirectionalLight(0x440000, 0.2);
    topFill.position.set(0, 20, 0);
    this.scene.add(topFill);
  }

  private _buildArena(): void {
    // Nền ngoài rộng
    const outerGround = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x0d0808, roughness: 1.0 })
    );
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.receiveShadow = true;
    this.scene.add(outerGround);

    // Arena chính
    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(CFG.ARENA_RADIUS, 80),
      new THREE.MeshStandardMaterial({
        color: CFG.ARENA_COLOR,
        roughness: 0.8,
        metalness: 0.2,
      })
    );
    arena.rotation.x = -Math.PI / 2;
    arena.position.y = 0.02;
    arena.receiveShadow = true;
    this.scene.add(arena);

    // Viền đỏ arena
    const border = new THREE.Mesh(
      new THREE.RingGeometry(CFG.ARENA_RADIUS - 0.8, CFG.ARENA_RADIUS + 1.8, 80),
      new THREE.MeshStandardMaterial({
        color: 0x440000,
        emissive: new THREE.Color(0x660000),
        emissiveIntensity: 0.5,
        roughness: 0.4,
        metalness: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    border.rotation.x = -Math.PI / 2;
    border.position.y = 0.03;
    this.scene.add(border);

    // Viền nhỏ bên trong — tạo depth
    const innerBorder = new THREE.Mesh(
      new THREE.RingGeometry(CFG.ARENA_RADIUS - 4, CFG.ARENA_RADIUS - 3.2, 80),
      new THREE.MeshStandardMaterial({
        color: 0x220000,
        emissive: new THREE.Color(0x330000),
        emissiveIntensity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    innerBorder.rotation.x = -Math.PI / 2;
    innerBorder.position.y = 0.035;
    this.scene.add(innerBorder);
  }

  /** Các vết nứt phát sáng dưới nền — tạo cảm giác dung nham */
  private _buildLavaCracks(): void {
    const crackMat = new THREE.MeshStandardMaterial({
      color: 0x220000,
      emissive: new THREE.Color(0xff2200),
      emissiveIntensity: 0.0, // animate dần
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // 6 vết nứt hướng ra từ trung tâm
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const length = 10 + Math.random() * 14;
      const crack = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18 + Math.random() * 0.12, length),
        crackMat.clone()
      );
      crack.rotation.x = -Math.PI / 2;
      crack.rotation.z = angle;
      crack.position.set(
        Math.cos(angle) * (length / 2),
        0.04,
        Math.sin(angle) * (length / 2)
      );
      this.scene.add(crack);
      this.lavaCracks.push(crack);
    }
  }

  private _buildPillars(): void {
    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x1a0f0f, roughness: 0.65, metalness: 0.55,
    });
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x150a0a, roughness: 0.8, metalness: 0.4,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x331100,
      emissive: new THREE.Color(0x661100),
      emissiveIntensity: 0.5,
      roughness: 0.4,
    });

    for (let i = 0; i < CFG.PILLAR_COUNT; i++) {
      const angle = (i / CFG.PILLAR_COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * CFG.PILLAR_RADIUS;
      const z = Math.sin(angle) * CFG.PILLAR_RADIUS;

      // Bệ dưới
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8), baseMat);
      base.position.set(x, 0.25, z);
      base.castShadow = true;
      this.scene.add(base);

      // Thân trụ
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 5.8, 8), shaftMat);
      shaft.position.set(x, 3.4, z);
      shaft.castShadow = true;
      this.scene.add(shaft);

      // Cap trên
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.42, 0.55, 8), capMat);
      cap.position.set(x, 6.4, z);
      this.scene.add(cap);

      // Bát lửa
      const bowl = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x1a0a00, roughness: 0.5, metalness: 0.7 })
      );
      bowl.position.set(x, 6.75, z);
      this.scene.add(bowl);

      // Quả cầu lửa
      const fireBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 10, 10),
        new THREE.MeshStandardMaterial({
          color: CFG.PILLAR_FIRE_COLOR,
          emissive: new THREE.Color(CFG.PILLAR_FIRE_COLOR),
          emissiveIntensity: 2.2,
        })
      );
      fireBall.position.set(x, 7.1, z);
      this.scene.add(fireBall);

      // Point light — chỉ 4 cái (cách 1 cái) để tránh overdraw
      if (i % 2 === 0) {
        const fire = new THREE.PointLight(
          CFG.PILLAR_FIRE_COLOR,
          CFG.PILLAR_FIRE_INTENSITY,
          CFG.PILLAR_FIRE_DISTANCE
        );
        fire.position.set(x, 7.3, z);
        this.scene.add(fire);
        this.pillarFires.push({ light: fire, phase: i * 0.785, mesh: fireBall });
      } else {
        // Pillar không có light vẫn cần fireBall animate → push với light giả
        // Dùng chung light của pillar liền kề — không tạo thêm light
        this.pillarFires.push({
          light: this.pillarFires[0]?.light ?? new THREE.PointLight(), // sẽ bị ghi đè
          phase: i * 0.785,
          mesh: fireBall,
        });
      }
    }
  }

  private _buildRuneFloor(): void {
    // 4 vòng rune đồng tâm
    const radii    = [6, 12, 20, 30];
    const segments = [32, 48, 64, 80];
    radii.forEach((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.14, r + 0.14, segments[i]),
        new THREE.MeshStandardMaterial({
          color: CFG.RUNE_COLOR,
          emissive: new THREE.Color(CFG.RUNE_COLOR),
          emissiveIntensity: 0.0,
          transparent: true,
          opacity: 0.0,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      this.scene.add(ring);
      this.runeRings.push(ring);
    });

    // Ngôi sao 5 cánh ở trung tâm
    const starMat = new THREE.MeshStandardMaterial({
      color: 0x220000,
      emissive: new THREE.Color(0xff0000),
      emissiveIntensity: 0.0,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const star = new THREE.Mesh(new THREE.CircleGeometry(4.0, 5), starMat);
    star.rotation.x = -Math.PI / 2;
    star.position.y = 0.06;
    this.scene.add(star);
    this.runeRings.push(star);
  }

  private _buildCentralFire(): void {
    // Inner glow dưới nền
    const groundGlow = new THREE.Mesh(
      new THREE.CircleGeometry(3.5, 32),
      new THREE.MeshStandardMaterial({
        color: 0xff2200,
        emissive: new THREE.Color(0xff1100),
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
    );
    groundGlow.rotation.x = -Math.PI / 2;
    groundGlow.position.y = 0.07;
    this.scene.add(groundGlow);

    // Quả cầu lửa chính
    this.centralFireMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 14, 14),
      new THREE.MeshStandardMaterial({
        color: 0xff4400,
        emissive: new THREE.Color(0xff2200),
        emissiveIntensity: 3.2,
        transparent: true,
        opacity: 0.88,
      })
    );
    this.centralFireMesh.position.set(0, 1.6, 0);
    this.scene.add(this.centralFireMesh);

    // Lớp ngoài mờ hơn tạo halo
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xff2200,
        emissive: new THREE.Color(0xff0000),
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.BackSide,
      })
    );
    halo.position.set(0, 1.6, 0);
    this.scene.add(halo);

    // Point light chính
    this.centralFireLight = new THREE.PointLight(
      CFG.FIRE_COLOR, CFG.FIRE_INTENSITY, CFG.FIRE_DISTANCE
    );
    this.centralFireLight.position.set(0, 3, 0);
    this.centralFireLight.castShadow = true;
    this.centralFireLight.shadow.mapSize.set(512, 512);
    this.scene.add(this.centralFireLight);
  }

  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();

    // Khung ngoài
    this.portalRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.18, 16, 72),
      new THREE.MeshStandardMaterial({
        color: CFG.PORTAL_COLOR,
        emissive: new THREE.Color(CFG.PORTAL_COLOR),
        emissiveIntensity: 1.5,
        roughness: 0.1,
        metalness: 0.9,
      })
    );
    this.portalGroup.add(this.portalRing);

    // Vòng trong
    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.06, 12, 64),
      new THREE.MeshStandardMaterial({
        color: 0xff6600,
        emissive: new THREE.Color(0xff6600),
        emissiveIntensity: 1.0,
        roughness: 0.2,
      })
    );
    this.portalGroup.add(innerRing);

    // Disk trong suốt
    this.portalDisk = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 72),
      new THREE.MeshStandardMaterial({
        color: CFG.PORTAL_COLOR,
        emissive: new THREE.Color(CFG.PORTAL_COLOR),
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.portalGroup.add(this.portalDisk);

    // Light
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 5.0, 22);
    this.portalLight.position.set(0, 0, 0.5);
    this.portalGroup.add(this.portalLight);

    this.portalGroup.position.copy(CFG.PORTAL_POS);
    this.portalGroup.position.y = 2.0;
    this.scene.add(this.portalGroup);
  }

  private _buildParticles(): void {
    // Tro bụi bay nhẹ khắp arena
    const ashCount = 350;
    const ashPos = new Float32Array(ashCount * 3);
    for (let i = 0; i < ashCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * CFG.ARENA_RADIUS;
      ashPos[i * 3]     = Math.cos(angle) * r;
      ashPos[i * 3 + 1] = Math.random() * 14;
      ashPos[i * 3 + 2] = Math.sin(angle) * r;
    }
    const ashGeo = new THREE.BufferGeometry();
    ashGeo.setAttribute("position", new THREE.BufferAttribute(ashPos, 3));
    this.ashParticles = new THREE.Points(
      ashGeo,
      new THREE.PointsMaterial({ color: 0x666666, size: 0.06, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.scene.add(this.ashParticles);

    // Ember từ lửa trung tâm
    const emberCount = 180;
    const emberPos = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 5;
      emberPos[i * 3]     = Math.cos(angle) * r;
      emberPos[i * 3 + 1] = Math.random() * 9;
      emberPos[i * 3 + 2] = Math.sin(angle) * r;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    this.emberParticles = new THREE.Points(
      emberGeo,
      new THREE.PointsMaterial({ color: 0xff5500, size: 0.1, transparent: true, opacity: 0.8, depthWrite: false })
    );
    this.scene.add(this.emberParticles);
  }

  private async _loadModels(): Promise<void> {
    const loader = new GLTFLoader();
    const load = (p: string) =>
      new Promise<THREE.Group>((res, rej) => loader.load(p, (g) => res(g.scene), undefined, rej));
    const shadow = (g: THREE.Group) =>
      g.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    // Skulls — bố cục đẹp hơn: vòng cung quanh nửa arena sau
    const skullConfigs: { pos: THREE.Vector3; scale: number; rotY: number }[] = [
      { pos: new THREE.Vector3( 12,  0,  8),  scale: 1.0,  rotY: 0.4 },
      { pos: new THREE.Vector3(-12,  0, 10),  scale: 1.15, rotY: -0.3 },
      { pos: new THREE.Vector3(  8,  0, -16), scale: 0.9,  rotY: 1.2 },
      { pos: new THREE.Vector3(-10,  0, -14), scale: 1.05, rotY: -1.0 },
      { pos: new THREE.Vector3( 18,  0, -5),  scale: 0.8,  rotY: 0.8 },
      { pos: new THREE.Vector3(-18,  0, -2),  scale: 0.85, rotY: -0.6 },
    ];

    load("/model/pile of skulls.glb")
      .then((master) => {
        shadow(master);
        skullConfigs.forEach(({ pos, scale, rotY }) => {
          const c = master.clone();
          c.position.copy(pos);
          c.scale.setScalar(scale);
          c.rotation.y = rotY;
          this.scene.add(c);
        });
      })
      .catch(() => {/* model không tồn tại thì bỏ qua */});
  }

  private _spawnBoss(): void {
    this.enemyManager.spawn(
      [CFG.BOSS_POS],
      {
        ...GOBLIN_CONFIG,
        scale:        CFG.BOSS_SCALE,   // ✅ 2.5 — hợp lý
        maxHp:        CFG.BOSS_HP,
        attackDamage: CFG.BOSS_DAMAGE,
        chaseRange:   CFG.BOSS_CHASE,
        patrolRadius: 0,
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATORS
  // ═══════════════════════════════════════════════════════════════════════════

  private _animateCentralFire(): void {
    const t = this.elapsed;
    const flicker = Math.sin(t * 7.3) * 0.3 + Math.sin(t * 13.1) * 0.15 + Math.sin(t * 3.7) * 0.1;
    this.centralFireLight.intensity = CFG.FIRE_INTENSITY * (1 + flicker);
    const scale = 1.0 + Math.sin(t * 5.0) * 0.12 + Math.sin(t * 8.3) * 0.06;
    this.centralFireMesh.scale.setScalar(scale);
    const mat = this.centralFireMesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 2.8 + Math.sin(t * 6.0) * 0.9;
  }

  private _animatePillarFires(dt: number): void {
    this.pillarFires.forEach((p) => {
      p.phase += dt * 9.0;
      const flicker = Math.sin(p.phase) * 0.25 + Math.sin(p.phase * 2.1) * 0.1;
      if (p.light) p.light.intensity = CFG.PILLAR_FIRE_INTENSITY * (1 + flicker);
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.0 + flicker * 1.2;
    });
  }

  private _animatePortal(dt: number): void {
    const t = this.elapsed;
    this.portalRing.rotation.z += dt * 0.85;
    this.portalRing.rotation.y += dt * 0.18;
    const diskMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    diskMat.opacity = 0.28 + Math.sin(t * 4.0) * 0.1;
    this.portalLight.intensity = 4.5 + Math.sin(t * 5.0) * 1.5;
  }

  private _animateRuneFloor(): void {
    const t = this.elapsed;
    const maxOpacity = Math.min(t / 8, 1.0);
    const pulse = Math.sin(t * 1.5) * 0.28 + 0.72;
    this.runeRings.forEach((ring, i) => {
      const mat = ring.material as THREE.MeshStandardMaterial;
      const ringFade = Math.min(Math.max((t - i * 1.0) / 4, 0), 1);
      mat.opacity          = ringFade * maxOpacity * pulse * 0.75;
      mat.emissiveIntensity = ringFade * maxOpacity * pulse * CFG.RUNE_EMISSIVE;
    });
  }

  private _animateParticles(dt: number): void {
    const t = this.elapsed;

    // Ash
    const ashPos = this.ashParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ashPos.count; i++) {
      let y = ashPos.getY(i) - dt * 0.07;
      if (y < 0) y = 12 + Math.random() * 2;
      ashPos.setY(i, y);
      const x = ashPos.getX(i), z = ashPos.getZ(i);
      const angle = Math.atan2(z, x) + dt * 0.07;
      const r = Math.sqrt(x * x + z * z);
      ashPos.setX(i, Math.cos(angle) * r);
      ashPos.setZ(i, Math.sin(angle) * r);
    }
    ashPos.needsUpdate = true;

    // Ember
    const emberPos = this.emberParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < emberPos.count; i++) {
      let y = emberPos.getY(i) + dt * (0.45 + Math.sin(t + i) * 0.15);
      if (y > 10) y = 0;
      emberPos.setY(i, y);
      const x = emberPos.getX(i), z = emberPos.getZ(i);
      const spread = dt * 0.04;
      emberPos.setX(i, x + (Math.random() - 0.5) * spread);
      emberPos.setZ(i, z + (Math.random() - 0.5) * spread);
    }
    emberPos.needsUpdate = true;
  }

  private _animateLavaCracks(): void {
    const t = this.elapsed;
    const maxOpacity = Math.min(t / 10, 1.0);
    const pulse = 0.6 + Math.sin(t * 2.2) * 0.4;
    this.lavaCracks.forEach((crack, i) => {
      const mat = crack.material as THREE.MeshStandardMaterial;
      const fade = Math.min(Math.max((t - i * 0.5) / 5, 0), 1);
      mat.opacity          = fade * maxOpacity * pulse * 0.65;
      mat.emissiveIntensity = fade * maxOpacity * pulse * 1.4;
    });
  }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
}
