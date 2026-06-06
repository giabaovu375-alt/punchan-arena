import * as THREE from "three";
import { eventBus } from "../core/EventBus";
import { GameEvents } from "../types/events";
import type { AnimKey } from "../types";

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════
export interface HitEvent {
  origin:   THREE.Vector3;
  forward:  THREE.Vector3;
  range:    number;
  damage:   number;
  isParry:  boolean;
  comboIdx: number;
}

interface ComboStep {
  animKey:  AnimKey;
  damage:   number;
  range:    number;
  delay:    number;   // giây sau khi anim bắt đầu → emit hit
  window:   number;   // giây nhận input bước tiếp (combo window)
  hitstop:  number;   // giây freeze (0 = không freeze)
}

// ═════════════════════════════════════════════════════════════════════════════
// COMBO CHAINS
// ═════════════════════════════════════════════════════════════════════════════
const COMBO_PUNCH: ComboStep[] = [
  { animKey:"punch",   damage:18, range:2.0, delay:0.28, window:0.55, hitstop:0.06 },
  { animKey:"uppercut",damage:22, range:2.1, delay:0.30, window:0.55, hitstop:0.07 },
  { animKey:"elbow",   damage:32, range:2.2, delay:0.35, window:0.65, hitstop:0.09 },
];
const COMBO_KICK: ComboStep[] = [
  { animKey:"kick",    damage:24, range:2.4, delay:0.38, window:0.60, hitstop:0.07 },
  { animKey:"sideKick",damage:28, range:2.5, delay:0.40, window:0.60, hitstop:0.08 },
  { animKey:"dropKick",damage:40, range:2.8, delay:0.42, window:0.70, hitstop:0.11 },
];
const COMBO_SPECIAL: ComboStep[] = [
  { animKey:"mmaKick", damage:35, range:3.0, delay:0.45, window:0.70, hitstop:0.10 },
];

const COMBO_MAP: Record<string, ComboStep[]> = {
  punch:   COMBO_PUNCH,
  kick:    COMBO_KICK,
  mmaKick: COMBO_SPECIAL,
};

// ═════════════════════════════════════════════════════════════════════════════
// HIT PARTICLE (DOM)
// ═════════════════════════════════════════════════════════════════════════════
function spawnHitParticles(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  container: HTMLElement,
  color = "#00cfff",
  count = 8,
) {
  const projected = worldPos.clone().project(camera);
  if (projected.z >= 1) return;
  const hw = container.clientWidth  / 2;
  const hh = container.clientHeight / 2;
  const sx = projected.x *  hw + hw;
  const sy = projected.y * -hh + hh;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    const angle  = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist   = 28 + Math.random() * 36;
    const size   = 4 + Math.random() * 6;
    const dur    = 300 + Math.random() * 200;
    p.style.cssText = `
      position:absolute; pointer-events:none; z-index:50;
      width:${size}px; height:${size}px; border-radius:50%;
      background:${color};
      box-shadow:0 0 ${size * 2}px ${color};
      left:${sx}px; top:${sy}px;
      transform:translate(-50%,-50%);
      transition:transform ${dur}ms ease-out, opacity ${dur}ms ease-out;
    `;
    container.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(
        calc(-50% + ${Math.cos(angle) * dist}px),
        calc(-50% + ${Math.sin(angle) * dist}px)
      )`;
      p.style.opacity = "0";
    });
    setTimeout(() => p.parentElement?.removeChild(p), dur + 50);
  }

  // Flash vàng trung tâm
  const flash = document.createElement("div");
  flash.style.cssText = `
    position:absolute; pointer-events:none; z-index:49;
    width:32px; height:32px; border-radius:50%;
    background:radial-gradient(circle, #fff 0%, ${color}88 50%, transparent 75%);
    left:${sx}px; top:${sy}px;
    transform:translate(-50%,-50%) scale(0.4);
    transition:transform 120ms ease-out, opacity 120ms ease-out;
  `;
  container.appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.transform = "translate(-50%,-50%) scale(1.6)";
    flash.style.opacity = "0";
  });
  setTimeout(() => flash.parentElement?.removeChild(flash), 180);
}

// ═════════════════════════════════════════════════════════════════════════════
// CAMERA SHAKE
// ═════════════════════════════════════════════════════════════════════════════
export class CameraShake {
  private trauma = 0;
  private readonly DECAY = 4.5;
  private readonly MAX_ANGLE = 0.025;
  private readonly MAX_OFFSET = 0.08;
  private _euler = new THREE.Euler();
  private _offset = new THREE.Vector3();

  addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  apply(camera: THREE.PerspectiveCamera, dt: number) {
    this.trauma = Math.max(0, this.trauma - this.DECAY * dt);
    const shake = this.trauma * this.trauma;
    if (shake < 0.001) return;

    const t = performance.now() * 0.012;
    this._euler.set(
      Math.sin(t * 1.7) * this.MAX_ANGLE * shake,
      Math.sin(t * 2.3) * this.MAX_ANGLE * shake,
      Math.sin(t * 3.1) * this.MAX_ANGLE * shake * 0.5,
    );
    camera.rotation.x += this._euler.x;
    camera.rotation.y += this._euler.y;
    camera.rotation.z += this._euler.z;

    this._offset.set(
      Math.sin(t * 2.9) * this.MAX_OFFSET * shake,
      Math.sin(t * 1.5) * this.MAX_OFFSET * shake,
      0,
    );
    camera.position.add(this._offset);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// LOCK-ON TARGET
// ═════════════════════════════════════════════════════════════════════════════
export class LockOnSystem {
  private locked: THREE.Object3D | null = null;
  private reticleEl: HTMLElement | null = null;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildReticle();
  }

  private buildReticle() {
    const el = document.createElement("div");
    el.style.cssText = `
      position:absolute; pointer-events:none; z-index:30;
      width:44px; height:44px;
      transform:translate(-50%,-50%);
      opacity:0; transition:opacity 0.15s;
    `;
    const corners = ["0 0","100% 0","0 100%","100% 100%"];
    const radii   = ["4px 0 0 0","0 4px 0 0","0 0 0 4px","0 0 4px 0"];
    corners.forEach((origin, i) => {
      const c = document.createElement("div");
      c.style.cssText = `
        position:absolute; width:10px; height:10px;
        border:2px solid #00f5d4;
        border-radius:${radii[i]};
        transform-origin:${origin};
        box-shadow:0 0 6px #00f5d488;
      `;
      if (i === 0) c.style.borderRight = c.style.borderBottom = "none";
      if (i === 1) c.style.borderLeft  = c.style.borderBottom = "none";
      if (i === 2) c.style.borderRight = c.style.borderTop    = "none";
      if (i === 3) c.style.borderLeft  = c.style.borderTop    = "none";
      el.appendChild(c);
    });

    const dot = document.createElement("div");
    dot.style.cssText = `
      position:absolute; top:50%; left:50%;
      transform:translate(-50%,-50%);
      width:6px; height:6px; border-radius:50%;
      background:#00f5d4; box-shadow:0 0 8px #00f5d4;
      animation:lockon-pulse 1s ease-in-out infinite;
    `;
    el.appendChild(dot);

    const style = document.createElement("style");
    style.textContent = `
      @keyframes lockon-pulse {
        0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}
        50%{transform:translate(-50%,-50%) scale(1.5);opacity:0.5}
      }
    `;
    document.head.appendChild(style);

    this.container.appendChild(el);
    this.reticleEl = el;
  }

  toggle(enemies: THREE.Object3D[], playerPos: THREE.Vector3) {
    if (this.locked) {
      this.locked = null;
      if (this.reticleEl) this.reticleEl.style.opacity = "0";
      return;
    }
    let closest: THREE.Object3D | null = null;
    let minDist = 15;
    for (const e of enemies) {
      const d = e.position.distanceTo(playerPos);
      if (d < minDist) { minDist = d; closest = e; }
    }
    this.locked = closest;
    if (this.reticleEl) this.reticleEl.style.opacity = closest ? "1" : "0";
  }

  getTarget() { return this.locked; }

  update(camera: THREE.Camera) {
    if (!this.locked || !this.reticleEl) return;
    const pos = this.locked.position.clone();
    pos.y += 1.8;
    pos.project(camera);
    if (pos.z >= 1) { this.reticleEl.style.opacity = "0"; return; }
    const hw = this.container.clientWidth  / 2;
    const hh = this.container.clientHeight / 2;
    this.reticleEl.style.opacity = "1";
    this.reticleEl.style.left = `${pos.x *  hw + hw}px`;
    this.reticleEl.style.top  = `${pos.y * -hh + hh}px`;
  }

  dispose() {
    this.reticleEl?.parentElement?.removeChild(this.reticleEl);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN: CombatController
// ═════════════════════════════════════════════════════════════════════════════
export class CombatController {
  // Combo state
  private comboChain: ComboStep[] = [];
  private comboIdx   = 0;
  private hitTimer   = 0;
  private windowTimer = 0;
  private inputQueued = false;

  // Parry
  private parryWindow  = 0;
  private parryActive  = false;
  private readonly PARRY_DURATION = 0.35;
  private readonly PARRY_COOLDOWN = 1.2;
  private parryCooldownTimer = 0;

  // Hitstop
  private hitstopTimer = 0;
  get isHitstop() { return this.hitstopTimer > 0; }

  // Lock-on
  readonly lockOn: LockOnSystem;

  // Camera shake
  readonly camShake = new CameraShake();

  // Attack forward
  private attackForward = new THREE.Vector3(0, 0, 1);

  constructor(
    private player: THREE.Object3D,
    private camera: THREE.PerspectiveCamera,
    private container: HTMLElement,
    private triggerAnim: (key: AnimKey) => void,
    private getEnemyRoots: () => THREE.Object3D[],
  ) {
    this.lockOn = new LockOnSystem(container);

    // Lắng nghe hit từ event bus → spawn particles
    eventBus.on(GameEvents.PLAYER_ATTACK, (e: HitEvent) => {
      if (e.damage > 0) {
        const hitPos = e.origin.clone().addScaledVector(e.forward, e.range * 0.7);
        hitPos.y += 1.0;
        const color = e.comboIdx >= 2 ? "#ff6600" : e.comboIdx === 1 ? "#00cfff" : "#ffffff";
        spawnHitParticles(hitPos, this.camera, this.container, color, 6 + e.comboIdx * 3);
        this.camShake.addTrauma(0.15 + e.comboIdx * 0.1);
        this.hitstopTimer = e.isParry ? 0.18 : (e as any).hitstop ?? 0.06;
      }
    });
  }

  // ── Nhấn nút tấn công ──────────────────────────────────────────────────
  scheduleAttack(inputKey: "punch" | "kick" | "mmaKick") {
    if (this.isHitstop) return;

    const chain = COMBO_MAP[inputKey];
    if (!chain) return;

    if (
      this.comboChain === chain &&
      this.windowTimer > 0 &&
      this.comboIdx < chain.length - 1
    ) {
      this.inputQueued = true;
      return;
    }

    this.comboChain  = chain;
    this.comboIdx    = 0;
    this.inputQueued = false;
    this.fireStep();
  }

  private fireStep() {
    const step = this.comboChain[this.comboIdx];
    if (!step) return;

    this.triggerAnim(step.animKey);
    this.hitTimer    = step.delay;
    this.windowTimer = step.delay + step.window;
    this.inputQueued = false;

    const target = this.lockOn.getTarget();
    if (target) {
      this.attackForward
        .subVectors(target.position, this.player.position)
        .setY(0).normalize();
      const angle = Math.atan2(this.attackForward.x, this.attackForward.z);
      this.player.rotation.y = angle;
    } else {
      const a = this.player.rotation.y;
      this.attackForward.set(Math.sin(a), 0, Math.cos(a));
    }
  }

  // ── Parry ──────────────────────────────────────────────────────────────
  activateParry() {
    if (this.parryCooldownTimer > 0) return;
    this.parryActive  = true;
    this.parryWindow  = this.PARRY_DURATION;
    this.parryCooldownTimer = this.PARRY_COOLDOWN;
    this.triggerAnim("pain" as AnimKey);
  }

  checkParry(): boolean {
    if (!this.parryActive || this.parryWindow <= 0) return false;
    this.hitstopTimer = 0.22;
    this.camShake.addTrauma(0.25);
    spawnHitParticles(
      this.player.position.clone().setY(this.player.position.y + 1),
      this.camera, this.container, "#ffffff", 12,
    );
    eventBus.emit(GameEvents.PLAYER_ATTACK, {
      origin: this.player.position.clone(),
      forward: this.attackForward.clone(),
      range: 0, damage: 0,
      isParry: true, comboIdx: 0,
    } as HitEvent);
    this.parryActive = false;
    return true;
  }

  // ── Lock-on toggle ─────────────────────────────────────────────────────
  toggleLockOn() {
    this.lockOn.toggle(this.getEnemyRoots(), this.player.position);
  }

  // ── Update mỗi frame ───────────────────────────────────────────────────
  update(dt: number) {
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      return;
    }

    if (this.parryCooldownTimer > 0) this.parryCooldownTimer -= dt;
    if (this.parryWindow > 0) {
      this.parryWindow -= dt;
      if (this.parryWindow <= 0) this.parryActive = false;
    }

    this.lockOn.update(this.camera);

    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) {
        const step = this.comboChain[this.comboIdx];
        if (step) {
          eventBus.emit(GameEvents.PLAYER_ATTACK, {
            origin:   this.player.position.clone(),
            forward:  this.attackForward.clone(),
            range:    step.range,
            damage:   step.damage,
            isParry:  false,
            comboIdx: this.comboIdx,
            hitstop:  step.hitstop,
          } as HitEvent);
        }
      }
    }

    if (this.windowTimer > 0) {
      this.windowTimer -= dt;
      if (this.windowTimer <= 0) {
        this.comboIdx    = 0;
        this.inputQueued = false;
      } else if (
        this.inputQueued &&
        this.hitTimer <= 0 &&
        this.comboIdx < this.comboChain.length - 1
      ) {
        this.comboIdx++;
        this.fireStep();
      }
    }
  }

  // ── Reset (khi chuyển scene) ──────────────────────────────────────────
  reset() {
    this.comboChain = [];
    this.comboIdx = 0;
    this.hitTimer = 0;
    this.windowTimer = 0;
    this.inputQueued = false;
  }

  dispose() {
    this.lockOn.dispose();
    // Bỏ listener nếu cần (eventBus.off), nhưng vì chỉ nghe PLAYER_ATTACK nên có thể để chung
  }
}
