import * as THREE from "three";
import { type CharacterDef } from "./characters";
import { type AnimClipMap, type AnimKey, type InputState, ANIM_KEYS } from "./types"; // file types.ts gốc
import { GameEvents } from "./types/events"; // hoặc "./types" nếu đã export từ index

import {
  AnimationController,
  CameraController,
  CombatController,
  PlayerController,
  lerpAngle,
} from "./controllers";

import {
  eventBus,
  ScreenManager,
  collisionManager,
} from "./core";

import { HubScene } from "./scenes";

import {
  HUD,
  MobileUI,
  DialogueUI,
  fadeToWhite,
} from "./ui";

import { INTRO_NPC_DIALOGUE } from "./dialogues";

import {
  buildIntroScene,
  tickIntroScene,
  PLAYER_SPAWN,
  type IntroSceneHandles,
} from "./IntroScene";

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

  // ── Camera ────────────────────────────────────────────────────────────────
  private cameraYaw = 0;        private targetYaw = 0;
  private cameraPitch = -0.18;  private targetPitch = -0.18;
  private cameraDistance = 3.8; private targetDistance = 3.8;
  private readonly CAM_DIST_MIN = 2.0;
  private readonly CAM_DIST_MAX = 10.0;
  private isRotating = false;
  private lastMouse = { x: 0, y: 0 };

  private animCtrl!: AnimationController;
  private playerCtrl!: PlayerController;
  private hud!: HUD;
  private mobileUI: MobileUI | null = null;
  private dialogue!: DialogueUI;
  private loadingOverlay: HTMLElement | null = null;

  private sceneMode: SceneMode = "intro";
  private introHandles: IntroSceneHandles | null = null;
  private hubScene: HubScene | null = null;
  private npcTriggered = false;
  private lastPortalTarget: string | null = null;

  private screenManager!: ScreenManager;

  private _camOff    = new THREE.Vector3();
  private _tgt       = new THREE.Vector3();
  private _camTarget = new THREE.Vector3();

  // ── Constructor private ───────────────────────────────────────────────────
  private constructor(
    container: HTMLElement,
    character: CharacterDef,
    model: THREE.Group | null,
    clips: AnimClipMap,
  ) {
    this.container = container;
    this.character = character;
    this.isMobile = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

    // ── Scene ─────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0x9bc4e2, 40, 180);

    // ── Camera – FOV 52 nhân vật to hơn, ít méo hơn ───────────────────────
    this.camera = new THREE.PerspectiveCamera(
      52, container.clientWidth / container.clientHeight, 0.1, 600,
    );

    // ── Renderer – tối ưu theo thiết bị ───────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile, // tắt antialias mobile → tiết kiệm GPU
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1 : 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = !this.isMobile; // shadow chỉ desktop
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.style.position = "relative";
    container.appendChild(this.renderer.domElement);

    this.screenManager = new ScreenManager();

    // ── Player rig ────────────────────────────────────────────────────────
    this.player = new THREE.Group();
    this.player.name = "PlayerRig";

    this.playerCtrl = new PlayerController({
      character,
      worldRadius: 140,
      onAttack: (key) => this.animCtrl.triggerAttack(key),
    });

    this.animCtrl = new AnimationController({
      isMoving: () => this.playerCtrl.isMovingNow(),
      onComboChanged: (count) => this.hud.flashCombo(count),
    });

    if (model) {
      const { modelRoot, playerHeight, footOffset } = this.animCtrl.setupModel(this.player, model, clips);
      this.modelRoot = modelRoot;
      this.playerHeight = playerHeight;
      this.playerCtrl.setFloor(footOffset);
    } else {
      this.player.add(this.createPlaceholder());
    }
    this.scene.add(this.player);

    this.dialogue = new DialogueUI(container);
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
            this.targetPitch  = Math.max(-1.2, Math.min(0.3, this.targetPitch));
          },
        },
        "/assets/ui/1000185469.png"
      );
    }

    this.loadIntroScene();
    this.start();
  }

  public static async create(
    container: HTMLElement,
    character: CharacterDef,
    model: THREE.Group | null,
    clips: AnimClipMap,
  ): Promise<GameEngine> {
    return new GameEngine(container, character, model, clips);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING OVERLAY
  // ═══════════════════════════════════════════════════════════════════════════
  private showLoadingOverlay(text = "Đang tải...") {
    if (this.loadingOverlay) return;
    const el = document.createElement("div");
    el.style.cssText = `
      position:absolute; inset:0; z-index:999;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      background:rgba(0,0,0,0.78);
      backdrop-filter:blur(8px);
      -webkit-backdrop-filter:blur(8px);
      font-family:'SF Pro Display','Helvetica Neue',sans-serif;
      color:#fff;
      gap:20px;
      opacity:0;
      transition:opacity 0.25s ease;
    `;
    el.innerHTML = `
      <div style="
        width:46px; height:46px; border-radius:50%;
        border:3px solid rgba(255,255,255,0.1);
        border-top-color:#00f5d4;
        animation:ge-spin 0.85s linear infinite;
      "></div>
      <div style="
        font-size:12px; letter-spacing:0.22em;
        text-transform:uppercase; color:rgba(255,255,255,0.7);
      ">${text}</div>
      <style>@keyframes ge-spin{to{transform:rotate(360deg)}}</style>
    `;
    this.container.appendChild(el);
    this.loadingOverlay = el;
    // fade in sau 1 frame
    requestAnimationFrame(() => { if (el.isConnected) el.style.opacity = "1"; });
  }

  private hideLoadingOverlay() {
    if (!this.loadingOverlay) return;
    const el = this.loadingOverlay;
    this.loadingOverlay = null;
    el.style.opacity = "0";
    setTimeout(() => el.parentElement?.removeChild(el), 300);
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
    // Hiện overlay thay vì màn trắng
    this.showLoadingOverlay("Đang tải map...");
    // Nhường 1 frame để overlay render trước khi block main thread
    await new Promise<void>((r) => setTimeout(r, 50));

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
      this.hideLoadingOverlay();
      return;
    }

    hub.scene.add(this.player);
    this.hubScene = hub;
    this.playerCtrl.setColliders([]);
    this.player.position.set(0, 0, 30);
    this.sceneMode = "hub";
    this.introHandles = null;
    this.lastPortalTarget = null;

    this.hideLoadingOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLACEHOLDER
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

  // Scroll chuột / pinch → zoom in-out nhân vật
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.targetDistance = Math.max(
      this.CAM_DIST_MIN,
      Math.min(this.CAM_DIST_MAX, this.targetDistance + e.deltaY * 0.012),
    );
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PINCH-TO-ZOOM (mobile)
  // ═══════════════════════════════════════════════════════════════════════════
  private pinchStartDist = 0;
  private pinchStartCamDist = 0;

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      this.pinchStartDist    = Math.hypot(dx, dy);
      this.pinchStartCamDist = this.targetDistance;
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = this.pinchStartDist / dist; // > 1 = thu nhỏ, < 1 = phóng to
      this.targetDistance = Math.max(
        this.CAM_DIST_MIN,
        Math.min(this.CAM_DIST_MAX, this.pinchStartCamDist * scale),
      );
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // GAME LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  private start() {
    // Bind pinch zoom cho mobile
    if (this.isMobile) {
      this.renderer.domElement.addEventListener("touchstart", this.onTouchStart, { passive: true });
      this.renderer.domElement.addEventListener("touchmove",  this.onTouchMove,  { passive: true });
    }

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
    this.cameraPitch    += (this.targetPitch    - this.cameraPitch)    * lk;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * lk;

    const locked = this.dialogue.isVisible();

    let playerPos = this.player.position.clone();
    let moving = false, sprinting = false, onGround = true;

    if (!locked) {
      const result = this.playerCtrl.update(dt, this.cameraYaw, this.player);
      moving    = result.moving;
      sprinting = result.sprinting;
      onGround  = result.onGround;
      playerPos = this.player.position.clone();
    }

    const playerRadius = 0.4;
    const resolvedPos = collisionManager.resolveCollisions(playerPos, playerRadius, "player");
    this.player.position.copy(resolvedPos);

    const { isAttacking } = this.animCtrl.update(dt);
    if (!isAttacking) this.animCtrl.drive(moving, sprinting, onGround);

    this.animTime += dt;
    if (this.bodyParts) {
      const bob = moving && onGround
        ? Math.sin(this.animTime * 14) * 0.06
        : Math.sin(this.animTime * 2)  * 0.03;
      this.bodyParts.body.position.y = 0.9 + bob;
      this.bodyParts.head.position.y = 1.75 + bob;
    }

    // ── Scene logic ───────────────────────────────────────────────────────
    if (this.sceneMode === "intro" && this.introHandles) {
      tickIntroScene(this.introHandles, dt);
      if (!this.npcTriggered && !locked && this.introHandles.checkNPCProximity(this.player.position)) {
        this.npcTriggered = true;
        this.dialogue.show(
          INTRO_NPC_DIALOGUE.npcName,
          INTRO_NPC_DIALOGUE.lines,
          () => {
            // Không dùng fadeToWhite nữa – overlay đã lo
            this.switchToHub().catch(err => console.error(err));
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

    // ── Camera ────────────────────────────────────────────────────────────
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

    if (this.isMobile) {
      this.renderer.domElement.removeEventListener("touchstart", this.onTouchStart);
      this.renderer.domElement.removeEventListener("touchmove",  this.onTouchMove);
    }

    this.hideLoadingOverlay();
    this.mobileUI?.dispose();
    this.hud.dispose();
    this.dialogue.dispose();
    this.screenManager.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }
        }
