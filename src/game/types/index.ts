// src/game/types/index.ts

// Re-export các type & hằng số gốc từ file types.ts trong thư mục types/
export {
  ANIM_KEYS,
  COMBAT_ANIMS,
  COMBO_CHAIN,
} from "./types";

export type {
  AnimKey,
  AnimClipMap,
  InputState,
  JoystickState,
} from "./types";

// Re-export các type liên quan đến Scene
export type {
  PortalConfig,
  LevelConfig,
  SceneLoadResult,
} from "./sceneTypes";

// Re-export các sự kiện
export {
  GameEvents,
} from "./events";
