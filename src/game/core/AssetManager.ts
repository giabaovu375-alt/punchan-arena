import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

const PROXY_BASE = "https://hf-proxy.giabaovu375.workers.dev";

const ALL_ASSET_URLS: string[] = [
  // ── Model cây (local public/model-tree) ──────────────────────────────
  "/model-tree/CommonTree_1.gltf",
  "/model-tree/CommonTree_2.gltf",
  "/model-tree/CommonTree_3.gltf",
  "/model-tree/CommonTree_4.gltf",
  "/model-tree/CommonTree_5.gltf",
  "/model-tree/TwistedTree_1.gltf",
  "/model-tree/TwistedTree_2.gltf",
  "/model-tree/TwistedTree_3.gltf",
  "/model-tree/TwistedTree_5.gltf",
  "/model-tree/Pine_1.gltf",
  "/model-tree/Pine_2.gltf",
  "/model-tree/Pine_3.gltf",
  "/model-tree/DeadTree_1.gltf",
  "/model-tree/DeadTree_2.gltf",
  "/model-tree/DeadTree_3.gltf",
  "/model-tree/Bush_Common.gltf",
  "/model-tree/Bush_Common_Flowers.gltf",
  "/model-tree/Fern_1.gltf",
  "/model-tree/Mushroom_Common.gltf",
  "/model-tree/Mushroom_Laetiporus.gltf",
  "/model-tree/Plant_1.gltf",
  "/model-tree/Plant_7.gltf",
  "/model-tree/Rock_Medium_1.gltf",
  "/model-tree/Rock_Medium_2.gltf",
  "/model-tree/Rock_Medium_3.gltf",
  "/model-tree/Grass_Common_Short.gltf",
  "/model-tree/Grass_Common_Tall.gltf",
  "/model-tree/Grass_Wispy_Short.gltf",
  "/model-tree/Grass_Wispy_Tall.gltf",
  "/model-tree/Clover_1.gltf",
  "/model-tree/Clover_2.gltf",
  "/model-tree/Petal_1.gltf",
  "/model-tree/Petal_2.gltf",
  "/model-tree/Pebble_Round_1.gltf",
  "/model-tree/Pebble_Round_2.gltf",
  "/model-tree/Pebble_Round_3.gltf",
  "/model-tree/Pebble_Square_1.gltf",
  "/model-tree/Pebble_Square_2.gltf",
  "/model-tree/Flower_3_Group.gltf",
  "/model-tree/Flower_4_Group.gltf",

  // ── Model nhân vật (qua proxy) ───────────────────────────────────────
  `${PROXY_BASE}/player.glb`,     // Player chính
`${PROXY_BASE}/model.glb`, 
  `${PROXY_BASE}/model1.glb`,     // Nhân vật 1
  `${PROXY_BASE}/model2.glb`,     // Nhân vật 2
  `${PROXY_BASE}/model3.glb`,     // NPC
];

export class AssetManager {
  private loader: GLTFLoader;
  private cache = new Map<string, THREE.Group>();

  constructor() {
    const manager = new THREE.LoadingManager();
    this.loader = new GLTFLoader(manager);
    THREE.Cache.enabled = true;
  }

  async preloadAll(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    console.log(`📦 [AssetManager] Preloading ${ALL_ASSET_URLS.length} assets...`);

    const total = ALL_ASSET_URLS.length;
    let loadedCount = 0;
    const CONCURRENCY_LIMIT = 6;

    const pool = [...ALL_ASSET_URLS];
    const workers = Array(CONCURRENCY_LIMIT).fill(null).map(async () => {
      while (pool.length > 0) {
        const url = pool.shift();
        if (!url) break;

        try {
          const group = await this.loadModelAsync(url);
          if (group) {
            this.cache.set(url, group);
          }
        } catch (err) {
          console.warn(`⚠️ [AssetManager] Bỏ qua lỗi tải: ${url}`);
        } finally {
          loadedCount++;
          if (onProgress) onProgress(loadedCount, total);
        }
      }
    });

    await Promise.all(workers);
    console.log("✅ [AssetManager] Tất cả asset đã sẵn sàng!");
  }

  get(key: string): THREE.Group | null {
    const base = this.cache.get(key);
    if (!base) {
      console.error(`❌ [AssetManager] Không tìm thấy asset: ${key}`);
      return null;
    }
    return base.clone();
  }

  private loadModelAsync(url: string): Promise<THREE.Group | null> {
    return new Promise((resolve) => {
      this.loader.load(
        url,
        (gltf: GLTF) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          resolve(gltf.scene);
        },
        undefined,
        (err) => {
          console.error(`❌ Thất bại khi tải: ${url}`, err);
          resolve(null);
        }
      );
    });
  }

  clear() {
    this.cache.clear();
  }
  }
