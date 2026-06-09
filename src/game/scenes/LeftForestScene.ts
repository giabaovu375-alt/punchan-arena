import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG = {
  // Atmosphere
  FOG_COLOR:          0x050e08,
  FOG_DENSITY:        0.022,
  SKY_COLOR:          0x03080a,
  AMBIENT_COLOR:      0x0d2218,
  AMBIENT_INTENSITY:  0.6,

  // Lighting
  MOON_COLOR:         0x8ecfdf,
  MOON_INTENSITY:     0.7,
  RIM_COLOR:          0x1a4060,
  RIM_INTENSITY:      0.3,
  FILL_COLOR:         0x061a10,
  FILL_INTENSITY:     0.25,

  // Ground
  GROUND_COLOR:       0x0c1509,
  GROUND_MOSS_COLOR:  0x1a2e10,

  // Portal
  PORTAL_COLOR:       0x00ff88,
  PORTAL_POS:         new THREE.Vector3(30, 0, 10),
  PORTAL_TRIGGER:     4,

  // Wisps
  WISP_COLOR:         0x33ff99,
  WISP_INTENSITY:     2.2,
  WISP_DISTANCE:      14,

  // Mist
  MIST_COLOR:         0x0a2015,
  MIST_COUNT:         120,

  // Leaves
  LEAF_COUNT:         180,
  LEAF_COLOR:         0x2d5e1e,

  // Spores
  SPORE_COUNT:        300,
  SPORE_COLOR:        0x77ffbb,
} as const;

// ─── SCENE ───────────────────────────────────────────────────────────────────
export class LeftForestScene extends BaseScene {
  public  scene:        THREE.Scene;
  private enemyManager!: EnemyManager;
  private playerRef!:   THREE.Object3D;
  private cameraRef!:   THREE.Camera;
  private elapsed = 0;

  // Portal
  private portalGroup!:  THREE.Group;
  private portalLight!:  THREE.PointLight;
  private portalRing!:   THREE.Mesh;
  private portalDisk!:   THREE.Mesh;
  private portalParticles!: THREE.Points;

  // Wisps
  private wisps: {
    light: THREE.PointLight;
    phase: number;
    pos:   THREE.Vector3;
    orb:   THREE.Mesh;
    trail: THREE.Mesh;
  }[] = [];

  // Particles
  private sporeParticles!: THREE.Points;
  private mistParticles!:  THREE.Points;
  private leafParticles!:  THREE.Points;
  private leafVelocities!: Float32Array;

  // Ground detail meshes
  private groundPatches: THREE.Mesh[] = [];

  // Disposables
  private disposables: THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[] = [];

  constructor() {
    super("LeftForestScene");
    this.scene = new THREE.Scene();
  }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] {
    return this.enemyManager?.getEnemyRoots() ?? [];
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────
  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildGroundDetail();
    this._buildWisps();
    this._buildPortal();
    this._buildMist();
    this._buildLeaves();
    this._buildSpores();
    this._buildGodRays();
    await this._loadModels();
    this._spawnEnemies();
    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    this._animateWisps(dt);
    this._animatePortal(dt);
    this._animateSpores(dt);
    this._animateMist(dt);
    this._animateLeaves(dt);
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    this.enemyManager?.dispose();
    collisionManager.clear();
    // Clean up geometries & materials
    this.disposables.forEach(g => g.dispose());
    this.disposableMats.forEach(m => m.dispose());
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    const d = new THREE.Vector2(
      playerPos.x - CFG.PORTAL_POS.x,
      playerPos.z - CFG.PORTAL_POS.z
    ).length();
    return d < CFG.PORTAL_TRIGGER ? "HubScene" : null;
  }

  // ─── ATMOSPHERE ────────────────────────────────────────────────────────────
  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);

    // Layered fog: exponential for depth
    this.scene.fog = new THREE.FogExp2(CFG.FOG_COLOR, CFG.FOG_DENSITY);

    // Ambient — very dark, tinted green/teal
    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));

    // Moon — primary directional, cold blue-white
    const moon = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    moon.position.set(40, 80, 30);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.near   = 0.5;
    moon.shadow.camera.far    = 200;
    moon.shadow.camera.left   = -80;
    moon.shadow.camera.right  = 80;
    moon.shadow.camera.top    = 80;
    moon.shadow.camera.bottom = -80;
    moon.shadow.bias          = -0.0005;
    moon.shadow.normalBias    = 0.02;
    this.scene.add(moon);

    // Rim light — opposite side, deep blue
    const rim = new THREE.DirectionalLight(CFG.RIM_COLOR, CFG.RIM_INTENSITY);
    rim.position.set(-40, 30, -40);
    this.scene.add(rim);

    // Fill — subtle upward bounce to simulate ground scatter
    const fill = new THREE.DirectionalLight(CFG.FILL_COLOR, CFG.FILL_INTENSITY);
    fill.position.set(0, -10, 0);
    this.scene.add(fill);
  }

  // ─── TERRAIN ───────────────────────────────────────────────────────────────
  private _buildTerrain(): void {
    // Base ground with subtle vertex displacement
    const geo = new THREE.PlaneGeometry(160, 160, 60, 60);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    // Gentle height variation
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i); // before rotation
      const h =
        Math.sin(x * 0.08) * 0.4 +
        Math.cos(z * 0.11) * 0.3 +
        Math.sin(x * 0.2 + z * 0.15) * 0.15 +
        (Math.random() - 0.5) * 0.12;
      pos.setZ(i, h);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color:     CFG.GROUND_COLOR,
      roughness: 0.98,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.disposables.push(geo);
    this.disposableMats.push(mat);
  }

  // Moss patches & root-like dark streaks on ground
  private _buildGroundDetail(): void {
    const mossMat = new THREE.MeshStandardMaterial({
      color:     CFG.GROUND_MOSS_COLOR,
      roughness: 1.0,
      transparent: true,
      opacity:   0.75,
      depthWrite: false,
    });
    this.disposableMats.push(mossMat);

    for (let i = 0; i < 30; i++) {
      const w = 2 + Math.random() * 5;
      const h = 1.5 + Math.random() * 4;
      const geo = new THREE.PlaneGeometry(w, h);
      this.disposables.push(geo);
      const patch = new THREE.Mesh(geo, mossMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(
        (Math.random() - 0.5) * 130,
        0.01,
        (Math.random() - 0.5) * 130
      );
      patch.rotation.z = Math.random() * Math.PI;
      this.scene.add(patch);
      this.groundPatches.push(patch);
    }
  }

  // ─── WISPS ─────────────────────────────────────────────────────────────────
  private _buildWisps(): void {
    const positions = [
      new THREE.Vector3(-15, 1.5, -20),
      new THREE.Vector3( 10, 2.0,  30),
      new THREE.Vector3(-30, 1.2,  15),
      new THREE.Vector3( 25, 1.8, -35),
      new THREE.Vector3(  5, 1.6,   5), // extra wisp near center
    ];

    const orbMat = new THREE.MeshStandardMaterial({
      color:             new THREE.Color(CFG.WISP_COLOR),
      emissive:          new THREE.Color(CFG.WISP_COLOR),
      emissiveIntensity: 3.0,
      roughness:         0.0,
      metalness:         0.0,
      transparent:       true,
      opacity:           0.9,
    });
    this.disposableMats.push(orbMat);

    // Halo/trail geometry shared
    const haloMat = new THREE.MeshStandardMaterial({
      color:       new THREE.Color(CFG.WISP_COLOR),
      emissive:    new THREE.Color(CFG.WISP_COLOR),
      emissiveIntensity: 0.6,
      transparent: true,
      opacity:     0.18,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    this.disposableMats.push(haloMat);

    positions.forEach((pos, i) => {
      // Point light
      const light = new THREE.PointLight(CFG.WISP_COLOR, CFG.WISP_INTENSITY, CFG.WISP_DISTANCE);
      light.position.copy(pos);
      this.scene.add(light);

      // Core orb
      const orbGeo = new THREE.SphereGeometry(0.1, 8, 8);
      this.disposables.push(orbGeo);
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.copy(pos);
      this.scene.add(orb);

      // Soft glow halo billboard
      const haloGeo = new THREE.SphereGeometry(0.38, 10, 10);
      this.disposables.push(haloGeo);
      const trail = new THREE.Mesh(haloGeo, haloMat);
      trail.position.copy(pos);
      this.scene.add(trail);

      this.wisps.push({ light, phase: i * 1.57, pos: pos.clone(), orb, trail });
    });
  }

  // ─── PORTAL ────────────────────────────────────────────────────────────────
  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();

    // Outer ring
    const ringGeo = new THREE.TorusGeometry(2.3, 0.14, 20, 80);
    this.disposables.push(ringGeo);
    const ringMat = new THREE.MeshStandardMaterial({
      color:             CFG.PORTAL_COLOR,
      emissive:          new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 1.6,
      roughness:         0.1,
      metalness:         0.8,
    });
    this.disposableMats.push(ringMat);
    this.portalRing = new THREE.Mesh(ringGeo, ringMat);
    this.portalRing.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalRing);

    // Inner ring (counter-rotate for depth)
    const innerGeo = new THREE.TorusGeometry(1.8, 0.06, 12, 60);
    this.disposables.push(innerGeo);
    const innerMat = new THREE.MeshStandardMaterial({
      color:             CFG.PORTAL_COLOR,
      emissive:          new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 2.0,
      roughness:         0.05,
      metalness:         0.9,
      transparent:       true,
      opacity:           0.7,
    });
    this.disposableMats.push(innerMat);
    const innerRing = new THREE.Mesh(innerGeo, innerMat);
    innerRing.rotation.x = Math.PI / 2;
    this.portalGroup.add(innerRing);

    // Disk surface
    const diskGeo = new THREE.CircleGeometry(2.2, 80);
    this.disposables.push(diskGeo);
    const diskMat = new THREE.MeshStandardMaterial({
      color:             CFG.PORTAL_COLOR,
      emissive:          new THREE.Color(CFG.PORTAL_COLOR),
      emissiveIntensity: 0.25,
      transparent:       true,
      opacity:           0.18,
      side:              THREE.DoubleSide,
      depthWrite:        false,
    });
    this.disposableMats.push(diskMat);
    this.portalDisk = new THREE.Mesh(diskGeo, diskMat);
    this.portalDisk.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalDisk);

    // Portal particle ring
    const pCount = 80;
    const pPos   = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const angle = (i / pCount) * Math.PI * 2;
      const r     = 2.3 + (Math.random() - 0.5) * 0.4;
      pPos[i * 3]     = Math.cos(angle) * r;
      pPos[i * 3 + 1] = 0;
      pPos[i * 3 + 2] = Math.sin(angle) * r;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    this.disposables.push(pGeo);
    const pMat = new THREE.PointsMaterial({
      color:       CFG.PORTAL_COLOR,
      size:        0.07,
      transparent: true,
      opacity:     0.8,
      depthWrite:  false,
    });
    this.disposableMats.push(pMat);
    this.portalParticles = new THREE.Points(pGeo, pMat);
    this.portalParticles.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalParticles);

    // Lights
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 4.0, 22);
    this.portalLight.position.y = 0.5;
    this.portalGroup.add(this.portalLight);

    // Subtle secondary light below portal for ground glow
    const groundLight = new THREE.PointLight(CFG.PORTAL_COLOR, 1.2, 8);
    groundLight.position.y = -3;
    this.portalGroup.add(groundLight);

    this.portalGroup.position.copy(CFG.PORTAL_POS).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(this.portalGroup);
  }

  // ─── MIST ──────────────────────────────────────────────────────────────────
  private _buildMist(): void {
    const count = CFG.MIST_COUNT;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 1.2; // low ground mist
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color:       CFG.MIST_COLOR,
      size:        3.5,
      transparent: true,
      opacity:     0.12,
      depthWrite:  false,
      sizeAttenuation: true,
    });
    this.disposableMats.push(mat);
    this.mistParticles = new THREE.Points(geo, mat);
    this.scene.add(this.mistParticles);
  }

  // ─── FALLING LEAVES ────────────────────────────────────────────────────────
  private _buildLeaves(): void {
    const count = CFG.LEAF_COUNT;
    const pos   = new Float32Array(count * 3);
    this.leafVelocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      // Velocities: gentle downward + sideways drift
      this.leafVelocities[i * 3]     = (Math.random() - 0.5) * 0.3;
      this.leafVelocities[i * 3 + 1] = -(0.3 + Math.random() * 0.4);
      this.leafVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color:       CFG.LEAF_COLOR,
      size:        0.14,
      transparent: true,
      opacity:     0.65,
      depthWrite:  false,
    });
    this.disposableMats.push(mat);
    this.leafParticles = new THREE.Points(geo, mat);
    this.scene.add(this.leafParticles);
  }

  // ─── SPORES ────────────────────────────────────────────────────────────────
  private _buildSpores(): void {
    const count = CFG.SPORE_COUNT;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color:       CFG.SPORE_COLOR,
      size:        0.08,
      transparent: true,
      opacity:     0.55,
      depthWrite:  false,
    });
    this.disposableMats.push(mat);
    this.sporeParticles = new THREE.Points(geo, mat);
    this.scene.add(this.sporeParticles);
  }

  // ─── GOD RAYS (Volumetric light shafts faked via cones) ──────────────────
  private _buildGodRays(): void {
    const rayMat = new THREE.MeshStandardMaterial({
      color:       0x1a4a25,
      emissive:    new THREE.Color(0x0a2a15),
      emissiveIntensity: 0.4,
      transparent: true,
      opacity:     0.04,
      side:        THREE.FrontSide,
      depthWrite:  false,
    });
    this.disposableMats.push(rayMat);

    // 5 scattered light shafts through forest canopy
    const shafts = [
      { x: -18, z: -12 }, { x:  5, z:  20 },
      { x:  20, z: -25 }, { x: -8, z:   8 },
      { x: -28, z:  30 },
    ];
    shafts.forEach(({ x, z }) => {
      const h   = 14 + Math.random() * 6;
      const geo = new THREE.CylinderGeometry(0.05, 1.6 + Math.random(), h, 8, 1, true);
      this.disposables.push(geo);
      const ray = new THREE.Mesh(geo, rayMat);
      ray.position.set(x, h / 2, z);
      // Slight tilt to match moon angle
      ray.rotation.z = (Math.random() - 0.5) * 0.15;
      ray.rotation.x = (Math.random() - 0.5) * 0.1;
      this.scene.add(ray);
    });
  }

  // ─── MODELS ────────────────────────────────────────────────────────────────
  private async _loadModels(): Promise<void> {
    const loader = new GLTFLoader();
    const load   = (p: string) =>
      new Promise<THREE.Group>((res, rej) =>
        loader.load(p, (g) => res(g.scene), undefined, rej)
      );

    const applyShadow = (g: THREE.Group) =>
      g.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          c.castShadow    = true;
          c.receiveShadow = true;
        }
      });

    // Darken & desaturate for night tone
    const nightify = (g: THREE.Group, scale = 0.35, tint = new THREE.Color(0.6, 1.0, 0.7)) =>
      g.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(scale);
          mat.color.multiply(tint);
          mat.roughness = Math.min(mat.roughness + 0.15, 1.0);
          if (mat.emissiveIntensity) mat.emissiveIntensity *= 0.2;
          m.material = mat;
        }
      });

    // Bushes — scattered with size variation
    load("/model/bush.glb").then((master) => {
      applyShadow(master);
      nightify(master, 0.55);
      for (let i = 0; i < 22; i++) {
        const c = master.clone();
        c.position.set(
          (Math.random() - 0.5) * 110,
          0,
          (Math.random() - 0.5) * 110
        );
        c.scale.setScalar(1.0 + Math.random() * 0.8);
        c.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(c);
      }
    }).catch(() => {});

    // Stones — clustered groupings for natural feel
    load("/model/Big-stone.glb").then((stone) => {
      applyShadow(stone);
      nightify(stone, 0.3, new THREE.Color(0.7, 0.85, 0.8));
      const clusters = [
        { x: -20, z: -20 }, { x:  12, z:  22 },
        { x: -35, z:  10 }, { x:  18, z: -30 },
      ];
      clusters.forEach(({ x, z }) => {
        for (let j = 0; j < 2; j++) {
          const c = stone.clone();
          c.position.set(
            x + (Math.random() - 0.5) * 8,
            0,
            z + (Math.random() - 0.5) * 8
          );
          c.scale.setScalar(0.8 + Math.random() * 1.8);
          c.rotation.y = Math.random() * Math.PI * 2;
          this.scene.add(c);
        }
      });
    }).catch(() => {});

    // Statue near portal
    load("/model/bo_ba_nam.glb").then((statue) => {
      applyShadow(statue);
      nightify(statue, 0.4, new THREE.Color(0.6, 0.9, 0.75));
      statue.position.copy(CFG.PORTAL_POS);
      statue.scale.setScalar(3.0);
      this.scene.add(statue);
    }).catch(() => {});
  }

  // ─── ENEMIES ───────────────────────────────────────────────────────────────
  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [
        new THREE.Vector3(15,  0,  10),
        new THREE.Vector3(-10, 0,  18),
        new THREE.Vector3(22,  0, -15),
      ],
      { ...GOBLIN_CONFIG, scale: 4.5, chaseRange: 20, patrolRadius: 5 }
    );
  }

  // ─── ANIMATION ─────────────────────────────────────────────────────────────
  private _animateWisps(dt: number): void {
    this.wisps.forEach((w) => {
      w.phase += dt * 1.1;
      const newPos = new THREE.Vector3(
        w.pos.x + Math.sin(w.phase * 0.6) * 1.5 + Math.sin(w.phase * 1.3) * 0.4,
        w.pos.y + Math.sin(w.phase)        * 0.6,
        w.pos.z + Math.cos(w.phase * 0.5)  * 1.2 + Math.cos(w.phase * 1.1) * 0.3
      );
      w.light.position.copy(newPos);
      w.orb.position.copy(newPos);
      w.trail.position.copy(newPos);

      const pulse = 0.8 + Math.sin(w.phase * 2.3) * 0.28;
      w.light.intensity   = CFG.WISP_INTENSITY * pulse;
      const s = 0.9 + Math.sin(w.phase * 3.1) * 0.15;
      w.orb.scale.setScalar(s);
      w.trail.scale.setScalar(1.0 + Math.sin(w.phase * 1.8) * 0.25);
      (w.trail.material as THREE.MeshStandardMaterial).opacity =
        0.12 + Math.sin(w.phase * 2.0) * 0.07;
    });
  }

  private _animatePortal(dt: number): void {
    // Outer ring spins
    this.portalRing.rotation.z += dt * 0.4;
    // Inner ring counter-spins
    (this.portalGroup.children[1] as THREE.Mesh).rotation.z -= dt * 0.7;
    // Disk pulse
    const diskMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    diskMat.opacity        = 0.14 + Math.sin(this.elapsed * 2.5) * 0.09;
    diskMat.emissiveIntensity = 0.2 + Math.sin(this.elapsed * 1.8) * 0.12;
    // Light flicker
    this.portalLight.intensity = 3.5 + Math.sin(this.elapsed * 3.2) * 1.0;
    // Particle ring slowly rotates
    this.portalParticles.rotation.z += dt * 0.2;
    // Whole portal bobs slightly
    this.portalGroup.position.y = CFG.PORTAL_POS.y + 4 + Math.sin(this.elapsed * 0.8) * 0.12;
  }

  private _animateSpores(dt: number): void {
    const pos = this.sporeParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.06;
      if (y > 5.5) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(this.elapsed * 0.7 + i * 0.3) * dt * 0.05);
      pos.setZ(i, pos.getZ(i) + Math.cos(this.elapsed * 0.5 + i * 0.2) * dt * 0.03);
    }
    pos.needsUpdate = true;
  }

  private _animateMist(dt: number): void {
    const pos = this.mistParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // Slow horizontal drift
      pos.setX(i, pos.getX(i) + Math.sin(this.elapsed * 0.3 + i * 0.7) * dt * 0.08);
      pos.setZ(i, pos.getZ(i) + Math.cos(this.elapsed * 0.2 + i * 0.5) * dt * 0.06);
    }
    pos.needsUpdate = true;
  }

  private _animateLeaves(dt: number): void {
    const pos = this.leafParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // Apply velocity + gentle swirl
      const vx = this.leafVelocities[i * 3]     + Math.sin(this.elapsed + i) * 0.04;
      const vy = this.leafVelocities[i * 3 + 1];
      const vz = this.leafVelocities[i * 3 + 2] + Math.cos(this.elapsed * 0.8 + i) * 0.03;

      let x = pos.getX(i) + vx * dt;
      let y = pos.getY(i) + vy * dt;
      let z = pos.getZ(i) + vz * dt;

      // Reset leaf when it hits ground
      if (y < 0) {
        y  = 15 + Math.random() * 5;
        x  = (Math.random() - 0.5) * 120;
        z  = (Math.random() - 0.5) * 120;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────
  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
}
