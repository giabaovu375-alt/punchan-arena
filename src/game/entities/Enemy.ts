import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION CACHE
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
// MODEL CACHE
// Cache lưu RAW scene chưa bị mutate — KHÔNG bao giờ add src vào scene trực tiếp
// ─────────────────────────────────────────────────────────────────────────────
const _modelCache = new Map<string, Promise<THREE.Group>>();
function loadModelCached(url: string): Promise<THREE.Group> {
  if (_modelCache.has(url)) return _modelCache.get(url)!;
  const p = new Promise<THREE.Group>((res, rej) => {
    if (url.endsWith(".glb") || url.endsWith(".gltf")) {
      new GLTFLoader().load(url, (g) => {
        // Đảm bảo src gốc luôn ở trạng thái "sạch" — không có position/rotation lạ
        g.scene.position.set(0, 0, 0);
        g.scene.rotation.set(0, 0, 0);
        g.scene.scale.set(1, 1, 1);
        res(g.scene as THREE.Group);
      }, undefined, rej);
    } else {
      new FBXLoader().load(url, (fbx) => {
        // FBXLoader tự scale x0.01 (cm→m), reset lại để ta tự kiểm soát
        fbx.position.set(0, 0, 0);
        fbx.rotation.set(0, 0, 0);
        fbx.scale.set(1, 1, 1);
        // Nhưng children bên trong vẫn giữ scale gốc của FBX (cm)
        // → ta sẽ normalize trong loadAssets() bằng bbox
        res(fbx as unknown as THREE.Group);
      }, undefined, rej);
    }
  });
  _modelCache.set(url, p);
  return p;
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
  /** Chiều cao mong muốn trong scene (đơn vị mét). Mặc định 1.8m.
   *  Enemy sẽ tự normalize từ bounding box rồi nhân thêm hệ số này nếu cần. */
  targetHeight?:   number;
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
  targetHeight:   1.8,   // goblin cao 1.8m trong scene
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
  private hpBarYOffset = 2.4; // sẽ được tính lại sau khi load model

  private flashTimer = 0;
  private originalEmissives = new Map<THREE.Material, THREE.Color>();

  private _dir  = new THREE.Vector3();
  private _flat = new THREE.Vector3();

  private static readonly AI_RANGE_SQ = 120 * 120;
  private _skipAI = false;

  // FIX: flag để EnemyManager biết enemy này đã bị dispose, tránh double-count
  private _disposed = false;
  get disposed() { return this._disposed; }

  constructor(
    spawnPos: THREE.Vector3,
    config: EnemyConfig,
    private scene: THREE.Scene,
    private hudContainer: HTMLElement,
  ) {
    // Merge config — dùng ?? cho từng field, KHÔNG dùng spread để tránh undefined ghi đè default
    this.cfg = {
      modelUrl:       config.modelUrl,
      animIdle:       config.animIdle,
      animWalk:       config.animWalk,
      animAttack:     config.animAttack,
      animDeath:      config.animDeath,
      targetHeight:   config.targetHeight   ?? 1.8,
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

    // root đặt đúng vị trí spawn ngay từ đầu
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

  // ── Load assets ────────────────────────────────────────────────────────────
  private async loadAssets() {
    try {
      const src = await loadModelCached(this.cfg.modelUrl);

      // FIX: clone() để không mutate src trong cache
      // Sau đó reset hoàn toàn transform của clone — src có thể đã bị mutate ở lần load trước
      const model = src.clone(true);
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      model.scale.set(1, 1, 1);
      model.updateMatrixWorld(true);

      // FIX: Tính bbox ở scale=1 để normalize về targetHeight
      // FBX cm-unit model sẽ có bbox rất lớn (ví dụ height=180), ta scale về đúng kích thước
      const bboxRaw = new THREE.Box3().setFromObject(model);
      const rawH    = bboxRaw.max.y - bboxRaw.min.y;

      let finalScale = 1.0;
      if (rawH > 0.001) {
        // Normalize: scale để model cao đúng targetHeight mét
        finalScale = this.cfg.targetHeight / rawH;
      }
      model.scale.setScalar(finalScale);
      model.updateMatrixWorld(true);

      // Căn foot về y=0 trong không gian local của root
      const bbox       = new THREE.Box3().setFromObject(model);
      const modelH     = bbox.max.y - bbox.min.y;
      const footOffset = isFinite(bbox.min.y) ? -bbox.min.y : 0;
      model.position.set(0, footOffset, 0);

      // HP bar ngay trên đỉnh đầu + 10% margin
      this.hpBarYOffset = modelH + modelH * 0.12;

      model.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow    = true;
        mesh.frustumCulled = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          const m = mat as THREE.MeshStandardMaterial;
          if (m.emissive && !this.originalEmissives.has(m)) {
            this.originalEmissives.set(m, m.emissive.clone());
          }
        });
      });

      // Xóa placeholder, thêm model thật
      this.root.children
        .filter((c) => c.name === "__placeholder")
        .forEach((c) => this.root.remove(c));
      this.root.add(model);
      this.root.updateMatrixWorld(true);

      // Mixer gắn vào model (không phải root) để animation đúng bone
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
    setTimeout(() => {
      this.dispose();
    }, 2500);
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  update(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera): number {
    if (this.state === "dead" || this._disposed) return 0;

    const distSq = this.root.position.distanceToSquared(playerPos);
    this._skipAI = distSq > Enemy.AI_RANGE_SQ;

    // FIX: chỉ update mixer khi enemy trong tầm — tiết kiệm CPU
    if (!this._skipAI) {
      this.mixer?.update(dt);
      this.updateHpBarPosition(camera);
    }

    if (this._skipAI) return 0;

    // Flash emissive khi bị hit
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
    if (this._disposed) return; // FIX: tránh dispose 2 lần
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
    // FIX: filter dựa vào disposed flag thay vì root.parent — tránh double-count mỗi frame
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
