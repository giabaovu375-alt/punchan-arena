import * as THREE from "three";
import { collisionManager } from "../core";
import { WorldScene } from "../scenes/WorldScene";
import { buildIntroScene, tickIntroScene, PLAYER_SPAWN, type IntroSceneHandles } from "../IntroScene";
import { LoadingOverlay } from "./LoadingOverlay";

export interface SceneControllerDeps {
  scene:         THREE.Scene;
  player:        THREE.Object3D;
  camera:        THREE.Camera;
  overlay:       LoadingOverlay;
  onWorldReady:  (ws: WorldScene) => void;
  onIntroReady:  (handles: IntroSceneHandles) => void;
  onWorldClear:  () => void;
  setColliders:  (c: unknown[]) => void;
  resetCombat:   () => void;
}

// ─── SceneController ──────────────────────────────────────────────────────────
export class SceneController {
  private worldScene:   WorldScene | null        = null;
  private introHandles: IntroSceneHandles | null = null;
  private isMobile:     boolean;

  constructor(
    private deps: SceneControllerDeps,
    isMobile:     boolean,
  ) {
    this.isMobile = isMobile;
  }

  get world()  { return this.worldScene;   }
  get intro()  { return this.introHandles; }
  get hasWorld(){ return this.worldScene !== null; }

  // ─── Switch to WorldScene ───────────────────────────────────────────────────
  async switchToWorld(): Promise<void> {
    const { scene, player, camera, overlay } = this.deps;

    overlay.show("Đang vào thế giới...");

    // Teardown intro
    if (this.introHandles) {
      this._clearScene(scene);
      this.introHandles = null;
      this.deps.onWorldClear();
    }
    scene.remove(player);

    // Load WorldScene
    const ws = new WorldScene();
    try {
      await ws.load();
    } catch (err) {
      console.error("❌ Không load được WorldScene:", err);
      this.loadIntro(this.isMobile);
      overlay.hide();
      return;
    }

    ws.setPlayer(player);
    ws.setCamera(camera);
    ws.scene.add(player);

    this.worldScene = ws;
    player.position.set(0, 0, 30);
    this.deps.setColliders([]);
    this.deps.resetCombat();
    this.deps.onWorldReady(ws);
    overlay.hide();
  }

  // ─── Load IntroScene ────────────────────────────────────────────────────────
  loadIntro(isMobile: boolean): void {
    const { scene, player } = this.deps;

    if (this.worldScene) {
      this.worldScene.scene.remove(player);
      this.worldScene.unload().catch(console.error);
      this.worldScene = null;
    }
    collisionManager.clear();
    this._clearScene(scene);
    scene.add(player);

    this.introHandles = buildIntroScene(scene, isMobile);
    this.deps.setColliders([]);
    this.deps.resetCombat();
    this.deps.onIntroReady(this.introHandles);

    if (PLAYER_SPAWN) player.position.copy(PLAYER_SPAWN);
  }

  // ─── Tick ───────────────────────────────────────────────────────────────────
  tick(dt: number, elapsed: number): void {
    if (this.introHandles) {
      tickIntroScene(this.introHandles, dt, elapsed);
    } else {
      this.worldScene?.update(dt);
    }
  }

  // ─── Helper: xóa scene không dùng traverse tốn CPU ─────────────────────────
  private _clearScene(target: THREE.Scene): void {
    // Chỉ xóa direct children — tránh traverse toàn bộ cây
    const keep  = new Set<THREE.Object3D>([this.deps.player]);
    const toRem = target.children.filter((c) => !keep.has(c));
    toRem.forEach((c) => target.remove(c));
  }
}
