// GameWorld.ts - thêm import
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Thay phần── Trees ──bằng cái này:
const loader = new GLTFLoader();

const TREES = [
  'CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5',
  'Pine_1','Pine_2','Pine_3','Pine_4','Pine_5',
  'TwistedTree_1','TwistedTree_2','TwistedTree_3',
  'Bush_Common','Bush_Common_Flowers','Fern_1',
];

for (let i = 0; i < 80; i++) {
  const angle = Math.random() * Math.PI * 2;
  const dist  = 25 + Math.random() * 100;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;
  if (Math.hypot(x + 45, z - 35) < 18) continue; // tránh lake

  const name = TREES[Math.floor(Math.random() * TREES.length)];
  loader.load(`/model-tree/${name}.gltf`, (gltf) => {
    const tree = gltf.scene;
    tree.position.set(x, 0, z);
    tree.scale.setScalar(0.7 + Math.random() * 0.9);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    scene.add(tree);
  });
}
