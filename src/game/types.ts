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

// Combo chain: bấm attack khi đang attack → next move
export const COMBO_CHAIN: Partial<Record<AnimKey, AnimKey>> = {
  punch:    "uppercut",
  uppercut: "elbow",
  kick:     "sideKick",
  sideKick: "mmaKick",
  mmaKick:  "dropKick",
  death:    "gettingUp",
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
