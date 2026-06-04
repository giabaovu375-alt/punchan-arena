/**
 * HubScene - Cây Đỏ Khổng Lồ + HUB
 * Nơi trung tâm, nơi gặp NPC, quân bại địch
 */

import { BaseScene } from './BaseScene';
import { eventBus } from '../core/EventBus';
import { GameEvents } from '../types/events';

export class HubScene extends BaseScene {
  constructor() {
    super('HubScene');
  }

  protected async onLoad(): Promise<void> {
    console.log('🌳 HubScene loading...');
    
    // TODO: 
    // 1. Setup lighting
    // 2. Load terrain/ground
    // 3. Load Cây Đỏ Khổng Lồ model
    // 4. Setup portals (left, right, boss, main_road)
    // 5. Setup colliders
    // 6. Place NPCs/enemies
    
    console.log('✅ HubScene loaded!');
  }

  protected async onUnload(): Promise<void> {
    console.log('🌳 HubScene unloading...');
    // Cleanup
  }

  protected onUpdate(deltaTime: number): void {
    // Update logic
  }
}
