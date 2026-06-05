import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BaseScene } from './BaseScene';
import { eventBus } from '../core/EventBus';
import { GameEvents } from '../types/events';

import { HUB_SPAWN } from './hub/HubConfig';
import { setupLighting } from './hub/HubLighting';
import { setupGround } from './hub/HubGround';
import { setupEnvironment, loadAllModels, type Collider } from './hub/HubEnvironment';
import { setupPortals, type PortalMarker } from './hub/HubPortal';
import { createLeafParticles, tickLeafParticles, type LeafParticleSystem } from './hub/HubParticles';

export class HubScene extends BaseScene {
  private loader: GLTFLoader;
  private modelCache: Map<string, THREE.Group> = new Map();
  private portalMarkers: PortalMarker[] = [];
  private particleSystem: LeafParticleSystem | null = null;
  private colliders: Collider[] = [];
  private elapsed = 0;

  public scene: THREE.Scene; // public để GameEngine gán

  constructor() {
    super('HubScene');
    this.loader = new GLTFLoader();
    this.scene = new THREE.Scene();
  }

  protected async onLoad(): Promise<void> {
    console.log('🌅 HubScene loading...');

    try {
      // Load model
      this.modelCache = await loadAllModels(this.loader);

      // Setup cảnh
      setupLighting(this.scene);
      setupGround(this.scene);
      this.colliders = await setupEnvironment(this.scene, this.modelCache);
      this.portalMarkers = setupPortals(this.scene);
      this.particleSystem = createLeafParticles(this.scene);

      console.log('✅ HubScene loaded (sunset edition)!');
      eventBus.emit(GameEvents.SCENE_LOADED, { sceneName: 'HubScene' });
    } catch (error) {
      console.error('Error loading HubScene:', error);
      throw error;
    }
  }

  protected async onUnload(): Promise<void> {
    console.log('🌅 HubScene unloading...');
    this.modelCache.clear();
    this.portalMarkers = [];
    this.particleSystem = null;
    this.colliders = [];
  }

  protected onUpdate(deltaTime: number): void {
    this.elapsed += deltaTime;

    // Portal ring xoay
    for (const marker of this.portalMarkers) {
      if (marker.mesh.children[0]) {
        marker.mesh.children[0].rotation.z += deltaTime * 0.3;
      }
    }

    // Particles
    if (this.particleSystem) {
      tickLeafParticles(this.particleSystem, deltaTime);
    }
  }

  public update(deltaTime: number): void {
    if (typeof (this as any).onUpdate === 'function') {
      (this as any).onUpdate(deltaTime);
    } else {
      this.onUpdate(deltaTime);
    }
  }

  public checkPortals(playerPos: THREE.Vector3): string | null {
    if (!this.portalMarkers || this.portalMarkers.length === 0) return null;
    for (const marker of this.portalMarkers) {
      const dx = playerPos.x - marker.position.x;
      const dz = playerPos.z - marker.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < marker.radius) {
        return marker.targetScene;
      }
    }
    return null;
  }

  /** Trả về danh sách collider cho PlayerController */
  public getColliders(): Collider[] {
    return this.colliders;
  }
  }
