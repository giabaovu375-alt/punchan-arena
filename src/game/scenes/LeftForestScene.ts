/**
 * LeftForestScene - Rừng Mật (Trái)
 */

import { BaseScene } from './BaseScene';

export class LeftForestScene extends BaseScene {
  constructor() {
    super('LeftForestScene');
  }

  protected async onLoad(): Promise<void> {
    console.log('🌲 LeftForestScene loading...');
    
    // TODO: Setup left forest scene
    
    console.log('✅ LeftForestScene loaded!');
  }

  protected async onUnload(): Promise<void> {
    console.log('🌲 LeftForestScene unloading...');
  }

  protected onUpdate(deltaTime: number): void {
    // Update logic
  }
}
