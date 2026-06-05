import * as THREE from "three";
import { PORTAL_DEFS } from "./HubConfig";

export interface PortalMarker {
  targetScene: string;
  position: THREE.Vector3;
  radius: number;
  mesh: THREE.Group;
}

function createPortalMesh(color: number, label: string): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.18, 12, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.7 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.02;
  group.add(inner);

  const light = new THREE.PointLight(color, 1.2, 10);
  light.position.y = 1;
  group.add(light);

  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(4, 4, 248, 56, 12); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.position.set(0, 3.2, 0);
  sprite.scale.set(3.2, 0.8, 1);
  group.add(sprite);

  return group;
}

function addPathLights(scene: THREE.Scene, portalPos: THREE.Vector3, color: number): void {
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const light = new THREE.PointLight(color, 0.4, 6);
    light.position.set(portalPos.x * t, 1.0, portalPos.z * t);
    scene.add(light);
  }
}

export function setupPortals(scene: THREE.Scene): PortalMarker[] {
  const markers: PortalMarker[] = [];
  for (const def of PORTAL_DEFS) {
    const mesh = createPortalMesh(def.color, def.label);
    mesh.position.copy(def.pos);
    scene.add(mesh);
    addPathLights(scene, def.pos, def.color);
    markers.push({ targetScene: def.targetScene, position: def.pos.clone(), radius: 2.5, mesh });
  }
  return markers;
}
