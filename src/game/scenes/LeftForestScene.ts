import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  FOG_COLOR:         0x0a1a0a,
  SKY_COLOR:         0x060f06,
  AMBIENT_COLOR:     0x1a3320,
  AMBIENT_INTENSITY: 0.5,
  MOON_COLOR:        0x7ab8d4,
  MOON_INTENSITY:    0.55,
  GROUND_COLOR:      0x141f0e,
  // Portal về Hub — xanh ngọc
  PORTAL_COLOR:      0x00ff88,
  PORTAL_POS:        new THREE.Vector3(30, 0, 10),
  PORTAL_RADIUS:     4,
  PORTAL_TRIGGER:    4,
  // Wisp — ánh sáng hồn ma xanh lạnh
  WISP_COLOR:        0x22ff88,
  WISP_INTENSITY:    1.8,
  WISP_DISTANCE:     12,
} as const;

// ─── LeftForestScene ──────────────────────────────────────────────────────────
export class LeftForestScene extends BaseScene {
  public  scene: THREE.Scene;

  private enemyManager!:  EnemyManager;
  private playerRef!:     THREE.Object3D;
  private cameraRef!:     THREE.Camera;
  private elapsed = 0;

  // Portal
  private portalGroup!:   THREE.Group;
  private portalLight!:   THREE.PointLight;

  // Wisp lights (ánh sáng rừng)
  private wisps: { light: THREE.PointLight; phase: number; pos: THREE.Vector3 }[] = [];

  // Particles
  private sporeParticles!: THREE.Points;

  constructor() {
    super("LeftForestScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildWisps();
    this._buildPortal();
    this._buildSpores();
    await this._loadModels();
    this._spawnEnemies();

    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "LeftForestScene" });
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateWisps(dt);
    this._animatePortal(dt);
    this._animateSpores(dt);

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
    const dist = new THREE.Vector2(
      playerPos.x - CFG.PORTAL_POS.x,
      playerPos.z - CFG.PORTAL_POS.z
    ).length();
    return dist < CFG.PORTAL_TRIGGER ? "HubScene" : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, 0.028);

    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));

    const moon = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    moon.position.set(30, 60, 40);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.bias = -0.001;
    this.scene.add(moon);
  }

  private _buildTerrain(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150, 30, 30),
      new THREE.MeshStandardMaterial({ color: CFG.GROUND_COLOR, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** Wisp — ánh đèn hồn ma lơ lửng trong rừng */
  private _buildWisps(): void {
    const positions = [
      new THREE.Vector3(-15, 1.5, -20),
      new THREE.Vector3( 10, 2.0,  30),
      new THREE.Vector3(-30, 1.2,  15),
      new THREE.Vector3( 25, 1.8, -35),
    ];

    positions.forEach((pos, i) => {
      const light = new THREE.PointLight(CFG.WISP_COLOR, CFG.WISP_INTENSITY, CFG.WISP_DISTANCE);
      light.position.copy(pos);
      this.scene.add(light);

      // Visual — quả cầu phát sáng nhỏ
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshStandardMaterial({
          color:             CFG.WISP_COLOR,
          emissive:          new THREE.Color(CFG.WISP_COLOR),
          emissiveIntensity: 2.0,
        })
      );
      orb.position.copy(pos);
      this.scene.add(orb);

      this.wisps.push({ light, phase: i * 1.57, pos: pos.clone() });
    });
  }

  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();

    // Ring xoay
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.16, 14, 56),
      new THREE.MeshStandardMaterial({
        color:             CFG.PORTAL_COLOR,
        emissive:          new THREE.Color(CFG.PORTAL_COLOR),
        emissiveIntensity: 1.0,
        roughness:         0.2,
        metalness:         0.7,
      })
    );
    ring.rotation.x = Math.PI / 2;
    this.portalGroup.add(ring);

    // Disk trong suốt
    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 56),
      new THREE.MeshStandardMaterial({
        color:             CFG.PORTAL_COLOR,
        emissive:          new THREE.Color(CFG.PORTAL_COLOR),
        emissiveIntensity: 0.3,
        transparent:       true,
        opacity:           0.22,
        side:              THREE.DoubleSide,
        depthWrite:        false,
      })
    );
    disk.rotation.x = Math.PI / 2;
    this.portalGroup.add(disk);

    // Ánh sáng
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 3.0, 18);
    this.portalLight.position.y = 1;
    this.portalGroup.add(this.portalLight);

    // Vị trí: trên tượng
    this.portalGroup.position.copy(CFG.PORTAL_POS).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(this.portalGroup);
  }

  /** Bào tử rừng bay lơ lửng */
  private _buildSpores(): void {
    const count = 200;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.sporeParticles = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color:       0x88ffbb,
        size:        0.09,
        transparent: true,
        opacity:     0.5,
        depthWrite:  false,
      })
    );
    this.scene.add(this.sporeParticles);
  }

  private async _loadModels(): Promise<void> {
    const loader  = new GLTFLoader();
    const load    = (p: string) => new Promise<THREE.Group>((res, rej) =>
      loader.load(p, (g) => res(g.scene), undefined, rej)
    );
    const shadow  = (g: THREE.Group) => g.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    const darken  = (g: THREE.Group, s = 0.45) => g.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && m.material) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiplyScalar(s);
        if (mat.emissiveIntensity) mat.emissiveIntensity *= 0.3;
        m.material = mat;
      }
    });

    // Bụi cây — clone 15 lần
    load("/model/bush.glb").then((master) => {
      shadow(master); darken(master, 0.6);
      for (let i = 0; i < 15; i++) {
        const c = master.clone();
        c.position.set((Math.random() - 0.5) * 100, 0, (Math.random() - 0.5) * 100);
        c.scale.setScalar(1.2 + Math.random() * 0.5);
        c.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(c);
      }
    });

    // Tảng đá
    load("/model/Big-stone.glb").then((stone) => {
      shadow(stone); darken(stone);
      stone.position.set(-20, 0, -20);
      stone.scale.setScalar(2.0);
      this.scene.add(stone);
    });

    // Tượng cổ (điểm portal)
    load("/model/bo_ba_nam.glb").then((statue) => {
      shadow(statue); darken(statue, 0.5);
      statue.position.copy(CFG.PORTAL_POS);
      statue.scale.setScalar(3.0);
      this.scene.add(statue);
    });
  }

  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [new THREE.Vector3(15, 0, 10), new THREE.Vector3(-10, 0, -15)],
      { ...GOBLIN_CONFIG, scale: 4.5, chaseRange: 20, patrolRadius: 4 }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATORS
  // ═══════════════════════════════════════════════════════════════════════════

  private _animateWisps(dt: number): void {
    this.wisps.forEach((w) => {
      w.phase += dt * 1.2;
      // Bay lên xuống + ngang nhẹ
      w.light.position.set(
        w.pos.x + Math.sin(w.phase * 0.7) * 1.2,
        w.pos.y + Math.sin(w.phase)        * 0.5,
        w.pos.z + Math.cos(w.phase * 0.5)  * 1.0,
      );
      // Intensity pulse
      w.light.intensity = CFG.WISP_INTENSITY * (0.8 + Math.sin(w.phase * 2.1) * 0.25);
    });
  }

  private _animatePortal(dt: number): void {
    const ring = this.portalGroup.children[0] as THREE.Mesh;
    ring.rotation.z += dt * 0.45;

    const disk = this.portalGroup.children[1] as THREE.Mesh;
    (disk.material as THREE.MeshStandardMaterial).opacity =
      0.18 + Math.sin(this.elapsed * 2.2) * 0.1;

    this.portalLight.intensity = 2.8 + Math.sin(this.elapsed * 3.0) * 0.8;
  }

  private _animateSpores(dt: number): void {
    const pos = this.sporeParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.05;
      if (y > 4.5) y = 0;
      pos.setY(i, y);
      let x = pos.getX(i) + Math.sin(this.elapsed + i) * dt * 0.04;
      pos.setX(i, x);
    }
    pos.needsUpdate = true;
  }

  // ─── Event handler ─────────────────────────────────────────────────────────
  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
                                 }
      
