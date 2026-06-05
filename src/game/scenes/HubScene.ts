import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BaseScene } from "./BaseScene";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import { collisionManager } from "../core/CollisionManager";

import { ALL_MODEL_NAMES, MODEL_BASE } from "./hub/HubConfig";
import { setupLighting } from "./hub/HubLighting";
import { setupGround } from "./hub/HubGround";
import { optimizeHubScene } from "./hub/HubCollisionOptimizer";
import { setupPortals, type PortalMarker } from "./hub/HubPortal";
import { createLeafParticles, tickLeafParticles, type LeafParticleSystem } from "./hub/HubParticles";

async function loadAllModels(loader: GLTFLoader): Promise<Map<string, THREE.Group>> {
  const cache = new Map<string, THREE.Group>();
  const unique = [...new Set(ALL_MODEL_NAMES)];
  await Promise.all(unique.map(name =>
    new Promise<void>((resolve) => {
      loader.load(
        `${MODEL_BASE}/${name}.gltf`,
        (gltf) => { cache.set(name, gltf.scene); resolve(); },
        undefined,
        (err) => { console.warn(`⚠️ Không load được ${name}`, err); resolve(); }
      );
    })
  ));
  return cache;
}

export class HubScene extends BaseScene {
  private loader = new GLTFLoader();
  private modelCache: Map<string, THREE.Group> = new Map();
  private portalMarkers: PortalMarker[] = [];
  private particleSystem: LeafParticleSystem | null = null;
  private elapsed = 0;

  public scene: THREE.Scene;

  constructor() {
    super("HubScene");
    this.scene = new THREE.Scene();
  }

  protected async onLoad(): Promise<void> {
    console.log("🌅 HubScene loading...");
    try {
      this.modelCache = await loadAllModels(this.loader);
      setupLighting(this.scene);
      setupGround(this.scene);
      optimizeHubScene(this.scene, this.modelCache); // Tối ưu + Collider
      this.portalMarkers = setupPortals(this.scene);
      this.particleSystem = createLeafParticles(this.scene);
      console.log("✅ HubScene loaded!");
      eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: "HubScene" });
    } catch (error) {
      console.error("Error loading HubScene:", error);
      throw error;
    }
  }

  protected async onUnload(): Promise<void> {
    console.log("🌅 HubScene unloading...");
    collisionManager.clear(); // XÓA TOÀN BỘ COLLIDER
    this.modelCache.clear();
    this.portalMarkers = [];
    this.particleSystem = null;
  }

  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0]) marker.mesh.children[0].rotation.z += deltaTime * 0.3;
    }
    if (this.particleSystem) tickLeafParticles(this.particleSystem, deltaTime);
  }

  public update(deltaTime: number): void {
    this.onUpdate(deltaTime);
  }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    if (!this.portalMarkers.length) return null;
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < marker.radius) return marker.targetScene;
    }
    return null;
  }
}
