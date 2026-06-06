import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
export interface EnemyConfig {
  modelUrl: string;
  animIdle:    string;
  animWalk:    string;
  animAttack:  string;
  animDeath:   string;
  scale?:      number;
  maxHp?:      number;
  moveSpeed?:  number;
  chaseRange?: number;
  attackRange?:number;
  attackDamage?:number;
  attackCooldown?:number;
  patrolRadius?: number;
}

// ─── CONFIG MẶC ĐỊNH CHO GOBLIN ──────────────────────────────────────────────
export const GOBLIN_CONFIG: EnemyConfig = {
  modelUrl:    "/model/goblin.fbx",
  animIdle:    "/animation/animation-goblin/Walking.fbx",      // không có idle riêng
  animWalk:    "/animation/animation-goblin/Walking.fbx",
  animAttack:  "/animation/animation-goblin/Standing Melee Attack Backhand.fbx",
  animDeath:   "/animation/animation-goblin/Zombie Reaction Hit.fbx",
  scale:       1.5,
  maxHp:       80,
  moveSpeed:   2.2,
  chaseRange:  15,
  attackRange: 2.5,
  attackDamage:8,
  attackCooldown:1.2,
  patrolRadius:6,
};

// ─────────────────────────────────────────────────────────────────────────────
type EnemyState = "idle" | "patrol" | "chase" | "attack" | "dead";

export class Enemy {
  readonly root: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<"idle"|"walk"|"attack"|"death", THREE.AnimationAction>> = {};
  private currentAction: THREE.AnimationAction | null = null;

  private state: EnemyState = "patrol";
  private hp: number;
  private readonly cfg: Required<EnemyConfig>;

  private spawnPos: THREE.Vector3;
  private patrolTarget: THREE.Vector3;
  private patrolWaitTimer = 0;

  private attackTimer = 0;
  private isAttacking = false;                            // ✅ Sửa 2

  private hpBarEl: HTMLElement | null = null;
  private hpFillEl: HTMLElement | null = null;
  private hpLabelEl: HTMLElement | null = null;

  private _dir = new THREE.Vector3();
  private _flat = new THREE.Vector3();

  constructor(
    spawnPos: THREE.Vector3,
    config: EnemyConfig,
    private scene: THREE.Scene,
    private hudContainer: HTMLElement,
  ) {
    this.cfg = {
      scale:          config.scale          ?? 1,
      maxHp:          config.maxHp          ?? 100,
      moveSpeed:      config.moveSpeed       ?? 2.5,
      chaseRange:     config.chaseRange      ?? 12,
      attackRange:    config.attackRange     ?? 1.6,
      attackDamage:   config.attackDamage    ?? 10,
      attackCooldown: config.attackCooldown  ?? 1.5,
      patrolRadius:   config.patrolRadius    ?? 6,
      ...config,
    };

    this.hp = this.cfg.maxHp;
    this.spawnPos = spawnPos.clone();
    this.patrolTarget = spawnPos.clone();

    this.root = new THREE.Group();
    this.root.position.copy(spawnPos);
    this.scene.add(this.root);
    this.buildPlaceholder();
    this.buildHpBar();
    this.loadAssets();
    this.pickPatrolTarget();
    this.patrolWaitTimer = 1 + Math.random() * 1.5;      // ✅ Sửa 1
  }

  // ── Placeholder capsule ────────────────────────────────────────────────
  private buildPlaceholder() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 4, 8), mat);
    body.position.y = 1.0;
    body.castShadow = true;
    body.name = "__placeholder";
    this.root.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xdd4444 }),
    );
    head.position.y = 1.9;
    head.castShadow = true;
    head.name = "__placeholder";
    this.root.add(head);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff2200, emissiveIntensity: 2 });
    for (const sx of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
      eye.position.set(sx, 1.92, 0.24);
      eye.name = "__placeholder";
      this.root.add(eye);
    }
  }

  // ── Load model + animations ─────────────────────────────────────────────
  private async loadAssets() {
    try {
      const model = await this.loadModel(this.cfg.modelUrl);
      model.scale.setScalar(this.cfg.scale);
      model.traverse(n => { if ((n as THREE.Mesh).isMesh) n.castShadow = true; });

      const toRemove = this.root.children.filter(c => c.name === "__placeholder");
      toRemove.forEach(c => this.root.remove(c));
      this.root.add(model);

      this.mixer = new THREE.AnimationMixer(model);

      // ✅ Sửa 4: Event khi attack kết thúc
      this.mixer.addEventListener("finished", (e: any) => {
        if (e.action === this.actions.attack) {
          this.isAttacking = false;
          if (this.state !== "dead") {
            this.playAnim("idle");
          }
        }
      });

      const [idle, walk, attack, death] = await Promise.all([
        this.loadClip(this.cfg.animIdle),
        this.loadClip(this.cfg.animWalk),
        this.loadClip(this.cfg.animAttack),
        this.loadClip(this.cfg.animDeath),
      ]);

      // ✅ Sửa 7: idle clip
      if (idle) {
        const a = this.mixer.clipAction(idle);
        a.paused = true;
        this.actions.idle = a;
      }
      if (walk)   this.actions.walk   = this.mixer.clipAction(walk);
      // ✅ Sửa 3: Attack clip loop once
      if (attack) {
        const a = this.mixer.clipAction(attack);
        a.loop = THREE.LoopOnce;
        a.clampWhenFinished = true;
        this.actions.attack = a;
      }
      if (death) {
        const a = this.mixer.clipAction(death);
        a.loop = THREE.LoopOnce;
        a.clampWhenFinished = true;
        this.actions.death = a;
      }

      this.playAnim("idle");
    } catch (err) {
      console.warn("Enemy asset load error:", err);
    }
  }

  private loadModel(url: string): Promise<THREE.Group> {
    return new Promise((res, rej) => {
      if (url.endsWith(".glb") || url.endsWith(".gltf")) {
        new GLTFLoader().load(url, g => res(g.scene as THREE.Group), undefined, rej);
      } else {
        new FBXLoader().load(url, fbx => res(fbx as unknown as THREE.Group), undefined, rej);
      }
    });
  }

  private loadClip(url: string): Promise<THREE.AnimationClip | null> {
    return new Promise((res) => {
      new FBXLoader().load(
        url,
        fbx => res(fbx.animations[0] ?? null),
        undefined,
        () => res(null),
      );
    });
  }

  private playAnim(key: "idle"|"walk"|"attack"|"death", crossfade = 0.2) {
    const next = this.actions[key];
    if (!next || next === this.currentAction) return;
    if (this.currentAction) this.currentAction.fadeOut(crossfade);
    next.reset().fadeIn(crossfade).play();
    this.currentAction = next;
  }

  // ── Thanh HP nổi (DOM overlay) ─────────────────────────────────────────
  private buildHpBar() {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      position:absolute; pointer-events:none; z-index:20;
      display:flex; flex-direction:column; align-items:center; gap:2px;
      transform:translateX(-50%);
      opacity:0; transition:opacity 0.2s;
    `;
    const track = document.createElement("div");
    track.style.cssText = `
      width:56px; height:5px; border-radius:99px;
      background:rgba(0,0,0,0.5);
      border:1px solid rgba(255,255,255,0.15);
      overflow:hidden;
    `;
    const fill = document.createElement("div");
    fill.style.cssText = `
      height:100%; width:100%; border-radius:99px;
      background:linear-gradient(90deg,#ef4444,#f97316);
      transition:width 0.15s ease;
    `;
    track.appendChild(fill);

    const lbl = document.createElement("div");
    lbl.style.cssText = `
      font-size:9px; font-family:'SF Pro Display',sans-serif;
      color:rgba(255,255,255,0.6); letter-spacing:0.05em;
      text-shadow:0 1px 3px #000;
    `;
    lbl.textContent = "???";

    wrap.appendChild(track);
    wrap.appendChild(lbl);
    this.hudContainer.appendChild(wrap);
    this.hpBarEl  = wrap;
    this.hpFillEl = fill;
    this.hpLabelEl = lbl;
  }

  // ── Update HP bar vị trí trên màn hình ────────────────────────────────
  private updateHpBarPosition(camera: THREE.Camera) {
    if (!this.hpBarEl || this.state === "dead") return;
    const pos = this.root.position.clone();
    pos.y += 2.4;
    pos.project(camera);
    const hw = this.hudContainer.clientWidth  / 2;
    const hh = this.hudContainer.clientHeight / 2;
    const sx = pos.x *  hw + hw;
    const sy = pos.y * -hh + hh;
    // ✅ Sửa 6: Kiểm tra phía trước và sau camera
    const visible = pos.z > -1 && pos.z < 1;
    this.hpBarEl.style.opacity  = visible ? "1" : "0";
    this.hpBarEl.style.left     = `${sx}px`;
    this.hpBarEl.style.top      = `${sy}px`;
  }

  private refreshHpBar() {
    if (!this.hpFillEl || !this.hpLabelEl) return;
    const pct = Math.max(0, this.hp / this.cfg.maxHp * 100);
    this.hpFillEl.style.width = `${pct}%`;
    this.hpFillEl.style.background = pct > 50
      ? "linear-gradient(90deg,#22c55e,#86efac)"
      : pct > 25
        ? "linear-gradient(90deg,#f59e0b,#fcd34d)"
        : "linear-gradient(90deg,#ef4444,#f97316)";
    this.hpLabelEl.textContent = `${Math.ceil(this.hp)}`;
  }

  // ── Patrol helpers ─────────────────────────────────────────────────────
  private pickPatrolTarget() {
    const angle = Math.random() * Math.PI * 2;
    const r     = (0.4 + Math.random() * 0.6) * this.cfg.patrolRadius;
    this.patrolTarget.set(
      this.spawnPos.x + Math.cos(angle) * r,
      this.spawnPos.y,
      this.spawnPos.z + Math.sin(angle) * r,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: nhận đòn từ player
  // ─────────────────────────────────────────────────────────────────────────
  takeDamage(dmg: number) {
    if (this.state === "dead") return;
    this.hp = Math.max(0, this.hp - dmg);
    this.refreshHpBar();

    this.root.traverse(n => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat: any) => {
        const orig = mat.emissive?.getHex?.() ?? 0;
        mat.emissive?.setHex(0xff2200);
        setTimeout(() => mat.emissive?.setHex(orig), 120);
      });
    });

    if (this.hp <= 0) this.die();
  }

  isDead() { return this.state === "dead"; }

  // ✅ Sửa 8: Death
  private die() {
    this.state = "dead";
    if (this.actions.death) {
      this.playAnim("death", 0.1);
    }
    if (this.hpBarEl) {
      this.hpBarEl.style.opacity = "0";
    }
    setTimeout(() => {
      this.root.visible = false;
      this.dispose();
    }, 2500);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────────────────────
  update(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera): number {
    if (this.state === "dead") return 0;

    this.mixer?.update(dt);
    this.updateHpBarPosition(camera);

    const distToPlayer = this.root.position.distanceTo(playerPos);
    let damageDealt = 0;

    switch (this.state) {

      case "patrol": {
        if (distToPlayer < this.cfg.chaseRange) {
          this.state = "chase";
          this.playAnim("walk");
          break;
        }
        const distTarget = this.root.position.distanceTo(this.patrolTarget);
        if (distTarget < 0.5) {
          this.patrolWaitTimer -= dt;
          this.playAnim("idle");
          if (this.patrolWaitTimer <= 0) {
            this.pickPatrolTarget();
            this.patrolWaitTimer = 1 + Math.random() * 1.5;
            this.playAnim("walk");
          }
        } else {
          this.playAnim("walk");
          this.moveToward(this.patrolTarget, dt, this.cfg.moveSpeed * 0.6);
        }
        break;
      }

      case "chase": {
        if (distToPlayer > this.cfg.chaseRange * 1.3) {
          this.state = "patrol";
          this.pickPatrolTarget();
          this.playAnim("walk");
          break;
        }
        if (distToPlayer <= this.cfg.attackRange) {
          this.state = "attack";
          break;
        }
        this.playAnim("walk");
        this.moveToward(playerPos, dt, this.cfg.moveSpeed);
        break;
      }

      case "attack": {
        this.attackTimer -= dt;
        this.faceTarget(playerPos);

        if (distToPlayer > this.cfg.attackRange * 1.2) {
          this.state = "chase";
          this.playAnim("walk");
          break;
        }

        // ✅ Sửa 5: Attack state cải tiến
        if (this.attackTimer <= 0 && !this.isAttacking) {
          this.attackTimer = this.cfg.attackCooldown;
          this.isAttacking = true;
          this.playAnim("attack", 0.1);
          damageDealt = this.cfg.attackDamage;
        }
        break;
      }
    }

    return damageDealt;
  }

  // ── Movement helpers ───────────────────────────────────────────────────
  private moveToward(target: THREE.Vector3, dt: number, speed: number) {
    this._dir.subVectors(target, this.root.position);
    this._dir.y = 0;
    const dist = this._dir.length();
    if (dist < 0.01) return;
    this._dir.normalize();
    this.root.position.addScaledVector(this._dir, Math.min(speed * dt, dist));
    this.faceTarget(target);
  }

  private faceTarget(target: THREE.Vector3) {
    this._flat.subVectors(target, this.root.position);
    this._flat.y = 0;
    if (this._flat.lengthSq() < 0.001) return;
    const angle = Math.atan2(this._flat.x, this._flat.z);
    this.root.rotation.y = angle;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  dispose() {
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
    this.hpBarEl?.parentElement?.removeChild(this.hpBarEl);
    this.root.traverse(n => {
      const m = n as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat: THREE.Material) => mat.dispose());
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EnemyManager
// ─────────────────────────────────────────────────────────────────────────────
export class EnemyManager {
  private enemies: Enemy[] = [];

  constructor(
    private scene: THREE.Scene,
    private hudContainer: HTMLElement,
  ) {}

  spawn(positions: THREE.Vector3[], config: EnemyConfig) {
    for (const pos of positions) {
      this.enemies.push(new Enemy(pos, config, this.scene, this.hudContainer));
    }
  }

  update(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera): number {
    let totalDmg = 0;
    for (const e of this.enemies) {
      totalDmg += e.update(dt, playerPos, camera);
    }
    this.enemies = this.enemies.filter(e => !e.isDead() || e.root.parent !== null);
    return totalDmg;
  }

  hitInRange(origin: THREE.Vector3, range: number, damage: number) {
    for (const e of this.enemies) {
      if (!e.isDead() && e.root.position.distanceTo(origin) <= range) {
        e.takeDamage(damage);
      }
    }
  }

  dispose() {
    this.enemies.forEach(e => e.dispose());
    this.enemies = [];
  }
      }
