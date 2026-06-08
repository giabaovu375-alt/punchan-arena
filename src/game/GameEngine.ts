import * as THREE from "three";
import { type CharacterDef } from "./characters";
import { type AnimClipMap, type AnimKey, type InputState, ANIM_KEYS } from "./types";
import { GameEvents } from "./types/events";

import {
  AnimationController,
  CombatController,
  PlayerController,
  lerpAngle,
  CameraIntro,
} from "./controllers";

import {
  eventBus,
  ScreenManager,
  collisionManager,
} from "./core";

import { WorldScene } from "./scenes/WorldScene";

import { HUD, MobileUI, DialogueUI } from "./ui";

import { INTRO_NPC_DIALOGUE } from "./dialogues";

import {
  buildIntroScene,
  tickIntroScene,
  PLAYER_SPAWN,
  type IntroSceneHandles,
} from "./IntroScene";

export { ANIM_KEYS, type AnimKey, type AnimClipMap, type InputState } from "./types";

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
  private elapsed = 0;

  private cameraYaw = 0;        private targetYaw = 0;
  private cameraPitch = -0.18;  private targetPitch = -0.18;
  private cameraDistance = 3.8; private targetDistance = 3.8;
  private readonly CAM_DIST_MIN = 2.0;
  private readonly CAM_DIST_MAX = 10.0;
  private isRotating = false;
  private lastMouse = { x: 0, y: 0 };

  private animCtrl!: AnimationController;
  private playerCtrl!: PlayerController;
  private combatCtrl!: CombatController;
  private hud!: HUD;
  private mobileUI: MobileUI | null = null;
  private dialogue!: DialogueUI;
  private loadingOverlay: HTMLElement | null = null;
  private screenManager!: ScreenManager;
  private cameraIntro!: CameraIntro;

  private currentScene: WorldScene | null = null;
  private introHandles: IntroSceneHandles | null = null;
  private npcTriggered = false;

  private _camOff    = new THREE.Vector3();
  private _tgt       = new THREE.Vector3();
  private _camTarget = new THREE.Vector3();

  private constructor(
    container: HTMLElement,
    character: CharacterDef,
    model: THREE.Group | null,
    clips: AnimClipMap,
  ) {
    this.container = container;
    this.character = character;
    this.isMobile = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

    // Renderer
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0x9bc4e2, 40, 180);
    this.camera = new THREE.PerspectiveCamera(52, container.clientWidth / container.clientHeight, 0.1, 600);
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.isMobile, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = !this.isMobile;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.style.position = "relative";
    container.appendChild(this.renderer.domElement);

    this.screenManager = new ScreenManager();

    // Player
    this.player = new THREE.Group();
    this.player.name = "PlayerRig";

    // Controllers
    this.animCtrl = new AnimationController({
      isMoving: () => this.playerCtrl.isMovingNow(),
      onComboChanged: (count) => this.hud.flashCombo(count),
    });

    this.combatCtrl = new CombatController(
      this.player, this.camera, this.container,
      (key) => this.animCtrl.triggerAttack(key),
      () => this.currentScene?.getEnemyRoots() ?? [],
    );

    this.playerCtrl = new PlayerController({
      character, worldRadius: 140,
      onAttack: (key) => this.combatCtrl.scheduleAttack(key as "punch" | "kick" | "mmaKick"),
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

    // UI
    this.dialogue = new DialogueUI(container);
    this.hud = new HUD(container, character, this.isMobile);
    if (this.isMobile) {
      this.mobileUI = new MobileUI(container, this.renderer.domElement, this.playerCtrl.input, {
        jump: () => this.playerCtrl.requestJump(),
        attack: (key) => this.combatCtrl.scheduleAttack(key as "punch" | "kick" | "mmaKick"),
        rotateCamera: (dYaw, dPitch) => {
          this.targetYaw   += dYaw;
          this.targetPitch += dPitch;
          this.targetPitch = Math.max(-1.2, Math.min(0.3, this.targetPitch));
        },
      });
    }

    // Events
    eventBus.on(GameEvents.PLAYER_DAMAGE, (data: { amount: number }) => {
      this.playerCtrl.hp = Math.max(0, this.playerCtrl.hp - data.amount / 100);
      this.hud.setHP(this.playerCtrl.hp);
      this.combatCtrl.camShake.addTrauma(0.3);
    });

    // Input
    this.playerCtrl.bindKeyboard();
    this.bindMouseAndResize();

    // Load intro scene trước để có cảnh cho camera bay
    this.loadIntroScene();
    this.start();

    // Bắt đầu cutscene intro
    this.cameraIntro = new CameraIntro(this.camera, () => {
      // Sau khi intro kết thúc, tự động chuyển vào thế giới chính
      this.switchToWorld().catch(err => console.error(err));
    });
  }

  public static async create(
    container: HTMLElement,
    character: CharacterDef,
    model: THREE.Group | null,
    clips: AnimClipMap,
  ): Promise<GameEngine> {
    return new GameEngine(container, character, model, clips);
  }

  // ── Chuyển vào thế giới chính (Map 1) ──────────────────────────────────

  private async switchToWorld() {
    this.showLoadingOverlay("Đang vào thế giới...");
    await new Promise(r => setTimeout(r, 60));

    // Dọn dẹp intro scene
    if (this.introHandles) {
      this.clearThreeScene(this.scene);
      this.introHandles = null;
    }

    this.scene.remove(this.player);

    // Tạo world scene
    const worldScene = new WorldScene();
    try {
      await worldScene.load();
    } catch (err) {
      console.error("❌ Không load được WorldScene:", err);
      this.loadIntroScene();
      this.hideLoadingOverlay();
      return;
    }

    worldScene.setPlayer(this.player);
    worldScene.setCamera(this.camera);
    worldScene.scene.add(this.player);
    this.currentScene = worldScene;
    this.elapsed = 0;
    this.playerCtrl.setColliders([]);
    this.player.position.set(0, 0, 30); // Vị trí spawn trong Hub
    this.combatCtrl.reset();
    this.hideLoadingOverlay();
  }

  private loadIntroScene() {
    if (this.currentScene) {
      this.currentScene.scene.remove(this.player);
      this.currentScene.unload().catch(err => console.error(err));
      this.currentScene = null;
    }
    collisionManager.clear();
    this.clearThreeScene(this.scene);
    this.scene.add(this.player);
    this.introHandles = buildIntroScene(this.scene, this.isMobile);
    this.playerCtrl.setColliders([]);
    if (this.player?.position && PLAYER_SPAWN) this.player.position.copy(PLAYER_SPAWN);
    this.npcTriggered = false;
    this.elapsed = 0;
    this.combatCtrl.reset();
  }

  private clearThreeScene(target: THREE.Scene) {
    const toRemove: THREE.Object3D[] = [];
    target.traverse(o => { if (o !== this.player && o.parent === target) toRemove.push(o); });
    toRemove.forEach(o => target.remove(o));
  }

  // ── Loading Overlay ────────────────────────────────────────────────────

  private showLoadingOverlay(text = "Đang tải...") {
    if (this.loadingOverlay) return;
    const el = document.createElement("div");
    el.style.cssText = "position:absolute; inset:0; z-index:999; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,0.78); backdrop-filter:blur(8px); color:#fff; gap:20px; opacity:0; transition:opacity 0.25s ease; font-family:sans-serif;";
    el.innerHTML = `<div style="width:46px;height:46px;border-radius:50%;border:3px solid rgba(255,255,255,0.1);border-top-color:#00f5d4;animation:spin 0.85s linear infinite;"></div><div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.7);">${text}</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    this.container.appendChild(el);
    this.loadingOverlay = el;
    requestAnimationFrame(() => { if (el.isConnected) el.style.opacity = "1"; });
  }

  private hideLoadingOverlay() {
    if (!this.loadingOverlay) return;
    const el = this.loadingOverlay;
    this.loadingOverlay = null;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }

  // ── Placeholder ────────────────────────────────────────────────────────

  private createPlaceholder(): THREE.Object3D {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: this.character.color, roughness: 0.6, metalness: 0.15 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 4, 12), bodyMat);
    body.position.y = 0.9; body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), new THREE.MeshStandardMaterial({ color: 0xe6c7a8, roughness: 0.8 }));
    head.position.y = 1.75; head.castShadow = true;
    group.add(head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.75, 0.32);
    group.add(nose);
    this.bodyParts = { body, head };
    return group;
  }

  // ── Mouse / Resize / Pinch ─────────────────────────────────────────────

  private bindMouseAndResize() {
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup",   this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive: false });
    this.renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", this.onResize);
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.isMobile || this.cameraIntro?.isActive()) return;
    this.isRotating = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    if (e.button === 0) this.combatCtrl.scheduleAttack("punch");
  };
  private onMouseUp = () => { this.isRotating = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.isRotating || this.isMobile || this.cameraIntro?.isActive()) return;
    this.targetYaw   -= (e.clientX - this.lastMouse.x) * 0.005;
    this.targetPitch -= (e.clientY - this.lastMouse.y) * 0.005;
    this.targetPitch  = Math.max(-1.2, Math.min(0.3, this.targetPitch));
    this.lastMouse = { x: e.clientX, y: e.clientY };
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.targetDistance = Math.max(this.CAM_DIST_MIN, Math.min(this.CAM_DIST_MAX, this.targetDistance + e.deltaY * 0.012));
  };
  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

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
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      this.targetDistance = Math.max(this.CAM_DIST_MIN, Math.min(this.CAM_DIST_MAX, this.pinchStartCamDist * (this.pinchStartDist / dist)));
    }
  };

  // ── Game Loop ──────────────────────────────────────────────────────────

  private start() {
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
      const renderScene = this.currentScene ? this.currentScene.scene : this.scene;
      this.renderer.render(renderScene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(dt: number) {
    // Camera intro đang chạy
    if (this.cameraIntro?.isActive()) {
      this.cameraIntro.tick(dt);
      this.animCtrl.update(dt);
      this.dialogue.update(dt);
      return;
    }

    this.elapsed += dt;
    const lk = 1 - Math.exp(-12 * dt);
    this.cameraYaw       = lerpAngle(this.cameraYaw, this.targetYaw, lk);
    this.cameraPitch    += (this.targetPitch    - this.cameraPitch)    * lk;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * lk;

    const locked = this.dialogue.isVisible();
    let playerPos = this.player.position.clone();
    let moving = false, sprinting = false, onGround = true;

    if (!locked) {
      const result = this.playerCtrl.update(dt, this.cameraYaw, this.player);
      moving = result.moving; sprinting = result.sprinting; onGround = result.onGround;
      playerPos = this.player.position.clone();
    }

    this.player.position.copy(collisionManager.resolveCollisions(playerPos, 0.4, "player"));
    this.combatCtrl.update(dt);
    this.combatCtrl.camShake.apply(this.camera, dt);

    const { isAttacking } = this.animCtrl.update(dt);
    if (!isAttacking) this.animCtrl.drive(moving, sprinting, onGround);

    this.animTime += dt;
    if (this.bodyParts) {
      const bob = moving && onGround ? Math.sin(this.animTime * 14) * 0.06 : Math.sin(this.animTime * 2) * 0.03;
      this.bodyParts.body.position.y = 0.9  + bob;
      this.bodyParts.head.position.y = 1.75 + bob;
    }

    // Scene logic
    if (this.introHandles) {
      tickIntroScene(this.introHandles, dt, this.elapsed);
      // NPC dialogue trigger (nếu có)
    } else if (this.currentScene) {
      this.currentScene.update(dt);
    }

    this.dialogue.update(dt);

    // Camera
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

  // ── Public API ─────────────────────────────────────────────────────────

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
    this.combatCtrl.dispose();
    this.mobileUI?.dispose();
    this.hud.dispose();
    this.dialogue.dispose();
    this.screenManager.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }
                                                        }
