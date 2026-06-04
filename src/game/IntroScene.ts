import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const PROXY = "https://hf-proxy.giabaovu375.workers.dev";

export interface IntroSceneHandles {
  npcMixer: THREE.AnimationMixer | null;
  checkNPCProximity: (playerPos: THREE.Vector3) => boolean;
}

/** Vị trí NPC — cuối đường, trước cây đỏ */
export const NPC_POSITION = new THREE.Vector3(0, 0, -22);
/** Vị trí spawn player */
export const PLAYER_SPAWN  = new THREE.Vector3(0, 0, 10);

const TREE_PAIRS: { z: number }[] = [
  { z:  6 }, { z:  2 }, { z: -2 },
  { z: -6 }, { z: -10 }, { z: -14 },
];

export function buildIntroScene(scene: THREE.Scene, isMobile = false): IntroSceneHandles {
  // ── Lighting ───────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xfff1d9, 0x3a4a2a, 0.8);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d0, 1.4);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top  =  30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // ── Ground nhỏ ─────────────────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 60),
    new THREE.MeshStandardMaterial({ color: 0x6b8e4e, roughness: 0.95, flatShading: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── Đường đi giữa ──────────────────────────────────────────────────────────
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 60),
    new THREE.MeshStandardMaterial({ color: 0xa89368, roughness: 1 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.01;
  path.receiveShadow = true;
  scene.add(path);

  // ── 2 hàng cây xanh (CommonTree) ───────────────────────────────────────────
  const loader = new GLTFLoader();
  const GREEN_MODELS = ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4"];

  for (let i = 0; i < TREE_PAIRS.length; i++) {
    const { z } = TREE_PAIRS[i];
    const model = GREEN_MODELS[i % GREEN_MODELS.length];

    // Hàng trái
    loader.load(`/model-tree/${model}.gltf`, (gltf) => {
      const t = gltf.scene.clone();
      t.position.set(-5, 0, z);
      t.scale.setScalar(0.9 + (i % 3) * 0.1);
      t.rotation.y = i * 0.7;
      t.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(t);
    });

    // Hàng phải
    loader.load(`/model-tree/${model}.gltf`, (gltf) => {
      const t = gltf.scene.clone();
      t.position.set(5, 0, z);
      t.scale.setScalar(0.9 + (i % 3) * 0.1);
      t.rotation.y = i * 1.1 + Math.PI;
      t.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(t);
    });
  }

  // ── Cây đỏ ở cuối đường ────────────────────────────────────────────────────
  loader.load(`/model-tree/TwistedTree_1.gltf`, (gltf) => {
    const t = gltf.scene;
    t.position.set(0, 0, -28);
    t.scale.setScalar(1.6);
    t.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(t);
  });

  // ── NPC ────────────────────────────────────────────────────────────────────
  let npcMixer: THREE.AnimationMixer | null = null;

  loader.load(`${PROXY}/model3.glb`, (gltf) => {
    const npc = gltf.scene;
    npc.position.copy(NPC_POSITION);
    npc.rotation.y = Math.PI; // quay mặt về phía player
    npc.scale.setScalar(1);
    npc.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        (o as THREE.Mesh).frustumCulled = false;
      }
    });
    scene.add(npc);

    // Chạy animation đầu tiên nếu có (idle)
    if (gltf.animations.length > 0) {
      npcMixer = new THREE.AnimationMixer(npc);
      const idle = npcMixer.clipAction(gltf.animations[0]);
      idle.play();
    }
  });

  // ── Indicator "!" nổi trên NPC ─────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffdd00";
  ctx.font = "bold 52px Arial";
  ctx.textAlign = "center";
  ctx.fillText("!", 32, 52);
  const tex = new THREE.CanvasTexture(canvas);
  const indicator = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  indicator.position.copy(NPC_POSITION).add(new THREE.Vector3(0, 2.6, 0));
  indicator.scale.set(0.6, 0.6, 1);
  scene.add(indicator);

  return {
    get npcMixer() { return npcMixer; },
    checkNPCProximity(playerPos: THREE.Vector3) {
      return playerPos.distanceTo(NPC_POSITION) < 3.5;
    },
  };
}

/** Gọi mỗi frame để NPC idle animation chạy */
export function tickIntroScene(handles: IntroSceneHandles, dt: number) {
  handles.npcMixer?.update(dt);
}
