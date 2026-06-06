import * as THREE from "three";
import {
  ANIM_KEYS, COMBAT_ANIMS, COMBO_CHAIN,
  type AnimKey, type AnimClipMap,
} from "../types";

export interface AnimationControllerCallbacks {
  isMoving: () => boolean;
  onComboChanged?: (count: number) => void;
}

export interface SetupResult {
  modelRoot: THREE.Object3D;
  playerHeight: number;
  footOffset: number;
}

export class AnimationController {
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private actionToKey = new Map<THREE.AnimationAction, AnimKey>();
  private currentAction: THREE.AnimationAction | null = null;
  private currentKey: AnimKey = "idle";
  private fallbackAnimKey: AnimKey | null = null;

  private isAttacking = false;
  private attackCooldown = 0;
  private attackLockTimer = 0;

  private comboCount = 0;
  private comboTimer = 0;

  constructor(private cb: AnimationControllerCallbacks) {}

  setupModel(rig: THREE.Object3D, model: THREE.Group, clips: AnimClipMap): SetupResult {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // tránh bị cull khi camera xoay

        // ── Nâng chất lượng material ─────────────────────────────────────
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          if (!(mat instanceof THREE.MeshStandardMaterial)) return;

          // Texture encoding chuẩn sRGB
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
            mat.map.anisotropy = 8; // nét hơn khi nhìn góc nghiêng
            mat.map.needsUpdate = true;
          }
          if (mat.normalMap) {
            mat.normalMap.anisotropy = 8;
          }
          if (mat.emissiveMap) {
            mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          }

          // Vật liệu trông thật hơn
          mat.roughness  = Math.min(mat.roughness  ?? 0.8, 0.85);
          mat.metalness  = Math.min(mat.metalness  ?? 0.0, 0.25);
          mat.envMapIntensity = 1.2; // phản chiếu môi trường rõ hơn

          // Tắt side double – nhẹ hơn, đúng hơn với skinned mesh
          if (mat.side === THREE.DoubleSide) mat.side = THREE.FrontSide;

          mat.needsUpdate = true;
        });
      }
    });

    model.scale.setScalar(1);

    // Tính bounding box để lấy footOffset + playerHeight
    const tempScene = new THREE.Scene();
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    tempScene.add(model);
    model.updateMatrixWorld(true);

    const bbox        = new THREE.Box3().setFromObject(model);
    const modelHeight = bbox.max.y - bbox.min.y;
    const footOffset  = isFinite(bbox.min.y) && modelHeight > 0.1 ? -bbox.min.y : 0;
    tempScene.remove(model);

    model.position.set(0, footOffset, 0);
    const playerHeight = modelHeight > 0.3 ? modelHeight * 0.85 : 1.6;

    rig.add(model);
    model.updateMatrixWorld(true);

    // ── Mixer + clips ────────────────────────────────────────────────────
    this.mixer = new THREE.AnimationMixer(model);

    const nodeNames = new Set<string>();
    model.traverse(n => { if (n.name) nodeNames.add(n.name); });

    for (const key of ANIM_KEYS) {
      const src = clips[key];
      if (!src) continue;

      const tracks = src.tracks
        .filter(t => nodeNames.has(t.name.split(".")[0]))
        .filter(t => {
          if (!t.name.includes(".position")) return true;
          const bn = t.name.split(".")[0].toLowerCase()
            .replace("mixamorig:", "").replace("mixamorig", "");
          return !(bn === "root" || bn === "hips" || bn === "j_bip_c_hips");
        })
        .map(t => t.clone());

      if (tracks.length === 0) continue;

      let dur = src.duration;
      if (dur > 10) {
        tracks.forEach(t => {
          (t as any).times = Float32Array.from(
            (t as any).times,
            (v: number) => v / (dur / 2),
          );
        });
        dur = 2;
      }

      const clip   = new THREE.AnimationClip(src.name, dur, tracks, src.blendMode);
      const action = this.mixer.clipAction(clip);
      action.timeScale = 1;
      action.stop();

      if (COMBAT_ANIMS.has(key) || key === "jump") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
      this.actionToKey.set(action, key);
      if (!this.fallbackAnimKey) this.fallbackAnimKey = key;
    }

    // Sự kiện kết thúc animation
    this.mixer.addEventListener("finished", (e: any) => {
      const doneKey = this.actionToKey.get(e.action);
      if (!doneKey) return;

      if (doneKey === "death" && this.actions.gettingUp) {
        this.currentAction = null;
        this.playAnim("gettingUp", 0);
        return;
      }
      if (COMBAT_ANIMS.has(doneKey) || doneKey === "jump") {
        this.isAttacking   = false;
        this.attackCooldown = 0.3;
        this.currentAction  = null;
        this.playAnim(this.cb.isMoving() ? "walk" : "idle", 0.15);
      }
    });

    // Play idle ngay
    const startKey: AnimKey = this.actions.idle ? "idle"
      : this.actions.walk   ? "walk"
      : (this.fallbackAnimKey ?? "idle");

    const startAction = this.actions[startKey];
    if (startAction) {
      startAction.enabled = true;
      startAction.setEffectiveWeight(1);
      startAction.setEffectiveTimeScale(1);
      startAction.play();
      this.currentAction = startAction;
      this.currentKey    = startKey;
    }

    // Warm up
    this.mixer.update(0);
    this.mixer.update(0.001);
    this.mixer.update(0.001);

    return { modelRoot: model, playerHeight, footOffset };
  }

  playAnim(key: AnimKey, fade = 0.15) {
    if (!this.mixer) return;
    let next = this.actions[key];
    if (!next && this.fallbackAnimKey) next = this.actions[this.fallbackAnimKey];
    if (!next) return;
    if (this.currentAction === next && next.isRunning()) return;

    const prev = this.currentAction;

    if (prev && prev !== next && fade > 0) {
      const needReset = COMBAT_ANIMS.has(key) || key === "jump";
      if (needReset) next.reset();
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.setEffectiveTimeScale(1);
      prev.crossFadeTo(next, fade, true);
      next.play();
    } else {
      if (prev && prev !== next) {
        prev.stop();
        prev.enabled = false;
      }
      next.reset();
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.setEffectiveTimeScale(1);
      next.play();
    }

    this.currentAction = next;
    this.currentKey    = key;
  }

  triggerAttack(key: AnimKey) {
    if (this.isAttacking) {
      const combo = COMBO_CHAIN[this.currentKey];
      if (combo && this.actions[combo]) {
        this.currentAction = null;
        this.playAnim(combo, 0);
        this.currentKey = combo;
      }
      return;
    }
    if (this.attackCooldown > 0) return;

    this.isAttacking      = true;
    this.attackCooldown   = 0.6;
    this.attackLockTimer  = 0.8;
    this.playAnim(key, 0.1);

    this.comboCount = Math.min(this.comboCount + 1, 999);
    this.comboTimer = 1.6;
    this.cb.onComboChanged?.(this.comboCount);
  }

  update(dt: number): { isAttacking: boolean } {
    if (this.attackCooldown  > 0) this.attackCooldown  -= dt;
    if (this.attackLockTimer > 0) {
      this.attackLockTimer -= dt;
      if (this.attackLockTimer <= 0) {
        this.isAttacking = false;
        this.comboCount  = 0;
        this.cb.onComboChanged?.(0);
      }
    }
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.cb.onComboChanged?.(0);
      }
    }
    this.mixer?.update(dt);
    return { isAttacking: this.isAttacking };
  }

  drive(moving: boolean, sprinting: boolean, onGround: boolean) {
    if (this.isAttacking) return;
    if (!onGround)                this.playAnim("jump", 0.15);
    else if (moving && sprinting) this.playAnim("run",  0.2);
    else if (moving)              this.playAnim("walk", 0.2);
    else                          this.playAnim("idle", 0.25);
  }

  getMixer() { return this.mixer; }
}
