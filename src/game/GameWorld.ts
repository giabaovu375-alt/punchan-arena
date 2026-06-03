import * as THREE from "three";

export interface WorldHandles {
  fireLight: THREE.PointLight;
}

/**
 * Build static world: lighting, ground, path, lake, trees, rocks,
 * stone arch, huts, campfire. Trả về handle cho object cần update per-frame.
 */
export function buildWorld(scene: THREE.Scene, isMobile = false): WorldHandles {
  // ── Lighting ──────────────────────────────────────────────────────────────
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

  // ── Ground (heightmap nhẹ ngoài rìa) ──────────────────────────────────────
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

  // ── Path ──────────────────────────────────────────────────────────────────
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 200),
    new THREE.MeshStandardMaterial({ color: 0xa89368, roughness: 1 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.02;
  path.receiveShadow = true;
  scene.add(path);

  // ── Lake ──────────────────────────────────────────────────────────────────
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

  // ── Trees ─────────────────────────────────────────────────────────────────
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 1 });
  const leafGeo  = new THREE.ConeGeometry(1.6, 3.5, 8);
  const leafMats = [
    new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x3a7d3a, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x4a8b3a, roughness: 1, flatShading: true }),
  ];
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 25 + Math.random() * 100;
    const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
    if (Math.hypot(x + 45, z - 35) < 18) continue; // tránh đè lake
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.1; trunk.castShadow = true; tree.add(trunk);
    const leaves = new THREE.Mesh(leafGeo, leafMats[Math.floor(Math.random() * 3)]);
    leaves.position.y = 3.4; leaves.castShadow = true; tree.add(leaves);
    tree.position.set(x, 0, z);
    tree.scale.setScalar(0.7 + Math.random() * 0.9);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);
  }

  // ── Rocks ─────────────────────────────────────────────────────────────────
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 1, flatShading: true });
  for (let i = 0; i < 40; i++) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.4 + Math.random() * 1.2, 0),
      rockMat,
    );
    const angle = Math.random() * Math.PI * 2;
    const dist  = 15 + Math.random() * 110;
    rock.position.set(Math.cos(angle) * dist, 0.2, Math.sin(angle) * dist);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // ── Stone Arch ────────────────────────────────────────────────────────────
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

  // ── Huts ──────────────────────────────────────────────────────────────────
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
    hut.rotation.y = Math.random() * Math.PI * 2;
    scene.add(hut);
  }

  // ── Campfire ──────────────────────────────────────────────────────────────
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

  const fireLight = new THREE.PointLight(0xff7733, 2, 18, 2);
  fireLight.position.set(8, 1.5, 8);
  scene.add(fireLight);

  return { fireLight };
}

/** Flicker campfire — gọi mỗi frame */
export function tickFireLight(light: THREE.PointLight) {
  light.intensity = 1.8 + Math.sin(Date.now() * 0.009) * 0.4 + Math.random() * 0.25;
}
