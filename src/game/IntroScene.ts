// IntroScene.ts – Bản tối ưu, sạch lỗi bất đồng bộ
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ── Cấu hình ─────────────────────────────────────────────────────────────────
const PROXY = "https://hf-proxy.giabaovu375.workers.dev";
const GREEN_MODEL_NAMES = [
  "CommonTree_1",
  "CommonTree_2",
  "CommonTree_3",
  "CommonTree_4",
];

export const NPC_POSITION = new THREE.Vector3(0, 0, -22);
export const PLAYER_SPAWN  = new THREE.Vector3(0, 0, 10);

const TREE_PAIRS = [
  { z: 6 }, { z: 2 }, { z: -2 },
  { z: -6 }, { z: -10 }, { z: -14 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function getFirstMesh(group: THREE.Group): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  group.traverse((obj) => {
    if (!found && (obj as THREE.Mesh).isMesh) found = obj as THREE.Mesh;
  });
  return found;
}

function applyShadows(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

// ── Loader toàn cục (dùng cache của Three.js) ────────────────────────────────
THREE.Cache.enabled = true;
const gltfLoader = new GLTFLoader();
gltfLoader.setCrossOrigin("anonymous");

interface CustomGLTFResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/** Load một model GLTF và trả về cả scene lẫn animation */
async function loadGLTF(url: string): Promise<CustomGLTFResult> {
  try {
    const gltf = await gltfLoader.loadAsync(url);
    return { scene: gltf.scene, animations: gltf.animations };
  } catch (err) {
    console.error(`❌ Không load được ${url}`, err);
    return { scene: new THREE.Group(), animations: [] };
  }
}

// ── Xây dựng cảnh ───────────────────────────────────────────────────────────
export interface IntroSceneHandles {
  npcMixer: THREE.AnimationMixer | null;
  checkNPCProximity: (playerPos: THREE.Vector3) => boolean;
}

export function buildIntroScene(
  globalScene: THREE.Scene, // Đổi tên để tránh xung đột với biến callback
  isMobile = false,
): IntroSceneHandles {
  // ── Ánh sáng ──────────────────────────────────────────────────────────────
  globalScene.add(new THREE.HemisphereLight(0xfff1d9, 0x3a4a2a, 0.8));

  const sun = new THREE.DirectionalLight(0xfff3d0, 1.4);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  const shadowRes = isMobile ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  sun.shadow.camera.left   = -30;
  sun.shadow.camera.right  =  30;
  sun.shadow.camera.top    =  30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near   = 0.5;
  sun.shadow.camera.far    = 120;
  sun.shadow.bias          = -0.0005;
  globalScene.add(sun);

  // ── Mặt đất & con đường ───────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 60),
    new THREE.MeshStandardMaterial({
      color: 0x6b8e4e,
      roughness: 0.95,
      flatShading: true,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  globalScene.add(ground);

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 60),
    new THREE.MeshStandardMaterial({ color: 0xa89368, roughness: 1 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.01;
  path.receiveShadow = true;
  globalScene.add(path);

  // ── Cây xanh: InstancedMesh ───────────────────────────────────────────────
  const modelInstances: Record<
    string,
    { z: number; x: number; rotation: number; scale: number }[]
  > = {};
  GREEN_MODEL_NAMES.forEach((name) => (modelInstances[name] = []));

  TREE_PAIRS.forEach((pair, i) => {
    const modelName = GREEN_MODEL_NAMES[i % GREEN_MODEL_NAMES.length];
    const scale = 0.9 + (i % 3) * 0.1;

    modelInstances[modelName].push({ z: pair.z, x: -5, rotation: i * 0.7, scale });
    modelInstances[modelName].push({ z: pair.z, x: 5, rotation: i * 1.1 + Math.PI, scale });
  });

  GREEN_MODEL_NAMES.forEach((modelName) => {
    const instances = modelInstances[modelName];
    if (instances.length === 0) return;

    const url = `${PROXY}/model-tree/${modelName}.gltf`;
    loadGLTF(url).then((res) => {
      const mesh = getFirstMesh(res.scene);
      if (!mesh) return;

      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, instances.length);
      im.castShadow = true;
      im.receiveShadow = true;

      const dummy = new THREE.Object3D();
      instances.forEach((inst, idx) => {
        dummy.position.set(inst.x, 0, inst.z);
        dummy.scale.setScalar(inst.scale);
        dummy.rotation.set(0, inst.rotation, 0);
        dummy.updateMatrix();
        im.setMatrixAt(idx, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      globalScene.add(im); // Đã sửa: Add vào globalScene
    });
  });

  // ── Cây đỏ ─────────────────────────────────────────────────────────────────
  loadGLTF(`${PROXY}/model-tree/TwistedTree_1.gltf`).then((res) => {
    const tree = res.scene;
    tree.position.set(0, 0, -28);
    tree.scale.setScalar(1.6);
    applyShadows(tree);
    globalScene.add(tree); // Đã sửa: Add vào globalScene
  });

  // ── NPC ────────────────────────────────────────────────────────────────────
  let npcMixer: THREE.AnimationMixer | null = null;

  loadGLTF(`${PROXY}/model3.glb`).then((res) => {
    const npc = res.scene;
    npc.position.copy(NPC_POSITION);
    npc.rotation.y = Math.PI;
    npc.scale.setScalar(1);
    
    npc.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).frustumCulled = false;
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    globalScene.add(npc); // Đã sửa: Add vào globalScene

    if (res.animations?.length) {
      npcMixer = new THREE.AnimationMixer(npc);
      npcMixer.clipAction(res.animations[0]).play(); // Đã sửa: Lấy từ res.animations
    }
  });

  // ── Indicator "!" ──────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffdd00";
  ctx.font = "bold 52px Arial";
  ctx.textAlign = "center";
  ctx.fillText("!", 32, 52);
  const tex = new THREE.CanvasTexture(canvas);

  const indicator = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false }),
  );
  indicator.position.copy(NPC_POSITION).add(new THREE.Vector3(0, 2.6, 0));
  indicator.scale.set(0.6, 0.6, 1);
  globalScene.add(indicator);

  return {
    get npcMixer() { return npcMixer; },
    checkNPCProximity(playerPos: THREE.Vector3) {
      return playerPos.distanceTo(NPC_POSITION) < 3.5;
    },
  };
}

/** Hàm preload chính xác */
export async function preloadIntroAssets(): Promise<void> {
  const urls = [
    ...GREEN_MODEL_NAMES.map((name) => `${PROXY}/model-tree/${name}.gltf`),
    `${PROXY}/model-tree/TwistedTree_1.gltf`,
    `${PROXY}/model3.glb`,
  ];
  // Chạy song song tất cả các request, tận dụng THREE.Cache
  await Promise.all(urls.map((url) => loadGLTF(url)));
  console.log("✅ Preload hoàn tất – Bộ nhớ cache đã sẵn sàng!");
}

export function tickIntroScene(handles: IntroSceneHandles, dt: number) {
  handles.npcMixer?.update(dt);
}
