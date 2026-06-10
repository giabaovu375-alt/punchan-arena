import * as THREE from "three";
import { BaseScene } from "../BaseScene";
import { eventBus } from "../../core/EventBus";
import { GameEvents } from "../../types/events";
import { collisionManager } from "../../core/CollisionManager";
import { EnemyManager, GOBLIN_CONFIG } from "../../entities/Enemy";
import { WORLD_SCALE, CFG } from "./leftforest/LeftForestConfig";
import { setupAtmosphere } from "./leftforest/LeftForestAtmosphere";
import { buildTerrain } from "./leftforest/LeftForestTerrain";
import { buildWisps, animateWisps, type Wisp } from "./leftforest/LeftForestWisps";
import { buildPortal, animatePortal, spawnShockwave, updateShockwaves, type PortalGroup } from "./leftforest/LeftForestPortal";
import { buildParticles, animateMist, animateLeaves, animateSpores, animateFireflies, animateEmbers, type ParticleSystems } from "./leftforest/LeftForestParticles";
import { loadAllModels } from "./leftforest/LeftForestModels";

export class LeftForestScene extends BaseScene {
  public  scene: THREE.Scene;
  private enemyManager!: EnemyManager;
  private playerRef!: THREE.Object3D;
  private cameraRef!: THREE.Camera;
  private elapsed = 0;

  private moonLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private lightningLight!: THREE.DirectionalLight;
  private wisps: Wisp[] = [];
  private portal!: PortalGroup;
  private particles!: ParticleSystems;
  private disposables: THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[] = [];
  private timeouts: ReturnType<typeof setTimeout>[] = [];

  constructor() { super("LeftForestScene"); this.scene = new THREE.Scene(); }

  public setPlayer(p: THREE.Object3D) { this.playerRef = p; }
  public setCamera(c: THREE.Camera)   { this.cameraRef = c; }
  public getEnemyRoots(): THREE.Object3D[] { return this.enemyManager?.getEnemyRoots() ?? []; }

  protected async onLoad(): Promise<void> {
    const { moonLight, fillLight, lightningLight } = setupAtmosphere(this.scene);
    this.moonLight = moonLight; this.fillLight = fillLight; this.lightningLight = lightningLight;
    buildTerrain(this.scene, this.disposables, this.disposableMats);
    this.wisps = buildWisps(this.scene, this.disposables, this.disposableMats);
    this.portal = buildPortal(this.scene, this.disposables, this.disposableMats);
    this.particles = buildParticles(this.scene, this.disposables, this.disposableMats);
    await loadAllModels(this.scene, this.disposables, this.disposableMats);
    this._spawnEnemies();
    eventBus.on(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
  }

  protected onUpdate(dt: number): void {
    this.elapsed += dt;
    animateWisps(this.wisps, dt);
    animatePortal(this.portal, this.elapsed, dt);
    if (Math.random() < dt * 0.25) spawnShockwave(this.portal, this.disposables, this.disposableMats, this.elapsed);
    updateShockwaves(this.portal, this.elapsed);
    animateSpores(this.particles.sporeParticles, this.elapsed, dt);
    animateMist(this.particles.mistParticles, this.elapsed, dt);
    animateLeaves(this.particles.leafParticles, this.particles.leafVelocities, this.elapsed, dt);
    animateFireflies(this.particles.fireflies, this.particles.fireflySeeds, this.elapsed, dt);
    animateEmbers(this.particles.embers, this.particles.emberVelocities, this.elapsed, dt);
    this._updateLightning(dt);
    if (this.enemyManager && this.playerRef) {
      const dmg = this.enemyManager.update(dt, this.playerRef.position, this.cameraRef);
      if (dmg > 0) eventBus.emit(GameEvents.PLAYER_DAMAGE, { amount: dmg });
    }
  }

  private _updateLightning(dt: number): void {
    this.lightningLight.intensity = 0;
    // giả lập chớp, bạn có thể thêm logic chi tiết
  }

  protected async onUnload(): Promise<void> {
    eventBus.off(GameEvents.PLAYER_ATTACK, this._onPlayerAttack);
    this.timeouts.forEach(t => clearTimeout(t));
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

  private _onPlayerAttack = (data: { origin: THREE.Vector3; range: number; damage: number }) => {
    this.enemyManager?.hitInRange(data.origin, data.range, data.damage);
  };
}
