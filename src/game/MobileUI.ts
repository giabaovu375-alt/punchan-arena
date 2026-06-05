import type { InputState, AnimKey } from "./types";

export interface MobileUICallbacks {
  jump: () => void;
  attack: (key: AnimKey) => void;
  rotateCamera: (deltaYaw: number, deltaPitch: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT: Hình thoi chuẩn PS/Xbox
//
//          [SPECIAL]
//       [PUNCH]   [KICK]
//          [JUMP]
//  [SPRINT]
//
// Toàn bộ cụm dính góc dưới-phải. Sprint tách riêng ra trái.
// col / row là bội số của STEP (BTN_SIZE + GAP).
// col tăng → dịch trái. row tăng → dịch lên.
// ─────────────────────────────────────────────────────────────────────────────
const BTN_SIZE   = 82;   // +18px → ngón cái chạm dễ hơn hẳn
const GAP        = 8;    // kéo sát lại cho cụm gọn
const SAFE_RIGHT = 16;
const SAFE_BOT   = 36;
const STEP       = BTN_SIZE + GAP;

//  Hình thoi chuẩn – nhìn như PS/Xbox
//          [SPECIAL]
//      [KICK]  [PUNCH]
//          [JUMP]
//  [SPRINT]
const RHOMBUS = {
  jump:    { col: 1,   row: 0   },
  punch:   { col: 1,   row: 1   },
  kick:    { col: 0,   row: 0.5 },
  special: { col: 2,   row: 0.5 },
  sprint:  { col: 3.4, row: 0.1 },   // tách sang trái, hơi nhích lên tránh cạnh dưới
};

const BUTTON_DEFS = [
  { id: "jump",    img: "jump.png",    glow: "#facc15", size: BTN_SIZE * 1.14 }, // nút chính to nhất
  { id: "punch",   img: "punch.png",   glow: "#38bdf8", size: BTN_SIZE },
  { id: "kick",    img: "kick.png",    glow: "#f472b6", size: BTN_SIZE },
  { id: "special", img: "special.png", glow: "#c084fc", size: BTN_SIZE },
  { id: "sprint",  img: "sprint.png",  glow: "#2dd4bf", size: BTN_SIZE * 0.82 }, // sprint nhỏ hơn chút, phụ trợ
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// CSS – nhúng 1 lần
// ─────────────────────────────────────────────────────────────────────────────
const INJECTED_CSS = `
@keyframes mui-ripple {
  0%   { transform: scale(0.6); opacity: 0.7; }
  100% { transform: scale(2.4); opacity: 0; }
}
@keyframes mui-idle-glow {
  0%, 100% { opacity: 0.55; }
  50%       { opacity: 0.85; }
}
@keyframes mui-sprint-pulse {
  0%, 100% { filter: brightness(1.4) saturate(1.8) drop-shadow(0 0 8px #2dd4bf); }
  50%       { filter: brightness(2.0) saturate(2.4) drop-shadow(0 0 18px #2dd4bf); }
}

/* ── Nút tròn ── */
.mui-btn {
  position: absolute;
  border-radius: 50%;
  pointer-events: all;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  /* Glass base */
  background:
    radial-gradient(circle at 38% 32%,
      rgba(255,255,255,0.22) 0%,
      rgba(255,255,255,0.07) 45%,
      rgba(0,0,0,0.42) 100%
    );
  backdrop-filter: blur(14px) saturate(1.7);
  -webkit-backdrop-filter: blur(14px) saturate(1.7);
  border: 1.5px solid rgba(255,255,255,0.24);
  box-shadow:
    0 6px 24px rgba(0,0,0,0.6),
    0 1px 0 rgba(255,255,255,0.14) inset,
    0 -1px 0 rgba(0,0,0,0.35) inset;
  transition:
    transform  0.07s cubic-bezier(0.34,1.56,0.64,1),
    box-shadow 0.07s ease;
  will-change: transform;
}

/* Specular highlight vòng cung trên đầu nút */
.mui-btn::before {
  content: '';
  position: absolute;
  top: 6%; left: 15%;
  width: 70%; height: 38%;
  border-radius: 50%;
  background: radial-gradient(ellipse at 50% 20%,
    rgba(255,255,255,0.32) 0%,
    transparent 75%
  );
  pointer-events: none;
  z-index: 3;
}

/* ── Icon: crop đúng giữa ảnh bất kể tỉ lệ gốc ── */
.mui-btn-img {
  /* Lấp đầy 78% đường kính nút – đủ thấy icon, không bị tràn cạnh */
  width:  78%;
  height: 78%;
  object-fit: cover;          /* crop, không méo */
  object-position: center;    /* luôn lấy vùng giữa ảnh */
  border-radius: 50%;         /* clip tròn cho chắc */
  pointer-events: none;
  position: relative;
  z-index: 1;
  /* Hơi tăng độ tương phản cho icon nổi trên nền tối */
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.7)) brightness(1.08);
}

/* Pressed */
.mui-btn.pressed {
  transform: scale(0.83) !important;
}

/* Ripple */
.mui-ripple-el {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  animation: mui-ripple 0.5s ease-out forwards;
  z-index: 2;
}

/* Sprint bật */
.mui-btn.sprint-on {
  animation: mui-sprint-pulse 0.9s ease-in-out infinite !important;
}

/* Label */
.mui-btn-label {
  position: absolute;
  bottom: -17px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 8.5px;
  font-family: 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.45);
  white-space: nowrap;
  pointer-events: none;
  text-shadow: 0 1px 5px rgba(0,0,0,1);
}

/* ── Joystick ── */
.mui-joy-wrap {
  position: absolute;
  border-radius: 50%;
  pointer-events: all;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mui-joy-base {
  position: absolute; inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%,
      rgba(255,255,255,0.05) 0%,
      rgba(0,0,0,0.58) 78%
    );
  border: 2px solid rgba(255,255,255,0.16);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow:
    0 8px 40px rgba(0,0,0,0.75),
    0 1px 0 rgba(255,255,255,0.1) inset;
}
/* Vòng chỉ hướng bên trong */
.mui-joy-base::before {
  content: '';
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.07);
}
.mui-joy-base::after {
  content: '';
  position: absolute;
  inset: 22px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.04);
}
.mui-joy-knob {
  border-radius: 50%;
  background:
    radial-gradient(circle at 34% 28%,
      rgba(255,255,255,0.96) 0%,
      rgba(210,220,232,0.88) 42%,
      rgba(148,163,184,0.82) 100%
    );
  border: 1.5px solid rgba(255,255,255,0.88);
  box-shadow:
    0 5px 18px rgba(0,0,0,0.65),
    0 2px 5px  rgba(0,0,0,0.45),
    0 1px 0    rgba(255,255,255,1) inset;
  position: relative;
  z-index: 2;
  will-change: transform;
}
/* Specular knob */
.mui-joy-knob::after {
  content: '';
  position: absolute;
  top: 16%; left: 18%;
  width: 38%; height: 26%;
  border-radius: 50%;
  background: rgba(255,255,255,0.68);
  filter: blur(3px);
  pointer-events: none;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
export class MobileUI {
  private root: HTMLElement;
  private joystickKnobEl: HTMLElement | null = null;
  private joystick = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: -1 };
  private cameraTouch: { id: number; lastX: number; lastY: number } | null = null;
  private sprintActive = false;

  private touchMoveHandler: (e: TouchEvent) => void;
  private touchEndHandler:  (e: TouchEvent) => void;
  private rendererTouchStart: (e: TouchEvent) => void;
  private rendererEl: HTMLElement;

  constructor(
    container: HTMLElement,
    rendererEl: HTMLElement,
    private input: InputState,
    private cb: MobileUICallbacks,
    _deprecatedSpriteUrl?: string
  ) {
    this.rendererEl = rendererEl;
    this.injectCSS();

    const ui = document.createElement("div");
    Object.assign(ui.style, {
      position:         "absolute",
      inset:            "0",
      pointerEvents:    "none",
      zIndex:           "10",
      userSelect:       "none",
      WebkitUserSelect: "none",
    } as CSSStyleDeclaration);
    container.appendChild(ui);
    this.root = ui;

    const joyWrap = this.buildJoystick(ui);
    this.buildActionButtons(ui);

    // ── Joystick touch ──────────────────────────────────────────────────────
    joyWrap.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const r = joyWrap.getBoundingClientRect();
      this.joystick = {
        active: true,
        startX: r.left + r.width  / 2,
        startY: r.top  + r.height / 2,
        dx: 0, dy: 0,
        touchId: t.identifier,
      };
    }, { passive: false });

    this.touchMoveHandler = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];

        if (this.joystick.active && t.identifier === this.joystick.touchId) {
          const MAX = 44;
          let dx = t.clientX - this.joystick.startX;
          let dy = t.clientY - this.joystick.startY;
          const d = Math.hypot(dx, dy);
          if (d > MAX) { dx *= MAX / d; dy *= MAX / d; }
          this.joystick.dx = dx;
          this.joystick.dy = dy;
          if (this.joystickKnobEl)
            this.joystickKnobEl.style.transform = `translate(${dx}px,${dy}px)`;
          const nx = dx / MAX, ny = dy / MAX, DZ = 0.2;
          this.input.forward  = ny < -DZ;
          this.input.backward = ny >  DZ;
          this.input.left     = nx < -DZ;
          this.input.right    = nx >  DZ;
        }

        if (this.cameraTouch && t.identifier === this.cameraTouch.id) {
          const dYaw   = -(t.clientX - this.cameraTouch.lastX) * 0.006;
          const dPitch = -(t.clientY - this.cameraTouch.lastY) * 0.006;
          this.cb.rotateCamera(dYaw, dPitch);
          this.cameraTouch.lastX = t.clientX;
          this.cameraTouch.lastY = t.clientY;
        }
      }
    };
    window.addEventListener("touchmove", this.touchMoveHandler, { passive: true });

    this.touchEndHandler = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystick.touchId) {
          this.joystick.active = false;
          if (this.joystickKnobEl) this.joystickKnobEl.style.transform = "";
          this.input.forward = this.input.backward = this.input.left = this.input.right = false;
        }
        if (this.cameraTouch && t.identifier === this.cameraTouch.id)
          this.cameraTouch = null;
      }
    };
    window.addEventListener("touchend", this.touchEndHandler);

    this.rendererTouchStart = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const tgt = e.target as HTMLElement;
        if (tgt?.style && window.getComputedStyle(tgt).pointerEvents === "all") continue;
        if (t.clientX > window.innerWidth / 2 && !this.cameraTouch)
          this.cameraTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY };
      }
    };
    rendererEl.addEventListener("touchstart", this.rendererTouchStart, { passive: true });
  }

  // ── CSS ────────────────────────────────────────────────────────────────────
  private injectCSS() {
    if (document.getElementById("mobileui-styles")) return;
    const s = document.createElement("style");
    s.id = "mobileui-styles";
    s.textContent = INJECTED_CSS;
    document.head.appendChild(s);
  }

  // ── Joystick ───────────────────────────────────────────────────────────────
  private buildJoystick(ui: HTMLElement): HTMLElement {
    const JOY_SIZE = 140;   // tăng từ 118 → 140, dễ điều hướng hơn
    const wrap = document.createElement("div");
    wrap.className = "mui-joy-wrap";
    Object.assign(wrap.style, {
      bottom: `max(${SAFE_BOT}px, calc(env(safe-area-inset-bottom,0px) + ${SAFE_BOT}px))`,
      left:   "max(22px, env(safe-area-inset-left,22px))",
      width:  `${JOY_SIZE}px`,
      height: `${JOY_SIZE}px`,
    });
    const base = document.createElement("div");
    base.className = "mui-joy-base";
    const knob = document.createElement("div");
    knob.className = "mui-joy-knob";
    Object.assign(knob.style, { width: "58px", height: "58px" });
    wrap.appendChild(base);
    wrap.appendChild(knob);
    ui.appendChild(wrap);
    this.joystickKnobEl = knob;
    return wrap;
  }

  // ── Action Buttons ─────────────────────────────────────────────────────────
  private buildActionButtons(ui: HTMLElement) {
    for (const def of BUTTON_DEFS) {
      const pos  = RHOMBUS[def.id as keyof typeof RHOMBUS];
      const half = (def.size - BTN_SIZE) / 2; // bù offset khi size khác BTN_SIZE

      // Tọa độ tuyệt đối so với góc dưới-phải
      const right  = SAFE_RIGHT + pos.col * STEP - half;
      const bottom = SAFE_BOT   + pos.row * STEP - half;

      const btnEl = document.createElement("div");
      btnEl.className = "mui-btn";
      btnEl.setAttribute("data-id", def.id);
      Object.assign(btnEl.style, {
        width:  `${def.size}px`,
        height: `${def.size}px`,
        right:  `${right}px`,
        bottom: `${bottom}px`,
        zIndex: def.id === "jump" ? "5" : "4",
      });

      // Icon – crop giữa ảnh, hiển thị 78% đường kính nút
      const img = document.createElement("img");
      img.className  = "mui-btn-img";
      img.src        = `/assets/ui/${def.img}`;
      img.draggable  = false;
      img.alt        = def.id;

      // Label
      const label = document.createElement("span");
      label.className   = "mui-btn-label";
      label.textContent = def.id.toUpperCase();

      btnEl.appendChild(img);
      btnEl.appendChild(label);
      ui.appendChild(btnEl);

      const action = this.resolveAction(def.id);
      const baseBox = this.idleBoxShadow(def.glow);

      btnEl.addEventListener("touchstart", (e) => {
        e.preventDefault();
        btnEl.classList.add("pressed");
        btnEl.style.boxShadow = `
          0 6px 24px rgba(0,0,0,0.6),
          0 1px 0 rgba(255,255,255,0.14) inset,
          0 -1px 0 rgba(0,0,0,0.35) inset,
          0 0 22px 5px ${def.glow}90,
          0 0 55px 14px ${def.glow}30
        `;
        const rip = document.createElement("div");
        rip.className  = "mui-ripple-el";
        rip.style.background = `radial-gradient(circle, ${def.glow}60 0%, transparent 68%)`;
        btnEl.appendChild(rip);
        rip.addEventListener("animationend", () => rip.remove());
        action();
      }, { passive: false });

      btnEl.addEventListener("touchend", () => {
        btnEl.classList.remove("pressed");
        if (def.id === "sprint" && this.sprintActive) return;
        btnEl.style.boxShadow = baseBox;
      });
    }
  }

  private idleBoxShadow(glow: string) {
    return `
      0 6px 24px rgba(0,0,0,0.6),
      0 1px 0 rgba(255,255,255,0.14) inset,
      0 -1px 0 rgba(0,0,0,0.35) inset,
      0 0 0 0 ${glow}00
    `;
  }

  private resolveAction(id: string): () => void {
    switch (id) {
      case "jump":    return () => this.cb.jump();
      case "punch":   return () => this.cb.attack("punch");
      case "kick":    return () => this.cb.attack("kick");
      case "special": return () => this.cb.attack("mmaKick");
      case "sprint":  return () => this.toggleSprint();
      default:        return () => {};
    }
  }

  private toggleSprint() {
    this.sprintActive = !this.sprintActive;
    this.input.sprint = this.sprintActive;
    const btn = this.root.querySelector('[data-id="sprint"]') as HTMLElement | null;
    if (!btn) return;
    if (this.sprintActive) {
      btn.classList.add("sprint-on");
      btn.style.boxShadow = `
        0 6px 24px rgba(0,0,0,0.6),
        0 1px 0 rgba(255,255,255,0.14) inset,
        0 -1px 0 rgba(0,0,0,0.35) inset,
        0 0 32px 8px #2dd4bf90,
        0 0 65px 18px #2dd4bf30
      `;
    } else {
      btn.classList.remove("sprint-on");
      btn.style.boxShadow = this.idleBoxShadow("#2dd4bf");
    }
  }

  dispose() {
    window.removeEventListener("touchmove", this.touchMoveHandler);
    window.removeEventListener("touchend",  this.touchEndHandler);
    this.rendererEl.removeEventListener("touchstart", this.rendererTouchStart);
    this.root.parentElement?.removeChild(this.root);
    document.getElementById("mobileui-styles")?.remove();
  }
}
