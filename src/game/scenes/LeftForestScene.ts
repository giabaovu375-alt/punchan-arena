import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../entities/Enemy";
import { MODEL_BASE, PROP_BASE } from "../config/models";

// ─────────────────────────────────────────────────────────────────────────────
// AAA HAUNTED FOREST — LEFT BIOME (Map 1, open-world)
// Cinematic lighting · layered fog · lightning storms · fireflies ·
// volumetric god-rays · multi-layer portal vortex · large hero props.
// ─────────────────────────────────────────────────────────────────────────────

const WORLD_SCALE = 1.6;

const CFG = {
  FOG_COLOR:         0x050e08,
  FOG_NEAR:          18,
  FOG_FAR:           180,
  SKY_COLOR:         0x03080a,

  AMBIENT_COLOR:     0x0d2218,
  AMBIENT_INTENSITY: 0.55,
  HEMI_SKY:          0x1a3a4a,
  HEMI_GROUND:       0x0a1808,
  HEMI_INTENSITY:    0.45,

  MOON_COLOR:        0x8ecfdf,
  MOON_INTENSITY:    1.1,
  RIM_COLOR:         0x1a4060,
  RIM_INTENSITY:     0.45,
  FILL_COLOR:        0x2a0a3a,
  FILL_INTENSITY:    0.25,

  GROUND_COLOR:      0x0c1509,
  GROUND_MOSS_COLOR: 0x1a2e10,

  PORTAL_COLOR:      0x00ff88,
  PORTAL_POS:        new THREE.Vector3(30 * WORLD_SCALE, 0, 10 * WORLD_SCALE),
  PORTAL_TRIGGER:    5.5,

  WISP_COLOR:        0x33ff99,
  WISP_INTENSITY:    3.0,
  WISP_DISTANCE:     20,

  SPORE_COUNT:       520,
  MIST_COUNT:        220,
  LEAF_COUNT:        320,
  FIREFLY_COUNT:     110,
  EMBER_COUNT:       180,

  MODEL_SCALE: {
    outerTreeH:  22,   // tường rừng — tăng từ 14 → 22
    outerTreeJ:  6,
    midTreeH:    13,
    midTreeJ:    6,
    underH:      1.1,
    underJ:      1.2,
    rockH:       0.9,
    rockJ:       1.4,
    skulls:      2.0,
    fence:       2.8,
    statue:      7.5,
    bigStone:    6.5,
    grass:       0.55,
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function inClearPath(x: number, z: number): boolean {
  const cx = 5 * WORLD_SCALE;
  const onMainPath = Math.abs(x - cx) < 11 && z > -45 * WORLD_SCALE && z < 45 * WORLD_SCALE;
  const nearPortal = Math.hypot(x - CFG.PORTAL_POS.x, z - CFG.PORTAL_POS.z) < 10;
  return onMainPath || nearPortal;
}

function annulusPoint(cx: number, cz: number, rMin: number, rMax: number): [number, number] {
  const angle = Math.random() * Math.PI * 2;
  const r     = rMin + Math.random() * (rMax - rMin);
  return [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r];
}

// Multi-octave fBm noise for terrain
function fbm(x: number, z: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum  += amp * (
      Math.sin(x * 0.08 * freq + o * 1.7) * Math.cos(z * 0.11 * freq - o * 1.3) +
      Math.sin((x + z) * 0.05 * freq) * 0.6
    );
    norm += amp;
    amp *= 0.5; freq *= 2.0;
  }
  return sum / norm;
}

// ─────────────────────────────────────────────────────────────────────────────
export class LeftForestScene extends BaseScene {
  public  scene: THREE.Scene;
  private enemyManager!:  EnemyManager;
  private playerRef!:     THREE.Object3D;
  private cameraRef!:     THREE.Camera;
  private elapsed = 0;

  // Lighting
  private moonLight!:      THREE.DirectionalLight;
  private fillLight!:      THREE.DirectionalLight;
  private lightningLight!: THREE.DirectionalLight;
  private moonDisk!:       THREE.Mesh;

  // Portal
  private portalGroup!:        THREE.Group;
  private portalRing!:         THREE.Mesh;
  private portalInnerRing!:    THREE.Mesh;
  private portalDisk!:         THREE.Mesh;
  private portalCore!:         THREE.Mesh;
  private portalLight!:        THREE.PointLight;
  private portalParticles!:    THREE.Points;
  private portalSwirl!:        THREE.Points;
  private portalRayCones:      THREE.Mesh[] = [];
  private portalShockwaves:    { mesh: THREE.Mesh; born: number }[] = [];

  // Wisps
  private wisps: { light: THREE.PointLight; phase: number; pos: THREE.Vector3; orb: THREE.Mesh; halo: THREE.Mesh }[] = [];

  // Particles
  private sporeParticles!:   THREE.Points;
  private mistParticles!:    THREE.Points;
  private leafParticles!:    THREE.Points;
  private leafVelocities!:   Float32Array;
  private fireflies!:        THREE.Points;
  private fireflySeeds!:     Float32Array;
  private embers!:           THREE.Points;
  private emberVelocities!:  Float32Array;

  // Weather
  private nextLightningAt = 4 + Math.random() * 6;
  private lightningT      = 0;
  private lightningPhase  = 0; // 0 idle, 1 flash A, 2 gap, 3 flash B

  // Cleanup
  private disposables:    THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[]       = [];
  private timeouts:       ReturnType<typeof setTimeout>[] = [];

  private loader = new GLTFLoader();

  constructor() { super("LeftForestScene"); this.scene = new THREE.Scene(); }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    this._setupAtmosphere();
    this._buildTerrain();
    this._buildMountainSilhouettes();
    this._buildWisps();
    this._buildPortal();
    this._buildMist();
    this._buildLeaves();
    this._buildSpores();
    this._buildFireflies();
    this._buildEmbers();
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
    this._animateFireflies(dt);
    this._animateEmbers(dt);
    this._updateLightning(dt);
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    this.timeouts.forEach(t => clearTimeout(t));
    this.timeouts.length = 0;
    this.enemyManager?.dispose();
    collisionManager.clear();
    this.disposables.forEach(g => g.dispose());
    this.disposableMats.forEach(m => m.dispose());
  }

  public update(dt: number): void { this.onUpdate(dt); }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    const dx = playerPos.x - CFG.PORTAL_POS.x;
    const dz = playerPos.z - CFG.PORTAL_POS.z;
    return (dx * dx + dz * dz) < CFG.PORTAL_TRIGGER * CFG.PORTAL_TRIGGER ? "HubScene" : null;
  }

  // ─── Atmosphere ────────────────────────────────────────────────────────────
  private _setupAtmosphere(): void {
    this.scene.background = new THREE.Color(CFG.SKY_COLOR);
    this.scene.fog        = new THREE.Fog(CFG.FOG_COLOR, CFG.FOG_NEAR, CFG.FOG_FAR);

    this.scene.add(new THREE.AmbientLight(CFG.AMBIENT_COLOR, CFG.AMBIENT_INTENSITY));
    this.scene.add(new THREE.HemisphereLight(CFG.HEMI_SKY, CFG.HEMI_GROUND, CFG.HEMI_INTENSITY));

    // Moon — key light
    this.moonLight = new THREE.DirectionalLight(CFG.MOON_COLOR, CFG.MOON_INTENSITY);
    this.moonLight.position.set(60, 110, 50);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(4096, 4096);
    const s = 120;
    this.moonLight.shadow.camera.left   = -s;
    this.moonLight.shadow.camera.right  =  s;
    this.moonLight.shadow.camera.top    =  s;
    this.moonLight.shadow.camera.bottom = -s;
    this.moonLight.shadow.camera.near   =  1;
    this.moonLight.shadow.camera.far    =  260;
    this.moonLight.shadow.bias          = -0.0004;
    this.moonLight.shadow.normalBias    =  0.025;
    this.scene.add(this.moonLight);

    // Rim — cyan back-light
    const rim = new THREE.DirectionalLight(CFG.RIM_COLOR, CFG.RIM_INTENSITY);
    rim.position.set(-60, 40, -60);
    this.scene.add(rim);

    // Fill — magic violet bounce
    this.fillLight = new THREE.DirectionalLight(CFG.FILL_COLOR, CFG.FILL_INTENSITY);
    this.fillLight.position.set(20, 25, -50);
    this.scene.add(this.fillLight);

    // Lightning — dormant directional, pulsed in _updateLightning
    this.lightningLight = new THREE.DirectionalLight(0xbfd8ff, 0);
    this.lightningLight.position.set(-30, 100, 40);
    this.scene.add(this.lightningLight);

    // Moon disk + halo (visual)
    const moonGroup = new THREE.Group();
    const diskGeo = new THREE.CircleGeometry(6, 48); this.disposables.push(diskGeo);
    const diskMat = new THREE.MeshBasicMaterial({ color: 0xdfeaff, transparent: true, opacity: 0.95 });
    this.disposableMats.push(diskMat);
    this.moonDisk = new THREE.Mesh(diskGeo, diskMat);
    moonGroup.add(this.moonDisk);
    const haloGeo = new THREE.CircleGeometry(13, 48); this.disposables.push(haloGeo);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x8ecfdf, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.disposableMats.push(haloMat);
    moonGroup.add(new THREE.Mesh(haloGeo, haloMat));
    moonGroup.position.set(80, 70, -110);
    moonGroup.lookAt(0, 0, 0);
    this.scene.add(moonGroup);
  }

  // ─── Terrain ───────────────────────────────────────────────────────────────
  private _buildTerrain(): void {
    const SIZE = 220, SEG = 140;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getY(i);
      const inPath = Math.abs(x - 5 * WORLD_SCALE) < 11;
      const h = fbm(x, z) * 0.9 + (Math.random() - 0.5) * 0.08;
      pos.setZ(i, inPath ? h * 0.25 : h);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: CFG.GROUND_COLOR, roughness: 0.98, metalness: 0.0,
    });
    this.disposables.push(geo); this.disposableMats.push(mat);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Moss patches
    const mossMat = new THREE.MeshStandardMaterial({
      color: CFG.GROUND_MOSS_COLOR, roughness: 1.0,
      transparent: true, opacity: 0.7, depthWrite: false,
    });
    this.disposableMats.push(mossMat);
    for (let z = -45; z < 45; z += 5) {
      const mossGeo = new THREE.PlaneGeometry(4 + Math.random() * 5, 3 + Math.random() * 4);
      this.disposables.push(mossGeo);
      const patch = new THREE.Mesh(mossGeo, mossMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(
        5 * WORLD_SCALE + (Math.random() - 0.5) * 9,
        0.02,
        z * WORLD_SCALE + (Math.random() - 0.5) * 4
      );
      patch.rotation.z = Math.random() * Math.PI;
      this.scene.add(patch);
    }
    for (let i = 0; i < 32; i++) {
      const mossGeo = new THREE.PlaneGeometry(3 + Math.random() * 6, 2 + Math.random() * 5);
      this.disposables.push(mossGeo);
      const patch = new THREE.Mesh(mossGeo, mossMat);
      patch.rotation.x = -Math.PI / 2;
      const angle = Math.random() * Math.PI * 2;
      const r     = 25 + Math.random() * 70;
      patch.position.set(Math.cos(angle) * r, 0.02, Math.sin(angle) * r);
      patch.rotation.z = Math.random() * Math.PI;
      this.scene.add(patch);
    }
  }

  // ─── Distant mountain silhouettes ──────────────────────────────────────────
  private _buildMountainSilhouettes(): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x05101a, transparent: true, opacity: 0.85, fog: true, side: THREE.DoubleSide,
    });
    this.disposableMats.push(mat);
    for (let i = 0; i < 16; i++) {
      const w = 28 + Math.random() * 30;
      const h = 14 + Math.random() * 18;
      const geo = new THREE.ConeGeometry(w * 0.5, h, 5, 1);
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, mat);
      const a = (i / 16) * Math.PI * 2;
      const r = 145 + Math.random() * 25;
      m.position.set(Math.cos(a) * r, h * 0.5 - 2, Math.sin(a) * r);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
    }
  }

  // ─── Wisps ─────────────────────────────────────────────────────────────────
  private _buildWisps(): void {
    const positions = [
      new THREE.Vector3( -8 * WORLD_SCALE, 2.0, -20 * WORLD_SCALE),
      new THREE.Vector3(  4 * WORLD_SCALE, 2.6,  -5 * WORLD_SCALE),
      new THREE.Vector3( 12 * WORLD_SCALE, 2.3,  10 * WORLD_SCALE),
      new THREE.Vector3( 22 * WORLD_SCALE, 1.9,  12 * WORLD_SCALE),
      new THREE.Vector3(-25 * WORLD_SCALE, 1.7,  20 * WORLD_SCALE),
      new THREE.Vector3(-15 * WORLD_SCALE, 2.2, -32 * WORLD_SCALE),
      new THREE.Vector3( 30 * WORLD_SCALE, 1.8, -18 * WORLD_SCALE),
    ];
    const orbMat = new THREE.MeshStandardMaterial({
      color: CFG.WISP_COLOR, emissive: new THREE.Color(CFG.WISP_COLOR),
      emissiveIntensity: 3.5, transparent: true, opacity: 0.95,
    });
    const haloMat = new THREE.MeshStandardMaterial({
      color: CFG.WISP_COLOR, emissive: new THREE.Color(CFG.WISP_COLOR),
      emissiveIntensity: 0.6, transparent: true, opacity: 0.18,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.disposableMats.push(orbMat, haloMat);
    positions.forEach((pos, i) => {
      const light = new THREE.PointLight(CFG.WISP_COLOR, CFG.WISP_INTENSITY, CFG.WISP_DISTANCE);
      light.position.copy(pos); this.scene.add(light);
      const orbGeo = new THREE.SphereGeometry(0.14, 10, 10); this.disposables.push(orbGeo);
      const orb = new THREE.Mesh(orbGeo, orbMat); orb.position.copy(pos); this.scene.add(orb);
      const haloGeo = new THREE.SphereGeometry(0.5, 12, 12); this.disposables.push(haloGeo);
      const halo = new THREE.Mesh(haloGeo, haloMat); halo.position.copy(pos); this.scene.add(halo);
      this.wisps.push({ light, phase: i * 1.57, pos: pos.clone(), orb, halo });
    });
  }

  // ─── Portal (multi-layer vortex) ───────────────────────────────────────────
  private _buildPortal(): void {
    this.portalGroup = new THREE.Group();
    const COL = new THREE.Color(CFG.PORTAL_COLOR);

    // Outer torus
    const outerGeo = new THREE.TorusGeometry(3.2, 0.22, 24, 96); this.disposables.push(outerGeo);
    const outerMat = new THREE.MeshStandardMaterial({
      color: COL, emissive: COL, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.85,
    }); this.disposableMats.push(outerMat);
    this.portalRing = new THREE.Mesh(outerGeo, outerMat);
    this.portalRing.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalRing);

    // Inner counter-rotating torus
    const innerGeo = new THREE.TorusGeometry(2.5, 0.09, 16, 72); this.disposables.push(innerGeo);
    const innerMat = new THREE.MeshStandardMaterial({
      color: COL, emissive: COL, emissiveIntensity: 2.6,
      roughness: 0.05, metalness: 0.95, transparent: true, opacity: 0.8,
    }); this.disposableMats.push(innerMat);
    this.portalInnerRing = new THREE.Mesh(innerGeo, innerMat);
    this.portalInnerRing.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalInnerRing);

    // Energy disk
    const diskGeo = new THREE.CircleGeometry(3.05, 96); this.disposables.push(diskGeo);
    const diskMat = new THREE.MeshStandardMaterial({
      color: COL, emissive: COL, emissiveIntensity: 0.35,
      transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }); this.disposableMats.push(diskMat);
    this.portalDisk = new THREE.Mesh(diskGeo, diskMat);
    this.portalDisk.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalDisk);

    // Bright core
    const coreGeo = new THREE.CircleGeometry(1.1, 48); this.disposables.push(coreGeo);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xcfffe8, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }); this.disposableMats.push(coreMat);
    this.portalCore = new THREE.Mesh(coreGeo, coreMat);
    this.portalCore.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalCore);

    // Particle ring
    const pCount = 140; const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const a = (i / pCount) * Math.PI * 2, r = 3.2 + (Math.random() - 0.5) * 0.6;
      pPos[i * 3] = Math.cos(a) * r; pPos[i * 3 + 1] = 0; pPos[i * 3 + 2] = Math.sin(a) * r;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    this.disposables.push(pGeo);
    const pMat = new THREE.PointsMaterial({
      color: COL, size: 0.11, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(pMat);
    this.portalParticles = new THREE.Points(pGeo, pMat);
    this.portalParticles.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalParticles);

    // Inner swirling motes
    const sCount = 200; const sPos = new Float32Array(sCount * 3);
    for (let i = 0; i < sCount; i++) {
      const r = Math.random() * 2.6;
      const a = Math.random() * Math.PI * 2;
      sPos[i * 3] = Math.cos(a) * r;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
      sPos[i * 3 + 2] = Math.sin(a) * r;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    this.disposables.push(sGeo);
    const sMat = new THREE.PointsMaterial({
      color: 0xa8ffd4, size: 0.06, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(sMat);
    this.portalSwirl = new THREE.Points(sGeo, sMat);
    this.portalSwirl.rotation.x = Math.PI / 2;
    this.portalGroup.add(this.portalSwirl);

    // God-ray cones shooting upward
    const rayMat = new THREE.MeshBasicMaterial({
      color: COL, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.disposableMats.push(rayMat);
    for (let i = 0; i < 3; i++) {
      const h = 14 + i * 4;
      const rGeo = new THREE.ConeGeometry(2.4 + i * 0.6, h, 24, 1, true);
      this.disposables.push(rGeo);
      const cone = new THREE.Mesh(rGeo, rayMat);
      cone.position.y = h / 2;
      this.portalRayCones.push(cone);
      this.portalGroup.add(cone);
    }

    // Lights
    this.portalLight = new THREE.PointLight(CFG.PORTAL_COLOR, 6.0, 32);
    this.portalLight.position.y = 0.5;
    this.portalGroup.add(this.portalLight);
    const groundGlow = new THREE.PointLight(CFG.PORTAL_COLOR, 2.0, 12);
    groundGlow.position.y = -3;
    this.portalGroup.add(groundGlow);

    this.portalGroup.position.copy(CFG.PORTAL_POS).add(new THREE.Vector3(0, 5, 0));
    this.scene.add(this.portalGroup);
  }

  // ─── Particles ─────────────────────────────────────────────────────────────
  private _buildMist(): void {
    const pos = new Float32Array(CFG.MIST_COUNT * 3);
    for (let i = 0; i < CFG.MIST_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 1] = Math.random() * 1.6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color: 0x0a2015, size: 4.5, transparent: true, opacity: 0.14,
      depthWrite: false, sizeAttenuation: true,
    });
    this.disposableMats.push(mat);
    this.mistParticles = new THREE.Points(geo, mat);
    this.scene.add(this.mistParticles);
  }

  private _buildLeaves(): void {
    const pos = new Float32Array(CFG.LEAF_COUNT * 3);
    this.leafVelocities = new Float32Array(CFG.LEAF_COUNT * 3);
    for (let i = 0; i < CFG.LEAF_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 1] = Math.random() * 24;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 200;
      this.leafVelocities[i * 3]     = (Math.random() - 0.5) * 0.35;
      this.leafVelocities[i * 3 + 1] = -(0.3 + Math.random() * 0.5);
      this.leafVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color: 0x2d5e1e, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false,
    });
    this.disposableMats.push(mat);
    this.leafParticles = new THREE.Points(geo, mat);
    this.scene.add(this.leafParticles);
  }

  private _buildSpores(): void {
    const pos = new Float32Array(CFG.SPORE_COUNT * 3);
    for (let i = 0; i < CFG.SPORE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color: 0x77ffbb, size: 0.1, transparent: true, opacity: 0.6,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(mat);
    this.sporeParticles = new THREE.Points(geo, mat);
    this.scene.add(this.sporeParticles);
  }

  private _buildFireflies(): void {
    const pos = new Float32Array(CFG.FIREFLY_COUNT * 3);
    this.fireflySeeds = new Float32Array(CFG.FIREFLY_COUNT * 3);
    for (let i = 0; i < CFG.FIREFLY_COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 180;
      pos[i * 3 + 1] = 0.8 + Math.random() * 5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 180;
      this.fireflySeeds[i * 3]     = Math.random() * Math.PI * 2;
      this.fireflySeeds[i * 3 + 1] = 0.5 + Math.random() * 1.5;
      this.fireflySeeds[i * 3 + 2] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color: 0xb8ff70, size: 0.16, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(mat);
    this.fireflies = new THREE.Points(geo, mat);
    this.scene.add(this.fireflies);
  }

  private _buildEmbers(): void {
    const pos = new Float32Array(CFG.EMBER_COUNT * 3);
    this.emberVelocities = new Float32Array(CFG.EMBER_COUNT * 3);
    for (let i = 0; i < CFG.EMBER_COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
      this.emberVelocities[i * 3]     = (Math.random() - 0.5) * 0.15;
      this.emberVelocities[i * 3 + 1] = 0.3 + Math.random() * 0.6;
      this.emberVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.disposables.push(geo);
    const mat = new THREE.PointsMaterial({
      color: 0x66ffaa, size: 0.08, transparent: true, opacity: 0.75,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(mat);
    this.embers = new THREE.Points(geo, mat);
    this.scene.add(this.embers);
  }

  private _buildGodRays(): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4af0a0, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.disposableMats.push(mat);
    const spots = [
      { x: -18, z: -12 }, { x: 5, z: 20 }, { x: 20, z: -25 },
      { x: -8, z:   8 }, { x: -28, z: 30 }, { x: 35, z: -8 },
      { x: -40, z: -18 }, { x: 28, z: 35 },
    ];
    spots.forEach(({ x, z }) => {
      const h = 18 + Math.random() * 8;
      const geo = new THREE.CylinderGeometry(0.05, 2.2 + Math.random() * 0.8, h, 10, 1, true);
      this.disposables.push(geo);
      const ray = new THREE.Mesh(geo, mat.clone());
      this.disposableMats.push(ray.material as THREE.Material);
      ray.position.set(x * WORLD_SCALE, h / 2, z * WORLD_SCALE);
      ray.rotation.z = (Math.random() - 0.5) * 0.18;
      this.scene.add(ray);
    });
  }

  // ─── Models — CLUSTERED PLACEMENT ─────────────────────────────────────────
  private async _loadModels(): Promise<void> {
    const gltfLoad = (name: string, base = MODEL_BASE) =>
      new Promise<THREE.Group>((res, rej) =>
        this.loader.load(`${base}/${name}.gltf`, g => res(g.scene), undefined, rej)
      );
    const propLoad = (path: string) =>
      new Promise<THREE.Group>((res, rej) =>
        this.loader.load(path, g => res(g.scene), undefined, rej)
      );

    const normalizeScale = (g: THREE.Group, targetH: number, multiplier = 1.0) => {
      const bbox = new THREE.Box3().setFromObject(g);
      const h    = bbox.max.y - bbox.min.y;
      if (h < 0.001) return;
      g.scale.setScalar((targetH / h) * multiplier);
    };

    const nightify = (g: THREE.Group, s = 0.4, tint = new THREE.Color(0.6, 1.0, 0.7)) =>
      g.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.material) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(s).multiply(tint);
          if (mat.emissiveIntensity) mat.emissiveIntensity *= 0.2;
          m.material = mat;
        }
      });
    const shadow = (g: THREE.Group) =>
      g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    // ── 1. TƯỜNG RỪNG ────────────────────────────────────────────────────────
    const outerTreeNames = ["CommonTree_1", "CommonTree_2", "Pine_1", "Pine_2", "TwistedTree_1", "TwistedTree_2"];
    const outerTreeModels = await Promise.all(outerTreeNames.map(n => gltfLoad(n).catch(() => null)));

    for (let i = 0; i < 38; i++) {
      const angle = (i / 38) * Math.PI * 2 + Math.random() * 0.12;
      const r     = 75 + Math.random() * 18;
      const x     = Math.cos(angle) * r, z = Math.sin(angle) * r;
      if (inClearPath(x, z)) continue;
      const src = outerTreeModels[i % outerTreeModels.length];
      if (!src) continue;
      const t = src.clone(); shadow(t); nightify(t, 0.32);
      normalizeScale(t, CFG.MODEL_SCALE.outerTreeH + Math.random() * CFG.MODEL_SCALE.outerTreeJ);
      t.position.set(x, 0, z);
      t.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(t);
    }

    // ── 2. CLUSTER CÂY GIỮA ───────────────────────────────────────────────────
    const midTreeNames  = ["DeadTree_1", "DeadTree_2", "TwistedTree_3", "CommonTree_3"];
    const midTreeModels = await Promise.all(midTreeNames.map(n => gltfLoad(n).catch(() => null)));

    const clusterAnchors = [
      { x: -30, z: -25 }, { x: -20, z:  15 }, { x:  15, z: -30 },
      { x: -35, z:  30 }, { x:  25, z:  25 }, { x: -10, z: -40 },
      { x:  40, z:  -5 }, { x: -45, z:   0 }, { x:  18, z:  45 },
    ].map(a => ({ x: a.x * WORLD_SCALE, z: a.z * WORLD_SCALE }));

    for (const anchor of clusterAnchors) {
      const count = 5 + Math.floor(Math.random() * 4);
      for (let j = 0; j < count; j++) {
        const [x, z] = annulusPoint(anchor.x, anchor.z, 2, 10);
        if (inClearPath(x, z)) continue;
        const src = midTreeModels[j % midTreeModels.length];
        if (!src) continue;
        const t = src.clone(); shadow(t); nightify(t, 0.38, new THREE.Color(0.55, 0.9, 0.65));
        normalizeScale(t, CFG.MODEL_SCALE.midTreeH + Math.random() * CFG.MODEL_SCALE.midTreeJ);
        t.position.set(x, 0, z);
        t.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(t);
      }
    }

    // ── 3. UNDERGROWTH ────────────────────────────────────────────────────────
    const groundNames  = ["Bush_Common", "Fern_1", "Mushroom_Common", "Mushroom_Laetiporus", "Plant_1"];
    const groundModels = await Promise.all(groundNames.map(n => gltfLoad(n).catch(() => null)));

    for (const anchor of clusterAnchors) {
      const count = 8 + Math.floor(Math.random() * 6);
      for (let j = 0; j < count; j++) {
        const [x, z] = annulusPoint(anchor.x, anchor.z, 0.5, 12);
        if (inClearPath(x, z)) continue;
        const src = groundModels[j % groundModels.length];
        if (!src) continue;
        const g = src.clone(); shadow(g); nightify(g, 0.5, new THREE.Color(0.6, 1.0, 0.7));
        normalizeScale(g, CFG.MODEL_SCALE.underH + Math.random() * CFG.MODEL_SCALE.underJ);
        g.position.set(x, 0, z);
        g.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(g);
      }
    }

    // ── 4. ĐÁ VEN PATH ────────────────────────────────────────────────────────
    const rockNames  = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
    const pebNames   = ["Pebble_Round_1", "Pebble_Round_2", "Pebble_Square_1"];
    const rockModels = await Promise.all([...rockNames, ...pebNames].map(n => gltfLoad(n).catch(() => null)));

    for (let z = -42; z < 40; z += 6) {
      for (const sideX of [-8 - Math.random() * 5, 8 + Math.random() * 5]) {
        const src = rockModels[Math.floor(Math.random() * rockModels.length)];
        if (!src) continue;
        const r = src.clone(); shadow(r); nightify(r, 0.32, new THREE.Color(0.7, 0.85, 0.8));
        normalizeScale(r, CFG.MODEL_SCALE.rockH + Math.random() * CFG.MODEL_SCALE.rockJ);
        r.position.set(
          (5 + sideX) * WORLD_SCALE,
          0,
          z * WORLD_SCALE + (Math.random() - 0.5) * 4
        );
        r.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(r);
      }
    }

    // ── 5. FOCAL POINTS ────────────────────────────────────────────────────────
    propLoad(`${PROP_BASE}/pile_of_skulls.glb`).then(skulls => {
      shadow(skulls); nightify(skulls, 0.45, new THREE.Color(0.85, 0.78, 0.7));
      normalizeScale(skulls, CFG.MODEL_SCALE.skulls);
      [{ x: -28, z: 22 }, { x: -18, z: -32 }, { x: 32, z: 28 }].forEach(({ x, z }) => {
        const s = skulls.clone();
        s.position.set(x * WORLD_SCALE, 0, z * WORLD_SCALE);
        s.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(s);
      });
    }).catch(() => {});

    propLoad(`${PROP_BASE}/stylized_fence.glb`).then(fence => {
      shadow(fence); nightify(fence, 0.42, new THREE.Color(0.7, 0.65, 0.55));
      normalizeScale(fence, CFG.MODEL_SCALE.fence);
      for (let i = 0; i < 6; i++) {
        const f = fence.clone();
        f.position.set(
          (-9 + (Math.random() - 0.5) * 1.5) * WORLD_SCALE,
          0,
          (-25 + i * 11 + (Math.random() - 0.5) * 2) * WORLD_SCALE
        );
        f.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.15;
        this.scene.add(f);
      }
    }).catch(() => {});

    propLoad(`${PROP_BASE}/bo_ba_nam.glb`).then(statue => {
      shadow(statue); nightify(statue, 0.42, new THREE.Color(0.6, 0.95, 0.78));
      normalizeScale(statue, CFG.MODEL_SCALE.statue);
      statue.position.set(CFG.PORTAL_POS.x - 6, 0, CFG.PORTAL_POS.z + 3);
      statue.rotation.y = Math.PI * 0.3;
      this.scene.add(statue);

      // Eerie up-light on the statue
      const upLight = new THREE.SpotLight(CFG.PORTAL_COLOR, 3.0, 18, Math.PI / 5, 0.6, 1.5);
      upLight.position.set(statue.position.x, 0.4, statue.position.z);
      upLight.target.position.set(statue.position.x, 4, statue.position.z);
      this.scene.add(upLight);
      this.scene.add(upLight.target);
    }).catch(() => {});

    propLoad(`${PROP_BASE}/Big-stone.glb`).then(stone => {
      shadow(stone); nightify(stone, 0.32, new THREE.Color(0.72, 0.85, 0.8));
      normalizeScale(stone, CFG.MODEL_SCALE.bigStone);
      stone.position.set(-22 * WORLD_SCALE, 0, -5 * WORLD_SCALE);
      stone.rotation.y = 0.8;
      this.scene.add(stone);
    }).catch(() => {});

    // ── 6. GROUND COVER ──────────────────────────────────────────
    const grassNames  = ["Grass_Common_Short", "Grass_Wispy_Short", "Clover_1", "Petal_1"];
    const grassModels = await Promise.all(grassNames.map(n => gltfLoad(n).catch(() => null)));
    for (let i = 0; i < 140; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = 4 + Math.random() * 70;
      const x     = Math.cos(angle) * r, z = Math.sin(angle) * r;
      const src   = grassModels[i % grassModels.length];
      if (!src) continue;
      const g = src.clone();
      normalizeScale(g, CFG.MODEL_SCALE.grass + Math.random() * 0.5);
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      nightify(g, 0.5, new THREE.Color(0.65, 1.0, 0.7));
      this.scene.add(g);
    }
  }

  // ─── Enemies ───────────────────────────────────────────────────────────────
  private _spawnEnemies(): void {
    this.enemyManager = new EnemyManager(this.scene, document.body);
    this.enemyManager.spawn(
      [
        new THREE.Vector3( 15 * WORLD_SCALE, 0,  10 * WORLD_SCALE),
        new THREE.Vector3(-10 * WORLD_SCALE, 0,  18 * WORLD_SCALE),
        new THREE.Vector3( 22 * WORLD_SCALE, 0, -15 * WORLD_SCALE),
        new THREE.Vector3(-28 * WORLD_SCALE, 0, -10 * WORLD_SCALE),
        new THREE.Vector3( 35 * WORLD_SCALE, 0,  25 * WORLD_SCALE),
      ],
      { ...GOBLIN_CONFIG, scale: 1.2, chaseRange: 24, patrolRadius: 7 }
    );
  }

  // ─── Animators ─────────────────────────────────────────────────────────────
  private _animateWisps(dt: number): void {
    this.wisps.forEach(w => {
      w.phase += dt * 1.1;
      const p = new THREE.Vector3(
        w.pos.x + Math.sin(w.phase * 0.6) * 1.8 + Math.sin(w.phase * 1.3) * 0.5,
        w.pos.y + Math.sin(w.phase) * 0.7,
        w.pos.z + Math.cos(w.phase * 0.5) * 1.5
      );
      w.light.position.copy(p);
      w.orb.position.copy(p);
      w.halo.position.copy(p);
      w.light.intensity = CFG.WISP_INTENSITY * (0.8 + Math.sin(w.phase * 2.3) * 0.3);
      w.orb.scale.setScalar(0.9 + Math.sin(w.phase * 3.1) * 0.18);
      w.halo.scale.setScalar(1.0 + Math.sin(w.phase * 1.8) * 0.28);
      (w.halo.material as THREE.MeshStandardMaterial).opacity =
        0.14 + Math.sin(w.phase * 2.0) * 0.08;
    });
  }

  private _animatePortal(dt: number): void {
    this.portalRing.rotation.z      += dt * 0.5;
    this.portalInnerRing.rotation.z -= dt * 0.85;
    this.portalCore.rotation.z      += dt * 1.8;

    const diskMat = this.portalDisk.material as THREE.MeshStandardMaterial;
    diskMat.opacity           = 0.18 + Math.sin(this.elapsed * 2.5) * 0.1;
    diskMat.emissiveIntensity = 0.3 + Math.sin(this.elapsed * 1.8) * 0.14;
    (this.portalCore.material as THREE.MeshBasicMaterial).opacity =
      0.5 + Math.sin(this.elapsed * 3.4) * 0.18;

    this.portalLight.intensity = 5.5 + Math.sin(this.elapsed * 3.2) * 1.4;
    this.portalParticles.rotation.z += dt * 0.25;
    this.portalSwirl.rotation.z     -= dt * 0.55;

    // Cones breathe & rotate
    this.portalRayCones.forEach((c, i) => {
      c.rotation.y += dt * (0.15 + i * 0.05);
      (c.material as THREE.MeshBasicMaterial).opacity =
        0.06 + Math.sin(this.elapsed * 1.5 + i) * 0.04;
    });

    this.portalGroup.position.y =
      CFG.PORTAL_POS.y + 5 + Math.sin(this.elapsed * 0.8) * 0.15;

    // Periodic shockwave
    if (Math.random() < dt * 0.25) this._spawnPortalShockwave();
    this._updateShockwaves(dt);
  }

  private _spawnPortalShockwave(): void {
    const geo = new THREE.RingGeometry(0.6, 0.8, 64); this.disposables.push(geo);
    const mat = new THREE.MeshBasicMaterial({
      color: CFG.PORTAL_COLOR, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disposableMats.push(mat);
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(CFG.PORTAL_POS.x, 0.05, CFG.PORTAL_POS.z);
    this.scene.add(ring);
    this.portalShockwaves.push({ mesh: ring, born: this.elapsed });
  }

  private _updateShockwaves(_dt: number): void {
    const DUR = 1.8;
    for (let i = this.portalShockwaves.length - 1; i >= 0; i--) {
      const sw = this.portalShockwaves[i];
      const t  = (this.elapsed - sw.born) / DUR;
      if (t >= 1) {
        this.scene.remove(sw.mesh);
        this.portalShockwaves.splice(i, 1);
        continue;
      }
      const s = 1 + t * 10;
      sw.mesh.scale.set(s, s, s);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
    }
  }

  private _animateSpores(dt: number): void {
    const pos = this.sporeParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.08;
      if (y > 7) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(this.elapsed * 0.7 + i * 0.3) * dt * 0.06);
    }
    pos.needsUpdate = true;
  }

  private _animateMist(dt: number): void {
    const pos = this.mistParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + Math.sin(this.elapsed * 0.3 + i * 0.7) * dt * 0.1);
      pos.setZ(i, pos.getZ(i) + Math.cos(this.elapsed * 0.2 + i * 0.5) * dt * 0.08);
    }
    pos.needsUpdate = true;
  }

  private _animateLeaves(dt: number): void {
    const pos = this.leafParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + (this.leafVelocities[i * 3]     + Math.sin(this.elapsed + i) * 0.05) * dt;
      let y = pos.getY(i) +  this.leafVelocities[i * 3 + 1] * dt;
      let z = pos.getZ(i) + (this.leafVelocities[i * 3 + 2] + Math.cos(this.elapsed * 0.8 + i) * 0.04) * dt;
      if (y < 0) {
        y = 18 + Math.random() * 6;
        x = (Math.random() - 0.5) * 200;
        z = (Math.random() - 0.5) * 200;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  private _animateFireflies(dt: number): void {
    const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const sA = this.fireflySeeds[i * 3];
      const sH = this.fireflySeeds[i * 3 + 1];
      const sB = this.fireflySeeds[i * 3 + 2];
      pos.setX(i, pos.getX(i) + Math.sin(this.elapsed * 0.9 + sA) * dt * 0.4);
      pos.setY(i, 0.8 + sH + Math.sin(this.elapsed * 1.3 + sB) * 0.6);
      pos.setZ(i, pos.getZ(i) + Math.cos(this.elapsed * 0.7 + sB) * dt * 0.4);
    }
    pos.needsUpdate = true;
    (this.fireflies.material as THREE.PointsMaterial).opacity =
      0.7 + Math.sin(this.elapsed * 4) * 0.25;
  }

  private _animateEmbers(dt: number): void {
    const pos = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + (this.emberVelocities[i * 3]     + Math.sin(this.elapsed * 0.6 + i) * 0.04) * dt;
      let y = pos.getY(i) +  this.emberVelocities[i * 3 + 1] * dt;
      let z = pos.getZ(i) + (this.emberVelocities[i * 3 + 2] + Math.cos(this.elapsed * 0.4 + i) * 0.04) * dt;
      if (y > 14) {
        y = 0.2;
        x = (Math.random() - 0.5) * 160;
        z = (Math.random() - 0.5) * 160;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  // ─── Distant lightning storm ──────────────────────────────────────────────
  private _updateLightning(dt: number): void {
    this.lightningT += dt;
    if (this.lightningPhase === 0 && this.lightningT >= this.nextLightningAt) {
      this.lightningPhase = 1;
      this.lightningT     = 0;
      this.lightningLight.color.setHex(0xbfd8ff);
      this.lightningLight.intensity = 1.2 + Math.random() * 1.5;
      // Schedule double-flash
      this.timeouts.push(setTimeout(() => {
        this.lightningLight.intensity = 0;
        this.timeouts.push(setTimeout(() => {
          this.lightningLight.intensity = 0.8 + Math.random() * 1.2;
          this.timeouts.push(setTimeout(() => {
            this.lightningLight.intensity = 0;
            this.lightningPhase   = 0;
            this.nextLightningAt  = 6 + Math.random() * 9;
          }, 90));
        }, 70));
      }, 100));
    }
  }

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
}
