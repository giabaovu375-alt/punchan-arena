import * as THREE from "three";
import { type CharacterDef } from "./characters";

export const ANIM_KEYS = [
  "idle", "walk", "run", "jump",
  "punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "sideKick",
  "pain", "death", "gettingUp",
  "breakdanceEnd", "breakdanceFreeze", "sitting", "sittingIdle",
] as const;
export type AnimKey = (typeof ANIM_KEYS)[number];

export type AnimClipMap = Partial<Record<AnimKey, THREE.AnimationClip>>;

const COMBAT_ANIMS = new Set<AnimKey>([
  "punch","kick","uppercut","dropKick","mmaKick","elbow","sideKick",
  "pain","death","gettingUp",
]);

// Combo: bấm attack khi đang attack → chain sang move tiếp theo
const COMBO_CHAIN: Partial<Record<AnimKey, AnimKey>> = {
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

interface JoystickState {
  active: boolean; startX: number; startY: number;
  dx: number; dy: number; touchId: number;
}

export class GameEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private rafId = 0;
  private disposed = false;
  private character: CharacterDef;

  // Player
  private player!: THREE.Object3D;          // group đóng vai trò "rig"
  private modelRoot: THREE.Object3D | null = null; // model thật bên trong
  private bodyParts: { body: THREE.Object3D; head: THREE.Object3D } | null = null;
  private animTime = 0;

  // Animation
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private currentAction: THREE.AnimationAction | null = null;
  private currentKey: AnimKey = "idle";
  private isAttacking = false;
  private attackCooldown = 0;
  private fallbackAnimKey: AnimKey | null = null;

  // Physics
  private velocity = new THREE.Vector3();
  private onGround = true;
  private playerHeight = 1.6;
  private playerFloor = 0;
  private moveSpeed: number;
  private sprintMultiplier = 1.8;
  private jumpSpeed: number;
  private gravity = -22;

  // Camera
  private cameraYaw = 0;        private targetYaw = 0;
  private cameraPitch = -0.25;  private targetPitch = -0.25;
  private cameraDistance = 6;   private targetDistance = 6;
  private isRotating = false;
  private lastMouse = { x: 0, y: 0 };

  // World
  private worldRadius = 140;
  private fireLight!: THREE.PointLight;

  // Input
  private input: InputState = {
    forward: false, backward: false, left: false,
    right: false,  jump: false,     sprint: false,
  };

  // HUD
  private hudRoot: HTMLElement | null = null;
  private staminaFill: HTMLElement | null = null;
  private hpFill: HTMLElement | null = null;
  private stamina = 1;          // 0..1
  private hp = 1;               // visual only
  private compassNeedle: HTMLElement | null = null;
  private comboEl: HTMLElement | null = null;
  private comboCount = 0;
  private comboTimer = 0;

  // Mobile
  private mobileUI: HTMLElement | null = null;
  private joystick: JoystickState = {
    active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: -1,
  };
  private joystickKnobEl: HTMLElement | null = null;
  private cameraTouch: { id: number; lastX: number; lastY: number } | null = null;
  private isMobile = false;

  constructor(
    container: HTMLElement,
    character: CharacterDef,
    model: THREE.Group | null,
    clips: AnimClipMap,
  ) {
    this.container = container;
    this.character = character;
    this.moveSpeed = character.moveSpeed;
    this.jumpSpeed = character.jumpSpeed;
    this.isMobile = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0x9bc4e2, 40, 180);

    this.camera = new THREE.PerspectiveCamera(
      60, container.clientWidth / container.clientHeight, 0.1, 600,
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true, powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.style.position = "relative";
    container.appendChild(this.renderer.domElement);

    this.buildWorld(this.isMobile);

    // Player wrapper group — đặt vị trí trong world, model thật là child
    // → tách "logic position" khỏi "visual offset" để không bao giờ bị lún
    this.player = new THREE.Group();
    this.player.name = "PlayerRig";

    if (model) {
      this.setupModel(model, clips);
    } else {
      const ph = this.createPlaceholder();
      this.player.add(ph);
    }
    this.scene.add(this.player);

    this.bindEvents();
    this.buildHUD();
    if (this.isMobile) this.buildMobileUI();
    this.start();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODEL SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  private setupModel(model: THREE.Group, clips: AnimClipMap) {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const m = child as THREE.Mesh;
        if (m.material) {
          // tránh tiêu hao GPU vô lý từ skinned mesh frustum culling sai
          m.frustumCulled = false;
        }
      }
    });
    model.scale.setScalar(1);

    // ── FIX LÚN ĐẤT ─────────────────────────────────────────────────────────
    // Tính bbox model ở bind pose, offset model.position.y sao cho feet = 0
    // (player group y=0 = mặt đất, model bên trong tự dâng lên đúng chiều cao)
    // Đo bbox trên tempScene để matrixWorld chính xác trước khi gắn vào player
    // (Nếu đo bbox khi model chưa trong scene → matrixWorld = identity → bbox sai)
    const tempScene = new THREE.Scene();
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    tempScene.add(model);
    model.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(model);
    const modelHeight = bbox.max.y - bbox.min.y;
    // footOffset: dâng model lên để chân chạm đúng y=0 của player group
    const footOffset = isFinite(bbox.min.y) && modelHeight > 0.1 ? -bbox.min.y : 0;
    tempScene.remove(model);

    model.position.set(0, footOffset, 0);
    if (modelHeight > 0.3) this.playerHeight = modelHeight * 0.85;

    this.modelRoot = model;
    this.player.add(model);
    // updateMatrixWorld sau khi add vào player để bone binding đúng → không T-pose
    model.updateMatrixWorld(true);

    this.mixer = new THREE.AnimationMixer(model);

    // Thu thập tên nodes trong model để filter track không khớp
    const nodeNames = new Set<string>();
    model.traverse(n => { if (n.name) nodeNames.add(n.name); });

    for (const key of ANIM_KEYS) {
      let clip = clips[key];
      if (!clip) continue;
      clip = clip.clone();

      // Normalize duration nếu FBX bị scale sai
      if (clip.duration > 10) {
        const s = clip.duration / 2;
        clip.tracks.forEach(t => {
          (t as any).times = (t as any).times.map((v: number) => v / s);
        });
        clip.duration = 2;
      }

      // Chỉ giữ track có bone tồn tại trong model
      clip.tracks = clip.tracks.filter(t => nodeNames.has(t.name.split(".")[0]));

      // Tắt root motion
      clip.tracks = clip.tracks.filter(t => {
        if (!t.name.includes(".position")) return true;
        const bn = t.name.split(".")[0].toLowerCase()
          .replace("mixamorig:", "").replace("mixamorig", "");
        return !(bn === "root" || bn === "hips" || bn === "j_bip_c_hips");
      });

      if (clip.tracks.length === 0) continue;

      const action = this.mixer.clipAction(clip);
      action.timeScale = 1;
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play(); // pre-warm tất cả actions ngay — tránh T-pose khi switch

      if (COMBAT_ANIMS.has(key) || key === "jump") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
      if (!this.fallbackAnimKey) this.fallbackAnimKey = key;
    }

    this.mixer.addEventListener("finished", () => {
      if (COMBAT_ANIMS.has(this.currentKey) || this.currentKey === "jump") {
        this.isAttacking = false;
        this.playAnim(this.isMovingNow() ? "walk" : "idle", 0.15);
      }
    });

    // Bắt đầu idle ngay
    const startKey: AnimKey =
      this.actions.idle ? "idle" :
      this.actions.walk ? "walk" :
      (this.fallbackAnimKey ?? "idle");
    this.playAnim(startKey, 0);
    this.mixer.update(0.001);
  }

  private createPlaceholder(): THREE.Object3D {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.character.color, roughness: 0.6, metalness: 0.15,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 4, 12), bodyMat);
    body.position.y = 0.9; body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe6c7a8, roughness: 0.8 }),
    );
    head.position.y = 1.75; head.castShadow = true;
    group.add(head);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.75, 0.32);
    group.add(nose);
    this.bodyParts = { body, head };
    return group;
  }

  private playAnim(key: AnimKey, fade = 0.2) {
    if (!this.mixer) return;
    let next = this.actions[key];
    if (!next && this.fallbackAnimKey) next = this.actions[this.fallbackAnimKey];
    if (!next) return;
    // Skip nếu đang chạy đúng action này
    if (this.currentAction === next) return;

    const prev = this.currentAction;
    this.currentAction = next;
    this.currentKey = key;

    if (fade <= 0) {
      // Instant switch — tắt tất cả, bật mỗi next
      Object.values(this.actions).forEach(a => {
        if (a && a !== next) { a!.setEffectiveWeight(0); }
      });
      if (COMBAT_ANIMS.has(key) || key === "jump") next.reset();
      next.setEffectiveWeight(1);
      next.play();
      return;
    }

    // Fade: dùng warp=false để tránh pose glitch
    if (prev && prev !== next) {
      prev.crossFadeTo(next, fade, false);
    } else {
      next.setEffectiveWeight(1);
      next.play();
    }
  }

  private isMovingNow() {
    return this.input.forward || this.input.backward || this.input.left || this.input.right;
  }

  private triggerAttack(key: AnimKey) {
    // Nếu đang attack → thử combo chain
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
    // combo counter
    this.comboCount++;
    this.comboTimer = 1.6;
    this.flashCombo();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORLD
  // ═══════════════════════════════════════════════════════════════════════════
  private buildWorld(isMobile = false) {
    const hemi = new THREE.HemisphereLight(0xfff1d9, 0x3a4a2a, 0.7);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3d0, 1.4);
    sun.position.set(60, 80, 40);
    sun.castShadow = true;
    const shadowRes = isMobile ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
    sun.shadow.camera.top  =  80; sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
    fill.position.set(-40, 30, -20);
    this.scene.add(fill);

    const groundGeo = new THREE.PlaneGeometry(400, 400, 120, 120);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const r = Math.sqrt(x*x + y*y);
      const h = Math.sin(x*0.05)*0.5 + Math.cos(y*0.07)*0.5 + Math.sin((x+y)*0.02)*1.2;
      const blend = Math.max(0, Math.min(1, (r - 20) / 15));
      pos.setZ(i, h * blend);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo,
      new THREE.MeshStandardMaterial({ color: 0x6b8e4e, roughness: 0.95, flatShading: true }),
    );
    ground.rotation.x = -Math.PI/2; ground.receiveShadow = true;
    this.scene.add(ground);

    const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 200),
      new THREE.MeshStandardMaterial({ color: 0xa89368, roughness: 1 }),
    );
    path.rotation.x = -Math.PI/2; path.position.y = 0.02; path.receiveShadow = true;
    this.scene.add(path);

    const lake = new THREE.Mesh(new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({
        color: 0x3a6ea8, roughness: 0.2, metalness: 0.4,
        transparent: true, opacity: 0.85,
      }),
    );
    lake.rotation.x = -Math.PI/2; lake.position.set(-45, 0.03, 35);
    this.scene.add(lake);

    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2.2, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 1 });
    const leafGeo  = new THREE.ConeGeometry(1.6, 3.5, 8);
    const leafMats = [
      new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x3a7d3a, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x4a8b3a, roughness: 1, flatShading: true }),
    ];
    for (let i = 0; i < 80; i++) {
      const angle = Math.random()*Math.PI*2, dist = 25 + Math.random()*100;
      const x = Math.cos(angle)*dist, z = Math.sin(angle)*dist;
      if (Math.hypot(x+45, z-35) < 18) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.1; trunk.castShadow = true; tree.add(trunk);
      const leaves = new THREE.Mesh(leafGeo, leafMats[Math.floor(Math.random()*3)]);
      leaves.position.y = 3.4; leaves.castShadow = true; tree.add(leaves);
      tree.position.set(x, 0, z);
      tree.scale.setScalar(0.7 + Math.random()*0.9);
      tree.rotation.y = Math.random()*Math.PI*2;
      this.scene.add(tree);
    }

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 1, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4+Math.random()*1.2, 0), rockMat);
      const angle = Math.random()*Math.PI*2, dist = 15+Math.random()*110;
      rock.position.set(Math.cos(angle)*dist, 0.2, Math.sin(angle)*dist);
      rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      rock.castShadow = true; rock.receiveShadow = true;
      this.scene.add(rock);
    }

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.9, flatShading: true });
    const arch = new THREE.Group();
    for (const [p, s] of [
      [[-1.3,0,0],[0.8,4,0.8]], [[1.3,0,0],[0.8,4,0.8]], [[0,3.2,0],[3.4,0.8,0.8]],
    ] as [[number,number,number],[number,number,number]][]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...s), stoneMat);
      m.position.set(...p); m.castShadow = true; arch.add(m);
    }
    arch.position.set(0, 0, -18); this.scene.add(arch);

    const hutWall = new THREE.MeshStandardMaterial({ color: 0xc8aa72, roughness: 1 });
    const hutRoof = new THREE.MeshStandardMaterial({ color: 0x7c3c14, roughness: 1, flatShading: true });
    for (const [x,,z] of [[18,0,-10],[-18,0,-8],[22,0,14],[-14,0,20],[30,0,-26]]) {
      const hut = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.6,2.8,2.8,8), hutWall);
      wall.position.y = 1.4; wall.castShadow = true; wall.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2,2.2,4), hutRoof);
      roof.position.y = 3.9; roof.rotation.y = Math.PI/4; roof.castShadow = true;
      hut.add(wall, roof);
      hut.position.set(x as number, 0, z as number);
      hut.rotation.y = Math.random()*Math.PI*2;
      this.scene.add(hut);
    }

    const fireBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6,0.8,0.3,8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
    );
    fireBase.position.set(8,0.15,8); this.scene.add(fireBase);
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.4,1,8),
      new THREE.MeshStandardMaterial({ color: 0xff7733, emissive: 0xff5511, emissiveIntensity: 2 }),
    );
    fire.position.set(8,0.8,8); this.scene.add(fire);
    this.fireLight = new THREE.PointLight(0xff7733, 2, 18, 2);
    this.fireLight.position.set(8,1.5,8); this.scene.add(this.fireLight);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUD (desktop + mobile dùng chung — chỉ ẩn/hiện hint tùy thiết bị)
  // ═══════════════════════════════════════════════════════════════════════════
  private injectStyles() {
    if (document.getElementById("__game-engine-style")) return;
    const s = document.createElement("style");
    s.id = "__game-engine-style";
    s.textContent = `
      @keyframes ge-pulse { 0%,100%{ opacity:.85 } 50%{ opacity:1 } }
      @keyframes ge-pop { 0%{ transform:scale(.6); opacity:0 } 40%{ transform:scale(1.15); opacity:1 } 100%{ transform:scale(1); opacity:1 } }
      @keyframes ge-spin90 { from{transform:rotate(0)} to{transform:rotate(90deg)} }
      @media screen and (orientation: portrait) and (max-width: 900px) {
        #__game-rotate-overlay { display:flex !important; }
      }
      .ge-btn {
        position:absolute; border-radius:50%;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:2px; pointer-events:all; touch-action:none;
        font-family: ui-sans-serif, system-ui, sans-serif; font-weight:800;
        color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.45);
        border:1.5px solid rgba(255,255,255,.35);
        transition: transform .08s ease, box-shadow .12s ease, filter .12s ease;
        -webkit-tap-highlight-color: transparent;
        user-select:none; -webkit-user-select:none;
        will-change: transform;
      }
      .ge-btn::before {
        content:""; position:absolute; inset:3px; border-radius:50%;
        background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.35), rgba(255,255,255,0) 55%);
        pointer-events:none;
      }
      .ge-btn:active { transform: scale(.9); filter: brightness(1.15); }
      .ge-card {
        background: linear-gradient(180deg, rgba(20,24,36,.72), rgba(12,14,22,.62));
        backdrop-filter: blur(14px) saturate(140%);
        -webkit-backdrop-filter: blur(14px) saturate(140%);
        border:1px solid rgba(255,255,255,.10);
        box-shadow: 0 8px 28px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06);
        border-radius: 14px;
        color:#eaf0ff; font-family: ui-sans-serif, system-ui, sans-serif;
      }
      .ge-bar-track {
        height:8px; border-radius:999px; overflow:hidden;
        background: rgba(255,255,255,.08);
        box-shadow: inset 0 1px 2px rgba(0,0,0,.45);
      }
      .ge-bar-fill { height:100%; border-radius:999px; transition: width .25s ease; }
      .ge-key {
        display:inline-flex; align-items:center; justify-content:center;
        min-width:18px; height:18px; padding:0 5px;
        font-size:10px; font-weight:800; color:#0a0d17;
        background: linear-gradient(180deg,#f5f7ff,#c4cce0);
        border:1px solid rgba(0,0,0,.2);
        border-radius:4px; box-shadow: 0 1px 0 rgba(0,0,0,.35);
        font-family: ui-monospace, monospace;
      }
    `;
    document.head.appendChild(s);
  }

  private buildHUD() {
    this.injectStyles();

    const hud = document.createElement("div");
    Object.assign(hud.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
      zIndex: "5", overflow: "hidden",
    } as CSSStyleDeclaration);
    this.container.appendChild(hud);
    this.hudRoot = hud;

    // ── TOP-LEFT: character card + HP / Stamina ─────────────────────────────
    const card = document.createElement("div");
    card.className = "ge-card";
    Object.assign(card.style, {
      position: "absolute",
      top: "max(14px, env(safe-area-inset-top,14px))",
      left: "max(14px, env(safe-area-inset-left,14px))",
      padding: "10px 14px 12px",
      minWidth: "210px",
      pointerEvents: "none",
    } as CSSStyleDeclaration);

    const name = this.character?.name ?? "Player";
    const avatarColor = "#" + (this.character?.color ?? 0xffaa44).toString(16).padStart(6, "0");

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="
          width:36px; height:36px; border-radius:10px;
          background: linear-gradient(135deg, ${avatarColor}, #1a1f2e);
          border:1px solid rgba(255,255,255,.18);
          display:flex; align-items:center; justify-content:center;
          font-weight:900; font-size:16px; color:#fff;
          text-shadow:0 1px 2px rgba(0,0,0,.5);
        ">${name.charAt(0).toUpperCase()}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:800; letter-spacing:.04em;">${name}</div>
          <div style="font-size:10px; opacity:.6; letter-spacing:.12em;">LV.1 · WARRIOR</div>
        </div>
      </div>
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
        <div>
          <div style="display:flex; justify-content:space-between; font-size:9px; letter-spacing:.1em; opacity:.7; margin-bottom:3px;">
            <span>HP</span><span id="__ge_hp_txt">100 / 100</span>
          </div>
          <div class="ge-bar-track"><div id="__ge_hp_fill" class="ge-bar-fill" style="width:100%; background:linear-gradient(90deg,#ff5577,#ff8855);"></div></div>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; font-size:9px; letter-spacing:.1em; opacity:.7; margin-bottom:3px;">
            <span>STAMINA</span><span id="__ge_st_txt">100</span>
          </div>
          <div class="ge-bar-track"><div id="__ge_st_fill" class="ge-bar-fill" style="width:100%; background:linear-gradient(90deg,#5ad1ff,#5ee6a8);"></div></div>
        </div>
      </div>
    `;
    hud.appendChild(card);
    this.hpFill      = card.querySelector("#__ge_hp_fill");
    this.staminaFill = card.querySelector("#__ge_st_fill");

    // ── TOP-RIGHT: compass ──────────────────────────────────────────────────
    const compass = document.createElement("div");
    compass.className = "ge-card";
    Object.assign(compass.style, {
      position: "absolute",
      top: "max(14px, env(safe-area-inset-top,14px))",
      right: "max(14px, env(safe-area-inset-right,14px))",
      width: "56px", height: "56px", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "0",
    } as CSSStyleDeclaration);
    compass.innerHTML = `
      <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:800; opacity:.55;">
        <span style="position:absolute; top:4px;">N</span>
        <span style="position:absolute; bottom:4px;">S</span>
        <span style="position:absolute; left:5px;">W</span>
        <span style="position:absolute; right:5px;">E</span>
      </div>
      <div id="__ge_needle" style="
        width:3px; height:24px; border-radius:2px;
        background:linear-gradient(180deg,#ff4d6d 0 50%, #f5f7ff 50% 100%);
        box-shadow:0 0 8px rgba(255,77,109,.6);
        transform-origin:center center;
      "></div>
    `;
    hud.appendChild(compass);
    this.compassNeedle = compass.querySelector("#__ge_needle");

    // ── CENTER-TOP: combo counter ───────────────────────────────────────────
    const combo = document.createElement("div");
    Object.assign(combo.style, {
      position: "absolute",
      top: "max(24px, env(safe-area-inset-top,24px))",
      left: "50%", transform: "translateX(-50%)",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontWeight: "900", fontSize: "28px",
      color: "#ffd75e",
      textShadow: "0 0 18px rgba(255,180,40,.85), 0 2px 6px rgba(0,0,0,.6)",
      letterSpacing: ".05em",
      opacity: "0", pointerEvents: "none",
    } as CSSStyleDeclaration);
    hud.appendChild(combo);
    this.comboEl = combo;

    // ── BOTTOM-LEFT: controls hint (desktop only) ───────────────────────────
    if (!this.isMobile) {
      const hint = document.createElement("div");
      hint.className = "ge-card";
      Object.assign(hint.style, {
        position: "absolute",
        bottom: "16px", left: "16px",
        padding: "10px 14px",
        fontSize: "11px", lineHeight: "1.75",
        pointerEvents: "none",
      } as CSSStyleDeclaration);
      hint.innerHTML = `
        <div style="font-size:10px; letter-spacing:.18em; opacity:.55; margin-bottom:4px;">CONTROLS</div>
        <div><span class="ge-key">W</span><span class="ge-key">A</span><span class="ge-key">S</span><span class="ge-key">D</span> Move</div>
        <div><span class="ge-key">⇧</span> Sprint &nbsp; <span class="ge-key">␣</span> Jump</div>
        <div><span class="ge-key">Z</span><span class="ge-key">X</span><span class="ge-key">C</span><span class="ge-key">V</span> Combat</div>
        <div style="opacity:.55; margin-top:2px;">Drag = camera · Wheel = zoom</div>
      `;
      hud.appendChild(hint);
    }

    // ── CROSSHAIR (desktop) ─────────────────────────────────────────────────
    if (!this.isMobile) {
      const ch = document.createElement("div");
      Object.assign(ch.style, {
        position: "absolute", left: "50%", top: "50%",
        width: "6px", height: "6px", marginLeft: "-3px", marginTop: "-3px",
        borderRadius: "50%", background: "rgba(255,255,255,.35)",
        boxShadow: "0 0 0 1px rgba(0,0,0,.45)",
        pointerEvents: "none",
      } as CSSStyleDeclaration);
      hud.appendChild(ch);
    }
  }

  private flashCombo() {
    if (!this.comboEl) return;
    if (this.comboCount < 2) { this.comboEl.style.opacity = "0"; return; }
    this.comboEl.textContent = `${this.comboCount}× COMBO`;
    this.comboEl.style.animation = "none";
    // force reflow
    void this.comboEl.offsetWidth;
    this.comboEl.style.animation = "ge-pop .35s ease-out forwards";
    this.comboEl.style.opacity = "1";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE UI (joystick + action buttons)
  // ═══════════════════════════════════════════════════════════════════════════
  private buildMobileUI() {
    // Landscape overlay
    if (!document.getElementById("__game-rotate-overlay")) {
      const ov = document.createElement("div");
      ov.id = "__game-rotate-overlay";
      Object.assign(ov.style, {
        display: "none", position: "fixed", inset: "0", zIndex: "9999",
        background: "radial-gradient(circle at center, #161a2a, #06080f)",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "18px", color: "#fff",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      } as CSSStyleDeclaration);
      ov.innerHTML = `
        <div style="font-size:64px; animation:ge-spin90 1.4s ease-in-out infinite alternate">📱</div>
        <div style="font-size:18px; font-weight:800; letter-spacing:.15em;">XOAY NGANG ĐỂ CHƠI</div>
        <div style="font-size:12px; opacity:.55; letter-spacing:.05em;">Rotate device to landscape</div>
      `;
      document.body.appendChild(ov);
    }

    const ui = document.createElement("div");
    Object.assign(ui.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
      zIndex: "10", userSelect: "none", WebkitUserSelect: "none",
    } as CSSStyleDeclaration);
    this.container.appendChild(ui);
    this.mobileUI = ui;

    // ── Joystick ────────────────────────────────────────────────────────────
    const joyWrap = document.createElement("div");
    Object.assign(joyWrap.style, {
      position: "absolute",
      bottom: "max(28px, env(safe-area-inset-bottom,28px))",
      left:   "max(28px, env(safe-area-inset-left,28px))",
      width: "140px", height: "140px", borderRadius: "50%",
      pointerEvents: "all", touchAction: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
    } as CSSStyleDeclaration);

    const joyBase = document.createElement("div");
    Object.assign(joyBase.style, {
      position: "absolute", inset: "0", borderRadius: "50%",
      background: "radial-gradient(circle at center, rgba(255,255,255,.05) 0 40%, rgba(255,255,255,.12) 70%, rgba(255,255,255,.02) 100%)",
      border: "2px solid rgba(255,255,255,.22)",
      boxShadow: "0 8px 28px rgba(0,0,0,.45), inset 0 0 22px rgba(0,0,0,.35)",
      backdropFilter: "blur(8px)",
    } as CSSStyleDeclaration);
    const joyRing = document.createElement("div");
    Object.assign(joyRing.style, {
      position: "absolute", inset: "14px", borderRadius: "50%",
      border: "1px dashed rgba(255,255,255,.18)",
    } as CSSStyleDeclaration);

    const joyKnob = document.createElement("div");
    Object.assign(joyKnob.style, {
      width: "58px", height: "58px", borderRadius: "50%",
      background: "radial-gradient(circle at 30% 25%, #ffffff, #cfd6e8 55%, #8c95ad 100%)",
      border: "2px solid rgba(255,255,255,.95)",
      boxShadow: "0 4px 16px rgba(0,0,0,.55), inset 0 -3px 6px rgba(0,0,0,.25)",
      position: "relative", zIndex: "2",
      transition: "transform .04s linear",
    } as CSSStyleDeclaration);

    joyWrap.appendChild(joyBase);
    joyWrap.appendChild(joyRing);
    joyWrap.appendChild(joyKnob);
    ui.appendChild(joyWrap);
    this.joystickKnobEl = joyKnob;

    // ── Action buttons ──────────────────────────────────────────────────────
    let sprintActive = false;
    const BTN = 64;
    type BtnDef = {
      label: string; icon: string; c1: string; c2: string;
      b: number; r: number; fn: () => void; isToggle?: boolean;
    };
    const btns: BtnDef[] = [
      { label: "JUMP",    icon: "▲", c1: "#3aa8ff", c2: "#1561d6",
        b: 156, r: 112,
        fn: () => { if (this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; } } },
      { label: "PUNCH",   icon: "✊", c1: "#ffb14a", c2: "#e85a14",
        b: 86,  r: 184, fn: () => this.triggerAttack("punch") },
      { label: "KICK",    icon: "🦶", c1: "#ff5d6e", c2: "#c81439",
        b: 16,  r: 112, fn: () => this.triggerAttack("kick") },
      { label: "SPECIAL", icon: "✦", c1: "#c478ff", c2: "#7022d8",
        b: 86,  r: 40,  fn: () => this.triggerAttack("mmaKick") },
      { label: "SPRINT",  icon: "»", c1: "#ffd84a", c2: "#d49a00",
        b: 86,  r: 268, fn: () => {}, isToggle: true },
    ];

    for (const def of btns) {
      const btn = document.createElement("div");
      btn.className = "ge-btn";
      Object.assign(btn.style, {
        bottom: `max(${def.b}px, calc(${def.b}px + env(safe-area-inset-bottom,0px)))`,
        right:  `max(${def.r}px, calc(${def.r}px + env(safe-area-inset-right,0px)))`,
        width:  `${BTN}px`, height: `${BTN}px`,
        background: `radial-gradient(circle at 30% 25%, ${def.c1}, ${def.c2} 75%)`,
        boxShadow: `0 6px 20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset, 0 -4px 10px ${def.c2}66 inset`,
      } as CSSStyleDeclaration);

      const icon = document.createElement("span");
      icon.textContent = def.icon;
      Object.assign(icon.style, {
        fontSize: "22px", lineHeight: "1", pointerEvents: "none",
      } as CSSStyleDeclaration);

      const lbl = document.createElement("span");
      lbl.textContent = def.label;
      Object.assign(lbl.style, {
        fontSize: "8px", letterSpacing: "0.1em",
        color: "rgba(255,255,255,.92)", pointerEvents: "none",
      } as CSSStyleDeclaration);

      btn.appendChild(icon); btn.appendChild(lbl);

      if (def.isToggle) {
        btn.addEventListener("touchstart", (e) => {
          e.preventDefault();
          sprintActive = !sprintActive;
          this.input.sprint = sprintActive;
          btn.style.boxShadow = sprintActive
            ? `0 0 24px ${def.c1}cc, 0 6px 20px rgba(0,0,0,.5), 0 0 0 2px ${def.c1} inset`
            : `0 6px 20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset, 0 -4px 10px ${def.c2}66 inset`;
          btn.style.filter = sprintActive ? "brightness(1.2) saturate(1.2)" : "";
        }, { passive: false });
      } else {
        btn.addEventListener("touchstart", (e) => { e.preventDefault(); def.fn(); }, { passive: false });
      }
      ui.appendChild(btn);
    }

    // ── Joystick touch ──────────────────────────────────────────────────────
    joyWrap.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.changedTouches[0], r = joyWrap.getBoundingClientRect();
      this.joystick = {
        active: true, startX: r.left + r.width/2, startY: r.top + r.height/2,
        dx: 0, dy: 0, touchId: t.identifier,
      };
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.joystick.active && t.identifier === this.joystick.touchId) {
          const MAX = 48;
          let dx = t.clientX - this.joystick.startX;
          let dy = t.clientY - this.joystick.startY;
          const d = Math.hypot(dx, dy); if (d > MAX) { dx *= MAX/d; dy *= MAX/d; }
          this.joystick.dx = dx; this.joystick.dy = dy;
          if (this.joystickKnobEl)
            this.joystickKnobEl.style.transform = `translate(${dx}px,${dy}px)`;
          const nx = dx/MAX, ny = dy/MAX, DZ = 0.18;
          this.input.forward  = ny < -DZ;
          this.input.backward = ny >  DZ;
          this.input.left     = nx < -DZ;
          this.input.right    = nx >  DZ;
        }
        if (this.cameraTouch && t.identifier === this.cameraTouch.id) {
          this.targetYaw   -= (t.clientX - this.cameraTouch.lastX) * 0.006;
          this.targetPitch -= (t.clientY - this.cameraTouch.lastY) * 0.006;
          this.targetPitch  = Math.max(-1.2, Math.min(0.3, this.targetPitch));
          this.cameraTouch.lastX = t.clientX;
          this.cameraTouch.lastY = t.clientY;
        }
      }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystick.touchId) {
          this.joystick.active = false;
          if (this.joystickKnobEl) this.joystickKnobEl.style.transform = "";
          this.input.forward = this.input.backward = this.input.left = this.input.right = false;
        }
        if (this.cameraTouch && t.identifier === this.cameraTouch.id) this.cameraTouch = null;
      }
    });

    this.renderer.domElement.addEventListener("touchstart", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX > window.innerWidth/2 && !this.cameraTouch)
          this.cameraTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY };
      }
    }, { passive: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INPUT
  // ═══════════════════════════════════════════════════════════════════════════
  private bindEvents() {
    window.addEventListener("keydown",   this.onKeyDown);
    window.addEventListener("keyup",     this.onKeyUp);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup",   this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive: false });
    this.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", this.onResize);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp":    this.input.forward = true;  break;
      case "KeyS": case "ArrowDown":  this.input.backward = true; break;
      case "KeyA": case "ArrowLeft":  this.input.left = true;     break;
      case "KeyD": case "ArrowRight": this.input.right = true;    break;
      case "Space": e.preventDefault();
        if (this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; } break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint = true; break;
      case "KeyZ": this.triggerAttack("punch");    break;
      case "KeyX": this.triggerAttack("kick");     break;
      case "KeyC": this.triggerAttack("uppercut"); break;
      case "KeyV": this.triggerAttack("mmaKick");  break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp":    this.input.forward = false;  break;
      case "KeyS": case "ArrowDown":  this.input.backward = false; break;
      case "KeyA": case "ArrowLeft":  this.input.left = false;     break;
      case "KeyD": case "ArrowRight": this.input.right = false;    break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint = false; break;
    }
  };
  private onMouseDown = (e: MouseEvent) => {
    this.isRotating = true; this.lastMouse = { x: e.clientX, y: e.clientY };
    if (e.button === 0) this.triggerAttack("punch");
  };
  private onMouseUp = () => { this.isRotating = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.isRotating) return;
    this.targetYaw   -= (e.clientX - this.lastMouse.x) * 0.005;
    this.targetPitch -= (e.clientY - this.lastMouse.y) * 0.005;
    this.targetPitch  = Math.max(-1.2, Math.min(0.3, this.targetPitch));
    this.lastMouse = { x: e.clientX, y: e.clientY };
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.targetDistance = Math.max(2.5, Math.min(18, this.targetDistance + e.deltaY * 0.01));
  };
  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  private start() {
    this.clock.start();
    const tick = () => {
      if (this.disposed) return;
      const rawDt = this.clock.getDelta();
      const dt    = Math.min(rawDt, 0.05);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private _fwd    = new THREE.Vector3();
  private _rgt    = new THREE.Vector3();
  private _move   = new THREE.Vector3();
  private _camOff = new THREE.Vector3();
  private _tgt    = new THREE.Vector3();
  private _camTarget = new THREE.Vector3();

  private update(dt: number) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Combo timer
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        if (this.comboEl) this.comboEl.style.opacity = "0";
      }
    }

    const lk = 1 - Math.exp(-12 * dt);
    this.cameraYaw      = this.lerpAngle(this.cameraYaw, this.targetYaw, lk);
    this.cameraPitch   += (this.targetPitch - this.cameraPitch) * lk;
    this.cameraDistance+= (this.targetDistance - this.cameraDistance) * lk;

    const fwd = this._fwd.set(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const rgt = this._rgt.set( Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const move = this._move.set(0, 0, 0);
    if (this.input.forward)  move.add(fwd);
    if (this.input.backward) move.sub(fwd);
    if (this.input.right)    move.add(rgt);
    if (this.input.left)     move.sub(rgt);

    const moving = move.lengthSq() > 0;
    if (moving) {
      move.normalize();
      const sprinting = this.input.sprint && this.stamina > 0.05;
      const spd = this.moveSpeed * (sprinting ? this.sprintMultiplier : 1);
      this.velocity.x = move.x * spd;
      this.velocity.z = move.z * spd;
      this.player.rotation.y = this.lerpAngle(
        this.player.rotation.y, Math.atan2(move.x, move.z), Math.min(1, dt * 12),
      );
      // Stamina drain khi sprint
      if (sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.25);
      else           this.stamina = Math.min(1, this.stamina + dt * 0.12);
    } else {
      this.velocity.x *= 0.8; this.velocity.z *= 0.8;
      this.stamina = Math.min(1, this.stamina + dt * 0.22);
    }

    this.velocity.y += this.gravity * dt;
    this.player.position.addScaledVector(this.velocity, dt);

    if (this.player.position.y <= this.playerFloor + 0.05) {
      this.player.position.y = this.playerFloor;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this.player.position.y > this.playerFloor + 0.15) {
      this.onGround = false;
    }

    const d = Math.hypot(this.player.position.x, this.player.position.z);
    if (d > this.worldRadius) {
      this.player.position.x *= this.worldRadius / d;
      this.player.position.z *= this.worldRadius / d;
    }

    // Placeholder bob
    this.animTime += dt;
    if (this.bodyParts) {
      const bob = moving && this.onGround
        ? Math.sin(this.animTime * 14) * 0.06
        : Math.sin(this.animTime * 2) * 0.03;
      this.bodyParts.body.position.y = 0.9 + bob;
      this.bodyParts.head.position.y = 1.75 + bob;
    }

    // Animation state machine
    if (this.mixer) {
      this.mixer.update(dt);
      if (!this.isAttacking) {
        if (!this.onGround)                            this.playAnim("jump", 0.15);
        else if (moving && this.input.sprint && this.stamina > 0.05)
                                                       this.playAnim("run",  0.25);
        else if (moving)                               this.playAnim("walk", 0.25);
        else                                           this.playAnim("idle", 0.35);
      }
    }

    if (this.fireLight)
      this.fireLight.intensity = 1.8 + Math.sin(Date.now() * 0.009) * 0.4 + Math.random() * 0.25;

    // Camera follow — smooth, anchor ngực thay vì đỉnh đầu
    const camOff = this._camOff.set(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      -Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    ).multiplyScalar(this.cameraDistance);
    const tgt = this._tgt.copy(this.player.position);
    tgt.y += this.playerHeight;
    this._camTarget.copy(tgt).add(camOff);
    this.camera.position.lerp(this._camTarget, lk * 1.8);
    this.camera.lookAt(tgt);

    // HUD updates
    if (this.staminaFill) this.staminaFill.style.width = `${Math.round(this.stamina * 100)}%`;
    if (this.hpFill)      this.hpFill.style.width      = `${Math.round(this.hp * 100)}%`;
    if (this.compassNeedle) {
      const deg = -this.cameraYaw * (180 / Math.PI);
      this.compassNeedle.style.transform = `rotate(${deg}deg)`;
    }
  }

  private lerpAngle(a: number, b: number, t: number) {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  getScene()  { return this.scene;  }
  getPlayer() { return this.player; }
  getMixer()  { return this.mixer;  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown",   this.onKeyDown);
    window.removeEventListener("keyup",     this.onKeyUp);
    window.removeEventListener("mouseup",   this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize",    this.onResize);
    this.renderer.dispose();
    if (this.mobileUI && this.mobileUI.parentElement === this.container)
      this.container.removeChild(this.mobileUI);
    if (this.hudRoot && this.hudRoot.parentElement === this.container)
      this.container.removeChild(this.hudRoot);
    document.getElementById("__game-rotate-overlay")?.remove();
    document.getElementById("__game-engine-style")?.remove();
    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }
}
