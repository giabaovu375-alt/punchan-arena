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

import { BaseScene } from "./scenes/BaseScene";
import {
  HubScene,
  MainRoadScene,
  LeftForestScene,
  RightPlatformScene,
  BossScene,
  SunsetCitySquareScene, // Ghim sẵn phôi Map 2
} from "./scenes";

import {
  HUD,
  MobileUI,
  DialogueUI,
} from "./ui";

import { INTRO_NPC_DIALOGUE } from "./dialogues";

import {
  buildIntroScene,
  tickIntroScene,
  PLAYER_SPAWN,
  type IntroSceneHandles,
} from "./IntroScene";

export { ANIM_KEYS, type AnimKey, type AnimClipMap, type InputState } from "./types";

type SceneMode = "intro" | "gameplay";

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

  // ── Camera (third‑person) ─────────────────────────────────────────────────
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

  // ── Scene management nâng cấp ─────────────────────────────────────────────
  private sceneMode: SceneMode = "intro";
  private currentScene: BaseScene | null = null; 
  private introHandles: IntroSceneHandles | null = null;
  private npcTriggered = false;
  private lastPortalTarget: string | null = null;

  private screenManager!: ScreenManager;

  // ── Intro camera (sequence) ─────────────────────────────────────────────
  private cameraIntro!: CameraIntro;
  private introCompleted = false;

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

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0x9bc4e2, 40, 180);

    this.camera = new THREE.PerspectiveCamera(
      52, container.clientWidth / container.clientHeight, 0.1, 600,
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile,
      powerPreference: "high-performance",
    });
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

    this.player = new THREE.Group();
    this.player.name = "PlayerRig";

    this.animCtrl = new AnimationController({
      isMoving: () => this.playerCtrl.isMovingNow(),
      onComboChanged: (count) => this.hud.flashCombo(count),
    });

    this.combatCtrl = new CombatController(
      this.player,
      this.camera,
      this.container,
      (key) => this.animCtrl.triggerAttack(key),
      () => this.currentScene?.getEnemyRoots() ?? [], // Dynamic target scanning cho mọi map
    );

    this.playerCtrl = new PlayerController({
      character,
      worldRadius: 140,
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

    this.dialogue = new DialogueUI(container);
    this.playerCtrl.bindKeyboard();
    this.bindMouseAndResize();

    this.hud = new HUD(container, character, this.isMobile);

    // Lắng nghe damage toàn cục
    eventBus.on(GameEvents.PLAYER_DAMAGE, (data: { amount: number }) => {
      this.playerCtrl.hp = Math.max(0, this.playerCtrl.hp - data.amount / 100);
      this.hud.setHP(this.playerCtrl.hp);
      this.combatCtrl.camShake.addTrauma(0.3);

      // Logic "Ép thua cốt truyện" tại phòng Boss
      if (this.playerCtrl.hp <= 0 && this.currentScene?.name === "BossScene") {
        this.playerCtrl.hp = 1.0; 
        this.hud.setHP(1.0);
        this.switchToScene("SunsetCitySquareScene").catch(err => console.error(err));
      }
    });

    // Lắng nghe cổng dịch chuyển từ portal bộc phát
    eventBus.on(GameEvents.PORTAL_ENTERED, (data: { targetScene: string; spawnPos?: THREE.Vector3 }) => {
      this.switchToScene(data.targetScene, data.spawnPos).catch(err => console.error(err));
    });

    if (this.isMobile) {
      this.mobileUI = new MobileUI(
        container,
        this.renderer.domElement,
        this.playerCtrl.input,
        {
          jump:   () => this.playerCtrl.requestJump(),
          attack: (key) => this.combatCtrl.scheduleAttack(key as "punch" | "kick" | "mmaKick"),
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

    this.cameraIntro = new CameraIntro(this.camera, () => {
      this.introCompleted = true;
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

  // ── Loading overlay ────────────────────────────────────────────────────
  private showLoadingOverlay(text = "Đang tải...") {
    if (this.loadingOverlay) return;
    const el = document.createElement("div");
    el.style.cssText = `
      position:absolute; inset:0; z-index:999;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      background:rgba(0,0,0,0.78);
      backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
      font-family:'SF Pro Display','Helvetica Neue',sans-serif;
      color:#fff; gap:20px; opacity:0; transition:opacity 0.25s ease;
    `;
    el.innerHTML = `
      <div style="width:46px;height:46px;border-radius:50%;
        border:3px solid rgba(255,255,255,0.1);border-top-color:#00f5d4;
        animation:ge-spin 0.85s linear infinite;"></div>
      <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;
        color:rgba(255,255,255,0.7);">${text}</div>
      <style>@keyframes ge-spin{to{transform:rotate(360deg)}}</style>
    `;
    this.container.appendChild(el);
    this.loadingOverlay = el;
    requestAnimationFrame(() => { if (el.isConnected) el.style.opacity = "1"; });
  }

  private hideLoadingOverlay() {
    if (!this.loadingOverlay) return;
    const el = this.loadingOverlay;
    this.loadingOverlay = null;
    el.style.opacity = "0";
    setTimeout(() => el.parentElement?.removeChild(el), 300);
  }

  private clearThreeScene(target: THREE.Scene) {
    const toRemove: THREE.Object3D[] = [];
    target.traverse(o => {
      if (o !== this.player && o.parent === target) toRemove.push(o);
    });
    toRemove.forEach(o => target.remove(o));
  }

  private loadIntroScene() {
    if (this.currentScene) {
      this.currentScene.scene.remove(this.player);
      this.currentScene.unload().catch(err => console.error(err));
      this.currentScene = null;
    }
    this.introHandles = null;

    collisionManager.clear();
    this.clearThreeScene(this.scene);
    this.scene.add(this.player);
    this.introHandles = buildIntroScene(this.scene, this.isMobile);
    this.playerCtrl.setColliders([]);
    if (this.player?.position && PLAYER_SPAWN) {
      this.player.position.copy(PLAYER_SPAWN);
    }
    this.sceneMode     = "intro";
    this.npcTriggered  = false;
    this.lastPortalTarget = null;
    this.elapsed       = 0;
    this.combatCtrl.reset();
  }

  // TỐI ƯU GỌN GÀNG: Đăng ký Map tự động thông qua Registry Dictionary
  private async switchToScene(sceneName: string, spawnPos?: THREE.Vector3) {
    this.showLoadingOverlay("Đang chuyển vùng đất...");
    await new Promise<void>((r) => setTimeout(r, 60));

    if (this.currentScene) {
      this.currentScene.scene.remove(this.player);
      await this.currentScene.unload();
      this.currentScene = null;
    }
    this.introHandles = null;

    collisionManager.clear();
    this.clearThreeScene(this.scene);
    this.scene.remove(this.player);

    const sceneRegistry: Record<string, new () => BaseScene> = {
      "HubScene": HubScene,
      "MainRoadScene": MainRoadScene,
      "LeftForestScene": LeftForestScene,
      "RightPlatformScene": RightPlatformScene,
      "BossScene": BossScene,
      "SunsetCitySquareScene": SunsetCitySquareScene, // Sẵn sàng cho Map 2
    };

    const SceneClass = sceneRegistry[sceneName];
    if (!SceneClass) {
      this.loadIntroScene();
      this.hideLoadingOverlay();
      return;
    }

    const newScene = new SceneClass();
    let loaded = false;
    try {
      await newScene.load();
      loaded = true;
    } catch (err) {
      console.error(`❌ Không load được ${sceneName}:`, err);
    }

    if (!loaded) {
      this.loadIntroScene();
      this.hideLoadingOverlay();
      return;
    }

    newScene.setPlayer(this.player);
    newScene.setCamera(this.camera);
    newScene.scene.add(this.player);
    
    this.currentScene = newScene;
    this.sceneMode = "gameplay";
    this.elapsed   = 0;
    this.playerCtrl.setColliders([]);

    if (spawnPos) {
      this.player.position.copy(spawnPos);
    } else {
      // Đặt tọa độ spawn mặc định hợp lý cho từng Map cụ thể
      if (sceneName === "HubScene") this.player.position.set(0, 0, 30);
      else if (sceneName === "BossScene") this.player.position.set(0, 0, -25);
      else this.player.position.set(0, 0, 0);
    }

    this.lastPortalTarget = null;
    this.combatCtrl.reset();
    this.hideLoadingOverlay();
  }

  private async switchToHub() {
    await this.switchToScene("HubScene", new THREE.Vector3(0, 0, 30));
  }

  // ── Placeholder ────────────────────────────────────────────────────────
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

  // ── Mouse / Resize ─────────────────────────────────────────────────────
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
    this.lastMouse  = { x: e.clientX, y: e.clientY };
    if (e.button === 0) this.combatCtrl.scheduleAttack("punch");
  };
  private onMouseUp   = () => { this.isRotating = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.isRotating || this.isMobile || this.cameraIntro?.isActive()) return;
    this.targetYaw   -= (e.clientX - this.lastMouse.x) * 0.005;
    this.targetPitch -= (e.clientY - this.lastMouse.y) * 0.005;
    this.targetPitch  = Math.max(-1.2, Math.min(0.3, this.targetPitch));
    this.lastMouse = { x: e.clientX, y: e.clientY };
  };
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

  // ── Pinch zoom ─────────────────────────────────────────────────────────
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
      this.targetDistance = Math.max(
        this.CAM_DIST_MIN,
        Math.min(this.CAM_DIST_MAX, this.pinchStartCamDist * (this.pinchStartDist / dist)),
      );
    }
  };

  // ── Game loop ──────────────────────────────────────────────────────────
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
      
      // Render đúng Scene đang hoạt động
      const renderScene = this.sceneMode === "gameplay" && this.currentScene 
        ? this.currentScene.scene : this.scene;
        
      this.renderer.render(renderScene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(dt: number) {
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
      moving    = result.moving;
      sprinting = result.sprinting;
      onGround  = result.onGround;
      playerPos = this.player.position.clone();
    }

    const resolvedPos = collisionManager.resolveCollisions(playerPos, 0.4, "player");
    this.player.position.copy(resolvedPos);

    this.combatCtrl.update(dt);
    this.combatCtrl.camShake.apply(this.camera, dt);

    const { isAttacking } = this.animCtrl.update(dt);
    if (!isAttacking) this.animCtrl.drive(moving, sprinting, onGround);

    this.animTime += dt;
    if (this.bodyParts) {
      const bob = moving && onGround
        ? Math.sin(this.animTime * 14) * 0.06
        : Math.sin(this.animTime * 2)  * 0.03;
      this.bodyParts.body.position.y = 0.9  + bob;
      this.bodyParts.head.position.y = 1.75 + bob;
    }

    // ── GỌN GÀNG HOÁ LOGIC CẬP NHẬT SCENE ───────────────────────────────────
    if (this.sceneMode === "intro" && this.introHandles) {
      tickIntroScene(this.introHandles, dt, this.elapsed);

      if (!this.npcTriggered && !locked && this.introHandles.checkNPCProximity(this.player.position)) {
        this.npcTriggered = true;
        this.dialogue.show(
          INTRO_NPC_DIALOGUE.npcName,
          INTRO_NPC_DIALOGUE.lines,
          () => { this.switchToHub().catch(err => console.error(err)); },
        );
      }
    } else if (this.currentScene) {
      this.currentScene.update(dt);
      
      if (!locked && !isAttacking) {
        const target = this.currentScene.checkPortals(this.player.position);
        if (target) {
          if (target !== this.lastPortalTarget) {
            this.lastPortalTarget = target;
            eventBus.emit(GameEvents.PORTAL_ENTERED, {
              targetScene: target,
              spawnPos: this.player.position.clone(),
            });
          }
        } else {
          this.lastPortalTarget = null;
        }
      }
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
      this.renderer.domElement.
