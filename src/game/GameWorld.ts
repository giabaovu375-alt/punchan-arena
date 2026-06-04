import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface WorldHandles {
  fireLight: THREE.PointLight;
  colliders: Collider[];
}

/** Cylinder collider — dùng cho huts, cây */
export interface CylinderCollider { type: "cylinder"; x: number; z: number; radius: number; }
/** AABB collider — dùng cho arch, rock lớn */
export interface BoxCollider      { type: "box"; minX: number; maxX: number; minZ: number; maxZ: number; }
export type Collider = CylinderCollider | BoxCollider;

export function buildWorld(scene: THREE.Scene, isMobile = false): WorldHandles {
  const colliders: Collider[] = [];

  // ── Lighting ───────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xfff1d9, 0x3a4a2a, 0.7);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d0, 1.4);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;
  const shadowRes = isMobile ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
  sun.shadow.camera.top  =  80; sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 250;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
  fill.position.set(-40, 30, -20);
  scene.add(fill);

  // ── Ground ─────────────────────────────────────────────────────────────────
  const groundGeo = new THREE.PlaneGeometry(400, 400, 120, 120);
  const pos = groundGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);
    const h = Math.sin(x * 0.05) * 0.5 + Math.cos(y * 0.07) * 0.5 + Math.sin((x + y) * 0.02) * 1.2;
    const blend = Math.max(0, Math.min(1, (r - 20) / 15));
    pos.setZ(i, h * blend);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ color: 0x6b8e4e, roughness: 0.95, flatShading: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── Path ───────────────────────────────────────────────────────────────────
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 200),
    new THREE.MeshStandardMaterial({ color: 0xa89368, roughness: 1 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.02;
  path.receiveShadow = true;
  scene.add(path);

  // ── Lake ───────────────────────────────────────────────────────────────────
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(14, 48),
    new THREE.MeshStandardMaterial({
      color: 0x3a6ea8, roughness: 0.2, metalness: 0.4,
      transparent: true, opacity: 0.85,
    }),
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(-45, 0.03, 35);
  scene.add(lake);
  // Lake collider
  colliders.push({ type: "cylinder", x: -45, z: 35, radius: 14 });

  // ── Trees ──────────────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  const FIXED_TREES: { model: string; x: number; z: number; scale: number; rotY: number; r: number }[] = [
    { model: "TwistedTree_1", x: 4,   z: -20, scale: 1.4, rotY: 0.3, r: 0.6 },
    { model: "CommonTree_2",  x: -8,  z: 10,  scale: 1.1, rotY: 1.0, r: 0.5 },
    { model: "CommonTree_4",  x: 14,  z: -5,  scale: 1.2, rotY: 2.5, r: 0.5 },
    { model: "CommonTree_1",  x: -12, z: -14, scale: 1.0, rotY: 0.8, r: 0.5 },
  ];
  for (const t of FIXED_TREES) {
    loader.load(`/model-tree/${t.model}.gltf`, (gltf) => {
      const tree = gltf.scene;
      tree.position.set(t.x, 0, t.z);
      tree.scale.setScalar(t.scale);
      tree.rotation.y = t.rotY;
      tree.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      scene.add(tree);
    });
    colliders.push({ type: "cylinder", x: t.x, z: t.z, radius: t.r * t.scale });
  }

  // ── Rocks ──────────────────────────────────────────────────────────────────
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 1, flatShading: true });
  const rng = mulberry32(42); // seed cố định → vị trí rock giống nhau mỗi lần
  for (let i = 0; i < 40; i++) {
    const size = 0.4 + rng() * 1.2;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rockMat);
    const angle = rng() * Math.PI * 2;
    const dist  = 15 + rng() * 110;
    const rx = Math.cos(angle) * dist;
    const rz = Math.sin(angle) * dist;
    rock.position.set(rx, 0.2, rz);
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    // Chỉ add collider cho rock đủ lớn
    if (size > 0.9) colliders.push({ type: "cylinder", x: rx, z: rz, radius: size * 0.8 });
  }

  // ── Stone Arch ─────────────────────────────────────────────────────────────
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.9, flatShading: true });
  const arch = new THREE.Group();
  for (const [p, s] of [
    [[-1.3, 0, 0], [0.8, 4, 0.8]],
    [[ 1.3, 0, 0], [0.8, 4, 0.8]],
    [[   0, 3.2, 0], [3.4, 0.8, 0.8]],
  ] as [[number, number, number], [number, number, number]][]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...s), stoneMat);
    m.position.set(...p); m.castShadow = true; arch.add(m);
  }
  arch.position.set(0, 0, -18);
  scene.add(arch);
  // 2 cột arch — box collider (world space)
  colliders.push({ type: "box", minX: -1.7, maxX: -0.9, minZ: -18.4, maxZ: -17.6 });
  colliders.push({ type: "box", minX:  0.9, maxX:  1.7, minZ: -18.4, maxZ: -17.6 });

  // ── Huts ───────────────────────────────────────────────────────────────────
  const hutWall = new THREE.MeshStandardMaterial({ color: 0xc8aa72, roughness: 1 });
  const hutRoof = new THREE.MeshStandardMaterial({ color: 0x7c3c14, roughness: 1, flatShading: true });
  for (const [x, , z] of [[18, 0, -10], [-18, 0, -8], [22, 0, 14], [-14, 0, 20], [30, 0, -26]]) {
    const hut = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 2.8, 8), hutWall);
    wall.position.y = 1.4; wall.castShadow = true; wall.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.2, 4), hutRoof);
    roof.position.y = 3.9; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    hut.add(wall, roof);
    hut.position.set(x as number, 0, z as number);
    scene.add(hut);
    colliders.push({ type: "cylinder", x: x as number, z: z as number, radius: 2.9 });
  }

  // ── Campfire ───────────────────────────────────────────────────────────────
  const fireBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.8, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
  );
  fireBase.position.set(8, 0.15, 8);
  scene.add(fireBase);
  const fire = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0xff7733, emissive: 0xff5511, emissiveIntensity: 2 }),
  );
  fire.position.set(8, 0.8, 8);
  scene.add(fire);
  colliders.push({ type: "cylinder", x: 8, z: 8, radius: 1.0 });

  const fireLight = new THREE.PointLight(0xff7733, 2, 18, 2);
  fireLight.position.set(8, 1.5, 8);
  scene.add(fireLight);

  return { fireLight, colliders };
}

export function tickFireLight(light: THREE.PointLight) {
  light.intensity = 1.8 + Math.sin(Date.now() * 0.009) * 0.4 + Math.random() * 0.25;
}

/** Seeded RNG — để rocks có vị trí cố định, khớp với collider */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
