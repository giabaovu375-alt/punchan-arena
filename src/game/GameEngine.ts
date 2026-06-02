import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type CharacterDef } from "./characters";

// ─── Animation keys + tên clip ứng viên trong file model ─────────────────────
// Animation được EMBED sẵn trong file GLB của model (không tải FBX riêng).
// Mỗi key gắn 1 danh sách tên ứng viên — match không phân biệt hoa thường,
// khớp 1 phần cũng OK để chịu được khác biệt tên do artist đặt.
export const ANIM_CLIPS = {
  idle:     ["idle", "idle_loop", "stand"],
  walk:     ["walk", "walking", "walk_forward"],
  run:      ["run", "running", "sprint"],
  jump:     ["jump", "jumping", "jump_up"],
  kick:     ["kick", "kicking", "front_kick"],
  punch:    ["hook punch", "hook", "punch", "punching"],
  uppercut: ["uppercut jab", "uppercut", "jab"],
  dropKick: ["drop kick", "dropkick"],
  mmaKick:  ["mma kick", "mma", "roundhouse"],
  elbow:    ["elbow uppercut combo", "elbow combo", "elbow"],
  pain:     ["pain gesture", "pain", "hit", "hurt"],
} as const;

export type AnimKey = keyof typeof ANIM_CLIPS;

const ANIM_PRIORITY: AnimKey[] = [
  "idle",
  "walk", "run", "jump",
  "punch", "kick", "uppercut", "mmaKick",
  "dropKick", "elbow", "pain",
];

const COMBAT_ONESHOT = new Set<AnimKey>([
  "punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "pain", "jump",
]);
const COMBAT_RECOVER = new Set<AnimKey>([
  "punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "pain",
]);

// ─── Singleton loader + cache GLTF (kèm animations embed) ────────────────────
const _gltfLoader = /* @__PURE__ */ new GLTFLoader();

interface LoadedGLTF {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}
const _gltfCache = new Map<string, Promise<LoadedGLTF>>();

function loadGLTFOnce(url: string): Promise<LoadedGLTF> {
  let p = _gltfCache.get(url);
  if (!p) {
    p = new Promise<LoadedGLTF>((resolve, reject) => {
      _gltfLoader.load(
        url,
        (gltf) => {
          // Retarget: strip prefix mixamorig: trên track names để khớp skeleton
          for (const clip of gltf.animations) {
            for (const t of clip.tracks) {
              t.name = t.name.replace(/^mixamorig[\d]*:?/i, "");
            }
          }
          resolve({
            scene: gltf.scene as THREE.Group,
            animations: gltf.animations ?? [],
          });
        },
        undefined,
        reject,
      );
    });
    _gltfCache.set(url, p);
  }
  return p;
}

// Tìm clip trong danh sách animations của model theo các tên ứng viên
function findClip(
  animations: THREE.AnimationClip[],
  candidates: readonly string[],
): THREE.AnimationClip | null {
  const lower = animations.map((c) => ({ clip: c, name: c.name.toLowerCase() }));
  for (const cand of candidates) {
    const c = cand.toLowerCase();
    const exact = lower.find((x) => x.name === c);
    if (exact) return exact.clip;
  }
  for (const cand of candidates) {
    const c = cand.toLowerCase();
    const partial = lower.find((x) => x.name.includes(c));
    if (partial) return partial.clip;
  }
  return null;
}

// ─── Input ────────────────────────────────────────────────────────────────────
export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  punch: boolean;
  kick: boolean;
  special: boolean;
}

// ─── Mobile joystick data ─────────────────────────────────────────────────────
interface JoystickState {
  active: boolean;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  touchId: number;
}

// ─── GameEngine ───────────────────────────────────────────────────────────────
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
  private player!: THREE.Object3D;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private currentAction: THREE.AnimationAction | null = null;
  private currentKey: AnimKey = "idle";
  private modelReady = false;

  private velocity = new THREE.Vector3();
  private onGround = true;
  private playerHeight = 1.6;
  private moveSpeed: number;
  private sprintMultiplier = 1.8;
  private jumpSpeed: number;
  private gravity = -22;

  // Combat state
  private isAttacking = false;
  private attackCooldown = 0;

  // Camera orbit (smooth lerp)
  private cameraYaw = 0;
  private cameraPitch = -0.25;
  private cameraDistance = 7;
  private targetYaw = 0;
  private targetPitch = -0.25;
  private targetDistance = 7;
  private isRotating = false;
  private lastMouse = { x: 0, y: 0 };

  // World
  private worldRadius = 140;
  private fireLight!: THREE.PointLight;

  // Input
  private input: InputState = {
    forward: false, backward: false,
    left: false, right: false,
    jump: false, sprint: false,
    punch: false, kick: false, special: false,
  };

  // Mobile UI elements
  private mobileUI: HTMLElement | null = null;
  private joystickMove: JoystickState = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: -1 };
  private joystickKnobEl: HTMLElement | null = null;
  private cameraTouch: { id: number; lastX: number; lastY: number } | null = null;

  // Reusable temp vectors (tránh GC pressure trong update loop)
  private _tmpForward = new THREE.Vector3();
  private _tmpRight   = new THREE.Vector3();
  private _tmpMove    = new THREE.Vector3();
  private _tmpCamOff  = new THREE.Vector3();
  private _tmpTarget  = new THREE.Vector3();

  constructor(container: HTMLElement, character: CharacterDef) {
    this.container = container;
    this.character = character;
    this.moveSpeed = character.moveSpeed;
    this.jumpSpeed = character.jumpSpeed;

    const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87aacc);
    this.scene.fog = new THREE.FogExp2(0x87aacc, 0.008);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      800,
    );

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.buildWorld(isMobile);
    this.createPlayerPlaceholder();
    this.loadCharacterModel(); // async, không block
    this.bindEvents();
    if (isMobile) this.buildMobileUI();
    this.start();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORLD
  // ═══════════════════════════════════════════════════════════════════════════
  private buildWorld(isMobile: boolean) {
    // ── Lighting ──────────────────────────────────────────────────────────────
    const hemi = new THREE.HemisphereLight(0xfff6e0, 0x2d4a1e, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3c8, 1.6);
    sun.position.set(70, 100, 50);
    sun.castShadow = true;
    const shadowSize = isMobile ? 1024 : 2048; // 4096 quá nặng, không tăng chất lượng đáng kể
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x6699ff, 0.35);
    rim.position.set(-50, 40, -30);
    this.scene.add(rim);

    // ── Ground terrain ────────────────────────────────────────────────────────
    const groundGeo = new THREE.PlaneGeometry(500, 500, 150, 150);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.sqrt(x * x + y * y);
      const h =
        Math.sin(x * 0.045) * 0.7 +
        Math.cos(y * 0.06) * 0.6 +
        Math.sin((x + y) * 0.018) * 1.5 +
        Math.sin(x * 0.12) * 0.3;
      const flatten = Math.min(1, r / 20);
      pos.setZ(i, h * flatten);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({
        color: 0x5a7a3a,
        roughness: 0.95,
        metalness: 0,
        flatShading: true,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // ── Dirt path ─────────────────────────────────────────────────────────────
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(4.5, 260),
      new THREE.MeshStandardMaterial({ color: 0x9a8060, roughness: 1 }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.y = 0.02;
    path.receiveShadow = true;
    this.scene.add(path);

    // ── Lake ──────────────────────────────────────────────────────────────────
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(16, 64),
      new THREE.MeshStandardMaterial({
        color: 0x2255aa,
        roughness: 0.05,
        metalness: 0.6,
        transparent: true,
        opacity: 0.82,
        envMapIntensity: 1.5,
      }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(-50, 0.04, 38);
    this.scene.add(lake);

    // ── Trees (shared geo/mat) ────────────────────────────────────────────────
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 2.4, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2e14, roughness: 1 });
    const leafGeo  = new THREE.ConeGeometry(1.8, 4, 8);
    const leafGeo2 = new THREE.ConeGeometry(1.3, 3, 8);
    const leafMats = [
      new THREE.MeshStandardMaterial({ color: 0x1e5c28, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x2a6e30, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x3a7e38, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x4a5e20, roughness: 1, flatShading: true }),
    ];
    const treeCount = isMobile ? 60 : 100;
    for (let i = 0; i < treeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 110;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (Math.hypot(x + 50, z - 38) < 20) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.2;
      trunk.castShadow = true;
      tree.add(trunk);
      const leaves = new THREE.Mesh(leafGeo, leafMats[Math.floor(Math.random() * leafMats.length)]);
      leaves.position.y = 3.8;
      leaves.castShadow = true;
      tree.add(leaves);
      const leaves2 = new THREE.Mesh(leafGeo2, leafMats[Math.floor(Math.random() * leafMats.length)]);
      leaves2.position.y = 5.2;
      leaves2.castShadow = true;
      tree.add(leaves2);
      tree.position.set(x, 0, z);
      const s = 0.6 + Math.random() * 1.1;
      tree.scale.setScalar(s);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(tree);
    }

    // ── Rocks (shared geo per size bucket) ────────────────────────────────────
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6a64, roughness: 1, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0); // unit, scale per instance
    const rockCount = isMobile ? 30 : 50;
    for (let i = 0; i < rockCount; i++) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const angle = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 120;
      const sc = 0.3 + Math.random() * 1.4;
      rock.scale.setScalar(sc);
      rock.position.set(Math.cos(angle) * dist, 0.2, Math.sin(angle) * dist);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    }

    // ── Stone arch ────────────────────────────────────────────────────────────
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 0.9, flatShading: true });
    const archPositions = [
      { pos: [-1.4, 0, 0], size: [0.8, 4.5, 0.9] },
      { pos: [1.4, 0, 0], size: [0.8, 4.5, 0.9] },
      { pos: [0, 3.8, 0], size: [3.8, 0.9, 0.9] },
    ];
    const arch = new THREE.Group();
    for (const { pos, size } of archPositions) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...(size as [number, number, number])), stoneMat);
      m.position.set(...(pos as [number, number, number]));
      m.castShadow = true;
      m.receiveShadow = true;
      arch.add(m);
    }
    arch.position.set(0, 0, -20);
    this.scene.add(arch);

    // ── Huts / village (shared geo/mat) ───────────────────────────────────────
    const hutWallMat = new THREE.MeshStandardMaterial({ color: 0xc8a870, roughness: 1 });
    const hutRoofMat = new THREE.MeshStandardMaterial({ color: 0x7a3c18, roughness: 1, flatShading: true });
    const hutWallGeo = new THREE.CylinderGeometry(2.8, 3.0, 2.8, 8);
    const hutRoofGeo = new THREE.ConeGeometry(3.6, 2.4, 8);
    const hutPositions = [
      [18, 0, -12], [-18, 0, -10], [22, 0, 14], [-15, 0, 20], [30, 0, -28],
    ];
    for (const [x, , z] of hutPositions) {
      const hut = new THREE.Group();
      const wall = new THREE.Mesh(hutWallGeo, hutWallMat);
      wall.position.y = 1.4;
      wall.castShadow = true;
      wall.receiveShadow = true;
      const roof = new THREE.Mesh(hutRoofGeo, hutRoofMat);
      roof.position.y = 4.2;
      roof.rotation.y = Math.PI / 8;
      roof.castShadow = true;
      hut.add(wall, roof);
      hut.position.set(x, 0, z);
      hut.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(hut);
    }

    // ── Bonfire ───────────────────────────────────────────────────────────────
    const fireBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.9, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x1e1e1e }),
    );
    fireBase.position.set(8, 0.18, 8);
    this.scene.add(fireBase);
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: 0xff6622, emissive: 0xff4400, emissiveIntensity: 3 }),
    );
    fire.position.set(8, 0.95, 8);
    this.scene.add(fire);
    this.fireLight = new THREE.PointLight(0xff6622, 3, 22, 2);
    this.fireLight.position.set(8, 1.8, 8);
    this.scene.add(this.fireLight);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAYER — placeholder + progressive model/animation loader
  // ═══════════════════════════════════════════════════════════════════════════
  private createPlayerPlaceholder() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: this.character.color,
      roughness: 0.5,
      metalness: 0.2,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 4, 12), mat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8d0a8, roughness: 0.75 }),
    );
    head.position.y = 1.88;
    head.castShadow = true;
    group.add(head);
    this.player = group;
    this.scene.add(this.player);
  }

  private async loadCharacterModel() {
    // Tải DUY NHẤT 1 file model (GLB) — animations đã embed sẵn bên trong.
    let loaded: LoadedGLTF;
    try {
      loaded = await loadGLTFOnce(this.character.modelUrl);
    } catch (err) {
      console.error("[GameEngine] Lỗi load model:", err);
      return; // giữ placeholder
    }
    if (this.disposed) return;

    const model = loaded.scene;
    model.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        // Tắt frustum culling cho skinned mesh → tránh biến mất khi anim biên độ lớn
        if ((m as any).isSkinnedMesh) m.frustumCulled = false;
      }
    });
    model.scale.setScalar(0.01);
    model.position.set(0, 0, 0);

    // Swap placeholder → real model
    this.scene.remove(this.player);
    this.player = model;
    this.scene.add(this.player);
    this.mixer = new THREE.AnimationMixer(this.player);
    this.mixer.addEventListener("finished", this.onAnimFinished);
    this.modelReady = true;

    // ── Map animations embed trong model → action keys ───────────────────────
    if (loaded.animations.length === 0) {
      console.warn(
        "[GameEngine] Model không chứa animation nào — kiểm tra lại file GLB " +
          "(cần export kèm animation từ Mixamo/Blender).",
      );
    }

    // idle attach + play trước cho mượt
    const idleClip = findClip(loaded.animations, ANIM_CLIPS.idle);
    if (idleClip) {
      this.attachClip("idle", idleClip);
      this.playAnim("idle", 0.2);
    }

    // các anim còn lại — attach hết (đã có sẵn trong memory, không tốn gì)
    for (const key of ANIM_PRIORITY) {
      if (key === "idle") continue;
      const clip = findClip(loaded.animations, ANIM_CLIPS[key]);
      if (clip) {
        this.attachClip(key, clip);
      } else {
        console.warn(`[GameEngine] Thiếu animation "${key}" trong model.`);
      }
    }
  }

  private attachClip(key: AnimKey, clip: THREE.AnimationClip) {
    if (!this.mixer) return;
    const action = this.mixer.clipAction(clip);
    if (COMBAT_ONESHOT.has(key)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    this.actions[key] = action;
  }

  private onAnimFinished = () => {
    if (COMBAT_RECOVER.has(this.currentKey)) {
      this.isAttacking = false;
      this.playAnim(this.isMoving() ? "walk" : "idle", 0.25);
    }
    if (this.currentKey === "jump" && this.onGround) {
      this.playAnim("idle", 0.2);
    }
  };

  private playAnim(key: AnimKey, fadeDuration = 0.2) {
    if (!this.mixer || this.currentKey === key) return;
    const next = this.actions[key];
    if (!next) return; // clip chưa load xong → giữ anim hiện tại
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(fadeDuration);
    }
    next.reset().fadeIn(fadeDuration).play();
    this.currentAction = next;
    this.currentKey = key;
  }

  private isMoving() {
    return this.input.forward || this.input.backward || this.input.left || this.input.right;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE UI
  // ═══════════════════════════════════════════════════════════════════════════
  private buildMobileUI() {
    const ui = document.createElement("div");
    ui.id = "game-mobile-ui";
    Object.assign(ui.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "10",
      userSelect: "none",
      WebkitUserSelect: "none",
    });
    this.container.style.position = "relative";
    this.container.appendChild(ui);
    this.mobileUI = ui;

    const joyBase = document.createElement("div");
    Object.assign(joyBase.style, {
      position: "absolute",
      bottom: "40px",
      left: "40px",
      width: "120px",
      height: "120px",
      borderRadius: "50%",
      background: "rgba(255,255,255,0.12)",
      border: "2px solid rgba(255,255,255,0.3)",
      backdropFilter: "blur(4px)",
      pointerEvents: "all",
      touchAction: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const joyKnob = document.createElement("div");
    Object.assign(joyKnob.style, {
      width: "48px",
      height: "48px",
      borderRadius: "50%",
      background: "rgba(255,255,255,0.5)",
      border: "2px solid rgba(255,255,255,0.8)",
      transition: "transform 0.05s",
      boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
      position: "relative",
    });
    joyBase.appendChild(joyKnob);
    ui.appendChild(joyBase);
    this.joystickKnobEl = joyKnob;

    const btnDefs: { label: string; color: string; action: () => void; bottom: string; right: string }[] = [
      { label: "👊", color: "rgba(255,120,50,0.75)", action: () => this.triggerAttack("punch"),   bottom: "110px", right: "50px" },
      { label: "🦵", color: "rgba(255,60,80,0.75)",  action: () => this.triggerAttack("kick"),    bottom: "50px",  right: "115px" },
      { label: "⬆️", color: "rgba(80,180,255,0.75)", action: () => { if (this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; } }, bottom: "50px", right: "40px" },
      { label: "💥", color: "rgba(180,80,255,0.75)", action: () => this.triggerAttack("mmaKick"), bottom: "115px", right: "118px" },
    ];

    for (const def of btnDefs) {
      const btn = document.createElement("div");
      Object.assign(btn.style, {
        position: "absolute",
        bottom: def.bottom,
        right: def.right,
        width: "58px",
        height: "58px",
        borderRadius: "50%",
        background: def.color,
        border: "2px solid rgba(255,255,255,0.4)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "22px",
        pointerEvents: "all",
        touchAction: "none",
        boxShadow: "0 3px 14px rgba(0,0,0,0.35)",
        transition: "transform 0.1s, opacity 0.1s",
      });
      btn.textContent = def.label;
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        btn.style.transform = "scale(0.9)";
        btn.style.opacity = "0.8";
        def.action();
      }, { passive: false });
      btn.addEventListener("touchend", () => {
        btn.style.transform = "scale(1)";
        btn.style.opacity = "1";
      });
      ui.appendChild(btn);
    }

    const sprintBtn = document.createElement("div");
    Object.assign(sprintBtn.style, {
      position: "absolute",
      bottom: "40px",
      left: "175px",
      width: "48px",
      height: "48px",
      borderRadius: "12px",
      background: "rgba(255,200,50,0.65)",
      border: "2px solid rgba(255,255,255,0.35)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "20px",
      pointerEvents: "all",
      touchAction: "none",
      boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
    });
    sprintBtn.textContent = "⚡";
    sprintBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.input.sprint = !this.input.sprint;
      sprintBtn.style.background = this.input.sprint
        ? "rgba(255,220,0,0.9)"
        : "rgba(255,200,50,0.65)";
    }, { passive: false });
    ui.appendChild(sprintBtn);

    joyBase.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      const rect = joyBase.getBoundingClientRect();
      this.joystickMove = {
        active: true,
        startX: rect.left + rect.width / 2,
        startY: rect.top + rect.height / 2,
        dx: 0, dy: 0,
        touchId: touch.identifier,
      };
    }, { passive: false });

    window.addEventListener("touchmove", this.onTouchMove, { passive: true });
    window.addEventListener("touchend", this.onTouchEnd);
    this.renderer.domElement.addEventListener("touchstart", this.onCanvasTouchStart, { passive: true });
  }

  private onTouchMove = (e: TouchEvent) => {
    if (this.joystickMove.active) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystickMove.touchId) {
          const maxR = 44;
          let dx = t.clientX - this.joystickMove.startX;
          let dy = t.clientY - this.joystickMove.startY;
          const dist = Math.hypot(dx, dy);
          if (dist > maxR) { dx *= maxR / dist; dy *= maxR / dist; }
          this.joystickMove.dx = dx;
          this.joystickMove.dy = dy;
          if (this.joystickKnobEl) {
            this.joystickKnobEl.style.transform = `translate(${dx}px, ${dy}px)`;
          }
          const nx = dx / maxR;
          const ny = dy / maxR;
          const deadzone = 0.15;
          this.input.forward = ny < -deadzone;
          this.input.backward = ny > deadzone;
          this.input.left = nx < -deadzone;
          this.input.right = nx > deadzone;
        }
      }
    }
    if (this.cameraTouch) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.cameraTouch.id) {
          const dx = t.clientX - this.cameraTouch.lastX;
          const dy = t.clientY - this.cameraTouch.lastY;
          this.targetYaw -= dx * 0.006;
          this.targetPitch -= dy * 0.006;
          this.targetPitch = Math.max(-1.2, Math.min(0.3, this.targetPitch));
          this.cameraTouch.lastX = t.clientX;
          this.cameraTouch.lastY = t.clientY;
        }
      }
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joystickMove.touchId) {
        this.joystickMove.active = false;
        this.joystickMove.dx = 0;
        this.joystickMove.dy = 0;
        if (this.joystickKnobEl) this.joystickKnobEl.style.transform = "";
        this.input.forward = false;
        this.input.backward = false;
        this.input.left = false;
        this.input.right = false;
      }
      if (this.cameraTouch && t.identifier === this.cameraTouch.id) {
        this.cameraTouch = null;
      }
    }
  };

  private onCanvasTouchStart = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX > window.innerWidth / 2 && !this.cameraTouch) {
        this.cameraTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY };
      }
    }
  };

  private triggerAttack(key: AnimKey) {
    if (this.isAttacking || this.attackCooldown > 0) return;
    if (!this.actions[key]) return; // anim chưa load → bỏ qua êm
    this.isAttacking = true;
    this.attackCooldown = 0.6;
    this.playAnim(key, 0.1);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYBOARD / MOUSE INPUT
  // ═══════════════════════════════════════════════════════════════════════════
  private bindEvents() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
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
      case "Space":
        e.preventDefault();
        if (this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; }
        break;
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
    if (e.button === 2 || e.button === 0) {
      this.isRotating = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    }
    if (e.button === 0) this.triggerAttack("punch");
  };
  private onMouseUp = () => { this.isRotating = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.isRotating) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    this.targetYaw -= dx * 0.005;
    this.targetPitch -= dy * 0.005;
    this.targetPitch = Math.max(-1.2, Math.min(0.3, this.targetPitch));
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.targetDistance += e.deltaY * 0.012;
    this.targetDistance = Math.max(2.5, Math.min(20, this.targetDistance));
  };
  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // GAME LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  private start() {
    const tick = () => {
      if (this.disposed) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(dt: number) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const camLerp = 1 - Math.exp(-12 * dt);
    this.cameraYaw = this.lerpAngle(this.cameraYaw, this.targetYaw, camLerp);
    this.cameraPitch += (this.targetPitch - this.cameraPitch) * camLerp;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * camLerp;

    // Movement (dùng vector tái sử dụng)
    const forward = this._tmpForward.set(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right   = this._tmpRight.set( Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const move    = this._tmpMove.set(0, 0, 0);
    if (this.input.forward)  move.add(forward);
    if (this.input.backward) move.sub(forward);
    if (this.input.right)    move.add(right);
    if (this.input.left)     move.sub(right);

    const moving = move.lengthSq() > 0;

    if (moving) {
      move.normalize();
      const speed = this.moveSpeed * (this.input.sprint ? this.sprintMultiplier : 1);
      this.velocity.x = move.x * speed;
      this.velocity.z = move.z * speed;
      const targetYaw = Math.atan2(move.x, move.z);
      this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetYaw, Math.min(1, dt * 14));
    } else {
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }

    this.velocity.y += this.gravity * dt;
    this.player.position.addScaledVector(this.velocity, dt);

    if (this.player.position.y <= 0) {
      this.player.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    const distFromCenter = Math.hypot(this.player.position.x, this.player.position.z);
    if (distFromCenter > this.worldRadius) {
      const k = this.worldRadius / distFromCenter;
      this.player.position.x *= k;
      this.player.position.z *= k;
    }

    // Anim state machine — chỉ khi model+mixer đã sẵn sàng
    if (this.modelReady && !this.isAttacking) {
      if (!this.onGround) {
        this.playAnim("jump", 0.15);
      } else if (moving) {
        this.playAnim(this.input.sprint ? "run" : "walk", 0.2);
      } else {
        this.playAnim("idle", 0.3);
      }
    }

    if (this.mixer) this.mixer.update(dt);

    // Firelight — deterministic flicker (không gọi Math.random mỗi frame)
    if (this.fireLight) {
      const t = performance.now() * 0.008;
      this.fireLight.intensity = 2.8 + Math.sin(t) * 0.4 + Math.sin(t * 2.7) * 0.25;
    }

    // Camera follow
    const camOffset = this._tmpCamOff.set(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      -Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    ).multiplyScalar(this.cameraDistance);

    const target = this._tmpTarget.copy(this.player.position);
    target.y += this.playerHeight;
    this.camera.position.lerp(target.clone().add(camOffset), camLerp * 2);
    this.camera.lookAt(target);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILS
  // ═══════════════════════════════════════════════════════════════════════════
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

    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup",   this.onKeyUp);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize",  this.onResize);
    window.removeEventListener("touchmove", this.onTouchMove);
    window.removeEventListener("touchend",  this.onTouchEnd);

    if (this.mixer) {
      this.mixer.removeEventListener("finished", this.onAnimFinished);
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.player);
      this.mixer = null;
    }

    // Dispose toàn bộ scene để giải phóng GPU memory
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      }
    });

    this.renderer.dispose();
    if (this.mobileUI && this.mobileUI.parentElement === this.container) {
      this.container.removeChild(this.mobileUI);
    }
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
