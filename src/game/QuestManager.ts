import * as THREE from "three";

export interface QuestManagerHandles {
  update: (playerPos: THREE.Vector3, dt: number) => void;
  isQuestCompleted: () => boolean;
  dispose: () => void;
}

const CRYSTAL_POSITIONS = [
  new THREE.Vector3(-2.5, 1.0,   0),
  new THREE.Vector3( 2.5, 1.0,  -8),
  new THREE.Vector3(-2.0, 1.0, -16),
];

export function initQuestManager(
  scene: THREE.Scene,
  container: HTMLElement, // nhận container thay vì gắn vào body
): QuestManagerHandles {
  let collectedCount = 0;
  const total = CRYSTAL_POSITIONS.length;
  let totalTime = 0;

  // ── UI ─────────────────────────────────────────────────────────────────────
  const ui = document.createElement("div");
  Object.assign(ui.style, {
    position:        "absolute",
    top:             "20px",
    left:            "20px",
    padding:         "10px 18px",
    fontFamily:      "'Segoe UI', sans-serif",
    fontSize:        "15px",
    fontWeight:      "bold",
    color:           "#fff",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius:    "8px",
    border:          "2px solid #00ffcc",
    boxShadow:       "0 0 15px rgba(0,255,204,0.3)",
    pointerEvents:   "none",
    transition:      "border 0.3s, box-shadow 0.3s",
    zIndex:          "50",
  });
  container.appendChild(ui); // gắn vào container, không phải body
  updateUI();

  // ── Geometry + Material (dùng chung, không dispose theo từng crystal) ──────
  const sharedGeo = new THREE.OctahedronGeometry(0.5, 0);
  const sharedMat = new THREE.MeshStandardMaterial({
    color: 0x00ffcc, emissive: 0x00aa88, emissiveIntensity: 1.5,
    roughness: 0.1, metalness: 0.9, flatShading: true,
  });

  // ── Crystal meshes ─────────────────────────────────────────────────────────
  // Lưu cả light để dispose sau
  interface CrystalEntry {
    mesh:  THREE.Mesh;
    light: THREE.PointLight;
    baseY: number;
  }
  const crystals: CrystalEntry[] = [];

  for (let i = 0; i < CRYSTAL_POSITIONS.length; i++) {
    const pos   = CRYSTAL_POSITIONS[i];
    const mesh  = new THREE.Mesh(sharedGeo, sharedMat); // share geo + mat
    mesh.position.copy(pos);
    mesh.castShadow = true;

    const light = new THREE.PointLight(0x00ffcc, 0.8, 4);
    mesh.add(light);
    scene.add(mesh);

    crystals.push({ mesh, light, baseY: pos.y });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function updateUI() {
    if (collectedCount >= total) {
      ui.style.border    = "2px solid #ffcc00";
      ui.style.boxShadow = "0 0 15px rgba(255,204,0,0.5)";
      ui.innerText = "✅ Hoàn tất! Lại gần NPC để kích hoạt Portal.";
    } else {
      ui.style.border    = "2px solid #00ffcc";
      ui.style.boxShadow = "0 0 15px rgba(0,255,204,0.3)";
      ui.innerText = `📜 Thu thập Crystal (${collectedCount}/${total})`;
    }
  }

  function removeCrystal(i: number) {
    const { mesh, light } = crystals[i];
    mesh.remove(light);         // tách light khỏi mesh
    light.dispose();            // dispose light
    scene.remove(mesh);         // xóa khỏi scene
    // KHÔNG dispose sharedGeo / sharedMat ở đây
    crystals.splice(i, 1);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    update(playerPos: THREE.Vector3, dt: number) {
      totalTime += dt;

      for (let i = crystals.length - 1; i >= 0; i--) {
        const { mesh, baseY } = crystals[i];

        // Hover + xoay
        mesh.rotation.y    += 1.5 * dt;
        mesh.position.y     = baseY + Math.sin(totalTime * 3 + i) * 0.15;

        // Collision
        if (playerPos.distanceTo(mesh.position) < 1.2) {
          removeCrystal(i);
          collectedCount++;
          updateUI();
        }
      }
    },

    isQuestCompleted() {
      return collectedCount >= total;
    },

    /** Gọi khi chuyển scene / dispose GameEngine */
    dispose() {
      // Xóa hết crystal còn lại
      for (let i = crystals.length - 1; i >= 0; i--) removeCrystal(i);
      // Dispose shared resource
      sharedGeo.dispose();
      sharedMat.dispose();
      // Xóa UI
      if (ui.parentElement) ui.parentElement.removeChild(ui);
    },
  };
}
