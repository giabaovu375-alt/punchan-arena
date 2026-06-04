/**
 * RightPlatformScene - Khu Đá Platform (Phải)
 */

import { BaseScene } from './BaseScene';

export class RightPlatformScene extends BaseScene {
  constructor() {
    super('RightPlatformScene');
  }

  protected async onLoad(): Promise<void> {
    console.log('⛰️ RightPlatformScene loading...');
    
    // TODO: Setup right platform scene
    
    console.log('✅ RightPlatformScene loaded!');
  }

  protected async onUnload(): Promise<void> {
    console.log('⛰️ RightPlatformScene unloading...');
  }

  protected onUpdate(deltaTime: number): void {
    // Update logic
  }
}
