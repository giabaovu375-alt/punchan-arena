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

  // ── Attack state ──────────────────────────────────────────────────────────
  private isAttacking    = false;
  private attackCooldown = 0;
  // Bỏ attackLockTimer cứng — dùng "finished" event để unlock

  // ── Combo ─────────────────────────────────────────────────────────────────
  private comboCount      = 0;
  private comboTimer      = 0;
  private pendingCombo: AnimKey | null = null; // input buffered khi đang attack

  constructor(private cb: AnimationControllerCallbacks) {}

  // ── Setup ──────────────────────────────────────────────────────────────────

  setupModel(rig: THREE.Object3D, model: THREE.Group, clips: AnimClipMap): SetupResult {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          if (!(mat instanceof THREE.MeshStandardMaterial)) return;
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
            mat.map.anisotropy = 8;
            mat.map.needsUpdate = true;
          }
          if (mat.normalMap) mat.normalMap.anisotropy = 8;
          if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          mat.roughness       = Math.min(mat.roughness  ?? 0.8, 0.85);
          mat.metalness       = Math.min(mat.metalness  ?? 0.0, 0.25);
          mat.envMapIntensity = 1.2;
          if (mat.side === THREE.DoubleSide) mat.side = THREE.FrontSide;
          mat.needsUpdate = true;
        });
      }
    });

    model.scale.setScalar(1);

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

    // ── Mixer + clips ────────────────────────────────────────────────────────
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
      this.actions[key]    = action;
      this.actionToKey.set(action, key);
      if (!this.fallbackAnimKey) this.fallbackAnimKey = key;
    }

    // ── finished event — đây là nơi DUY NHẤT unlock isAttacking ─────────────
    this.mixer.addEventListener("finished", (e: any) => {
      const doneKey = this.actionToKey.get(e.action);
      if (!doneKey) return;

      if (doneKey === "death") {
        this.playAnim("gettingUp", 0.1);
        return;
      }

      if (COMBAT_ANIMS.has(doneKey) || doneKey === "jump") {
        // Có combo được buffer không?
        if (this.pendingCombo) {
          const next = this.pendingCombo;
          this.pendingCombo  = null;
          this.isAttacking   = true;
          this.attackCooldown = 0;
          this._playAttack(next);
          return;
        }

        // Không có pending → unlock hoàn toàn
        this.isAttacking    = false;
        this.attackCooldown = 0.2;
        this.comboCount     = 0;
        this.cb.onComboChanged?.(0);
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

    this.mixer.update(0);
    this.mixer.update(0.001);
    this.mixer.update(0.001);

    return { modelRoot: model, playerHeight, footOffset };
  }

  // ── playAnim ───────────────────────────────────────────────────────────────

  playAnim(key: AnimKey, fade = 0.15) {
    if (!this.mixer) return;
    let next = this.actions[key];
    if (!next && this.fallbackAnimKey) next = this.actions[this.fallbackAnimKey];
    if (!next) return;
    if (this.currentAction === next && next.isRunning()) return;

    const prev = this.currentAction; // KHÔNG set null trước khi gọi

    if (prev && prev !== next && fade > 0) {
      if (COMBAT_ANIMS.has(key) || key === "jump") next.reset();
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

  // ── triggerAttack ──────────────────────────────────────────────────────────

  triggerAttack(key: AnimKey) {
    if (this.attackCooldown > 0) return;

    if (this.isAttacking) {
      // Buffer combo — chỉ lưu 1 input, không spam
      const next = COMBO_CHAIN[this.currentKey];
      if (next && this.actions[next]) {
        this.pendingCombo = next;
      }
      return;
    }

    this.isAttacking    = true;
    this.pendingCombo   = null;
    this._playAttack(key);

    this.comboCount = Math.min(this.comboCount + 1, 999);
    this.comboTimer = 2.0;
    this.cb.onComboChanged?.(this.comboCount);
  }

  /** Internal: play attack animation mượt với prev đúng */
  private _playAttack(key: AnimKey) {
    const action = this.actions[key];
    if (!action) return;

    const prev = this.currentAction; // giữ prev TRƯỚC khi đổi
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);

    if (prev && prev !== action) {
      prev.crossFadeTo(action, 0.08, true); // fade ngắn cho combat feel snappy
    }
    action.play();

    this.currentAction = action;
    this.currentKey    = key;

    this.comboCount = Math.min(this.comboCount + 1, 999);
    this.comboTimer = 2.0;
    this.cb.onComboChanged?.(this.comboCount);
  }

  // ── update ─────────────────────────────────────────────────────────────────

  update(dt: number): { isAttacking: boolean } {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

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

  // ── drive ──────────────────────────────────────────────────────────────────

  drive(moving: boolean, sprinting: boolean, onGround: boolean) {
    if (this.isAttacking) return;
    if (!onGround)                this.playAnim("jump", 0.15);
    else if (moving && sprinting) this.playAnim("run",  0.2);
    else if (moving)              this.playAnim("walk", 0.2);
    else                          this.playAnim("idle", 0.25);
  }

  getMixer() { return this.mixer; }
}
