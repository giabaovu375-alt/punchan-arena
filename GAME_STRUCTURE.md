# Game Structure Documentation

Cấu trúc project game Punchan Arena

## 📁 Folder Structure

```
src/
├── game/                              # 🎮 Game logic (NEW)
│   ├── core/
│   │   ├── GameEngine.ts              # Vòng lặp game chính
│   │   ├── SceneManager.ts            # Quản lý scenes & chuyển scene
│   │   ├── GameWorld.ts               # Quản lý objects, physics, collisions
│   │   └── EventBus.ts                # Event system
│   │
│   ├── scenes/
│   │   ├── BaseScene.ts               # Lớp trừu tượng
│   │   ├── SpawnScene.ts              # Nơi bắt đầu
│   │   ├── MainRoadScene.ts           # Đường chính
│   │   ├── HubScene.ts                # Cây Đỏ Khổng Lồ
│   │   ├── LeftForestScene.ts         # Rừng Mật (Trái)
│   │   ├── RightPlatformScene.ts      # Khu Đá Platform (Phải)
│   │   ├── BossScene.ts               # Boss Arena
│   │   └── index.ts
│   │
│   ├── controllers/
│   │   ├── PlayerController.ts        # Xử lý input & di chuyển
│   │   ├── BossController.ts          # AI Boss
│   │   └── GameLoopController.ts      # Quản lý Update/Draw loop
│   │
│   ├── types/
│   │   ├── sceneTypes.ts              # Types cho scenes
│   │   └── events.ts                  # Event definitions
│   │
│   ├── data/
│   │   └── levelConfig.ts             # Config cho từng level
│   │
│   ├── ui/
│   │   └── SceneTransition.ts         # Hiệu ứng chuyển màn
│   │
│   └── utils/
│       ├── math.ts                    # Hàm toán học
│       ├── inputHelper.ts             # Quản lý input
│       └── loader.ts                  # Tải assets
│
├── components/                        # React components (cũ)
├── routes/                            # React routes (cũ)
├── hooks/                             # React hooks (cũ)
└── lib/                               # Utilities (cũ)
```

## 🎯 Cách Sử Dụng

### Import scenes
```typescript
import { SpawnScene, MainRoadScene, HubScene } from '@/game/scenes';
```

### Import controllers
```typescript
import { PlayerController } from '@/game/controllers/PlayerController';
import { BossController } from '@/game/controllers/BossController';
```

### Import utilities
```typescript
import { distance, clamp, lerp } from '@/game/utils/math';
import { InputHelper } from '@/game/utils/inputHelper';
```

### Import types & config
```typescript
import { GameEvents } from '@/game/types/events';
import { levelConfigs } from '@/game/data/levelConfig';
```

## 📡 Event System

Sử dụng EventBus để giao tiếp giữa modules:

```typescript
import { eventBus, GameEvents } from '@/game/types/events';

// Đăng ký
eventBus.on(GameEvents.PLAYER_ATTACKED, (data) => {
  console.log('Player attacked:', data);
});

// Phát sự kiện
eventBus.emit(GameEvents.PLAYER_ATTACKED, { damage: 10 });
```

## 🎬 Scene Flow

```
SceneManager.switchScene('MainRoadScene')
  ↓
CurrentScene.load()
  ├─ onLoad() - Initialize objects
  ├─ onUpdate(deltaTime) - mỗi frame
  ├─ onRender() - Render graphics
  └─ onUnload() - Cleanup
```

---

**Tạo bởi Copilot** 🚀
