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

// ── Tuning constants (AAA-style) ────────────────────────────────────────────
const FADE = {
  idle:         0.25,
  locomotion:   0.18,   // walk ↔ run
  toAttack:     0.06,   // very snappy entry
  comboChain:   0.05,   // almost instant chain
  exitAttack:   0.18,   // smooth return to idle/walk
  jump:         0.12,
  death:        0.1,
  gettingUp:    0.15,
} as const;

/** Fraction of clip duration that must pass before a combo input is accepted */
const COMBO_WINDOW_FRACTION = 0.45;

/** Attackcooldown after the finished-event fires (prevent double-tap spam) */
const POST_ATTACK_COOLDOWN = 0.12;

export class AnimationController {
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private clipDurations: Partial<Record<AnimKey, number>> = {};
  private actionToKey = new Map<THREE.AnimationAction, AnimKey>();
  private currentAction: THREE.AnimationAction | null = null;
  private currentKey: AnimKey = "idle";
  private fallbackAnimKey: AnimKey | null = null;

  // ── Attack state ──────────────────────────────────────────────────────────
  private isAttacking     = false;
  private attackCooldown  = 0;
  private comboWindowOpen = false;   // true once past COMBO_WINDOW_FRACTION

  // ── Combo ─────────────────────────────────────────────────────────────────
  private comboCount    = 0;
  private comboTimer    = 0;
  private pendingCombo: AnimKey | null = null;

  constructor(private cb: AnimationControllerCallbacks) {}

  // ── Setup ──────────────────────────────────────────────────────────────────

  setupModel(rig: THREE.Object3D, model: THREE.Group, clips: AnimClipMap): SetupResult {
    // ── Material setup ───────────────────────────────────────────────────────
    model.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
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
        if (mat.normalMap)   mat.normalMap.anisotropy = 8;
        if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        mat.roughness       = Math.min(mat.roughness  ?? 0.8, 0.85);
        mat.metalness       = Math.min(mat.metalness  ?? 0.0, 0.25);
        mat.envMapIntensity = 1.2;
        if (mat.side === THREE.DoubleSide) mat.side = THREE.FrontSide;
        mat.needsUpdate = true;
      });
    });

    // ── Measure model size ───────────────────────────────────────────────────
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

      // Strip root-motion position tracks & filter to model bones
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

      // ── Duration fix: ONLY retime if clip is suspiciously long (>30 s).
      //    Old threshold of 10 s was too aggressive and mutilated normal clips.
      //    We retime to 2× the "natural" frame-rate guess instead of a flat "2 s".
      let dur = src.duration;
      if (dur > 30) {
        const scale = dur / 3; // bring absurdly long clips down to ~3 s
        tracks.forEach(t => {
          const times = (t as any).times as Float32Array;
          for (let i = 0; i < times.length; i++) times[i] /= scale;
        });
        dur = src.duration / scale;
      }

      const clip   = new THREE.AnimationClip(src.name, dur, tracks, src.blendMode);
      const action = this.mixer.clipAction(clip);
      action.timeScale = 1;
      action.stop();

      if (COMBAT_ANIMS.has(key) || key === "jump") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }

      this.actions[key]      = action;
      this.clipDurations[key] = clip.duration;
      this.actionToKey.set(action, key);
      if (!this.fallbackAnimKey) this.fallbackAnimKey = key;
    }

    // ── finished event ───────────────────────────────────────────────────────
    this.mixer.addEventListener("finished", (e: any) => {
      const doneKey = this.actionToKey.get(e.action);
      if (!doneKey) return;

      if (doneKey === "death") {
        this.playAnim("gettingUp", FADE.gettingUp);
        return;
      }

      if (COMBAT_ANIMS.has(doneKey) || doneKey === "jump") {
        if (this.pendingCombo) {
          const next        = this.pendingCombo;
          this.pendingCombo = null;
          // Stay isAttacking = true, reset window
          this.comboWindowOpen = false;
          this._playAttack(next);
          return;
        }

        // Unlock
        this.isAttacking     = false;
        this.comboWindowOpen = false;
        this.attackCooldown  = POST_ATTACK_COOLDOWN;
        this.comboCount      = 0;
        this.cb.onComboChanged?.(0);
        this.currentAction   = null;
        this.playAnim(this.cb.isMoving() ? "walk" : "idle", FADE.exitAttack);
      }
    });

    // ── Play idle immediately ────────────────────────────────────────────────
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

    // Warm up the mixer (avoids first-frame T-pose)
    this.mixer.update(0);
    this.mixer.update(0.001);
    this.mixer.update(0.001);

    return { modelRoot: model, playerHeight, footOffset };
  }

  // ── playAnim ───────────────────────────────────────────────────────────────

  playAnim(key: AnimKey, fade = FADE.locomotion) {
    if (!this.mixer) return;
    let next = this.actions[key];
    if (!next && this.fallbackAnimKey) next = this.actions[this.fallbackAnimKey];
    if (!next) return;
    if (this.currentAction === next && next.isRunning()) return;

    const prev = this.currentAction;

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
      // Only accept combo input when we're past the combo window
      if (!this.comboWindowOpen) return;

      const next = COMBO_CHAIN[this.currentKey];
      if (next && this.actions[next] && !this.pendingCombo) {
        this.pendingCombo = next;
      }
      return;
    }

    this.isAttacking     = true;
    this.comboWindowOpen = false;
    this.pendingCombo    = null;

    // comboCount incremented ONLY here (not in _playAttack)
    this.comboCount = Math.min(this.comboCount + 1, 999);
    this.comboTimer = 2.0;
    this.cb.onComboChanged?.(this.comboCount);

    this._playAttack(key);
  }

  /** Internal: plays attack anim; does NOT touch comboCount */
  private _playAttack(key: AnimKey) {
    const action = this.actions[key];
    if (!action) return;

    const prev = this.currentAction;
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);

    if (prev && prev !== action) {
      prev.crossFadeTo(action, FADE.toAttack, true);
    }
    action.play();

    this.currentAction = action;
    this.currentKey    = key;
  }

  // ── update ─────────────────────────────────────────────────────────────────

  update(dt: number): { isAttacking: boolean } {
    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.cb.onComboChanged?.(0);
      }
    }

    // ── Open combo window based on clip progress ───────────────────────────
    if (this.isAttacking && !this.comboWindowOpen && this.currentAction) {
      const dur = this.clipDurations[this.currentKey] ?? 0;
      if (dur > 0) {
        const progress = this.currentAction.time / dur;
        if (progress >= COMBO_WINDOW_FRACTION) {
          this.comboWindowOpen = true;
        }
      }
    }

    this.mixer?.update(dt);
    return { isAttacking: this.isAttacking };
  }

  // ── drive ──────────────────────────────────────────────────────────────────

  drive(moving: boolean, sprinting: boolean, onGround: boolean) {
    if (this.isAttacking) return;

    if (!onGround) {
      this.playAnim("jump", FADE.jump);
    } else if (moving && sprinting) {
      this.playAnim("run",  FADE.locomotion);
    } else if (moving) {
      this.playAnim("walk", FADE.locomotion);
    } else {
      this.playAnim("idle", FADE.idle);
    }
  }

  getMixer() { return this.mixer; }
        }
