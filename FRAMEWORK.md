/**
 * Game Framework Documentation
 */

# 🎮 Punchan Arena - Game Framework

## 📁 Cấu Trúc

```
src/game/
├── core/
│   ├── EventBus.ts        - Central event system
│   ├── SceneManager.ts    - Scene management & transitions
│   └── index.ts
├── scenes/
│   ├── BaseScene.ts       - Abstract base class
│   ├── HubScene.ts        - Cây Đỏ Khổng Lồ
│   ├── MainRoadScene.ts   - Đường chính
│   ├── LeftForestScene.ts - Rừng Mật
│   ├── RightPlatformScene.ts - Khu Đá
│   ├── BossScene.ts       - Boss Arena
│   └── index.ts
├── types/
│   ├── events.ts          - Game events
│   ├── sceneTypes.ts      - Scene types
│   └── index.ts
├── data/
│   ├── levelConfig.ts     - Level configurations
│   └── index.ts
├── controllers/
│   ├── PlayerController.ts (existing)
│   ├── AnimationController.ts (existing)
│   └── ...
├── utils/
│   ├── math.ts            - Math utilities
│   ├── sceneHelper.ts     - Scene creation helpers
│   └── index.ts
└── ui/
    └── (existing UI files)
```

## 🎯 Cách Sử Dụng

### 1. Setup SceneManager

```typescript
import { SceneManager } from '@/game/core';
import { HubScene, MainRoadScene } from '@/game/scenes';

const sceneManager = new SceneManager();
sceneManager.registerScene(new HubScene());
sceneManager.registerScene(new MainRoadScene());

// Switch scene
await sceneManager.switchScene('HubScene');
```

### 2. Listen to Events

```typescript
import { eventBus, GameEvents } from '@/game/core';

eventBus.on(GameEvents.SCENE_LOADED, (data) => {
  console.log('Scene loaded:', data.sceneName);
});

eventBus.on(GameEvents.PLAYER_SPAWN, (data) => {
  console.log('Player spawned at:', data.pos);
});
```

### 3. Create Custom Scene

```typescript
import { BaseScene } from '@/game/scenes';
import { setupLighting, createGround } from '@/game/utils';

export class MyScene extends BaseScene {
  protected async onLoad(): Promise<void> {
    // Setup lighting
    setupLighting(this.scene, false);
    
    // Create ground
    const ground = createGround(200, 300);
    this.scene.add(ground);
    
    // TODO: Add models, portals, etc.
  }

  protected async onUnload(): Promise<void> {
    // Cleanup
  }

  protected onUpdate(deltaTime: number): void {
    // Update logic
  }
}
```

## 📡 Event System

### Core Events

- `SCENE_LOADED` - Scene loaded
- `SCENE_UNLOADED` - Scene unloaded
- `SCENE_TRANSITION_START` - Transition started
- `SCENE_TRANSITION_END` - Transition ended
- `PLAYER_SPAWN` - Player spawned at position
- `PORTAL_ENTERED` - Player entered portal
- `PLAYER_ATTACKED` - Player attacked
- `ENEMY_DEFEATED` - Enemy defeated
- And more...

### Emit Events

```typescript
import { eventBus, GameEvents } from '@/game/core';

eventBus.emit(GameEvents.PORTAL_ENTERED, {
  targetScene: 'HubScene',
  spawnPos: { x: 0, z: 30 }
});
```

## 🌍 Scene Transitions

Portal detection & transitions được handle tự động qua `BaseScene`:

```typescript
// In your update loop (GameEngine or similar)
const targetScene = currentScene.checkPortalCollision(playerPos);
if (targetScene) {
  const spawnPos = currentScene.getPortalSpawnPos(targetScene);
  sceneManager.switchScene(targetScene, spawnPos);
}
```

## 📦 Level Configs

Mỗi scene có config định nghĩa portals, spawn positions, difficulty, v.v:

```typescript
// src/game/data/levelConfig.ts
HubScene: {
  name: 'Hub - Cây Đỏ Khổng Lồ',
  difficulty: 'easy',
  spawnPos: { x: 0, z: 30 },
  portals: [
    { id: 'portal_to_main_road', x: 0, z: -30, ... },
    { id: 'portal_to_left_forest', x: -40, z: 0, ... },
    ...
  ]
}
```

## 🛠️ Utilities

### Math

```typescript
import { distance, lerp, clamp, randomRange } from '@/game/utils';

const dist = distance(x1, z1, x2, z2);
const value = lerp(a, b, t);
```

### Scene Helpers

```typescript
import { createGround, createPath, setupLighting } from '@/game/utils';

const ground = createGround(200, 300, 0x6b8e4e);
const path = createPath(4, 200, 0xa89368);
setupLighting(scene, isMobile);
```

## 🎮 Integration with GameEngine

```typescript
import { SceneManager } from '@/game/core';

export class GameEngine {
  private sceneManager: SceneManager;

  constructor() {
    this.sceneManager = new SceneManager();
    this.setupScenes();
    this.start();
  }

  private setupScenes() {
    // Register all scenes
    this.sceneManager.registerScene(new HubScene());
    this.sceneManager.registerScene(new MainRoadScene());
    // ...
  }

  private update(dt: number) {
    this.sceneManager.update(dt);
    
    // Check portal collisions
    const currentScene = this.sceneManager.getCurrentScene();
    if (currentScene && this.player) {
      const targetScene = currentScene.checkPortalCollision(this.player.position);
      if (targetScene) {
        const spawnPos = currentScene.getPortalSpawnPos(targetScene);
        this.sceneManager.switchScene(targetScene, spawnPos);
      }
    }
  }

  private render(renderer: THREE.WebGLRenderer) {
    this.sceneManager.render(renderer, this.camera);
  }
}
```

## 📝 TODO - Next Steps

1. **Implement scene content** - Add models, terrain, NPCs to each scene
2. **Add colliders** - Setup collision detection
3. **Enemies & AI** - Add enemy spawning & behavior
4. **Quests** - Implement quest system
5. **Save/Load** - Add game state persistence

---

**Happy coding!** 🚀
