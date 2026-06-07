import * as THREE from "three";
import { NPC_POSITION, PLAYER_SPAWN } from "./IntroScene";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OnIntroComplete = () => void;

interface Keyframe {
  time:     number;           // giây, tính từ 0
  pos:      THREE.Vector3;
  target:   THREE.Vector3;
  fov?:     number;
  ease?:    (t: number) => number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Easing helpers
// ─────────────────────────────────────────────────────────────────────────────

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

const easeInQuart = (t: number) => t * t * t * t;

const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyframe sequence  (chỉnh pos/target ở đây là đổi được cả cảnh quay)
// ─────────────────────────────────────────────────────────────────────────────

const KEYFRAMES: Keyframe[] = [
  // 0 — Drone, nhìn xuống
  {
    time:   0,
    pos:    new THREE.Vector3(0, 38, -10),
    target: new THREE.Vector3(0,  0, -10),
    fov:    35,
    ease:   easeInOutCubic,
  },
  // 1 — Crane down: reveal con đường hoàng hôn
  {
    time:   2.5,
    pos:    new THREE.Vector3(-8, 14, 14),
    target: new THREE.Vector3( 0,  0, -10),
    fov:    55,
    ease:   easeOutQuart,
  },
  // 2 — Dolly forward: eye-level, đi dọc đường
  {
    time:   5.5,
    pos:    new THREE.Vector3(0, 1.7, 8),
    target: new THREE.Vector3(0, 1.4, -5),
    fov:    70,
    ease:   easeInOutCubic,
  },
  // 3 — Orbit left: vòng sang trái nhìn NPC + cây đỏ
  {
    time:   9.0,
    pos:    new THREE.Vector3(-9, 3.5, -16),
    target: NPC_POSITION.clone().add(new THREE.Vector3(0, 1.6, 0)),
    fov:    60,
    ease:   easeOutBack,
  },
  // 4 — Push in: zoom vào mặt NPC
  {
    time:   12.5,
    pos:    new THREE.Vector3(1.2, 1.9, -19),
    target: NPC_POSITION.clone().add(new THREE.Vector3(0, 1.7, 0)),
    fov:    42,
    ease:   easeInOutCubic,
  },
  // 5 — Hold: vị trí cuối, chuẩn bị fade
  {
    time:   15.0,
    pos:    new THREE.Vector3(1.2, 1.9, -19),
    target: NPC_POSITION.clone().add(new THREE.Vector3(0, 1.7, 0)),
    fov:    42,
    ease:   easeInOutCubic,
  },
];

const TOTAL_DURATION   = 17.0;  // giây
const FADE_START       = 15.0;  // bắt đầu fade-out
const FADE_DURATION    =  2.0;

// ─────────────────────────────────────────────────────────────────────────────
// CameraIntro class
// ─────────────────────────────────────────────────────────────────────────────

export class CameraIntro {
  private camera:     THREE.PerspectiveCamera;
  private onComplete: OnIntroComplete;

  private elapsed  = 0;
  private active   = true;

  // Overlay DOM cho fade + title card
  private overlay:    HTMLDivElement;
  private titleCard:  HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private barTop:     HTMLDivElement;
  private barBottom:  HTMLDivElement;

  // Shake
  private shakeIntensity = 0;

  // Skip listener
  private skipHandler: () => void;

  // Reused vectors (tránh GC)
  private _pos    = new THREE.Vector3();
  private _target = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    onComplete: OnIntroComplete,
  ) {
    this.camera     = camera;
    this.onComplete = onComplete;
    this._buildOverlay();
    this._placeCamera(0);

    // Cho phép skip bằng Space / E / click
    this.skipHandler = () => {
      if (this.active) this._finish();
    };
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "KeyE") this.skipHandler();
    });
    this.overlay.addEventListener("click", this.skipHandler);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Gọi mỗi frame, dt = delta giây */
  tick(dt: number) {
    if (!this.active) return;

    this.elapsed += dt;
    const t = Math.min(this.elapsed, TOTAL_DURATION);

    this._placeCamera(t);
    this._updateOverlay(t);

    if (this.elapsed >= TOTAL_DURATION) {
      this._finish();
    }
  }

  isActive() { return this.active; }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _placeCamera(t: number) {
    const { kfA, kfB, alpha } = this._findSegment(t);
    const ease = kfB.ease ?? easeInOutCubic;
    const e    = ease(alpha);

    // Interpolate pos & target
    this._pos   .lerpVectors(kfA.pos,    kfB.pos,    e);
    this._target.lerpVectors(kfA.target, kfB.target, e);

    // Camera shake nhẹ — chỉ khi dolly (shot 2→3)
    if (t >= 5.5 && t <= 9.0) {
      this.shakeIntensity = 0.018;
    } else {
      this.shakeIntensity = 0;
    }

    if (this.shakeIntensity > 0) {
      this._pos.x += (Math.random() - 0.5) * this.shakeIntensity;
      this._pos.y += (Math.random() - 0.5) * this.shakeIntensity * 0.5;
    }

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._target);

    // FOV lerp
    const fovA = kfA.fov ?? 60;
    const fovB = kfB.fov ?? 60;
    this.camera.fov = fovA + (fovB - fovA) * e;
    this.camera.updateProjectionMatrix();
  }

  private _findSegment(t: number): {
    kfA: Keyframe; kfB: Keyframe; alpha: number;
  } {
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      const kfA = KEYFRAMES[i];
      const kfB = KEYFRAMES[i + 1];
      if (t >= kfA.time && t <= kfB.time) {
        const span  = kfB.time - kfA.time;
        const alpha = span > 0 ? (t - kfA.time) / span : 1;
        return { kfA, kfB, alpha };
      }
    }
    // Quá cuối → giữ frame cuối
    const last = KEYFRAMES[KEYFRAMES.length - 1];
    return { kfA: last, kfB: last, alpha: 1 };
  }

  private _updateOverlay(t: number) {
    // Fade-in đầu (0 → 0.8s)
    if (t < 0.8) {
      const a = easeOutQuart(t / 0.8);
      this.overlay.style.opacity = String(1 - a);
    }
    // Title card hiện (1.0 → 3.5s)
    else if (t >= 1.0 && t < 3.5) {
      const a = easeOutQuart(Math.min((t - 1.0) / 0.8, 1));
      this.titleCard.style.opacity  = String(a);
      this.subtitleEl.style.opacity = String(Math.max(0, (t - 1.6) / 0.8));
    }
    // Title card ẩn (3.5 → 4.5s)
    else if (t >= 3.5 && t < 4.5) {
      const a = 1 - easeInQuart((t - 3.5) / 1.0);
      this.titleCard.style.opacity  = String(a);
      this.subtitleEl.style.opacity = String(a);
    }
    else if (t >= 4.5 && t < FADE_START) {
      this.titleCard.style.opacity  = "0";
      this.subtitleEl.style.opacity = "0";
      this.overlay.style.opacity    = "0";
    }
    // Fade-out cuối
    else if (t >= FADE_START) {
      const a = easeInQuart((t - FADE_START) / FADE_DURATION);
      this.overlay.style.opacity = String(Math.min(a, 1));
    }
  }

  private _finish() {
    if (!this.active) return;
    this.active = false;

    // Gỡ listener skip
    window.removeEventListener("keydown", this.skipHandler);
    this.overlay.removeEventListener("click", this.skipHandler);

    // Xoá toàn bộ DOM element
    this.barTop?.remove();
    this.barBottom?.remove();
    this.titleCard.remove();
    this.overlay.remove();

    // Reset camera về vị trí player spawn (sẽ được CameraController ghi đè sau)
    this.camera.position.copy(PLAYER_SPAWN);
    this.camera.fov = 75;
    this.camera.updateProjectionMatrix();

    // Gọi callback để GameEngine biết intro đã xong
    setTimeout(() => this.onComplete(), 200);
  }

  // ── DOM overlay ─────────────────────────────────────────────────────────────

  private _buildOverlay() {
    // Nền đen full-screen cho fade
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position:       "fixed",
      inset:          "0",
      background:     "#000",
      opacity:        "1",
      pointerEvents:  "none",
      zIndex:         "100",
      transition:     "none",
    });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Letterbox bars (phong cách anamorphic)
    this.barTop = document.createElement("div");
    Object.assign(this.barTop.style, {
      position:   "fixed",
      top:        "0",
      left:       "0",
      right:      "0",
      height:     "9vh",
      background: "#000",
      zIndex:     "99",
      pointerEvents: "none",
    });
    document.body.appendChild(this.barTop);

    this.barBottom = document.createElement("div");
    Object.assign(this.barBottom.style, {
      position:   "fixed",
      bottom:     "0",
      left:       "0",
      right:      "0",
      height:     "9vh",
      background: "#000",
      zIndex:     "99",
      pointerEvents: "none",
    });
    document.body.appendChild(this.barBottom);

    // Title card — căn giữa dưới
    const card = document.createElement("div");
    Object.assign(card.style, {
      position:       "fixed",
      bottom:         "12%",
      left:           "50%",
      transform:      "translateX(-50%)",
      textAlign:      "center",
      opacity:        "0",
      pointerEvents:  "none",
      zIndex:         "101",
      fontFamily:     "'Georgia', serif",
      userSelect:     "none",
    });

    // Tên map / tiêu đề
    const title = document.createElement("div");
    title.textContent = "Hoàng Hôn Cuối Đường";
    Object.assign(title.style, {
      color:          "rgba(255, 220, 160, 0.95)",
      fontSize:       "clamp(22px, 3.5vw, 42px)",
      fontWeight:     "400",
      letterSpacing:  "0.18em",
      textShadow:     "0 0 40px rgba(255,140,60,0.6), 0 2px 8px rgba(0,0,0,0.8)",
      marginBottom:   "10px",
      fontStyle:      "italic",
    });

    // Đường kẻ trang trí
    const line = document.createElement("div");
    Object.assign(line.style, {
      width:      "120px",
      height:     "1px",
      background: "linear-gradient(90deg, transparent, rgba(255,200,100,0.7), transparent)",
      margin:     "0 auto 10px",
    });

    // Subtitle
    const sub = document.createElement("div");
    sub.textContent = "Một câu chuyện còn dang dở…";
    Object.assign(sub.style, {
      color:         "rgba(255,200,140,0.6)",
      fontSize:      "clamp(12px, 1.6vw, 18px)",
      letterSpacing: "0.25em",
      opacity:       "0",
      textTransform: "uppercase",
      fontStyle:     "normal",
      fontFamily:    "'Courier New', monospace",
    });

    card.appendChild(title);
    card.appendChild(line);
    card.appendChild(sub);
    document.body.appendChild(card);

    this.titleCard  = card;
    this.subtitleEl = sub;
  }
    }
