import * as THREE from "three";
import {
  ANIM_KEYS, COMBAT_ANIMS, COMBO_CHAIN,
  type AnimKey, type AnimClipMap,
} from "./types";

export interface AnimationControllerCallbacks {
  /** Có đang giữ phím di chuyển không (để chọn idle/walk sau khi attack xong) */
  isMoving: () => boolean;
  /** HUD flash khi combo tăng */
  onComboChanged?: (count: number) => void;
}

export interface SetupResult {
  /** Model đã được offset Y cho chân chạm đất */
  modelRoot: THREE.Object3D;
  /** Chiều cao tham chiếu (để camera anchor ngực) */
  playerHeight: number;
}

export class AnimationController {
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private currentAction: THREE.AnimationAction | null = null;
  private currentKey: AnimKey = "idle";
  private fallbackAnimKey: AnimKey | null = null;

  private isAttacking = false;
  private attackCooldown = 0;

  private comboCount = 0;
  private comboTimer = 0;

  constructor(private cb: AnimationControllerCallbacks) {}

  /**
   * Gắn model vào parent rig (player Group), tính foot offset để không lún đất,
   * khởi tạo mixer + clean tracks (filter bone không khớp, loại root translation,
   * deep-clone để không corrupt clip gốc).
   */
  setupModel(rig: THREE.Object3D, model: THREE.Group, clips: AnimClipMap): SetupResult {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // skinned mesh frustum culling thường sai → tắt
        (child as THREE.Mesh).frustumCulled = false;
      }
    });
    model.scale.setScalar(1);

    // Đo bbox ở bind pose trong tempScene để matrixWorld chính xác
    const tempScene = new THREE.Scene();
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    tempScene.add(model);
    model.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(model);
    const modelHeight = bbox.max.y - bbox.min.y;
    const footOffset = isFinite(bbox.min.y) && modelHeight > 0.1 ? -bbox.min.y : 0;
    tempScene.remove(model);

    model.position.set(0, footOffset, 0);
    const playerHeight = modelHeight > 0.3 ? modelHeight * 0.85 : 1.6;

    rig.add(model);
    model.updateMatrixWorld(true);

    this.mixer = new THREE.AnimationMixer(model);

    // Tên các node trong model để filter track không khớp
    const nodeNames = new Set<string>();
    model.traverse(n => { if (n.name) nodeNames.add(n.name); });

    for (const key of ANIM_KEYS) {
      const src = clips[key];
      if (!src) continue;

      // THREE.AnimationClip.clone() là SHALLOW → tracks share Float32Array
      // → deep clone từng track
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

      const clip = new THREE.AnimationClip(src.name, dur, tracks, src.blendMode);
      const action = this.mixer.clipAction(clip);
      action.timeScale = 1;
      action.stop();

      if (COMBAT_ANIMS.has(key) || key === "jump") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
      if (!this.fallbackAnimKey) this.fallbackAnimKey = key;
    }

    this.mixer.addEventListener("finished", (e: any) => {
      const doneKey = (Object.entries(this.actions) as [AnimKey, THREE.AnimationAction][])
        .find(([, a]) => a === e.action)?.[0];
      if (!doneKey) return;

      if (doneKey === "death" && this.actions.gettingUp) {
        this.currentAction = null;
        this.playAnim("gettingUp", 0);
        return;
      }
      if (COMBAT_ANIMS.has(doneKey) || doneKey === "jump") {
        this.isAttacking = false;
        this.attackCooldown = 0.3;
        this.currentAction = null;
        this.playAnim(this.cb.isMoving() ? "walk" : "idle", 0);
      }
    });

    const startKey: AnimKey = this.actions.idle ? "idle"
      : this.actions.walk ? "walk"
      : (this.fallbackAnimKey ?? "idle");
    this.playAnim(startKey, 0);
    this.mixer.update(0.016);

    return { modelRoot: model, playerHeight };
  }

  playAnim(key: AnimKey, _fade = 0.2) {
    if (!this.mixer) return;
    let next = this.actions[key];
    if (!next && this.fallbackAnimKey) next = this.actions[this.fallbackAnimKey];
    if (!next) return;
    if (this.currentAction === next && next.isRunning()) return;

    // Stop tất cả action khác — tránh multiple action chạy đồng thời → T-pose
    for (const a of Object.values(this.actions)) {
      if (a && a !== next) { a.stop(); a.enabled = false; }
    }

    this.currentAction = next;
    this.currentKey = key;

    const needReset = COMBAT_ANIMS.has(key) || key === "jump" || !next.isRunning();
    if (needReset) next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(1);
    next.play();
  }

  triggerAttack(key: AnimKey) {
    // Đang attack → thử chain combo
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

    this.isAttacking = true;
    this.attackCooldown = 0.6;
    this.playAnim(key, 0.1);

    this.comboCount++;
    this.comboTimer = 1.6;
    this.cb.onComboChanged?.(this.comboCount);
  }

  /** Gọi mỗi frame; trả về có đang attack không (để PlayerController biết) */
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

  /** Locomotion fallback (idle/walk/run/jump) khi không attack */
  drive(moving: boolean, sprinting: boolean, onGround: boolean) {
    if (this.isAttacking) return;
    if (!onGround)            this.playAnim("jump", 0.15);
    else if (moving && sprinting) this.playAnim("run", 0.25);
    else if (moving)              this.playAnim("walk", 0.25);
    else                          this.playAnim("idle", 0.35);
  }

  getMixer() { return this.mixer; }
}
