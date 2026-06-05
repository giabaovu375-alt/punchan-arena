import * as THREE from "three";
import { type CharacterDef } from "./characters";
import { type AnimClipMap } from "./types";
import { AnimationController } from "./AnimationController";
import { PlayerController, lerpAngle } from "./PlayerController";
import { HUD } from "./HUD";
import { MobileUI } from "./MobileUI";
import { DialogueUI, fadeToWhite } from "./DialogueUI";
import { INTRO_NPC_DIALOGUE } from "./dialogues";

// Intro scene
import {
  buildIntroScene,
  tickIntroScene,
  PLAYER_SPAWN,
  type IntroSceneHandles,
} from "./IntroScene";

// Hub scene
import { HubScene } from "./scenes/HubScene";

// Event system
import { eventBus } from "./core/EventBus";
import { GameEvents } from "./types/events";

// Screen & Collision managers
import { ScreenManager } from "./core/ScreenManager";
import { collisionManager } from "./core/CollisionManager";

// Asset Manager (preload toàn bộ model)
import { AssetManager } from "./core/AssetManager";

export { ANIM_KEYS, type AnimKey, type AnimClipMap, type InputState } from "./types";

type SceneMode = "intro" | "hub";

export class GameEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private timer = new THREE.Timer();
  private rafId = 0;
  private disposed = false;

  private character: CharacterDef;
  private isMobile: boolean;

  private player!: THREE.Object3D;
  private modelRoot: THREE.Object3D | null = null;
  private bodyParts: { body: THREE.Object3D; head: THREE.Object3D } | null = null;
  private playerHeight = 1.6;
  private animTime = 0;

  private cameraYaw = 0;        private targetYaw = 0;
  private cameraPitch = -0.25;  private targetPitch = -0.25;
  private cameraDistance = 6;   private targetDistance = 6;
  private isRotating = false;
  private lastMouse = { x: 0, y: 0 };

  private animCtrl!: AnimationController;
  private playerCtrl!: PlayerController;
  private hud!: HUD;
  private mobileUI: MobileUI | null = null;
  private dialogue!: DialogueUI;

  private sceneMode: SceneMode = "intro";
  private introHandles: IntroSceneHandles | null = null;
  private hubScene: HubScene | null = null;
  private npcTriggered = false;
  private lastPortalTarget: string | null = null;

  private screenManager!: ScreenManager;
  public assetManager!: AssetManager;

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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.style.position = "relative";
    container.appendChild(this.renderer.domElement);

    // ── Screen Manager ──────────────────────────────────────────────────────
    this.screenManager = new ScreenManager();

    // ── Player rig ──────────────────────────────────────────────────────────
    this.player = new THREE.Group();
    this.player.name = "PlayerRig";

    // ── Sub-controllers ─────────────────────────────────────────────────────
    this.playerCtrl = new PlayerController({
      character,
      worldRadius: 140,
      onAttack: (key) => this.animCtrl.triggerAttack(key),
    });

    this.animCtrl = new AnimationController({
      isMoving: () => this.playerCtrl.isMovingNow(),
      onComboChanged: (count) => this.hud.flashCombo(count),
    });

    // ── Model ────────────────────────────────────────────────────────────────
    if (model) {
      const { modelRoot, playerHeight, footOffset } = this.animCtrl.setupModel(this.player, model, clips);
      this.modelRoot = modelRoot;
      this.playerHeight = playerHeight;
      this.playerCtrl.setFloor(footOffset);
    } else {
      this.player.add(this.createPlaceholder());
    }
    this.scene.add(this.player);

    // ── Dialogue UI ─────────────────────────────────────────────────────────
    this.dialogue = new DialogueUI(container);

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
        "/assets/ui/1000185469.png"
      );
    }

    // ── Preload asset rồi mới bắt đầu game ────────────────────────────────
    this.assetManager = new AssetManager();
    this.initGame();   // async, không block constructor
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRELOAD & INIT (CÓ ẢNH LOADING)
  // ═══════════════════════════════════════════════════════════════════════════
  private async initGame() {
    // Tạo màn hình loading
    const loadingEl = document.createElement("div");
    loadingEl.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #0a0a14;
      z-index: 100; pointer-events: none;
    `;

    // Ảnh loading (logo hoặc ảnh tùy chỉnh)
    const img = document.createElement("img");
    img.src = "/assets/ui/loading-bg.png";   // ← cậu thay bằng đường dẫn ảnh load của mình
    img.style.cssText = `
      width: 200px; height: auto; margin-bottom: 24px;
      image-rendering: crisp-edges;
    `;
    loadingEl.appendChild(img);

    // Thanh tiến trình
    const progressContainer = document.createElement("div");
    progressContainer.style.cssText = `
      width: 200px; height: 6px; background: rgba(255,255,255,0.12);
      border-radius: 999px; overflow: hidden;
    `;

    const progressBar = document.createElement("div");
    progressBar.style.cssText = `
      height: 100%; width: 0%; background: #00a8ff;
      border-radius: 999px; transition: width 0.15s ease;
      box-shadow: 0 0 12px #00a8ff;
    `;
    progressContainer.appendChild(progressBar);
    loadingEl.appendChild(progressContainer);

    // Text tiến trình
    const progressText = document.createElement("div");
    progressText.style.cssText = `
      margin-top: 8px; color: rgba(255,255,255,0.7); font-size: 14px;
      font-family: sans-serif;
    `;
    loadingEl.appendChild(progressText);

    this.container.appendChild(loadingEl);

    // Preload toàn bộ asset
    await this.assetManager.preloadAll((loaded, total) => {
      const pct = Math.round((loaded / total) * 100);
      progressBar.style.width = `${pct}%`;
      progressText.textContent = `Đang tải... ${pct}%`;
    });

    // Xoá loading
    loadingEl.remove();

    // Bắt đầu game
    this.loadIntroScene();
    this.start();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE LOADING
  // ═══════════════════════════════════════════════════════════════════════════
  private clearThreeScene(target: THREE.Scene) {
    const toRemove: THREE.Object3D[] = [];
    target.traverse(o => {
      if (o !== this.player && o.parent === target) toRemove.push(o);
    });
    toRemove.forEach(o => target.remove(o));
  }

  private loadIntroScene() {
    if (this.hubScene) {
      this.hubScene.scene.remove(this.player);
      this.hubScene.unload().catch(err => console.error("unload hub error:", err));
      this.hubScene = null;
    }

    collisionManager.clear();
    this.clearThreeScene(this.scene);
    this.scene.add(this.player);

    this.introHandles = buildIntroScene(this.scene, this.isMobile);
    this.playerCtrl.setColliders([]);

    if (this.player?.position && PLAYER_SPAWN) {
      this.player.position.copy(PLAYER_SPAWN);
    }

    this.sceneMode = "intro";
    this.npcTriggered = false;
    this.lastPortalTarget = null;
  }

  private async switchToHub() {
    this.clearThreeScene(this.scene);
    this.scene.remove(this.player);

    const hub = new HubScene();

    let loaded = false;
    try {
      await hub.load();
      loaded = true;
    } catch (err) {
      console.error("❌ Không load được HubScene:", err);
    }

    if (!loaded) {
      this.scene.add(this.player);
      this.sceneMode = "intro";
      this.npcTriggered = false;
      return;
    }

    hub.scene.add(this.player);
    this.hubScene = hub;
    this.playerCtrl.setColliders([]);
    this.player.position.set(0, 0, 30);

    this.sceneMode = "hub";
    this.introHandles = null;
    this.lastPortalTarget = null;
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
    if (this.isMobile) return;
    this.isRotating = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    if (e.button === 0) this.animCtrl.triggerAttack("punch");
  };

  private onMouseUp = () => { this.isRotating = false; };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isRotating || this.isMobile) return;
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
    this.timer.update();
    const tick = () => {
      if (this.disposed) return;
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), 0.05);
      this.update(dt);

      const activeScene = this.sceneMode === "hub" && this.hubScene
        ? this.hubScene.scene
        : this.scene;
      this.renderer.render(activeScene, this.camera);

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(dt: number) {
    const lk = 1 - Math.exp(-12 * dt);
    this.cameraYaw       = lerpAngle(this.cameraYaw, this.targetYaw, lk);
    this.cameraPitch    += (this.targetPitch - this.cameraPitch) * lk;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * lk;

    const locked = this.dialogue.isVisible();

    let playerPos = this.player.position.clone();
    let moving = false, sprinting = false, onGround = true;

    if (!locked) {
      const result = this.playerCtrl.update(dt, this.cameraYaw, this.player);
      moving = result.moving;
      sprinting = result.sprinting;
      onGround = result.onGround;
      playerPos = this.player.position.clone();
    }

    // ── Va chạm ──────────────────────────────────────────────────────────
    const playerRadius = 0.4;
    const resolvedPos = collisionManager.resolveCollisions(playerPos, playerRadius, "player");
    this.player.position.copy(resolvedPos);

    const { isAttacking } = this.animCtrl.update(dt);
    if (!isAttacking) this.animCtrl.drive(moving, sprinting, onGround);

    this.animTime += dt;
    if (this.bodyParts) {
      const bob = moving && onGround
        ? Math.sin(this.animTime * 14) * 0.06
        : Math.sin(this.animTime * 2) * 0.03;
      this.bodyParts.body.position.y = 0.9 + bob;
      this.bodyParts.head.position.y = 1.75 + bob;
    }

    // ── Scene‑specific logic ──────────────────────────────────────────────
    if (this.sceneMode === "intro" && this.introHandles) {
      tickIntroScene(this.introHandles, dt);

      if (!this.npcTriggered && !locked && this.introHandles.checkNPCProximity(this.player.position)) {
        this.npcTriggered = true;
        this.dialogue.show(
          INTRO_NPC_DIALOGUE.npcName,
          INTRO_NPC_DIALOGUE.lines,
          () => {
            fadeToWhite(this.container, () => {
              this.switchToHub().catch(err => console.error(err));
            });
          },
        );
      }
    } else if (this.sceneMode === "hub" && this.hubScene && typeof this.hubScene.checkPortals === "function") {
      this.hubScene.update(dt);

      if (!locked && !isAttacking) {
        const target = this.hubScene.checkPortals(this.player.position);
        if (target) {
          if (target !== this.lastPortalTarget) {
            this.lastPortalTarget = target;
            eventBus.emit(GameEvents.PORTAL_ENTERED, {
              targetScene: target,
              spawnPos: this.player.position.clone(),
            });
            console.log(`🌐 Portal đến: ${target}`);
          }
        } else {
          this.lastPortalTarget = null;
        }
      }
    }

    this.dialogue.update(dt);

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

    this.hud.setStamina(this.playerCtrl.stamina);
    this.hud.setHP(this.playerCtrl.hp);
    this.hud.setCompassYaw(this.cameraYaw);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════
  getScene()  { return this.scene; }
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
    this.dialogue.dispose();
    this.screenManager.dispose();
    this.assetManager.clear();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }
          }
