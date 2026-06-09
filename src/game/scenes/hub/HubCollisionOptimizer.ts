import * as THREE from "three";
import { collisionManager } from "../../core/CollisionManager";
import { OUTER_TREES, MID_TREES } from "./HubConfig";

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
        im.castShadow    = false; // tắt hết shadow — mobile không dùng được
        im.receiveShadow = false; // receiveShadow cũng tắt luôn cho nhẹ
        im.frustumCulled = true;

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

  // Vòng ngoài
  addInstancedGroup(generateScatter(OUTER_TREES, 12, 40, 68, [1.2, 2.0]), false, true, 0.8);
  // Vòng giữa
  addInstancedGroup(generateScatter(MID_TREES, 5, 18, 38, [1.0, 1.6]), false, true, 0.7);
  // Bụi cỏ, hoa, nấm
  addInstancedGroup(generateScatter(["Bush_Common", "Fern_1", "Mushroom_Laetiporus", "Plant_1"], 15, 6, 55, [0.6, 1.1]), false, false, 0);
  // Đá
  addInstancedGroup(generateScatter(["Rock_Medium_1", "Rock_Medium_2"], 8, 10, 50, [0.6, 1.0]), false, true, 0.5);
  // Cây đỏ trung tâm
  addInstancedGroup(
    [{ modelName: "TwistedTree_1", x: 0, z: 0, scale: 5.0, rotY: Math.PI * 0.15 }],
    false, true, 1.0
  );
  // Cây phụ
  addInstancedGroup(
    [
      { modelName: "TwistedTree_3", x: -6, z: 3, scale: 2.8, rotY: 1.1 },
      { modelName: "TwistedTree_5", x:  5, z: -4, scale: 2.2, rotY: 2.4 },
    ],
    false, true, 1.2
  );

  collisionManager.debug();
}
