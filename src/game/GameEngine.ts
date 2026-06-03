import * as THREE from "three";
import { type CharacterDef } from "./characters";
import { type AnimClipMap } from "./types";
import { AnimationController } from "./AnimationController";
import { PlayerController, lerpAngle } from "./PlayerController";
import { HUD } from "./HUD";
import { MobileUI } from "./MobileUI";
import { buildWorld, tickFireLight } from "./GameWorld";

export { ANIM_KEYS, type AnimKey, type AnimClipMap, type InputState } from "./types";

/**
 * Top-level orchestrator: scene/camera/renderer + game loop.
 * Sub-modules:
 *   - PlayerController   → input + movement + stamina
 *   - AnimationController → mixer + combat + combo
 *   - HUD                 → status card, compass, combo flash
 *   - MobileUI            → joystick + buttons (chỉ trên touch device)
 *   - GameWorld           → tĩnh (lighting, ground, props)
 */
export class GameEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private rafId = 0;
  private disposed = false;

  private character: CharacterDef;
  private isMobile: boolean;

  // Player rig — Group là logic position, model là child (visual offset)
  private player!: THREE.Object3D;
  private modelRoot: THREE.Object3D | null = null;
  private bodyParts: { body: THREE.Object3D; head: THREE.Object3D } | null = null;
  private playerHeight = 1.6;
  private animTime = 0;

  // Camera orbit
  private cameraYaw = 0;        private targetYaw = 0;
  private cameraPitch = -0.25;  private targetPitch = -0.25;
  private cameraDistance = 6;   private targetDistance = 6;
  private isRotating = false;
  private lastMouse = { x: 0, y: 0 };

  // World
  private worldRadius = 140;
  private fireLight!: THREE.PointLight;

  // Sub-systems
  private animCtrl!: AnimationController;
  private playerCtrl!: PlayerController;
  private hud!: HUD;
  private mobileUI: MobileUI | null = null;

  // scratch vectors
  private _camOff    = new THREE.Vector3();
  private _tgt       = new THREE.Vector3();
  private _camTarget = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    character: CharacterDef,
    model: THREE.Group | null,
    clips: AnimClipMap,
  ) {
    this.container = container;
    this.character = character;
    this.isMobile = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

    // ── Scene / camera / renderer ───────────────────────────────────────────
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

    // ── World ───────────────────────────────────────────────────────────────
    const handles = buildWorld(this.scene, this.isMobile);
    this.fireLight = handles.fireLight;

    // ── Player rig ──────────────────────────────────────────────────────────
    this.player = new THREE.Group();
    this.player.name = "PlayerRig";

    // ── Sub-controllers ─────────────────────────────────────────────────────
    this.playerCtrl = new PlayerController({
      character,
      worldRadius: this.worldRadius,
      onAttack: (key) => this.animCtrl.triggerAttack(key),
    });

    this.animCtrl = new AnimationController({
      isMoving: () => this.playerCtrl.isMovingNow(),
      onComboChanged: (count) => this.hud.flashCombo(count),
    });

    if (model) {
      const { modelRoot, playerHeight } = this.animCtrl.setupModel(this.player, model, clips);
      this.modelRoot = modelRoot;
      this.playerHeight = playerHeight;
    } else {
      this.player.add(this.createPlaceholder());
    }
    this.scene.add(this.player);

    // ── Bind events + UI ────────────────────────────────────────────────────
    this.playerCtrl.bindKeyboard();
    this.bindMouseAndResize();

    this.hud = new HUD(container, character, this.isMobile);

    if (this.isMobile) {
      this.mobileUI = new MobileUI(
        container,
        this.renderer.domElement,
        this.playerCtrl.input,
        {
          jump: () => this.playerCtrl.requestJump(),
          attack: (key) => this.animCtrl.triggerAttack(key),
          rotateCamera: (dYaw, dPitch) => {
            this.targetYaw   += dYaw;
            this.targetPitch += dPitch;
            this.targetPitch = Math.max(-1.2, Math.min(0.3, this.targetPitch));
          },
        },
      );
    }

    this.start();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLACEHOLDER (khi không có model)
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUSE / RESIZE
  // ═══════════════════════════════════════════════════════════════════════════
  private bindMouseAndResize() {
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup",   this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive: false });
    this.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", this.onResize);
  }

  private onMouseDown = (e: MouseEvent) => {
    this.isRotating = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    if (e.button === 0) this.animCtrl.triggerAttack("punch");
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
      const dt = Math.min(rawDt, 0.05);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(dt: number) {
    // Camera smoothing
    const lk = 1 - Math.exp(-12 * dt);
    this.cameraYaw       = lerpAngle(this.cameraYaw, this.targetYaw, lk);
    this.cameraPitch    += (this.targetPitch - this.cameraPitch) * lk;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * lk;

    // Player + animation
    const { moving, sprinting, onGround } =
      this.playerCtrl.update(dt, this.cameraYaw, this.player);
    const { isAttacking } = this.animCtrl.update(dt);
    if (!isAttacking) this.animCtrl.drive(moving, sprinting, onGround);

    // Placeholder bob (chỉ khi không có model thật)
    this.animTime += dt;
    if (this.bodyParts) {
      const bob = moving && onGround
        ? Math.sin(this.animTime * 14) * 0.06
        : Math.sin(this.animTime * 2) * 0.03;
      this.bodyParts.body.position.y = 0.9 + bob;
      this.bodyParts.head.position.y = 1.75 + bob;
    }

    tickFireLight(this.fireLight);

    // Camera follow — anchor ngực thay vì đỉnh đầu
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

    // HUD
    this.hud.setStamina(this.playerCtrl.stamina);
    this.hud.setHP(this.playerCtrl.hp);
    this.hud.setCompassYaw(this.cameraYaw);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════
  getScene()  { return this.scene;  }
  getPlayer() { return this.player; }
  getMixer()  { return this.animCtrl.getMixer(); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);

    this.playerCtrl.unbindKeyboard();
    window.removeEventListener("mouseup",   this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize",    this.onResize);

    this.mobileUI?.dispose();
    this.hud.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }
}
