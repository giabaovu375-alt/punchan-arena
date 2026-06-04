/**
 * MainRoadScene - Đường chính uốn lượn
 * Level chính của game
 */

import { BaseScene } from './BaseScene';

export class MainRoadScene extends BaseScene {
  constructor() {
    super('MainRoadScene');
  }

  protected async onLoad(): Promise<void> {
    console.log('🛣️ MainRoadScene loading...');
    
    // TODO:
    // 1. Setup lighting
    // 2. Load terrain/ground
    // 3. Load trees/obstacles
    // 4. Setup portals (to hub, to intro)
    // 5. Setup colliders
    // 6. Place enemies
    
    console.log('✅ MainRoadScene loaded!');
  }

  protected async onUnload(): Promise<void> {
    console.log('🛣️ MainRoadScene unloading...');
  }

  protected onUpdate(deltaTime: number): void {
    // Update logic
  }
}
