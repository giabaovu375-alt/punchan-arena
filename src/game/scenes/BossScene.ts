import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  SKY_COLOR:          0x050002,
  FOG_COLOR:          0x1a0000,
  FOG_DENSITY:        0.018,
  AMBIENT_COLOR:      0x3a0808,
  AMBIENT_INTENSITY:  0.4,
  FIRE_COLOR:         0xff3300,
  FIRE_INTENSITY:     4.0,
  FIRE_DISTANCE:      90,
  PILLAR_COUNT:       8,
  PILLAR_RADIUS:      36,
  PILLAR_FIRE_COLOR:  0xff6600,
  PILLAR_FIRE_INTENSITY: 1.8,
  PILLAR_FIRE_DISTANCE:  14,
  ARENA_RADIUS:       40,
  ARENA_COLOR:        0x1a1010,
  PORTAL_COLOR:       0xff2200,
  PORTAL_POS:         new THREE.Vector3(0, 0, 37),
  PORTAL_TRIGGER:     3.5,
  BOSS_POS:           new THREE.Vector3(0, 0, -12),
  BOSS_SCALE:         7.0,
  BOSS_CHASE:         50,
  RUNE_COLOR:         0xff0000,
  RUNE_EMISSIVE:      0.6,
} as const;

// ─── BossScene ────────────────────────────────────────────────────────────────
export class BossScene extends BaseScene {
  public  scene: THREE.Scene;
  private enemyManager!: EnemyManager;
  private playerRef!:    THREE.Object3D;
  private cameraRef!:    THREE.Camera;
  private elapsed = 0;

  private centralFireLight!: THREE.PointLight;
  private centralFireMesh!:  THREE.Mesh;
  private pillarFires: { light: THREE.PointLight; phase: number; mesh: THREE.Mesh }[] = [];
  private portalGroup!: THREE.Group;
  private portalRing!:  THREE.Mesh;
  private portalDisk!:  THREE.Mesh;
  private portalLight!: THREE.PointLight;
  private runeRings: THREE.Mesh[] = [];
  private emberParticles!: THREE.Points;
  private ashParticles!:   THREE.Points;

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
    this.enemyManager = new EnemyManager(this.scene, document.body); // Khởi tạo EnemyManager trước
    this._setupAtmosphere();
    this._buildArena();
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
    this._animateCentralFire(dt);
    this._animatePillarFires(dt);
    this._animatePortal(dt);
    this._animateRuneFloor(dt);
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
    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));
    const hellRim = new THREE.DirectionalLight(0x660000, 0.4);
    hellRim.position.set(0, -8, 0);
    this.scene.add(hellRim);
    const backRim = new THREE.DirectionalLight(0xff1100, 0.2);
    backRim.position.set(0, 10, -50);
    this.scene.add(backRim);
  }

  private _buildArena(): void {
    const outerGround = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x0d0808, roughness: 1.0 })
    );
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.receiveShadow = true;
    this.scene.add(outerGround);

    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(CFG.ARENA_RADIUS, 72),
      new THREE.MeshStandardMaterial({ color: CFG.ARENA_COLOR, roughness: 0.75, metalness: 0.25 })
    );
    arena.rotation.x = -Math.PI / 2;
    arena.position.y = 0.02;
    arena.receiveShadow = true;
    this.scene.add(arena);

    const border = new THREE.Mesh(
      new THREE.RingGeometry(CFG.ARENA_RADIUS - 1, CFG.ARENA_RADIUS + 1.5, 72),
      new THREE.MeshStandardMaterial({
        color: 0x330000, emissive: new THREE.Color(0x550000), emissiveIntensity: 0.4,
        roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide,
      })
    );
    border.rotation.x = -Math.PI / 2;
    border.position.y = 0.03;
    this.scene.add(border);
  }

  private _buildPillars(): void {
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1a0f0f, roughness: 0.6, metalness: 0.6 });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x331100, emissive: new THREE.Color(0x661100), emissiveIntensity: 0.5, roughness: 0.4,
    });
    for (let i = 0; i < CFG.PILLAR_COUNT; i++) {
      const angle = (i / CFG.PILLAR_COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * CFG.PILLAR_RADIUS;
      const z = Math.sin(angle) * CFG.PILLAR_RADIUS;

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 5.5, 8), pillarMat);
      shaft.position.set(x, 2.75, z);
      shaft.castShadow = true;
      this.scene.add(shaft);

      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.45, 0.5, 8), capMat);
      cap.position.set(x, 5.8, z);
      this.scene.add(cap);

      const fireBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        new THREE.MeshStandardMaterial({ color: CFG.PILLAR_FIRE_COLOR, emissive: new THREE.Color(CFG.PILLAR_FIRE_COLOR), emissiveIntensity: 2.0 })
      );
      fireBall.position.set(x, 6.3, z);
      this.scene.add(fireBall);

      const fire = new THREE.PointLight(CFG.PILLAR_FIRE_COLOR, CFG.PILLAR_FIRE_INTENSITY, CFG.PILLAR_FIRE_DISTANCE);
      fire.position.set(x, 6.5, z);
      this.scene.add(fire);

      this.pillarFires.push({ light: fire, phase: i * 0.785, mesh: fireBall });
    }
  }

  private _buildRuneFloor(): void {
    const radii = [8, 16, 24, 32];
    const segments = [32, 48, 64, 80];
    radii.forEach((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.12, r + 0.12, segments[i]),
        new THREE.MeshStandardMaterial({
          color: CFG.RUNE_COLOR, emissive: new THREE.Color(CFG.RUNE_COLOR), emissiveIntensity: 0.0,
          transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      this.scene.add(ring);
      this.runeRings.push(ring);
    });
    const starMat = new THREE.MeshStandardMaterial({
      color: 0x220000, emissive: new THREE.Color(0xff0000), emissiveIntensity: 0.0,
      transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false,
    });
    const starGeo = new THREE.CircleGeometry(3.5, 5);
    const star = new THREE.Mesh(starGeo, starMat);
    star.rotation.x = -Math.PI / 2;
    star.position.y = 0.06;
    this.scene.add(star);
    this.runeRings.push(star);
  }

  private _buildCentralFire(): void {
    this.centralFireMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0xff4400, emissive: new THREE.Color(0xff2200), emissiveIntensity: 3.0,
        transparent: true, opacity: 0.85,
      })
    );
    this.centralFireMesh.position.set(0, 1.5, 0);
    this.scene.add(this.centralFireMesh);

    this.centralFireLight = new THREE.PointLight(CFG.FIRE_COLOR, CFG.FIRE_INTENSITY, CFG.FIRE_DISTANCE);
    this.centralFireLight.position.set(0, 3, 0);
    this.centralFireLight.castShadow = true;
    this.centralFireLight.shadow.mapSize.set(512, 512);
    this.scene.add(this.centralFireLight);
  }

  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();
    this.portalRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.0, 0.16, 16, 64),
      new THREE.MeshStandardMaterial({ color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR), emissiveIntensity: 1.4, roughness: 0.1, metalness: 0.9 })
    );
    this.portalGroup.add(this.portalRing);
    this.portalDisk = new THREE.Mesh(
      new THREE.CircleGeometry(1.8, 64),
      new THREE.MeshStandardMaterial({ color: CFG.PORTAL_COLOR, emissive: new THREE.Color(CFG.PORTAL_COLOR), emissiveIntensity: 0.5, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
    );
    this.portalGroup.add(this.portalDisk);
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 4.5, 20);
    this.portalLight.position.set(0, 0, 0.5);
    this.portalGroup.add(this.portalLight);
    this.portalGroup.position.copy(CFG.PORTAL_POS);
    this.portalGroup.position.y = 2.0;
    this.scene.add(this.portalGroup);
  }

  private _buildParticles(): void {
    const ashCount = 300;
    const ashPos = new Float32Array(ashCount * 3);
    for (let i = 0; i < ashCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * CFG.ARENA_RADIUS;
      ashPos[i * 3] = Math.cos(angle) * r;
      ashPos[i * 3 + 1] = Math.random() * 12;
      ashPos[i * 3 + 2] = Math.sin(angle) * r;
    }
    const ashGeo = new THREE.BufferGeometry();
    ashGeo.setAttribute("position", new THREE.BufferAttribute(ashPos, 3));
    this.ashParticles = new THREE.Points(ashGeo, new THREE.PointsMaterial({ color: 0x555555, size: 0.07, transparent: true, opacity: 0.4, depthWrite: false }));
    this.scene.add(this.ashParticles);

    const emberCount = 150;
    const emberPos = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 6;
      emberPos[i * 3] = Math.cos(angle) * r;
      emberPos[i * 3 + 1] = Math.random() * 8;
      emberPos[i * 3 + 2] = Math.sin(angle) * r;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    this.emberParticles = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xff4400, size: 0.1, transparent: true, opacity: 0.75, depthWrite: false }));
    this.scene.add(this.emberParticles);
  }

  private async _loadModels(): Promise<void> {
    const loader = new GLTFLoader();
    const load = (p: string) => new Promise<THREE.Group>((res, rej) => loader.load(p, (g) => res(g.scene), undefined, rej));
    const shadow = (g: THREE.Group) => g.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    const skullPositions = [
      new THREE.Vector3(10, 0, 10), new THREE.Vector3(-10, 0, 15),
      new THREE.Vector3(8, 0, -18), new THREE.Vector3(-14, 0, -8),
    ];
    load("/model/pile of skulls.glb").then((master) => {
      shadow(master);
      skullPositions.forEach((pos, i) => {
        const c = master.clone();
        c.position.copy(pos);
        c.scale.setScalar(1.0 + i * 0.15);
        c.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(c);
      });
    });
  }

  private _spawnBoss(): void {
    this.enemyManager.spawn(
      [CFG.BOSS_POS],
      { ...GOBLIN_CONFIG, scale: CFG.BOSS_SCALE, chaseRange: CFG.BOSS_CHASE, patrolRadius: 0 }
    );
  }

  private _animateCentralFire(dt: number): void {
    const t = this.elapsed;
    const flicker = Math.sin(t * 7.3) * 0.3 + Math.sin(t * 13.1) * 0.15 + Math.sin(t * 3.7) * 0.1;
    this.centralFireLight.intensity = CFG.FIRE_INTENSITY * (1 + flicker);
    const scale = 1.0 + Math.sin(t * 5.0) * 0.12 + Math.sin(t * 8.3) * 0.06;
    this.centralFireMesh.scale.setScalar(scale);
    const mat = this.centralFireMesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 2.5 + Math.sin(t * 6.0) * 0.8;
  }

  private _animatePillarFires(dt: number): void {
    this.pillarFires.forEach((p) => {
      p.phase += dt * 9.0;
      const flicker = Math.sin(p.phase) * 0.25 + Math.sin(p.phase * 2.1) * 0.1;
      p.light.intensity = CFG.PILLAR_FIRE_INTENSITY * (1 + flicker);
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.8 + flicker * 1.2;
    });
  }

  private _animatePortal(dt: number): void {
    const t = this.elapsed;
    this.portalRing.rotation.z += dt * 0.9;
    this.portalRing.rotation.y += dt * 0.2;
    const diskMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    diskMat.opacity = 0.25 + Math.sin(t * 4.0) * 0.12;
    this.portalLight.intensity = 4.0 + Math.sin(t * 5.0) * 1.5;
  }

  private _animateRuneFloor(dt: number): void {
    const t = this.elapsed;
    const maxOpacity = Math.min(t / 8, 1.0);
    const pulse = Math.sin(t * 1.5) * 0.3 + 0.7;
    this.runeRings.forEach((ring, i) => {
      const mat = ring.material as THREE.MeshStandardMaterial;
      const ringFade = Math.min(Math.max((t - i * 1.0) / 4, 0), 1);
      mat.opacity = ringFade * maxOpacity * pulse * 0.7;
      mat.emissiveIntensity = ringFade * maxOpacity * pulse * CFG.RUNE_EMISSIVE;
    });
  }

  private _animateParticles(dt: number): void {
    const t = this.elapsed;
    const ashPos = this.ashParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ashPos.count; i++) {
      let y = ashPos.getY(i) - dt * 0.08;
      if (y < 0) y = 10 + Math.random() * 2;
      ashPos.setY(i, y);
      const x = ashPos.getX(i), z = ashPos.getZ(i);
      const angle = Math.atan2(z, x) + dt * 0.08;
      const r = Math.sqrt(x * x + z * z);
      ashPos.setX(i, Math.cos(angle) * r);
      ashPos.setZ(i, Math.sin(angle) * r);
    }
    ashPos.needsUpdate = true;

    const emberPos = this.emberParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < emberPos.count; i++) {
      let y = emberPos.getY(i) + dt * (0.4 + Math.sin(t + i) * 0.15);
      if (y > 9) y = 0;
      emberPos.setY(i, y);
      const x = emberPos.getX(i), z = emberPos.getZ(i);
      const spread = dt * 0.05;
      emberPos.setX(i, x + (Math.random() - 0.5) * spread);
      emberPos.setZ(i, z + (Math.random() - 0.5) * spread);
    }
    emberPos.needsUpdate = true;
  }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
      }
