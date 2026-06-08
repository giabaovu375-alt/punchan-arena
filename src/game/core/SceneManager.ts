/**
 * SceneManager - Quản lý các scene và chuyển scene
 * Chịu trách nhiệm: Load, Unload, Switch scenes, Portal transitions
 */

import * as THREE from "three";
import { eventBus } from "./EventBus";
import { GameEvents } from "../types/events";
import type { BaseScene } from "../scenes/BaseScene";

export class SceneManager {
  private scenes: Map<string, BaseScene> = new Map();
  private currentScene: BaseScene | null = null;
  private isTransitioning: boolean = false;
  private transitionDuration: number = 0.5; // seconds

  // ── Fade overlay ──────────────────────────────────────────────────────────
  private overlay: HTMLDivElement | null = null;

  constructor() {
    this._buildOverlay();

    // Subscribe to portal enter events
    eventBus.on(GameEvents.PORTAL_ENTERED, (data) => {
      if (data?.targetScene) {
        this.switchScene(data.targetScene, data.spawnPos);
      }
    });
  }

  // ── Register ───────────────────────────────────────────────────────────────

  public registerScene(scene: BaseScene): void {
    const name = scene.getName();
    this.scenes.set(name, scene);
    console.log(`✅ Scene registered: ${name}`);
  }

  // ── Switch ─────────────────────────────────────────────────────────────────

  public async switchScene(
    sceneName: string,
    spawnPos?: { x: number; z: number },
  ): Promise<boolean> {
    if (this.isTransitioning) {
      console.warn("⚠️ Đang chuyển scene, vui lòng chờ...");
      return false;
    }

    const nextScene = this.scenes.get(sceneName);
    if (!nextScene) {
      console.error(`❌ Scene not found: ${sceneName}`);
      return false;
    }

    if (this.currentScene === nextScene) {
      console.warn(`⚠️ Scene already active: ${sceneName}`);
      return false;
    }

    this.isTransitioning = true;
    const prevScene = this.currentScene; // giữ ref để rollback nếu cần

    eventBus.emit(GameEvents.SCENE_TRANSITION_START, {
      fromScene: prevScene?.getName(),
      toScene: sceneName,
    });

    try {
      // 1. Fade ra đen
      await this._fadeOut();

      // 2. Unload scene cũ
      if (prevScene) {
        await prevScene.unload();
      }

      // 3. Load scene mới
      const result = await nextScene.load();
      if (!result.success) {
        console.error(`❌ Load failed [${sceneName}]: ${result.error}`);
        // Rollback — tải lại scene cũ
        if (prevScene) {
          await prevScene.load();
          this.currentScene = prevScene;
        }
        await this._fadeIn();
        return false;
      }

      // 4. Commit
      this.currentScene = nextScene;

      if (spawnPos) {
        eventBus.emit(GameEvents.PLAYER_SPAWN, { sceneName, pos: spawnPos });
      }

      eventBus.emit(GameEvents.SCENE_TRANSITION_END, { sceneName });
      console.log(`✅ Scene switched to: ${sceneName}`);

      // 5. Fade vào
      await this._fadeIn();
      return true;
    } catch (error) {
      console.error(`❌ Error switching to ${sceneName}:`, error);
      // Rollback khi exception
      if (prevScene) {
        try {
          await prevScene.load();
          this.currentScene = prevScene;
        } catch (rollbackErr) {
          console.error("❌ Rollback failed:", rollbackErr);
        }
      }
      await this._fadeIn();
      return false;
    } finally {
      this.isTransitioning = false;
    }
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  public getCurrentScene(): BaseScene | null {
    return this.currentScene;
  }

  public getScene(sceneName: string): BaseScene | null {
    return this.scenes.get(sceneName) ?? null;
  }

  public isTransitioningNow(): boolean {
    return this.isTransitioning;
  }

  public setTransitionDuration(duration: number): void {
    this.transitionDuration = duration;
  }

  public getTransitionDuration(): number {
    return this.transitionDuration;
  }

  // ── Update / Render ────────────────────────────────────────────────────────

  public update(deltaTime: number): void {
    this.currentScene?.update(deltaTime);
  }

  public render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.currentScene?.render(renderer, camera);
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  /** await đúng cách, không leak */
  public async dispose(): Promise<void> {
    await Promise.all([...this.scenes.values()].map((s) => s.unload()));
    this.scenes.clear();
    this.currentScene = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  public debug(): string[] {
    return Array.from(this.scenes.keys());
  }

  // ── Fade helpers ───────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position:       "fixed",
      inset:          "0",
      background:     "#000",
      opacity:        "0",
      pointerEvents:  "none",
      zIndex:         "999",
      transition:     `opacity ${this.transitionDuration}s ease`,
    });
    document.body.appendChild(el);
    this.overlay = el;
  }

  private _fadeOut(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.overlay) { resolve(); return; }
      this.overlay.style.transition = `opacity ${this.transitionDuration}s ease`;
      this.overlay.style.opacity = "1";
      setTimeout(resolve, this.transitionDuration * 1000);
    });
  }

  private _fadeIn(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.overlay) { resolve(); return; }
      this.overlay.style.transition = `opacity ${this.transitionDuration}s ease`;
      this.overlay.style.opacity = "0";
      setTimeout(resolve, this.transitionDuration * 1000);
    });
  }
}
