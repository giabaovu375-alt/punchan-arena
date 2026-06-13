import * as THREE from "three";

export const WORLD_SCALE = 1.6;

export const CFG = {
  FOG_COLOR:         0x050e08,
  FOG_NEAR:          18,
  FOG_FAR:           180,
  SKY_COLOR:         0x03080a,

  AMBIENT_COLOR:     0x0d2218,
  AMBIENT_INTENSITY: 0.55,
  HEMI_SKY:          0x1a3a4a,
  HEMI_GROUND:       0x0a1808,
  HEMI_INTENSITY:    0.45,

  MOON_COLOR:        0x8ecfdf,
  MOON_INTENSITY:    1.1,
  RIM_COLOR:         0x1a4060,
  RIM_INTENSITY:     0.45,
  FILL_COLOR:        0x2a0a3a,
  FILL_INTENSITY:    0.25,

  GROUND_COLOR:      0x0c1509,
  GROUND_MOSS_COLOR: 0x1a2e10,

  PORTAL_COLOR:      0x00ff88,
  PORTAL_POS:        new THREE.Vector3(30 * WORLD_SCALE, 0, 10 * WORLD_SCALE),
  PORTAL_TRIGGER:    5.5,

  WISP_COLOR:        0x33ff99,
  WISP_INTENSITY:    3.0,
  WISP_DISTANCE:     20,

  SPORE_COUNT:       520,
  MIST_COUNT:        220,
  LEAF_COUNT:        320,
  FIREFLY_COUNT:     110,
  EMBER_COUNT:       180,

  MODEL_SCALE: {
  outerTreeH:  8,    // 22 → 8
  outerTreeJ:  3,    // 6  → 3
  midTreeH:    5,    // 13 → 5
  midTreeJ:    2,    // 6  → 2
  underH:      0.6,  // 1.1 → 0.6
  underJ:      0.5,  // 1.2 → 0.5
  rockH:       0.8,  // giữ
  rockJ:       0.6,
  skulls:      0.8,  // 2.0 → 0.8
  fence:       2.2,  // giữ
  statue:      3.5,  // 7.5 → 3.5
  bigStone:    2.5,  // 6.5 → 2.5
  grass:       0.4,  // 0.55 → 0.4
},
} as const;

export function inClearPath(x: number, z: number): boolean {
  const cx = 5 * WORLD_SCALE;
  const onMainPath = Math.abs(x - cx) < 11 && z > -45 * WORLD_SCALE && z < 45 * WORLD_SCALE;
  const nearPortal = Math.hypot(x - CFG.PORTAL_POS.x, z - CFG.PORTAL_POS.z) < 10;
  return onMainPath || nearPortal;
}

export function annulusPoint(cx: number, cz: number, rMin: number, rMax: number): [number, number] {
  const angle = Math.random() * Math.PI * 2;
  const r     = rMin + Math.random() * (rMax - rMin);
  return [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r];
}

export function fbm(x: number, z: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum  += amp * (
      Math.sin(x * 0.08 * freq + o * 1.7) * Math.cos(z * 0.11 * freq - o * 1.3) +
      Math.sin((x + z) * 0.05 * freq) * 0.6
    );
    norm += amp;
    amp *= 0.5; freq *= 2.0;
  }
  return sum / norm;
}
