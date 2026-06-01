import * as THREE from "three";
import { type CharacterDef } from "./characters";

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
}

/**
 * Khung game 3D nhập vai góc nhìn thứ 3.
 * - World rộng với địa hình, cây cối, đá, ngôi làng, hồ nước, vòng cổng đá
 * - Character controller (WASD, Space, Shift)
 * - Camera orbit theo nhân vật (giữ chuột để xoay, cuộn để zoom)
 *
 * Thay model thật bằng cách sửa `createPlayerMesh()`.
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

  // Player
  private player!: THREE.Object3D;
  private velocity = new THREE.Vector3();
  private onGround = true;
  private playerHeight = 1.6;
  private moveSpeed: number;
  private sprintMultiplier = 1.8;
  private jumpSpeed: number;
  private gravity = -22;

  // Anim helpers (placeholder body bob)
  private bodyParts: { body: THREE.Object3D; head: THREE.Object3D } | null = null;
  private animTime = 0;
  private isMoving = false;

  // Camera orbit
  private cameraYaw = 0;
  private cameraPitch = -0.25;
  private cameraDistance = 7;
  private isRotating = false;
  private lastMouse = { x: 0, y: 0 };

  // World extents (for soft boundary)
  private worldRadius = 140;

  private input: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
  };

  constructor(container: HTMLElement, character: CharacterDef) {
    this.container = container;
    this.character = character;
    this.moveSpeed = character.moveSpeed;
    this.jumpSpeed = character.jumpSpeed;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0x9bc4e2, 40, 180);

    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      600,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.buildWorld();
    this.player = this.createPlayerMesh();
    this.scene.add(this.player);

    this.bindEvents();
    this.start();
  }

  // === World ===
  private buildWorld() {
    // --- Lighting ---
    const hemi = new THREE.HemisphereLight(0xfff1d9, 0x3a4a2a, 0.7);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d0, 1.4);
    sun.position.set(60, 80, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // Rim fill
    const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
    fill.position.set(-40, 30, -20);
    this.scene.add(fill);

    // --- Ground with bumpy terrain via vertex displacement ---
    const groundGeo = new THREE.PlaneGeometry(400, 400, 120, 120);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.sqrt(x * x + y * y);
      const h =
        Math.sin(x * 0.05) * 0.5 +
        Math.cos(y * 0.07) * 0.5 +
        Math.sin((x + y) * 0.02) * 1.2;
      // Flatten center near spawn
      const flatten = Math.min(1, r / 18);
      pos.setZ(i, h * flatten);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({
        color: 0x6b8e4e,
        roughness: 0.95,
        metalness: 0,
        flatShading: true,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // --- Path (a subtle road across spawn) ---
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 200),
      new THREE.MeshStandardMaterial({ color: 0xa89368, roughness: 1 }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.y = 0.02;
    path.receiveShadow = true;
    this.scene.add(path);

    // --- Lake ---
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({
        color: 0x3a6ea8,
        roughness: 0.2,
        metalness: 0.4,
        transparent: true,
        opacity: 0.85,
      }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(-45, 0.03, 35);
    this.scene.add(lake);

    // --- Trees ---
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2.2, 6);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x5b3a22,
      roughness: 1,
    });
    const leafGeo = new THREE.ConeGeometry(1.6, 3.5, 8);
    const leafMats = [
      new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x3a7d3a, roughness: 1, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x4a8b3a, roughness: 1, flatShading: true }),
    ];

    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25 + Math.random() * 100;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      // skip if near lake
      if (Math.hypot(x + 45, z - 35) < 18) continue;

      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      tree.add(trunk);

      const leaves = new THREE.Mesh(
        leafGeo,
        leafMats[Math.floor(Math.random() * leafMats.length)],
      );
      leaves.position.y = 3.4;
      leaves.castShadow = true;
      tree.add(leaves);

      tree.position.set(x, 0, z);
      const s = 0.7 + Math.random() * 0.9;
      tree.scale.setScalar(s);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(tree);
    }

    // --- Rocks ---
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x7a7a7a,
      roughness: 1,
      flatShading: true,
    });
    for (let i = 0; i < 40; i++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.4 + Math.random() * 1.2, 0),
        rockMat,
      );
      const angle = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * 110;
      rock.position.set(
        Math.cos(angle) * dist,
        0.2,
        Math.sin(angle) * dist,
      );
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    }

    // --- Stone arch (landmark) ---
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x8a8278,
      roughness: 0.9,
    });
    const pillarGeo = new THREE.BoxGeometry(1.2, 5, 1.2);
    const archGroup = new THREE.Group();
    const pL = new THREE.Mesh(pillarGeo, stoneMat);
    pL.position.set(-2.5, 2.5, 0);
    pL.castShadow = true;
    const pR = new THREE.Mesh(pillarGeo, stoneMat);
    pR.position.set(2.5, 2.5, 0);
    pR.castShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.8, 1.4), stoneMat);
    top.position.set(0, 5.4, 0);
    top.castShadow = true;
    archGroup.add(pL, pR, top);
    archGroup.position.set(25, 0, -10);
    archGroup.rotation.y = -0.4;
    this.scene.add(archGroup);

    // --- Village huts ---
    const hutWallMat = new THREE.MeshStandardMaterial({ color: 0xb89a72, roughness: 1 });
    const hutRoofMat = new THREE.MeshStandardMaterial({ color: 0x6e2e1f, roughness: 1, flatShading: true });
    const hutPositions: [number, number, number][] = [
      [40, 0, 30],
      [48, 0, 26],
      [44, 0, 38],
      [38, 0, 42],
    ];
    for (const [x, , z] of hutPositions) {
      const hut = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.8, 4), hutWallMat);
      wall.position.y = 1.4;
      wall.castShadow = true;
      wall.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.2, 4), hutRoofMat);
      roof.position.y = 3.9;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      hut.add(wall, roof);
      hut.position.set(x, 0, z);
      hut.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(hut);
    }

    // --- Bonfire (warm point light) ---
    const fireBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.8, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
    );
    fireBase.position.set(8, 0.15, 8);
    this.scene.add(fireBase);
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1, 8),
      new THREE.MeshStandardMaterial({
        color: 0xff7733,
        emissive: 0xff5511,
        emissiveIntensity: 2,
      }),
    );
    fire.position.set(8, 0.8, 8);
    this.scene.add(fire);
    const fireLight = new THREE.PointLight(0xff7733, 2, 18, 2);
    fireLight.position.set(8, 1.5, 8);
    this.scene.add(fireLight);
  }

  /** Placeholder player - thay bằng model GLTF của bạn sau. */
  private createPlayerMesh(): THREE.Object3D {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.character.color,
      roughness: 0.6,
      metalness: 0.15,
    });

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 0.8, 4, 12),
      bodyMat,
    );
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe6c7a8, roughness: 0.8 }),
    );
    head.position.y = 1.75;
    head.castShadow = true;
    group.add(head);

    // Hướng nhìn (mũi tên nhỏ phía trước) - dùng để định hướng debug
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.75, 0.32);
    group.add(nose);

    this.bodyParts = { body, head };
    group.position.set(0, 0, 0);
    return group;
  }

  // === Input ===
  private bindEvents() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("wheel", this.onWheel, {
      passive: false,
    });
    this.renderer.domElement.addEventListener("contextmenu", (e) =>
      e.preventDefault(),
    );
    window.addEventListener("resize", this.onResize);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.input.forward = true; break;
      case "KeyS": case "ArrowDown": this.input.backward = true; break;
      case "KeyA": case "ArrowLeft": this.input.left = true; break;
      case "KeyD": case "ArrowRight": this.input.right = true; break;
      case "Space": this.input.jump = true; break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint = true; break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.input.forward = false; break;
      case "KeyS": case "ArrowDown": this.input.backward = false; break;
      case "KeyA": case "ArrowLeft": this.input.left = false; break;
      case "KeyD": case "ArrowRight": this.input.right = false; break;
      case "Space": this.input.jump = false; break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint = false; break;
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    this.isRotating = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
  };
  private onMouseUp = () => { this.isRotating = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.isRotating) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    this.cameraYaw -= dx * 0.005;
    this.cameraPitch -= dy * 0.005;
    this.cameraPitch = Math.max(-1.2, Math.min(0.3, this.cameraPitch));
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.cameraDistance += e.deltaY * 0.01;
    this.cameraDistance = Math.max(2.5, Math.min(18, this.cameraDistance));
  };
  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // === Loop ===
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
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));

    const move = new THREE.Vector3();
    if (this.input.forward) move.add(forward);
    if (this.input.backward) move.sub(forward);
    if (this.input.right) move.add(right);
    if (this.input.left) move.sub(right);

    this.isMoving = move.lengthSq() > 0;

    if (this.isMoving) {
      move.normalize();
      const speed = this.moveSpeed * (this.input.sprint ? this.sprintMultiplier : 1);
      this.velocity.x = move.x * speed;
      this.velocity.z = move.z * speed;
      const targetYaw = Math.atan2(move.x, move.z);
      this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetYaw, Math.min(1, dt * 12));
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    if (this.input.jump && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }
    this.velocity.y += this.gravity * dt;

    this.player.position.x += this.velocity.x * dt;
    this.player.position.y += this.velocity.y * dt;
    this.player.position.z += this.velocity.z * dt;

    // Boundary (soft)
    const distFromCenter = Math.hypot(this.player.position.x, this.player.position.z);
    if (distFromCenter > this.worldRadius) {
      const k = this.worldRadius / distFromCenter;
      this.player.position.x *= k;
      this.player.position.z *= k;
    }

    if (this.player.position.y <= 0) {
      this.player.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // Idle/walk bob anim
    this.animTime += dt;
    if (this.bodyParts) {
      if (this.isMoving && this.onGround) {
        const bob = Math.sin(this.animTime * 14) * 0.06;
        this.bodyParts.body.position.y = 0.9 + bob;
        this.bodyParts.head.position.y = 1.75 + bob;
      } else {
        const idle = Math.sin(this.animTime * 2) * 0.03;
        this.bodyParts.body.position.y = 0.9 + idle;
        this.bodyParts.head.position.y = 1.75 + idle;
      }
    }

    // Camera follow
    const camOffset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      -Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    ).multiplyScalar(this.cameraDistance);

    const target = this.player.position.clone().add(new THREE.Vector3(0, this.playerHeight, 0));
    this.camera.position.copy(target).add(camOffset);
    this.camera.lookAt(target);
  }

  private lerpAngle(a: number, b: number, t: number) {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  getScene() { return this.scene; }
  getPlayer() { return this.player; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
