import * as THREE from "three";

export const ANIM_KEYS = [
  "idle", "walk", "run", "jump",
  "punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "sideKick",
  "pain", "death", "gettingUp",
  "breakdanceEnd", "breakdanceFreeze", "sitting", "sittingIdle",
] as const;
export type AnimKey = (typeof ANIM_KEYS)[number];

export type AnimClipMap = Partial<Record<AnimKey, THREE.AnimationClip>>;

export const COMBAT_ANIMS = new Set<AnimKey>([
  "punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "sideKick",
  "pain", "death", "gettingUp",
]);

// ── Combo chain ───────────────────────────────────────────────────────────────
// punch → uppercut → elbow → dropKick (chain tay)
// kick  → sideKick → mmaKick          (chain chân)
// Bấm attack khi đang attack → chạy move tiếp theo
export const COMBO_CHAIN: Partial<Record<AnimKey, AnimKey>> = {
  // Chain tay
  punch:    "uppercut",
  uppercut: "elbow",
  elbow:    "dropKick",   // ← fix: elbow giờ có next

  // Chain chân
  kick:     "sideKick",
  sideKick: "mmaKick",
  // mmaKick → end (không loop chain chân)

  // Death không phải combo chain — handled riêng trong finished event
};

export interface InputState {
  forward: boolean; backward: boolean;
  left: boolean;    right: boolean;
  jump: boolean;    sprint: boolean;
}

export interface JoystickState {
  active: boolean;
  startX: number; startY: number;
  dx: number; dy: number;
  touchId: number;
}
