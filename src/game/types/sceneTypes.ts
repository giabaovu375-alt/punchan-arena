/**
 * Scene Types - Define types cho scenes
 */

export interface PortalConfig {
  id: string;
  x: number;
  z: number;
  width: number;
  height: number;
  targetScene: string;
  targetSpawnPos?: { x: number; z: number };
}

export interface LevelConfig {
  name: string;
  description: string;
  difficulty: 'easy' | 'normal' | 'hard' | 'boss';
  width: number;
  height: number;
  portals: PortalConfig[];
  spawnPos: { x: number; z: number };
}

export interface SceneLoadResult {
  success: boolean;
  error?: string;
}
