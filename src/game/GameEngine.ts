import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { type CharacterDef } from "./characters";

// ─── GitHub raw base cho animation FBX ───────────────────────────────────────
const ANIM_BASE =
  "https://raw.githubusercontent.com/giabaovu375-alt/punchan-arena/main/public/animation";

// Tên clip trong file FBX → action key
export const ANIM_CLIPS = {
  idle:          "Idle.fbx",
  walk:          "Walking.fbx",
  run:           "Running.fbx",
  jump:          "Jumping.fbx",
  kick:          "Kicking.fbx",
  punch:         "Hook Punch.fbx",
  uppercut:      "Uppercut Jab.fbx",
  dropKick:      "Drop Kick.fbx",
  mmaKick:       "Mma Kick.fbx",
  elbow:         "Elbow Uppercut Combo.fbx",
  pain:          "Pain Gesture.fbx",
} as const;

export type AnimKey = keyof typeof ANIM_CLIPS;

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

  constructor(container: HTMLElement, character: CharacterDef) {
    this.container = container;
    this.character = character;
    this.moveSpeed = character.moveSpeed;
    this.jumpSpeed = character.jumpSpeed;

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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.buildWorld();
    this.createPlayerPlaceholder(); // hiển thị placeholder trong khi load
    this.loadCharacterModel();
    this.bindEvents();
    this.buildMobileUI();
    this.start();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORLD
  // ═══════════════════════════════════════════════════════════════════════════
  private buildWorld() {
    // ── Lighting ──────────────────────────────────────────────────────────────
    const hemi = new THREE.HemisphereLight(0xfff6e0, 0x2d4a1e, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3c8, 1.6);
    sun.position.set(70, 100, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    // Rim light (blue sky bounce)
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

    // ── Trees (instanced for performance) ─────────────────────────────────────
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 2.4, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2e14, roughness: 1 });
    const leafGeo = new THREE.ConeGeometry(1.8, 4, 8);
    const leafMats = [
      new THREE.MeshStandardMaterial({ color: 0x1e5c28, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x2a6e30, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x3a7e38, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x4a5e20, roughness: 1, flatShading: true }),
    ];
    for (let i = 0; i < 100; i++) {
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
      // Double canopy for fuller look
      const leaves2 = new THREE.Mesh(
        new THREE.ConeGeometry(1.3, 3, 8),
        leafMats[Math.floor(Math.random() * leafMats.length)],
      );
      leaves2.position.y = 5.2;
      leaves2.castShadow = true;
      tree.add(leaves2);
      tree.position.set(x, 0, z);
      const s = 0.6 + Math.random() * 1.1;
      tree.scale.setScalar(s);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(tree);
    }

    // ── Rocks ─────────────────────────────────────────────────────────────────
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6a64, roughness: 1, flatShading: true });
    for (let i = 0; i < 50; i++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.3 + Math.random() * 1.4, 0),
        rockMat,
      );
      const angle = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 120;
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

    // ── Huts / village ────────────────────────────────────────────────────────
    const hutWallMat = new THREE.MeshStandardMaterial({ color: 0xc8a870, roughness: 1 });
    const hutRoofMat = new THREE.MeshStandardMaterial({ color: 0x7a3c18, roughness: 1, flatShading: true });
    const hutPositions = [
      [18, 0, -12], [-18, 0, -10], [22, 0, 14], [-15, 0, 20], [30, 0, -28],
    ];
    for (const [x, , z] of hutPositions) {
      const hut = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.0, 2.8, 8), hutWallMat);
      wall.position.y = 1.4;
      wall.castShadow = true;
      wall.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.4, 8), hutRoofMat);
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
  // PLAYER — placeholder + real model loader
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
    const gltfLoader = new GLTFLoader();
    const fbxLoader = new FBXLoader();

    try {
      // 1. Load base model (GLB)
      const gltf = await new Promise<any>((resolve, reject) =>
        gltfLoader.load(this.character.modelUrl, resolve, undefined, reject),
      );
      const model = gltf.scene as THREE.Group;
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Scale & position — điều chỉnh nếu model quá to/nhỏ
      model.scale.setScalar(0.01); // mixamo models thường scale 0.01
      model.position.set(0, 0, 0);

      // Replace placeholder
      this.scene.remove(this.player);
      this.player = model;
      this.scene.add(this.player);

      // 2. Setup AnimationMixer
      this.mixer = new THREE.AnimationMixer(this.player);

      // 3. Load all animation FBX files
      const animEntries = Object.entries(ANIM_CLIPS) as [AnimKey, string][];
      await Promise.all(
        animEntries.map(async ([key, filename]) => {
          try {
            const fbx = await new Promise<THREE.Group>((resolve, reject) =>
              fbxLoader.load(`${ANIM_BASE}/${filename}`, resolve as any, undefined, reject),
            );
            if (fbx.animations.length > 0 && this.mixer) {
              // Retarget animation onto our model skeleton
              const clip = fbx.animations[0];
              clip.name = key;
              const action = this.mixer.clipAction(clip);
              // Combat animations: không loop
              if (["punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "pain", "jump"].includes(key)) {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
              }
              this.actions[key] = action;
            }
          } catch {
            console.warn(`[GameEngine] Không load được animation: ${filename}`);
          }
        }),
      );

      // 4. Play idle
      this.playAnim("idle", 0.3);

      // 5. Listener khi combat anim kết thúc → về idle/walk
      this.mixer.addEventListener("finished", (e) => {
        if (["punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "pain"].includes(this.currentKey)) {
          this.isAttacking = false;
          this.playAnim(this.isMoving() ? "walk" : "idle", 0.25);
        }
        if (this.currentKey === "jump" && this.onGround) {
          this.playAnim("idle", 0.2);
        }
      });

    } catch (err) {
      console.error("[GameEngine] Lỗi load model:", err);
      // Giữ nguyên placeholder nếu load thất bại
    }
  }

  private playAnim(key: AnimKey, fadeDuration = 0.2) {
    if (!this.mixer || this.currentKey === key) return;
    const next = this.actions[key];
    if (!next) return;
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
    const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isMobile) return;

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

    // ── Left joystick base ────────────────────────────────────────────────────
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

    // ── Right action buttons ──────────────────────────────────────────────────
    const btnDefs: { label: string; color: string; action: () => void; bottom: string; right: string }[] = [
      {
        label: "👊",
        color: "rgba(255,120,50,0.75)",
        action: () => this.triggerAttack("punch"),
        bottom: "110px",
        right: "50px",
      },
      {
        label: "🦵",
        color: "rgba(255,60,80,0.75)",
        action: () => this.triggerAttack("kick"),
        bottom: "50px",
        right: "115px",
      },
      {
        label: "⬆️",
        color: "rgba(80,180,255,0.75)",
        action: () => { if (this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; } },
        bottom: "50px",
        right: "40px",
      },
      {
        label: "💥",
        color: "rgba(180,80,255,0.75)",
        action: () => this.triggerAttack("mmaKick"),
        bottom: "115px",
        right: "118px",
      },
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

    // ── Sprint toggle ──────────────────────────────────────────────────────────
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

    // ── Joystick touch events ─────────────────────────────────────────────────
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

    window.addEventListener("touchmove", (e) => {
      // Joystick move
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
            // Map to input
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
      // Camera swipe (right half of screen, not on buttons)
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
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
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
    });

    // Swipe camera from right half
    this.renderer.domElement.addEventListener("touchstart", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX > window.innerWidth / 2 && !this.cameraTouch) {
          this.cameraTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY };
        }
      }
    }, { passive: true });
  }

  private triggerAttack(key: AnimKey) {
    if (this.isAttacking || this.attackCooldown > 0) return;
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
    // Left click = punch
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
    // ── Cooldowns ──────────────────────────────────────────────────────────────
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // ── Camera smooth lerp ────────────────────────────────────────────────────
    const camLerp = 1 - Math.exp(-12 * dt);
    this.cameraYaw = this.lerpAngle(this.cameraYaw, this.targetYaw, camLerp);
    this.cameraPitch += (this.targetPitch - this.cameraPitch) * camLerp;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * camLerp;

    // ── Movement ──────────────────────────────────────────────────────────────
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right   = new THREE.Vector3( Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const move = new THREE.Vector3();
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

    // Gravity & jump
    this.velocity.y += this.gravity * dt;
    this.player.position.addScaledVector(this.velocity, dt);

    // Ground
    if (this.player.position.y <= 0) {
      this.player.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // Boundary
    const distFromCenter = Math.hypot(this.player.position.x, this.player.position.z);
    if (distFromCenter > this.worldRadius) {
      const k = this.worldRadius / distFromCenter;
      this.player.position.x *= k;
      this.player.position.z *= k;
    }

    // ── Animation state machine ────────────────────────────────────────────────
    if (!this.isAttacking) {
      if (!this.onGround) {
        this.playAnim("jump", 0.15);
      } else if (moving) {
        this.playAnim(this.input.sprint ? "run" : "walk", 0.2);
      } else {
        this.playAnim("idle", 0.3);
      }
    }

    // ── Mixer update ──────────────────────────────────────────────────────────
    if (this.mixer) this.mixer.update(dt);

    // ── Firelight flicker ─────────────────────────────────────────────────────
    if (this.fireLight) {
      this.fireLight.intensity = 2.8 + Math.sin(Date.now() * 0.008) * 0.5 + Math.random() * 0.3;
    }

    // ── Camera follow ─────────────────────────────────────────────────────────
    const camOffset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      -Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    ).multiplyScalar(this.cameraDistance);

    const target = this.player.position.clone().add(new THREE.Vector3(0, this.playerHeight, 0));
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
    this.renderer.dispose();
    if (this.mobileUI) this.container.removeChild(this.mobileUI);
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
