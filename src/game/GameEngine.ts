import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION CACHE — clip data only, không cache model/skeleton
// ─────────────────────────────────────────────────────────────────────────────
const _animCache = new Map<string, Promise<THREE.AnimationClip | null>>();

function loadClipCached(url: string): Promise<THREE.AnimationClip | null> {
  if (_animCache.has(url)) return _animCache.get(url)!;
  const p = new Promise<THREE.AnimationClip | null>((res) => {
    new FBXLoader().load(
      url,
      (fbx) => res(fbx.animations[0] ?? null),
      undefined,
      () => { console.warn(`⚠️ Clip failed: ${url}`); res(null); }
    );
  });
  _animCache.set(url, p);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load model — MỖI ENEMY LOAD RIÊNG để tránh shared skeleton/bones
// Chỉ cache rawHeight (số đo) để tính scale, không cache THREE.Group
// ─────────────────────────────────────────────────────────────────────────────
const _heightCache = new Map<string, Promise<number>>();

function loadRawHeight(url: string): Promise<number> {
  if (_heightCache.has(url)) return _heightCache.get(url)!;
  const p = new Promise<number>((res) => {
    const onLoaded = (group: THREE.Group) => {
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      group.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(group);
      const rawH = bbox.max.y - bbox.min.y;
      const isCm = rawH > 10;
      const height = isCm ? rawH / 100 : rawH;
      console.log(`[HeightCache] ${url} rawH=${rawH.toFixed(2)} isCm=${isCm} → ${height.toFixed(4)}m`);
      res(height);
    };
    if (url.endsWith(".glb") || url.endsWith(".gltf")) {
      new GLTFLoader().load(url, (g) => onLoaded(g.scene as THREE.Group), undefined, () => res(1.8));
    } else {
      new FBXLoader().load(url, (fbx) => onLoaded(fbx as unknown as THREE.Group), undefined, () => res(1.8));
    }
  });
  _heightCache.set(url, p);
  return p;
}

function loadFreshModel(url: string): Promise<THREE.Group> {
  return new Promise((res, rej) => {
    if (url.endsWith(".glb") || url.endsWith(".gltf")) {
      new GLTFLoader().load(url, (g) => res(g.scene as THREE.Group), undefined, rej);
    } else {
      new FBXLoader().load(url, (fbx) => res(fbx as unknown as THREE.Group), undefined, rej);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
export interface EnemyConfig {
  modelUrl:        string;
  animIdle:        string;
  animWalk:        string;
  animAttack:      string;
  animDeath:       string;
  targetHeight?:   number;
  scale?:          number;
  maxHp?:          number;
  moveSpeed?:      number;
  chaseRange?:     number;
  attackRange?:    number;
  attackDamage?:   number;
  attackCooldown?: number;
  patrolRadius?:   number;
}

export const GOBLIN_CONFIG: EnemyConfig = {
  modelUrl:       "/model/goblin.fbx",
  animIdle:       "/animation/animation-goblin/Rifle Kneel Hit To Back.fbx",
  animWalk:       "/animation/animation-goblin/Walking.fbx",
  animAttack:     "/animation/animation-goblin/Standing Melee Attack Backhand.fbx",
  animDeath:      "/animation/animation-goblin/Zombie Reaction Hit.fbx",
  targetHeight:   1.8,
  scale:          1.0,
  maxHp:          150,
  moveSpeed:      2.2,
  chaseRange:     15,
  attackRange:    2.5,
  attackDamage:   12,
  attackCooldown: 1.2,
  patrolRadius:   6,
};

// ─────────────────────────────────────────────────────────────────────────────
type EnemyState   = "idle" | "patrol" | "chase" | "attack" | "dead";
type EnemyAnimKey = "idle" | "walk" | "attack" | "death";

export class Enemy {
  readonly root: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<EnemyAnimKey, THREE.AnimationAction>> = {};
  private currentAction:  THREE.AnimationAction | null = null;
  private currentAnimKey: EnemyAnimKey | null = null;

  private state: EnemyState = "patrol";
  private hp: number;
  private readonly cfg: Required<EnemyConfig>;

  private spawnPos:        THREE.Vector3;
  private patrolTarget:    THREE.Vector3;
  private patrolWaitTimer = 0;
  private attackTimer     = 0;
  private isAttacking     = false;

  private hpBarEl:   HTMLElement | null = null;
  private hpFillEl:  HTMLElement | null = null;
  private hpLabelEl: HTMLElement | null = null;
  private hpBarYOffset = 2.4;

  private flashTimer = 0;
  private originalEmissives = new Map<THREE.Material, THREE.Color>();

  private _dir  = new THREE.Vector3();
  private _flat = new THREE.Vector3();

  private static readonly AI_RANGE_SQ = 120 * 120;
  private _skipAI = false;

  private _disposed = false;
  get disposed() { return this._disposed; }

  constructor(
    spawnPos: THREE.Vector3,
    config: EnemyConfig,
    private scene: THREE.Scene,
    private hudContainer: HTMLElement,
  ) {
    this.cfg = {
      modelUrl:       config.modelUrl,
      animIdle:       config.animIdle,
      animWalk:       config.animWalk,
      animAttack:     config.animAttack,
      animDeath:      config.animDeath,
      targetHeight:   config.targetHeight   ?? 1.8,
      scale:          config.scale          ?? 1.0,
      maxHp:          config.maxHp          ?? 100,
      moveSpeed:      config.moveSpeed      ?? 2.5,
      chaseRange:     config.chaseRange     ?? 12,
      attackRange:    config.attackRange    ?? 1.6,
      attackDamage:   config.attackDamage   ?? 10,
      attackCooldown: config.attackCooldown ?? 1.5,
      patrolRadius:   config.patrolRadius   ?? 6,
    };

    this.hp           = this.cfg.maxHp;
    this.spawnPos     = spawnPos.clone();
    this.patrolTarget = spawnPos.clone();

    this.root = new THREE.Group();
    this.root.position.copy(spawnPos);
    this.root.frustumCulled = false;
    this.scene.add(this.root);

    this.buildPlaceholder();
    this.buildHpBar();
    this.loadAssets();
    this.pickPatrolTarget();
    this.patrolWaitTimer = 1 + Math.random() * 1.5;
  }

  // ── Placeholder ────────────────────────────────────────────────────────────
  private buildPlaceholder() {
    const mat  = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 4, 8), mat);
    body.position.y = 1.0; body.castShadow = true; body.name = "__placeholder";
    this.root.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xdd4444 }),
    );
    head.position.y = 1.9; head.castShadow = true; head.name = "__placeholder";
    this.root.add(head);

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: new THREE.Color(0xff2200),
      emissiveIntensity: 2,
    });
    for (const sx of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
      eye.position.set(sx, 1.92, 0.24); eye.name = "__placeholder";
      this.root.add(eye);
    }
  }

  // ── Load assets — model load fresh, không clone từ cache ──────────────────
  private async loadAssets() {
    try {
      // Load rawHeight từ cache (chỉ số đo, không giữ Group)
      // Đồng thời load fresh model riêng cho enemy này
      const [rawHeight, model] = await Promise.all([
        loadRawHeight(this.cfg.modelUrl),
        loadFreshModel(this.cfg.modelUrl),
      ]);

      if (this._disposed) return; // enemy bị dispose trong lúc load

      // Reset transform
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      model.updateMatrixWorld(true);

      // Tính scale
      let finalScale = 1.0;
      if (rawHeight > 0.001) {
        finalScale = (this.cfg.targetHeight / rawHeight) * this.cfg.scale;
      }
      console.log(`[Enemy] finalScale=${finalScale.toFixed(4)} targetH=${this.cfg.targetHeight} rawH=${rawHeight.toFixed(4)}`);

      model.scale.setScalar(finalScale);
      model.updateMatrixWorld(true);

      // Căn chân về y=0
      const bbox       = new THREE.Box3().setFromObject(model);
      const modelH     = bbox.max.y - bbox.min.y;
      const footOffset = isFinite(bbox.min.y) ? -bbox.min.y : 0;
      model.position.set(0, footOffset, 0);

      this.hpBarYOffset = modelH + modelH * 0.12;

      model.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow    = true;
        mesh.frustumCulled = false; // tắt frustum culling để tránh pop-in
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          const m = mat as THREE.MeshStandardMaterial;
          if (m.emissive && !this.originalEmissives.has(m)) {
            this.originalEmissives.set(m, m.emissive.clone());
          }
        });
      });

      // Xóa placeholder, thêm model thật
      [...this.root.children]
        .filter((c) => c.name === "__placeholder")
        .forEach((c) => this.root.remove(c));
      this.root.add(model);
      this.root.updateMatrixWorld(true);

      // Mixer gắn vào model (không phải root)
      this.mixer = new THREE.AnimationMixer(model);
      this.mixer.addEventListener("finished", (e: any) => {
        if (e.action === this.actions.attack) {
          this.isAttacking = false;
          if (this.state !== "dead") this.playAnim("idle");
        }
      });

      const [idle, walk, attack, death] = await Promise.all([
        loadClipCached(this.cfg.animIdle),
        loadClipCached(this.cfg.animWalk),
        loadClipCached(this.cfg.animAttack),
        loadClipCached(this.cfg.animDeath),
      ]);

      if (this._disposed) return;

      if (idle)   this.actions.idle   = this.mixer.clipAction(idle);
      if (walk)   this.actions.walk   = this.mixer.clipAction(walk);
      if (attack) {
        const a = this.mixer.clipAction(attack);
        a.loop = THREE.LoopOnce; a.clampWhenFinished = true;
        this.actions.attack = a;
      }
      if (death) {
        const a = this.mixer.clipAction(death);
        a.loop = THREE.LoopOnce; a.clampWhenFinished = true;
        this.actions.death = a;
      }

      this.playAnim("idle");
    } catch (err) {
      console.error("❌ Enemy asset load error:", err);
    }
  }

  private playAnim(key: EnemyAnimKey, crossfade = 0.2) {
    if (!this.mixer) return;
    if (this.currentAnimKey === key) return;
    const next = this.actions[key];
    if (!next) return;
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(crossfade);
    }
    next.reset().fadeIn(crossfade).play();
    this.currentAction  = next;
    this.currentAnimKey = key;
  }

  // ── HP bar ─────────────────────────────────────────────────────────────────
  private buildHpBar() {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      position:absolute; pointer-events:none; z-index:20;
      display:flex; flex-direction:column; align-items:center; gap:2px;
      transform:translateX(-50%); opacity:0; transition:opacity 0.2s;
    `;
    const track = document.createElement("div");
    track.style.cssText = `
      width:56px; height:5px; border-radius:99px;
      background:rgba(0,0,0,0.5);
      border:1px solid rgba(255,255,255,0.15); overflow:hidden;
    `;
    const fill = document.createElement("div");
    fill.style.cssText = `
      height:100%; width:100%; border-radius:99px;
      background:linear-gradient(90deg,#22c55e,#86efac);
      transition:width 0.15s ease;
    `;
    track.appendChild(fill);
    const lbl = document.createElement("div");
    lbl.style.cssText = `
      font-size:9px; font-family:'SF Pro Display',sans-serif;
      color:rgba(255,255,255,0.6); letter-spacing:0.05em;
      text-shadow:0 1px 3px #000;
    `;
    lbl.textContent = String(this.cfg.maxHp);
    wrap.appendChild(track);
    wrap.appendChild(lbl);
    this.hudContainer.appendChild(wrap);
    this.hpBarEl   = wrap;
    this.hpFillEl  = fill;
    this.hpLabelEl = lbl;
  }

  private updateHpBarPosition(camera: THREE.Camera) {
    if (!this.hpBarEl || this.state === "dead") return;
    if (this._skipAI) { this.hpBarEl.style.opacity = "0"; return; }

    const pos = this.root.position.clone();
    pos.y += this.hpBarYOffset;
    pos.project(camera);

    const hw = this.hudContainer.clientWidth  / 2;
    const hh = this.hudContainer.clientHeight / 2;
    const visible = pos.z > -1 && pos.z < 1 && Math.abs(pos.x) < 1.1 && Math.abs(pos.y) < 1.1;
    this.hpBarEl.style.opacity = visible ? "1" : "0";
    this.hpBarEl.style.left    = `${pos.x *  hw + hw}px`;
    this.hpBarEl.style.top     = `${pos.y * -hh + hh}px`;
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

  // ── Patrol ─────────────────────────────────────────────────────────────────
  private pickPatrolTarget() {
    const angle = Math.random() * Math.PI * 2;
    const r     = (0.4 + Math.random() * 0.6) * this.cfg.patrolRadius;
    this.patrolTarget.set(
      this.spawnPos.x + Math.cos(angle) * r,
      this.spawnPos.y,
      this.spawnPos.z + Math.sin(angle) * r,
    );
  }

  // ── Damage ─────────────────────────────────────────────────────────────────
  takeDamage(dmg: number) {
    if (this.state === "dead") return;
    this.hp = Math.max(0, this.hp - dmg);
    this.refreshHpBar();
    this.flashTimer = 0.12;
    if (this.hp <= 0) this.die();
  }

  isDead() { return this.state === "dead"; }

  private die() {
    this.state = "dead";
    this.playAnim("death", 0.1);
    if (this.hpBarEl) this.hpBarEl.style.opacity = "0";
    setTimeout(() => { this.dispose(); }, 2500);
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  update(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera): number {
    if (this.state === "dead" || this._disposed) return 0;

    const distSq = this.root.position.distanceToSquared(playerPos);
    this._skipAI = distSq > Enemy.AI_RANGE_SQ;

    if (!this._skipAI) {
      this.mixer?.update(dt);
      this.updateHpBarPosition(camera);
    }

    if (this._skipAI) return 0;

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const on = this.flashTimer > 0;
      this.root.traverse((n) => {
        const m = n as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          const sm = mat as THREE.MeshStandardMaterial;
          if (!sm.emissive) return;
          if (on) {
            sm.emissive.setHex(0xff2200);
          } else {
            const orig = this.originalEmissives.get(sm);
            if (orig) sm.emissive.copy(orig); else sm.emissive.setHex(0x000000);
          }
        });
      });
    }

    const dist = Math.sqrt(distSq);
    let dmg = 0;

    switch (this.state) {
      case "patrol": {
        if (dist < this.cfg.chaseRange) { this.state = "chase"; this.playAnim("walk"); break; }
        const d2t = this.root.position.distanceTo(this.patrolTarget);
        if (d2t < 0.5) {
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
        if (dist > this.cfg.chaseRange * 1.3) {
          this.state = "patrol"; this.pickPatrolTarget(); this.playAnim("walk"); break;
        }
        if (dist <= this.cfg.attackRange) { this.state = "attack"; break; }
        this.playAnim("walk");
        this.moveToward(playerPos, dt, this.cfg.moveSpeed);
        break;
      }
      case "attack": {
        this.attackTimer -= dt;
        this.faceTarget(playerPos);
        if (dist > this.cfg.attackRange * 1.2) {
          this.state = "chase"; this.playAnim("walk"); break;
        }
        if (this.attackTimer <= 0 && !this.isAttacking) {
          this.attackTimer = this.cfg.attackCooldown;
          this.isAttacking = true;
          this.currentAnimKey = null;
          this.playAnim("attack", 0.1);
          dmg = this.cfg.attackDamage;
        }
        break;
      }
    }

    return dmg;
  }

  private moveToward(target: THREE.Vector3, dt: number, speed: number) {
    this._dir.subVectors(target, this.root.position).setY(0);
    const len = this._dir.length();
    if (len < 0.01) return;
    this._dir.normalize();
    this.root.position.addScaledVector(this._dir, Math.min(speed * dt, len));
    this.faceTarget(target);
  }

  private faceTarget(target: THREE.Vector3) {
    this._flat.subVectors(target, this.root.position).setY(0);
    if (this._flat.lengthSq() < 0.001) return;
    this.root.rotation.y = Math.atan2(this._flat.x, this._flat.z);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
    this.hpBarEl?.parentElement?.removeChild(this.hpBarEl);
    this.originalEmissives.clear();
    this.root.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : [m.material])
          .forEach((mat: THREE.Material) => mat.dispose());
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
    let total = 0;
    for (const e of this.enemies) {
      total += e.update(dt, playerPos, camera);
    }
    this.enemies = this.enemies.filter((e) => !e.disposed);
    return total;
  }

  hitInRange(origin: THREE.Vector3, range: number, damage: number) {
    for (const e of this.enemies) {
      if (!e.isDead() && e.root.position.distanceTo(origin) <= range) {
        e.takeDamage(damage);
      }
    }
  }

  getEnemyRoots(): THREE.Object3D[] {
    return this.enemies.filter((e) => !e.isDead()).map((e) => e.root);
  }

  dispose() {
    this.enemies.forEach((e) => e.dispose());
    this.enemies = [];
  }
      }
    
