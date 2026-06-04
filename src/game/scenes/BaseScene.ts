/**
 * BaseScene - Abstract base class for all scenes
 * Các scene khác sẽ kế thừa từ lớp này
 */

import * as THREE from 'three';
import { eventBus } from '../core/EventBus';
import { GameEvents } from '../types/events';
import type { LevelConfig, SceneLoadResult } from '../types/sceneTypes';
import { getLevelConfig } from '../data/levelConfig';

export abstract class BaseScene {
  protected name: string;
  protected scene: THREE.Scene;
  protected levelConfig: LevelConfig | null;
  protected loaded: boolean = false;
  protected portals: Map<string, THREE.Object3D> = new Map();

  constructor(name: string) {
    this.name = name;
    this.scene = new THREE.Scene();
    this.levelConfig = getLevelConfig(name);
  }

  /**
   * Load scene - gọi khi scene được chuyển đến
   */
  public async load(): Promise<SceneLoadResult> {
    try {
      console.log(`📦 Loading scene: ${this.name}`);
      await this.onLoad();
      this.loaded = true;
      eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: this.name });
      return { success: true };
    } catch (error) {
      console.error(`Error loading scene ${this.name}:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Unload scene - gọi khi chuyển sang scene khác
   */
  public async unload(): Promise<void> {
    try {
      console.log(`🗑️ Unloading scene: ${this.name}`);
      await this.onUnload();
      this.loaded = false;
      eventBus.emit(GameEvents.SCENE_UNLOADED, { sceneName: this.name });
      this.cleanup();
    } catch (error) {
      console.error(`Error unloading scene ${this.name}:`, error);
    }
  }

  /**
   * Update logic mỗi frame
   */
  public update(deltaTime: number): void {
    if (!this.loaded) return;
    this.onUpdate(deltaTime);
  }

  /**
   * Render scene
   */
  public render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.loaded) return;
    renderer.render(this.scene, camera);
  }

  /**
   * Lấy scene object
   */
  public getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Lấy tên scene
   */
  public getName(): string {
    return this.name;
  }

  /**
   * Lấy level config
   */
  public getLevelConfig(): LevelConfig | null {
    return this.levelConfig;
  }

  /**
   * Check portal collision
   */
  public checkPortalCollision(playerPos: THREE.Vector3): string | null {
    if (!this.levelConfig) return null;

    for (const portal of this.levelConfig.portals) {
      const dx = Math.abs(playerPos.x - portal.x);
      const dz = Math.abs(playerPos.z - portal.z);

      if (dx < portal.width / 2 && dz < portal.height / 2) {
        return portal.targetScene;
      }
    }

    return null;
  }

  /**
   * Get portal target spawn position
   */
  public getPortalSpawnPos(sceneName: string): { x: number; z: number } | null {
    if (!this.levelConfig) return null;

    const portal = this.levelConfig.portals.find((p) => p.targetScene === sceneName);
    return portal?.targetSpawnPos || null;
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    // Dispose geometries & materials
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    // Clear portals
    this.portals.clear();
  }

  /**
   * ────────────────────────────────────────────────────────────
   * Abstract methods - implement by subclasses
   * ────────────────────────────────────────────────────────────
   */

  /**
   * Được gọi khi scene load xong
   */
  protected abstract onLoad(): Promise<void>;

  /**
   * Được gọi khi scene unload
   */
  protected abstract onUnload(): Promise<void>;

  /**
   * Được gọi mỗi frame để update logic
   */
  protected abstract onUpdate(deltaTime: number): void;
}
