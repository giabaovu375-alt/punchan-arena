import * as THREE from "three";
import { type CharacterDef } from "./characters";
import { type AnimClipMap, type AnimKey, type InputState, ANIM_KEYS } from "./types";
import { GameEvents } from "./types/events";

import {
  AnimationController,
  CombatController,
  PlayerController,
  CameraIntro,
} from "./controllers";

import { eventBus, ScreenManager } from "./core";
import { HUD, MobileUI, DialogueUI } from "./ui";
import { WorldScene } from "./scenes/WorldScene";
import { type IntroSceneHandles } from "./IntroScene";

// ── Tách ra ──────────────────────────────────────────────────────────────────
import { CameraController } from "./controllers/CameraController";
import { InputController }  from "./controllers/InputController";
import { LoadingOverlay }   from "./controllers/LoadingOverlay";
import { SceneController }  from "./controllers/SceneController";

export { ANIM_KEYS, type AnimKey, type AnimClipMap, type InputState } from "./types";

// ─── GameEngine ───────────────────────────────────────────────────────────────
export class GameEngine {
  // Three.js core
  private scene:    THREE.Scene;
  private camera:   THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private timer   = new THREE.Timer();
  private rafId   = 0;
  private disposed= false;
  private elapsed = 0;

  // Character
  private character:    CharacterDef;
  private isMobile:     boolean;
  private player!:      THREE.Object3D;
  private modelRoot:    THREE.Object3D | null = null;
  private bodyParts:    { body: THREE.Object3D; head: THREE.Object3D } | null = null;
  private playerHeight= 1.6;
  private animTime    = 0;

  // Controllers (tách file)
  private camCtrl!:     CameraController;
  private inputCtrl!:   InputController;
  private overlay!:     LoadingOverlay;
  private sceneCtrl!:   SceneController;

  // Controllers (existing)
  private animCtrl!:    AnimationController;
  private playerCtrl!:  PlayerController;
  private combatCtrl!:  CombatController;
  private cameraIntro!: CameraIntro;

  // UI
  private hud!:         HUD;
  private mobileUI:     MobileUI | null = null;
  private dialogue!:    DialogueUI;
  private screenManager!: ScreenManager;

  // Scene state — dùng qua sceneCtrl
  private _worldScene:   WorldScene | null        = null;
  private _introHandles: IntroSceneHandles | null = null;

  private constructor(
    private container: HTMLElement,
    character:         CharacterDef,
    model:             THREE.Group | null,
    clips:             AnimClipMap,
  ) {
    this.character = character;
    this.isMobile  = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

    // ── Renderer ───────────────────────────────────────────────────────────
    this.scene  = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog        = new THREE.Fog(0x9bc4e2, 40, 180);

    this.camera = new THREE.PerspectiveCamera(
      52,
      container.clientWidth / container.clientHeight,
      0.1, 600
    );
    this.renderer = new THREE.WebGLRenderer({
      antialias:         !this.isMobile,
      powerPreference:   "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled  = !this.isMobile;
    this.renderer.shadowMap.type     = THREE.PCFShadowMap;
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure= 1.05;
    this.renderer.outputColorSpace   = THREE.SRGBColorSpace;
    container.style.position = "relative";
    container.appendChild(this.renderer.domElement);

    this.screenManager = new ScreenManager();

    // ── Player ─────────────────────────────────────────────────────────────
    this.player      = new THREE.Group();
    this.player.name = "PlayerRig";

    // ── Controllers ────────────────────────────────────────────────────────
    this.animCtrl = new AnimationController({
      isMoving:       () => this.playerCtrl.isMovingNow(),
      onComboChanged: (n) => this.hud.flashCombo(n),
    });

    this.combatCtrl = new CombatController(
      this.player, this.camera, this.container,
      (key) => this.animCtrl.triggerAttack(key),
      () => this._worldScene?.getEnemyRoots() ?? [],
    );

    this.playerCtrl = new PlayerController({
      character,
      worldRadius: 140,
      onAttack: (key) => this.combatCtrl.scheduleAttack(key as "punch" | "kick" | "mmaKick"),
    });

    if (model) {
      const { modelRoot, playerHeight, footOffset } =
        this.animCtrl.setupModel(this.player, model, clips);
      this.modelRoot    = modelRoot;
      this.playerHeight = playerHeight;
      this.playerCtrl.setFloor(footOffset);
    } else {
      this.player.add(this._createPlaceholder());
    }
    this.scene.add(this.player);

    // ── UI ─────────────────────────────────────────────────────────────────
    this.dialogue = new DialogueUI(container);
    this.hud      = new HUD(container, character, this.isMobile);
    if (this.isMobile) {
      this.mobileUI = new MobileUI(
        container,
        this.renderer.domElement,
        this.playerCtrl.input,
        {
          jump:         () => this.playerCtrl.requestJump(),
          attack:       (key) => this.combatCtrl.scheduleAttack(key as "punch" | "kick" | "mmaKick"),
          rotateCamera: (dYaw, dPitch) => {
            this.camCtrl.addYaw(dYaw);
            this.camCtrl.addPitch(dPitch);
          },
        }
      );
    }

    // ── Tách-ra controllers ────────────────────────────────────────────────
    this.camCtrl = new CameraController();

    this.overlay = new LoadingOverlay(container);

    this.sceneCtrl = new SceneController(
      {
        scene:        this.scene,
        player:       this.player,
        camera:       this.camera,
        overlay:      this.overlay,
        onWorldReady: (ws) => { this._worldScene = ws; this.elapsed = 0; },
        onIntroReady: (h)  => { this._introHandles = h; this.elapsed = 0; },
        onWorldClear: ()   => { this._worldScene = null; },
        setColliders: (c)  => this.playerCtrl.setColliders(c as any),
        resetCombat:  ()   => this.combatCtrl.reset(),
      },
      this.isMobile
    );

    this.inputCtrl = new InputController(
      this.renderer.domElement,
      container,
      {
        onRotate:      (dY, dP) => { this.camCtrl.addYaw(dY); this.camCtrl.addPitch(dP); },
        onZoom:        (d)      => this.camCtrl.addZoom(d),
        onAttack:      ()       => this.combatCtrl.scheduleAttack("punch"),
        isIntroActive: ()       => this.cameraIntro?.isActive() ?? false,
        onResize:      (w, h)   => {
          this.camera.aspect = w / h;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(w, h);
        },
      },
      this.isMobile
    );

    // ── Events ─────────────────────────────────────────────────────────────
    eventBus.on(GameEvents.PLAYER_DAMAGE, (data: { amount: number }) => {
      this.playerCtrl.hp = Math.max(0, this.playerCtrl.hp - data.amount / 100);
      this.hud.setHP(this.playerCtrl.hp);
      this.combatCtrl.camShake.addTrauma(0.3);
    });

    this.playerCtrl.bindKeyboard();

    // ── Khởi động ──────────────────────────────────────────────────────────
    this.sceneCtrl.loadIntro(this.isMobile);
    this._start();

    this.cameraIntro = new CameraIntro(this.camera, () => {
      this.sceneCtrl.switchToWorld().catch(console.error);
    });
  }

  // ── Factory ────────────────────────────────────────────────────────────────
  static async create(
    container: HTMLElement,
    character: CharacterDef,
    model:     THREE.Group | null,
    clips:     AnimClipMap,
  ): Promise<GameEngine> {
    return new GameEngine(container, character, model, clips);
  }

  // ── Game Loop ──────────────────────────────────────────────────────────────
  private _start() {
    this.timer.update();
    const tick = () => {
      if (this.disposed) return;
      this.timer.update();
      const dt          = Math.min(this.timer.getDelta(), 0.05);
      this._update(dt);
      const renderScene = this._worldScene ? this._worldScene.scene : this.scene;
      this.renderer.render(renderScene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private _update(dt: number): void {
    // ── Intro cutscene ──────────────────────────────────────────────────────
    if (this.cameraIntro?.isActive()) {
      this.cameraIntro.tick(dt);
      this.animCtrl.update(dt);
      this.dialogue.update(dt);
      return;
    }

    this.elapsed += dt;

    // ── Camera lerp ─────────────────────────────────────────────────────────
    const lk = this.camCtrl.tick(dt);

    // ── Player movement ─────────────────────────────────────────────────────
    const locked = this.dialogue.isVisible();
    let moving = false, sprinting = false, onGround = true;

    if (!locked) {
      const r = this.playerCtrl.update(dt, this.camCtrl.yaw, this.player);
      moving    = r.moving;
      sprinting = r.sprinting;
      onGround  = r.onGround;
    }

    // ── Combat + Animation ──────────────────────────────────────────────────
    this.combatCtrl.update(dt);
    this.combatCtrl.camShake.apply(this.camera, dt);

    const { isAttacking } = this.animCtrl.update(dt);
    if (!isAttacking) this.animCtrl.drive(moving, sprinting, onGround);

    // ── Placeholder body bob ────────────────────────────────────────────────
    this.animTime += dt;
    if (this.bodyParts) {
      const bob = moving && onGround
        ? Math.sin(this.animTime * 14) * 0.06
        : Math.sin(this.animTime *  2) * 0.03;
      this.bodyParts.body.position.y = 0.9  + bob;
      this.bodyParts.head.position.y = 1.75 + bob;
    }

    // ── Scene tick ──────────────────────────────────────────────────────────
    this.sceneCtrl.tick(dt, this.elapsed);
    this.dialogue.update(dt);

    // ── Camera apply ────────────────────────────────────────────────────────
    this.camCtrl.apply(this.camera, this.player.position, this.playerHeight, lk);

    // ── HUD ─────────────────────────────────────────────────────────────────
    this.hud.setStamina(this.playerCtrl.stamina);
    this.hud.setHP(this.playerCtrl.hp);
    this.hud.setCompassYaw(this.camCtrl.yaw);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  getScene()  { return this.scene; }
  getPlayer() { return this.player; }
  getMixer()  { return this.animCtrl.getMixer(); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.playerCtrl.unbindKeyboard();
    this.inputCtrl.dispose();
    this.overlay.hide();
    this.combatCtrl.dispose();
    this.mobileUI?.dispose();
    this.hud.dispose();
    this.dialogue.dispose();
    this.screenManager.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }

  // ── Placeholder khi không có model ────────────────────────────────────────
  private _createPlaceholder(): THREE.Object3D {
    const group  = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.character.color, roughness: 0.6, metalness: 0.15,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 4, 12), bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe6c7a8, roughness: 0.8 })
    );
    head.position.y = 1.75;
    head.castShadow = true;
    group.add(head);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.75, 0.32);
    group.add(nose);

    this.bodyParts = { body, head };
    return group;
  }
}
