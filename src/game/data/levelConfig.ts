/**
 * Level Config - Configuration cho từng level/scene
 */

import type { LevelConfig } from '../types/sceneTypes';

export const levelConfigs: Record<string, LevelConfig> = {
  IntroScene: {
    name: 'Intro',
    description: 'Nơi bắt đầu câu chuyện',
    difficulty: 'easy',
    width: 40,
    height: 60,
    spawnPos: { x: 0, z: 10 },
    portals: [
      {
        id: 'portal_to_main_road',
        x: 0,
        z: -28,
        width: 3,
        height: 3,
        targetScene: 'MainRoadScene',
        targetSpawnPos: { x: 0, z: 50 },
      },
    ],
  },

  MainRoadScene: {
    name: 'Main Road',
    description: 'Đường chính uốn lượn',
    difficulty: 'normal',
    width: 200,
    height: 300,
    spawnPos: { x: 0, z: 50 },
    portals: [
      {
        id: 'portal_to_hub',
        x: 0,
        z: 150,
        width: 5,
        height: 5,
        targetScene: 'HubScene',
        targetSpawnPos: { x: 0, z: 30 },
      },
      {
        id: 'portal_to_intro',
        x: 0,
        z: -50,
        width: 3,
        height: 3,
        targetScene: 'IntroScene',
        targetSpawnPos: { x: 0, z: -28 },
      },
    ],
  },

  HubScene: {
    name: 'Hub - Cây Đỏ Khổng Lồ',
    description: 'Trung tâm - Nơi gặp NPC & quân bại địch',
    difficulty: 'easy',
    width: 150,
    height: 150,
    spawnPos: { x: 0, z: 30 },
    portals: [
      {
        id: 'portal_to_main_road',
        x: 0,
        z: -30,
        width: 5,
        height: 5,
        targetScene: 'MainRoadScene',
        targetSpawnPos: { x: 0, z: 150 },
      },
      {
        id: 'portal_to_left_forest',
        x: -40,
        z: 0,
        width: 5,
        height: 5,
        targetScene: 'LeftForestScene',
        targetSpawnPos: { x: 30, z: 0 },
      },
      {
        id: 'portal_to_right_platform',
        x: 40,
        z: 0,
        width: 5,
        height: 5,
        targetScene: 'RightPlatformScene',
        targetSpawnPos: { x: -30, z: 0 },
      },
      {
        id: 'portal_to_boss',
        x: 0,
        z: 50,
        width: 5,
        height: 5,
        targetScene: 'BossScene',
        targetSpawnPos: { x: 0, z: -40 },
      },
    ],
  },

  LeftForestScene: {
    name: 'Left Forest - Rừng Mật',
    description: 'Khu vực phía trái',
    difficulty: 'hard',
    width: 150,
    height: 150,
    spawnPos: { x: 30, z: 0 },
    portals: [
      {
        id: 'portal_to_hub',
        x: -30,
        z: 0,
        width: 5,
        height: 5,
        targetScene: 'HubScene',
        targetSpawnPos: { x: -40, z: 0 },
      },
    ],
  },

  RightPlatformScene: {
    name: 'Right Platform - Khu Đá',
    description: 'Khu vực phía phải với platform',
    difficulty: 'hard',
    width: 150,
    height: 150,
    spawnPos: { x: -30, z: 0 },
    portals: [
      {
        id: 'portal_to_hub',
        x: 30,
        z: 0,
        width: 5,
        height: 5,
        targetScene: 'HubScene',
        targetSpawnPos: { x: 40, z: 0 },
      },
    ],
  },

  BossScene: {
    name: 'Boss Arena - Cao Nguyên',
    description: 'Nơi gặp Boss cuối cùng',
    difficulty: 'boss',
    width: 200,
    height: 200,
    spawnPos: { x: 0, z: -40 },
    portals: [
      {
        id: 'portal_exit',
        x: 0,
        z: 50,
        width: 5,
        height: 5,
        targetScene: 'HubScene',
        targetSpawnPos: { x: 0, z: 50 },
      },
    ],
  },
};

/**
 * Get level config by scene name
 */
export function getLevelConfig(sceneName: string): LevelConfig | null {
  return levelConfigs[sceneName] || null;
}
