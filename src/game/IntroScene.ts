import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const PROXY = "https://hf-proxy.giabaovu375.workers.dev";

export interface IntroSceneHandles {
  npcMixer:          THREE.AnimationMixer | null;
  checkNPCProximity: (playerPos: THREE.Vector3) => boolean;
  tick:              (dt: number, elapsed: number) => void;
}

export const NPC_POSITION = new THREE.Vector3(0, 0, -22);
export const PLAYER_SPAWN = new THREE.Vector3(0, 0, 10);

const TREE_PAIRS: { z: number }[] = [
  { z:  6 }, { z:  2 }, { z: -2 },
  { z: -6 }, { z: -10 }, { z: -14 },
];

// ── Leaf particles ─────────────────────────────────────────────────────────
interface Leaf {
  mesh:    THREE.Mesh;
  vel:     THREE.Vector3;
  rotVel:  THREE.Euler;
  life:    number;
  maxLife: number;
}

function createLeafSystem(scene: THREE.Scene, count = 30): Leaf[] {
  const leaves: Leaf[] = [];
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff6633, side: THREE.DoubleSide,
    roughness: 1, transparent: true, opacity: 0.85,
  });
  for (let i = 0; i < count; i++) {
    const geo  = new THREE.PlaneGeometry(0.08 + Math.random() * 0.08, 0.06 + Math.random() * 0.06);
    const mesh = new THREE.Mesh(geo, mat.clone());
    const maxLife = 4 + Math.random() * 4;
    mesh.position.set(
      (Math.random() - 0.5) * 14,
      1 + Math.random() * 8,
      -5 - Math.random() * 25,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.frustumCulled = false;
    scene.add(mesh);
    leaves.push({
      mesh,
      vel:     new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.3 - Math.random() * 0.3, 0),
      rotVel:  new THREE.Euler(Math.random() * 1.2, Math.random() * 1.2, Math.random() * 0.8),
      life:    Math.random() * maxLife,
      maxLife,
    });
  }
  return leaves;
}

function tickLeaves(leaves: Leaf[], dt: number) {
  for (const l of leaves) {
    l.life += dt;
    if (l.life > l.maxLife) {
      l.life = 0;
      l.mesh.position.set(
        (Math.random() - 0.5) * 14,
        6 + Math.random() * 4,
        -5 - Math.random() * 25,
      );
    }
    l.mesh.position.addScaledVector(l.vel, dt);
    l.mesh.position.x += Math.sin(l.life * 1.5) * 0.003;
    l.mesh.rotation.x += l.rotVel.x * dt;
    l.mesh.rotation.y += l.rotVel.y * dt;
    l.mesh.rotation.z += l.rotVel.z * dt;
    const t = l.life / l.maxLife;
    (l.mesh.material as THREE.MeshStandardMaterial).opacity =
      t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 0.85;
  }
}

// ── Build ──────────────────────────────────────────────────────────────────
export function buildIntroScene(scene: THREE.Scene, isMobile = false): IntroSceneHandles {

  // Sky + fog hoàng hôn
  scene.background = new THREE.Color(0xff7733);
  scene.fog = new THREE.FogExp2(0xcc4422, 0.016);

  // Lighting
  scene.add(new THREE.HemisphereLight(0xffb347, 0x2c1a0e, 1.0));
  scene.add(new THREE.AmbientLight(0xff6622, 0.3));

  const sun = new THREE.DirectionalLight(0xff9933, 2.2);
  sun.position.set(-30, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  sun.shadow.camera.left = -30; sun.shadow.camera.right  = 30;
  sun.shadow.camera.top  =  30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far    = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x6688cc, 0.4);
  fill.position.set(20, 20, -10);
  scene.add(fill);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 80, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a6e35, roughness: 1, flatShading: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Đường đi
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 80),
    new THREE.MeshStandardMaterial({ color: 0x8a7355, roughness: 0.95 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.01;
  path.receiveShadow = true;
  scene.add(path);

  // Viền đường
  for (const sx of [-1.9, 1.9]) {
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 80),
      new THREE.MeshStandardMaterial({ color: 0xc8a96e, roughness: 1 }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(sx, 0.02, 0);
    scene.add(edge);
  }

  // Cây xanh
  const loader = new GLTFLoader();
  const fbxLoader = new FBXLoader();
  const GREEN_MODELS = ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4"];
  const trees: THREE.Object3D[] = [];

  for (let i = 0; i < TREE_PAIRS.length; i++) {
    const { z } = TREE_PAIRS[i];
    const model = GREEN_MODELS[i % GREEN_MODELS.length];
    for (const sx of [-5.5, 5.5]) {
      loader.load(`/model-tree/${model}.gltf`, (gltf) => {
        const t = gltf.scene.clone();
        t.position.set(sx, 0, z);
        t.scale.setScalar(0.85 + (i % 3) * 0.12);
        t.rotation.y = sx < 0 ? i * 0.7 : i * 1.1 + Math.PI;
        t.traverse(o => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            (o as THREE.Mesh).frustumCulled = false;
          }
        });
        scene.add(t);
        trees.push(t);
      });
    }
  }

  // Cây đỏ cuối đường
  loader.load(`/model-tree/TwistedTree_1.gltf`, (gltf) => {
    const t = gltf.scene;
    t.position.set(0, 0, -30);
    t.scale.setScalar(2.0);
    t.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        (o as THREE.Mesh).frustumCulled = false;
      }
    });
    scene.add(t);
    trees.push(t);
  });

  // Đèn lồng
  const lanternPositions = [
    { x: -2.2, z: 4 }, { x: 2.2, z: 4 },
    { x: -2.2, z: -4 }, { x: 2.2, z: -4 },
    { x: -2.2, z: -12 }, { x: 2.2, z: -12 },
  ];
  const lanternMeshes: THREE.Mesh[] = [];

  for (const lp of lanternPositions) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.8 }),
    );
    pole.position.set(lp.x, 1.1, lp.z);
    pole.castShadow = true;
    scene.add(pole);

    const lantern = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshStandardMaterial({
        color: 0xff8800, emissive: 0xff6600,
        emissiveIntensity: 1.5, transparent: true, opacity: 0.85,
      }),
    );
    lantern.position.set(lp.x, 2.3, lp.z);
    scene.add(lantern);
    lanternMeshes.push(lantern);

    const pl = new THREE.PointLight(0xff8833, 1.2, 5);
    pl.position.set(lp.x, 2.3, lp.z);
    scene.add(pl);
  }

  // NPC — load model + fallback animation Sitting Idle
  let npcMixer: THREE.AnimationMixer | null = null;

  loader.load(`${PROXY}/model3.glb`, (gltf) => {
    const npc = gltf.scene;
    npc.position.copy(NPC_POSITION);
    npc.rotation.y = Math.PI;
    npc.scale.setScalar(1);
    npc.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        (o as THREE.Mesh).frustumCulled = false;
      }
    });
    scene.add(npc);

    npcMixer = new THREE.AnimationMixer(npc);

    console.log("NPC animations:", gltf.animations.length, gltf.animations.map(a => a.name));

    if (gltf.animations.length > 0) {
      // Model có animation sẵn → dùng luôn
      npcMixer.clipAction(gltf.animations[0]).play();
    } else {
      // Không có animation → load Sitting Idle từ FBX
      fbxLoader.load("/animation/Sitting Idle.fbx", (fbx) => {
        const clip = fbx.animations[0];
        if (clip && npcMixer) {
          // Lọc track chỉ giữ rotation, bỏ position root
          const tracks = clip.tracks.filter(t => !t.name.toLowerCase().includes("hips.position"));
          const cleanClip = new THREE.AnimationClip("SittingIdle", clip.duration, tracks);
          npcMixer.clipAction(cleanClip).play();
        }
      });
    }
  },
  undefined,
  (err) => console.warn("⚠️ NPC load failed:", err));

  // Indicator "!" pulse
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
  grad.addColorStop(0,   "rgba(255,220,0,0.9)");
  grad.addColorStop(0.6, "rgba(255,160,0,0.5)");
  grad.addColorStop(1,   "rgba(255,100,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff700";
  ctx.font = "bold 80px Arial";
  ctx.textAlign = "center";
  ctx.shadowColor = "#ff8800";
  ctx.shadowBlur  = 12;
  ctx.fillText("!", 64, 90);

  const tex       = new THREE.CanvasTexture(canvas);
  const indicator = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, depthTest: false, transparent: true,
  }));
  indicator.position.copy(NPC_POSITION).add(new THREE.Vector3(0, 2.8, 0));
  indicator.scale.set(0.8, 0.8, 1);
  scene.add(indicator);

  // Leaf particles
  const leaves = createLeafSystem(scene, isMobile ? 15 : 30);

  return {
    get npcMixer() { return npcMixer; },

    checkNPCProximity(playerPos: THREE.Vector3) {
      return playerPos.distanceTo(NPC_POSITION) < 3.5;
    },

    tick(dt: number, elapsed: number) {
      npcMixer?.update(dt);

      // Indicator pulse
      const pulse = 0.75 + Math.sin(elapsed * 3.5) * 0.15;
      indicator.scale.set(pulse, pulse, 1);
      (indicator.material as THREE.SpriteMaterial).opacity = 0.8 + Math.sin(elapsed * 3.5) * 0.2;

      // Đèn lồng flickering
      for (const lm of lanternMeshes) {
        const flicker = 1.3
          + Math.sin(elapsed * 7  + lm.position.z) * 0.25
          + Math.sin(elapsed * 13 + lm.position.x) * 0.1;
        (lm.material as THREE.MeshStandardMaterial).emissiveIntensity = flicker;
      }

      // Lá rơi
      tickLeaves(leaves, dt);

      // Cây lắc nhẹ
      for (const t of trees) {
        t.rotation.z = Math.sin(elapsed * 0.8 + t.position.z * 0.3) * 0.015;
      }
    },
  };
}

export function tickIntroScene(handles: IntroSceneHandles, dt: number, elapsed = 0) {
  handles.tick(dt, elapsed);
        }
