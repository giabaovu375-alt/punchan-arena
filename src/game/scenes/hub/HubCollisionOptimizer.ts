import * as THREE from "three";
import { collisionManager } from "../../core/CollisionManager";
import { OUTER_TREES, MID_TREES, GROUND_ITEMS } from "./HubConfig";

function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

function generateScatter(
  models: string[], count: number, minR: number, maxR: number,
  scaleRange: [number, number], seed = 0
) {
  const items: { modelName: string; x: number; z: number; scale: number; rotY: number }[] = [];
  let s = seed;
  let attempts = 0;

  while (items.length < count && attempts < count * 4) {
    attempts++;
    s++; const angle = seededRand(s) * Math.PI * 2;
    s++; const r = minR + seededRand(s) * (maxR - minR);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    if (Math.abs(x) < 4.5 && Math.abs(z) < 50) continue;
    if (Math.abs(z) < 4.5 && Math.abs(x) < 40) continue;

    s++; const scale = scaleRange[0] + seededRand(s) * (scaleRange[1] - scaleRange[0]);
    s++; const rotY = seededRand(s) * Math.PI * 2;
    s++; const modelName = models[Math.floor(seededRand(s) * models.length)];

    items.push({ modelName, x, z, scale, rotY });
  }
  return items;
}

export function optimizeHubScene(
  scene: THREE.Scene,
  modelCache: Map<string, THREE.Group>
): void {
  const dummy = new THREE.Object3D();

  const addInstancedGroup = (
    items: { modelName: string; x: number; z: number; scale: number; rotY: number }[],
    castShadow: boolean,
    addCollision: boolean,
    colliderRadius: number
  ) => {
    const modelNames = [...new Set(items.map((i) => i.modelName))];

    for (const modelName of modelNames) {
      const sourceModel = modelCache.get(modelName);
      if (!sourceModel) continue;

      const instances = items.filter((i) => i.modelName === modelName);
      sourceModel.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;

        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, instances.length);
        im.castShadow = castShadow;
        im.receiveShadow = true;

        instances.forEach((item, idx) => {
          dummy.position.set(item.x, 0, item.z);
          dummy.scale.setScalar(item.scale);
          dummy.rotation.set(0, item.rotY, 0);
          dummy.updateMatrix();
          im.setMatrixAt(idx, dummy.matrix);
        });
        im.instanceMatrix.needsUpdate = true;
        scene.add(im);
      });

      // Đăng ký collider nếu cần
      if (addCollision) {
        instances.forEach((item) => {
          collisionManager.setCollider(
            `tree_${item.x}_${item.z}`,
            new THREE.Vector3(item.x, 0, item.z),
            item.scale * colliderRadius
          );
        });
      }
    }
  };

  // 1. Cây ngoài
  addInstancedGroup(generateScatter(OUTER_TREES, 20, 40, 68, [1.2, 2.0]), true, true, 1.0);
  // 2. Cây giữa
  addInstancedGroup(generateScatter(MID_TREES, 8, 18, 38, [1.0, 1.6]), true, true, 0.8);
  // 3. Bụi cỏ, đá (không shadow, không collider)
  addInstancedGroup(generateScatter(GROUND_ITEMS, 25, 6, 55, [0.5, 1.2]), false, false, 0);
  // 4. Cây đỏ trung tâm
  addInstancedGroup(
    [{ modelName: "TwistedTree_1", x: 0, z: 0, scale: 5.0, rotY: Math.PI * 0.15 }],
    true, true, 3.0
  );
  // 5. Cây TwistedTree phụ
  addInstancedGroup(
    [
      { modelName: "TwistedTree_3", x: -6, z: 3, scale: 2.8, rotY: 1.1 },
      { modelName: "TwistedTree_5", x: 5, z: -4, scale: 2.2, rotY: 2.4 },
      { modelName: "TwistedTree_2", x: -3, z: -6, scale: 1.8, rotY: 0.7 },
    ],
    true, true, 1.5
  );

  console.log("✅ HubCollisionOptimizer: InstancedMesh + Collider hoàn tất!");
  collisionManager.debug();
}
