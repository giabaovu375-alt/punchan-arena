/**
 * SceneManager - Quản lý các scene và chuyển scene
 * Chịu trách nhiệm: Load, Unload, Switch scenes, Portal transitions
 */

import * as THREE from 'three';
import { eventBus } from './EventBus';
import { GameEvents } from '../types/events';
import type { BaseScene } from '../scenes/BaseScene';

export class SceneManager {
  private scenes: Map<string, BaseScene> = new Map();
  private currentScene: BaseScene | null = null;
  private isTransitioning: boolean = false;
  private transitionDuration: number = 0.5; // seconds

  constructor() {
    // Subscribe to portal enter events
    eventBus.on(GameEvents.PORTAL_ENTERED, (data) => {
      if (data?.targetScene) {
        this.switchScene(data.targetScene, data.spawnPos);
      }
    });
  }

  /**
   * Đăng ký một scene
   */
  public registerScene(scene: BaseScene): void {
    const sceneName = scene.getName();
    this.scenes.set(sceneName, scene);
    console.log(`✅ Scene registered: ${sceneName}`);
  }

  /**
   * Chuyển sang scene khác
   */
  public async switchScene(
    sceneName: string,
    spawnPos?: { x: number; z: number }
  ): Promise<boolean> {
    if (this.isTransitioning) {
      console.warn('⚠️ Đang chuyển scene, vui lòng chờ...');
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
    eventBus.emit(GameEvents.SCENE_TRANSITION_START, { 
      fromScene: this.currentScene?.getName(), 
      toScene: sceneName 
    });

    try {
      // Unload current scene
      if (this.currentScene) {
        await this.currentScene.unload();
      }

      // Load next scene
      const result = await nextScene.load();
      if (!result.success) {
        console.error(`Failed to load scene ${sceneName}: ${result.error}`);
        this.isTransitioning = false;
        return false;
      }

      this.currentScene = nextScene;

      // Emit spawn event with spawn position
      if (spawnPos) {
        eventBus.emit(GameEvents.PLAYER_SPAWN, { 
          sceneName, 
          pos: spawnPos 
        });
      }

      eventBus.emit(GameEvents.SCENE_TRANSITION_END, { sceneName });
      console.log(`✅ Scene switched to: ${sceneName}`);
      return true;
    } catch (error) {
      console.error(`Error switching scene to ${sceneName}:`, error);
      return false;
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Lấy scene hiện tại
   */
  public getCurrentScene(): BaseScene | null {
    return this.currentScene;
  }

  /**
   * Lấy scene theo tên
   */
  public getScene(sceneName: string): BaseScene | null {
    return this.scenes.get(sceneName) || null;
  }

  /**
   * Update scene hiện tại
   */
  public update(deltaTime: number): void {
    if (this.currentScene) {
      this.currentScene.update(deltaTime);
    }
  }

  /**
   * Render scene hiện tại
   */
  public render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.currentScene) {
      this.currentScene.render(renderer, camera);
    }
  }

  /**
   * Kiểm tra xem có đang chuyển scene không
   */
  public isTransitioningNow(): boolean {
    return this.isTransitioning;
  }

  /**
   * Set transition duration
   */
  public setTransitionDuration(duration: number): void {
    this.transitionDuration = duration;
  }

  /**
   * Get transition duration
   */
  public getTransitionDuration(): number {
    return this.transitionDuration;
  }

  /**
   * Dispose all scenes
   */
  public dispose(): void {
    for (const scene of this.scenes.values()) {
      scene.unload();
    }
    this.scenes.clear();
    this.currentScene = null;
  }

  /**
   * Debug: list all registered scenes
   */
  public debug(): string[] {
    return Array.from(this.scenes.keys());
  }
}
