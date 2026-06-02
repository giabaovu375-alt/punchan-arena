import * as THREE from "three";
import { type CharacterDef } from "./characters";

export const ANIM_KEYS = [
  "idle", "walk", "run", "jump",
  "punch", "kick", "uppercut", "dropKick", "mmaKick", "elbow", "pain",
] as const;
export type AnimKey = (typeof ANIM_KEYS)[number];

/** Map từ AnimKey → AnimationClip đã load sẵn từ bên ngoài */
export type AnimClipMap = Partial<Record<AnimKey, THREE.AnimationClip>>;

const COMBAT_ANIMS = new Set<AnimKey>(["punch","kick","uppercut","dropKick","mmaKick","elbow","pain"]);

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
  private player!: THREE.Object3D;
  private bodyParts: { body: THREE.Object3D; head: THREE.Object3D } | null = null;
  private animTime = 0;

  // Animation
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private currentAction: THREE.AnimationAction | null = null;
  private currentKey: AnimKey = "idle";
  private isAttacking = false;
  private attackCooldown = 0;

  // Physics
  private velocity = new THREE.Vector3();
  private onGround = true;
  private playerHeight = 1.6;
  private moveSpeed: number;
  private sprintMultiplier = 1.8;
  private jumpSpeed: number;
  private gravity = -22;

  // Camera
  private cameraYaw = 0;    private targetYaw = 0;
  private cameraPitch = -0.25; private targetPitch = -0.25;
  private cameraDistance = 7;  private targetDistance = 7;
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

  // Mobile
  private mobileUI: HTMLElement | null = null;
  private joystick: JoystickState = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: -1 };
  private joystickKnobEl: HTMLElement | null = null;
  private cameraTouch: { id: number; lastX: number; lastY: number } | null = null;

  /**
   * @param container  div để mount canvas vào
   * @param character  CharacterDef đã chọn
   * @param model      THREE.Group GLB đã load sẵn (clone trước khi truyền vào)
   * @param clips      AnimClipMap đã load sẵn
   */
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

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bc4e2);
    this.scene.fog = new THREE.Fog(0x9bc4e2, 40, 180);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60, container.clientWidth / container.clientHeight, 0.1, 600,
    );

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.buildWorld();

    // Player — dùng model thật nếu có, không thì placeholder
    if (model) {
      this.setupModel(model, clips);
    } else {
      this.player = this.createPlaceholder();
    }
    this.scene.add(this.player);

    this.bindEvents();
    this.buildMobileUI();
    this.start();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODEL SETUP (dùng asset đã có sẵn — không fetch gì thêm)
  // ═══════════════════════════════════════════════════════════════════════════
  private setupModel(model: THREE.Group, clips: AnimClipMap) {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    // VRoid GLB đúng scale rồi (1 unit = 1m)
    // Nếu model quá to/nhỏ thì chỉnh số này
    model.scale.setScalar(1);
    this.player = model;

    this.mixer = new THREE.AnimationMixer(this.player);

    for (const key of ANIM_KEYS) {
      let clip = clips[key];
      if (!clip) continue;
      // Tắt root motion: xoá Root.position track
      // để model di chuyển theo physics, không bị animation kéo trôi
      clip = clip.clone();
      clip.tracks = clip.tracks.filter(
        t => !(t.name.split(".")[0].toLowerCase() === "root" && t.name.includes(".position"))
      );
      const action = this.mixer.clipAction(clip);
      if (COMBAT_ANIMS.has(key) || key === "jump") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
    }

    this.mixer.addEventListener("finished", () => {
      if (COMBAT_ANIMS.has(this.currentKey) || this.currentKey === "jump") {
        this.isAttacking = false;
        this.playAnim(this.isMovingNow() ? "walk" : "idle", 0.25);
      }
    });

    this.playAnim("idle", 0);
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
    if (this.currentKey === key && this.currentAction?.isRunning()) return;
    const next = this.actions[key];
    if (!next) return;
    this.currentAction?.fadeOut(fade);
    next.reset().fadeIn(fade).play();
    this.currentAction = next;
    this.currentKey    = key;
  }

  private isMovingNow() {
    return this.input.forward || this.input.backward || this.input.left || this.input.right;
  }

  private triggerAttack(key: AnimKey) {
    if (this.isAttacking || this.attackCooldown > 0) return;
    this.isAttacking    = true;
    this.attackCooldown = 0.6;
    this.playAnim(key, 0.1);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORLD
  // ═══════════════════════════════════════════════════════════════════════════
  private buildWorld() {
    const hemi = new THREE.HemisphereLight(0xfff1d9, 0x3a4a2a, 0.7);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3d0, 1.4);
    sun.position.set(60, 80, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
    sun.shadow.camera.top  =  80; sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
    fill.position.set(-40, 30, -20);
    this.scene.add(fill);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(400, 400, 120, 120);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const r = Math.sqrt(x*x + y*y);
      const h = Math.sin(x*0.05)*0.5 + Math.cos(y*0.07)*0.5 + Math.sin((x+y)*0.02)*1.2;
      pos.setZ(i, h * Math.min(1, r/18));
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
      new THREE.MeshStandardMaterial({ color: 0x3a6ea8, roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.85 }),
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
  // MOBILE UI
  // ═══════════════════════════════════════════════════════════════════════════
  private buildMobileUI() {
    if (!("ontouchstart" in window) && navigator.maxTouchPoints === 0) return;
    const ui = document.createElement("div");
    Object.assign(ui.style, {
      position:"absolute", inset:"0", pointerEvents:"none",
      zIndex:"10", userSelect:"none", WebkitUserSelect:"none",
    });
    this.container.style.position = "relative";
    this.container.appendChild(ui);
    this.mobileUI = ui;

    // Joystick
    const joyBase = document.createElement("div");
    Object.assign(joyBase.style, {
      position:"absolute", bottom:"40px", left:"40px",
      width:"120px", height:"120px", borderRadius:"50%",
      background:"rgba(255,255,255,0.12)", border:"2px solid rgba(255,255,255,0.3)",
      backdropFilter:"blur(6px)", pointerEvents:"all", touchAction:"none",
      display:"flex", alignItems:"center", justifyContent:"center",
    });
    const joyKnob = document.createElement("div");
    Object.assign(joyKnob.style, {
      width:"48px", height:"48px", borderRadius:"50%",
      background:"rgba(255,255,255,0.55)", border:"2px solid rgba(255,255,255,0.85)",
      boxShadow:"0 2px 12px rgba(0,0,0,0.3)", position:"relative",
    });
    joyBase.appendChild(joyKnob); ui.appendChild(joyBase);
    this.joystickKnobEl = joyKnob;

    // Action buttons
    const btns = [
      { e:"👊", c:"rgba(255,110,40,0.8)",  b:"108px", r:"48px",  fn:()=>this.triggerAttack("punch")   },
      { e:"🦵", c:"rgba(240,50,70,0.8)",   b:"48px",  r:"112px", fn:()=>this.triggerAttack("kick")    },
      { e:"⬆️", c:"rgba(60,160,255,0.8)",  b:"48px",  r:"42px",  fn:()=>{ if(this.onGround){ this.velocity.y=this.jumpSpeed; this.onGround=false; } } },
      { e:"💥", c:"rgba(170,60,255,0.8)",  b:"108px", r:"114px", fn:()=>this.triggerAttack("mmaKick") },
      { e:"⚡", c:"rgba(255,200,30,0.8)",  b:"48px",  r:"178px", fn:()=>{ this.input.sprint=!this.input.sprint; } },
    ];
    for (const def of btns) {
      const btn = document.createElement("div");
      Object.assign(btn.style, {
        position:"absolute", bottom:def.b, right:def.r,
        width:"58px", height:"58px", borderRadius:"50%",
        background:def.c, border:"2px solid rgba(255,255,255,0.4)",
        backdropFilter:"blur(4px)", display:"flex", alignItems:"center",
        justifyContent:"center", fontSize:"22px",
        pointerEvents:"all", touchAction:"none",
        boxShadow:"0 3px 14px rgba(0,0,0,0.35)", transition:"transform 0.08s",
      });
      btn.textContent = def.e;
      btn.addEventListener("touchstart",(e)=>{ e.preventDefault(); btn.style.transform="scale(0.88)"; def.fn(); },{ passive:false });
      btn.addEventListener("touchend",()=>{ btn.style.transform="scale(1)"; });
      ui.appendChild(btn);
    }

    // Joystick touch
    joyBase.addEventListener("touchstart",(e)=>{
      e.preventDefault();
      const t=e.changedTouches[0], r=joyBase.getBoundingClientRect();
      this.joystick={ active:true, startX:r.left+r.width/2, startY:r.top+r.height/2, dx:0, dy:0, touchId:t.identifier };
    },{ passive:false });

    window.addEventListener("touchmove",(e)=>{
      for(let i=0;i<e.changedTouches.length;i++){
        const t=e.changedTouches[i];
        if(this.joystick.active && t.identifier===this.joystick.touchId){
          const MAX=44;
          let dx=t.clientX-this.joystick.startX, dy=t.clientY-this.joystick.startY;
          const d=Math.hypot(dx,dy); if(d>MAX){ dx*=MAX/d; dy*=MAX/d; }
          this.joystick.dx=dx; this.joystick.dy=dy;
          if(this.joystickKnobEl) this.joystickKnobEl.style.transform=`translate(${dx}px,${dy}px)`;
          const nx=dx/MAX, ny=dy/MAX, DZ=0.18;
          this.input.forward=ny<-DZ; this.input.backward=ny>DZ;
          this.input.left=nx<-DZ;   this.input.right=nx>DZ;
        }
        if(this.cameraTouch && t.identifier===this.cameraTouch.id){
          this.targetYaw  -=(t.clientX-this.cameraTouch.lastX)*0.006;
          this.targetPitch-=(t.clientY-this.cameraTouch.lastY)*0.006;
          this.targetPitch=Math.max(-1.2,Math.min(0.3,this.targetPitch));
          this.cameraTouch.lastX=t.clientX; this.cameraTouch.lastY=t.clientY;
        }
      }
    },{ passive:true });

    window.addEventListener("touchend",(e)=>{
      for(let i=0;i<e.changedTouches.length;i++){
        const t=e.changedTouches[i];
        if(t.identifier===this.joystick.touchId){
          this.joystick.active=false;
          if(this.joystickKnobEl) this.joystickKnobEl.style.transform="";
          this.input.forward=this.input.backward=this.input.left=this.input.right=false;
        }
        if(this.cameraTouch && t.identifier===this.cameraTouch.id) this.cameraTouch=null;
      }
    });

    this.renderer.domElement.addEventListener("touchstart",(e)=>{
      for(let i=0;i<e.changedTouches.length;i++){
        const t=e.changedTouches[i];
        if(t.clientX>window.innerWidth/2 && !this.cameraTouch)
          this.cameraTouch={ id:t.identifier, lastX:t.clientX, lastY:t.clientY };
      }
    },{ passive:true });
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
    this.renderer.domElement.addEventListener("wheel", this.onWheel, { passive:false });
    this.renderer.domElement.addEventListener("contextmenu",(e)=>e.preventDefault());
    window.addEventListener("resize", this.onResize);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch(e.code){
      case "KeyW": case "ArrowUp":    this.input.forward=true;  break;
      case "KeyS": case "ArrowDown":  this.input.backward=true; break;
      case "KeyA": case "ArrowLeft":  this.input.left=true;     break;
      case "KeyD": case "ArrowRight": this.input.right=true;    break;
      case "Space": e.preventDefault();
        if(this.onGround){ this.velocity.y=this.jumpSpeed; this.onGround=false; } break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint=true; break;
      case "KeyZ": this.triggerAttack("punch");    break;
      case "KeyX": this.triggerAttack("kick");     break;
      case "KeyC": this.triggerAttack("uppercut"); break;
      case "KeyV": this.triggerAttack("mmaKick");  break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    switch(e.code){
      case "KeyW": case "ArrowUp":    this.input.forward=false;  break;
      case "KeyS": case "ArrowDown":  this.input.backward=false; break;
      case "KeyA": case "ArrowLeft":  this.input.left=false;     break;
      case "KeyD": case "ArrowRight": this.input.right=false;    break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint=false; break;
    }
  };
  private onMouseDown = (e: MouseEvent) => {
    this.isRotating=true; this.lastMouse={ x:e.clientX, y:e.clientY };
    if(e.button===0) this.triggerAttack("punch");
  };
  private onMouseUp   = () => { this.isRotating=false; };
  private onMouseMove = (e: MouseEvent) => {
    if(!this.isRotating) return;
    this.targetYaw  -=(e.clientX-this.lastMouse.x)*0.005;
    this.targetPitch-=(e.clientY-this.lastMouse.y)*0.005;
    this.targetPitch=Math.max(-1.2,Math.min(0.3,this.targetPitch));
    this.lastMouse={ x:e.clientX, y:e.clientY };
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.targetDistance=Math.max(2.5,Math.min(18,this.targetDistance+e.deltaY*0.01));
  };
  private onResize = () => {
    const w=this.container.clientWidth, h=this.container.clientHeight;
    this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  private start() {
    const tick = () => {
      if(this.disposed) return;
      this.update(Math.min(this.clock.getDelta(), 0.05));
      this.renderer.render(this.scene, this.camera);
      this.rafId=requestAnimationFrame(tick);
    };
    this.rafId=requestAnimationFrame(tick);
  }

  private update(dt: number) {
    if(this.attackCooldown>0) this.attackCooldown-=dt;

    const lk=1-Math.exp(-12*dt);
    this.cameraYaw     =this.lerpAngle(this.cameraYaw, this.targetYaw, lk);
    this.cameraPitch  +=(this.targetPitch-this.cameraPitch)*lk;
    this.cameraDistance+=(this.targetDistance-this.cameraDistance)*lk;

    const fwd = new THREE.Vector3(-Math.sin(this.cameraYaw),0,-Math.cos(this.cameraYaw));
    const rgt = new THREE.Vector3( Math.cos(this.cameraYaw),0,-Math.sin(this.cameraYaw));
    const move = new THREE.Vector3();
    if(this.input.forward)  move.add(fwd);
    if(this.input.backward) move.sub(fwd);
    if(this.input.right)    move.add(rgt);
    if(this.input.left)     move.sub(rgt);

    const moving=move.lengthSq()>0;
    if(moving) console.log("pos:", this.player.position.x.toFixed(2), this.player.position.z.toFixed(2));
    if(moving){
      move.normalize();
      const spd=this.moveSpeed*(this.input.sprint?this.sprintMultiplier:1);
      this.velocity.x=move.x*spd; this.velocity.z=move.z*spd;
      this.player.rotation.y=this.lerpAngle(
        this.player.rotation.y, Math.atan2(move.x,move.z), Math.min(1,dt*12),
      );
    } else {
      this.velocity.x*=0.8; this.velocity.z*=0.8;
    }

    this.velocity.y+=this.gravity*dt;
    this.player.position.addScaledVector(this.velocity,dt);

    if(this.player.position.y<=0){
      this.player.position.y=0; this.velocity.y=0; this.onGround=true;
    }
    const d=Math.hypot(this.player.position.x,this.player.position.z);
    if(d>this.worldRadius){
      this.player.position.x*=this.worldRadius/d;
      this.player.position.z*=this.worldRadius/d;
    }

    // Placeholder bob
    this.animTime+=dt;
    if(this.bodyParts){
      const bob=moving&&this.onGround ? Math.sin(this.animTime*14)*0.06 : Math.sin(this.animTime*2)*0.03;
      this.bodyParts.body.position.y=0.9+bob;
      this.bodyParts.head.position.y=1.75+bob;
    }

    // Anim state machine
    if(this.mixer){
      if(!this.isAttacking){
        if(!this.onGround)   this.playAnim("jump",0.15);
        else if(moving)      this.playAnim(this.input.sprint?"run":"walk",0.2);
        else                 this.playAnim("idle",0.3);
      }
      this.mixer.update(dt);
    }

    // Fire flicker
    if(this.fireLight)
      this.fireLight.intensity=1.8+Math.sin(Date.now()*0.009)*0.4+Math.random()*0.25;

    // Camera
    const camOff=new THREE.Vector3(
      Math.sin(this.cameraYaw)*Math.cos(this.cameraPitch),
      -Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw)*Math.cos(this.cameraPitch),
    ).multiplyScalar(this.cameraDistance);
    const tgt=this.player.position.clone().add(new THREE.Vector3(0,this.playerHeight,0));
    this.camera.position.lerp(tgt.clone().add(camOff), lk*1.8);
    this.camera.lookAt(tgt);
  }

  private lerpAngle(a:number,b:number,t:number){
    let diff=((b-a+Math.PI)%(Math.PI*2))-Math.PI;
    if(diff<-Math.PI) diff+=Math.PI*2;
    return a+diff*t;
  }

  getScene()  { return this.scene;  }
  getPlayer() { return this.player; }
  getMixer()  { return this.mixer;  }

  dispose(){
    this.disposed=true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown",   this.onKeyDown);
    window.removeEventListener("keyup",     this.onKeyUp);
    window.removeEventListener("mouseup",   this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize",    this.onResize);
    this.renderer.dispose();
    if(this.mobileUI) this.container.removeChild(this.mobileUI);
    if(this.renderer.domElement.parentElement===this.container)
      this.container.removeChild(this.renderer.domElement);
  }
}
