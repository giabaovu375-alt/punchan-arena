import type { InputState, JoystickState, AnimKey } from "./types";

export interface MobileUICallbacks {
  /** Có sẵn `onGround` check bên trong PlayerController.requestJump */
  jump: () => void;
  attack: (key: AnimKey) => void;
  /** Drag nửa phải màn hình → xoay camera (yaw/pitch delta dạng radian) */
  rotateCamera: (deltaYaw: number, deltaPitch: number) => void;
}

/**
 * Mobile control overlay: virtual joystick (trái) + action buttons (phải)
 * + landscape-rotate overlay. Ghi trực tiếp vào `input` từ PlayerController.
 */
export class MobileUI {
  private root: HTMLElement;
  private joystickKnobEl: HTMLElement | null = null;
  private joystick: JoystickState = {
    active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: -1,
  };
  private cameraTouch: { id: number; lastX: number; lastY: number } | null = null;
  private sprintActive = false;

  // Listeners cần lưu để dispose
  private touchMoveHandler: (e: TouchEvent) => void;
  private touchEndHandler:  (e: TouchEvent) => void;
  private rendererTouchStart: (e: TouchEvent) => void;
  private rendererEl: HTMLElement;

  constructor(
    container: HTMLElement,
    rendererEl: HTMLElement,
    private input: InputState,
    private cb: MobileUICallbacks,
  ) {
    this.rendererEl = rendererEl;
    this.ensureRotateOverlay();

    const ui = document.createElement("div");
    Object.assign(ui.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
      zIndex: "10", userSelect: "none", WebkitUserSelect: "none",
    } as CSSStyleDeclaration);
    container.appendChild(ui);
    this.root = ui;

    const joyWrap = this.buildJoystick(ui);
    this.buildActionButtons(ui);

    // ── Joystick start ──────────────────────────────────────────────────────
    joyWrap.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const r = joyWrap.getBoundingClientRect();
      this.joystick = {
        active: true,
        startX: r.left + r.width / 2,
        startY: r.top  + r.height / 2,
        dx: 0, dy: 0,
        touchId: t.identifier,
      };
    }, { passive: false });

    // ── Touch move (joystick + camera drag) ─────────────────────────────────
    this.touchMoveHandler = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];

        if (this.joystick.active && t.identifier === this.joystick.touchId) {
          const MAX = 48;
          let dx = t.clientX - this.joystick.startX;
          let dy = t.clientY - this.joystick.startY;
          const d = Math.hypot(dx, dy);
          if (d > MAX) { dx *= MAX / d; dy *= MAX / d; }
          this.joystick.dx = dx; this.joystick.dy = dy;
          if (this.joystickKnobEl)
            this.joystickKnobEl.style.transform = `translate(${dx}px,${dy}px)`;
          const nx = dx / MAX, ny = dy / MAX, DZ = 0.18;
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

    // ── Touch end ───────────────────────────────────────────────────────────
    this.touchEndHandler = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystick.touchId) {
          this.joystick.active = false;
          if (this.joystickKnobEl) this.joystickKnobEl.style.transform = "";
          this.input.forward = this.input.backward = this.input.left = this.input.right = false;
        }
        if (this.cameraTouch && t.identifier === this.cameraTouch.id) {
          this.cameraTouch = null;
        }
      }
    };
    window.addEventListener("touchend", this.touchEndHandler);

    // ── Camera touch (nửa phải màn hình, không trùng button/joystick) ───────
    this.rendererTouchStart = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX > window.innerWidth / 2 && !this.cameraTouch) {
          this.cameraTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY };
        }
      }
    };
    rendererEl.addEventListener("touchstart", this.rendererTouchStart, { passive: true });
  }

  private ensureRotateOverlay() {
    if (document.getElementById("__game-rotate-overlay")) return;
    const ov = document.createElement("div");
    ov.id = "__game-rotate-overlay";
    Object.assign(ov.style, {
      display: "none", position: "fixed", inset: "0", zIndex: "9999",
      background: "radial-gradient(circle at center, #161a2a, #06080f)",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: "18px", color: "#fff",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    } as CSSStyleDeclaration);
    ov.innerHTML = `
      <div style="font-size:64px; animation:ge-spin90 1.4s ease-in-out infinite alternate">📱</div>
      <div style="font-size:18px; font-weight:800; letter-spacing:.15em;">XOAY NGANG ĐỂ CHƠI</div>
      <div style="font-size:12px; opacity:.55; letter-spacing:.05em;">Rotate device to landscape</div>
    `;
    document.body.appendChild(ov);
  }

  private buildJoystick(ui: HTMLElement): HTMLElement {
    const joyWrap = document.createElement("div");
    Object.assign(joyWrap.style, {
      position: "absolute",
      bottom: "max(28px, env(safe-area-inset-bottom,28px))",
      left:   "max(28px, env(safe-area-inset-left,28px))",
      width: "140px", height: "140px", borderRadius: "50%",
      pointerEvents: "all", touchAction: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
    } as CSSStyleDeclaration);

    const joyBase = document.createElement("div");
    Object.assign(joyBase.style, {
      position: "absolute", inset: "0", borderRadius: "50%",
      background: "radial-gradient(circle at center, rgba(255,255,255,.05) 0 40%, rgba(255,255,255,.12) 70%, rgba(255,255,255,.02) 100%)",
      border: "2px solid rgba(255,255,255,.22)",
      boxShadow: "0 8px 28px rgba(0,0,0,.45), inset 0 0 22px rgba(0,0,0,.35)",
      backdropFilter: "blur(8px)",
    } as CSSStyleDeclaration);

    const joyRing = document.createElement("div");
    Object.assign(joyRing.style, {
      position: "absolute", inset: "14px", borderRadius: "50%",
      border: "1px dashed rgba(255,255,255,.18)",
    } as CSSStyleDeclaration);

    const joyKnob = document.createElement("div");
    Object.assign(joyKnob.style, {
      width: "58px", height: "58px", borderRadius: "50%",
      background: "radial-gradient(circle at 30% 25%, #ffffff, #cfd6e8 55%, #8c95ad 100%)",
      border: "2px solid rgba(255,255,255,.95)",
      boxShadow: "0 4px 16px rgba(0,0,0,.55), inset 0 -3px 6px rgba(0,0,0,.25)",
      position: "relative", zIndex: "2",
      transition: "transform .04s linear",
    } as CSSStyleDeclaration);

    joyWrap.appendChild(joyBase);
    joyWrap.appendChild(joyRing);
    joyWrap.appendChild(joyKnob);
    ui.appendChild(joyWrap);
    this.joystickKnobEl = joyKnob;
    return joyWrap;
  }

  private buildActionButtons(ui: HTMLElement) {
    const BTN = 64;
    type BtnDef = {
      label: string; icon: string; c1: string; c2: string;
      b: number; r: number; fn: () => void; isToggle?: boolean;
    };
    const btns: BtnDef[] = [
      { label: "JUMP",    icon: "▲", c1: "#3aa8ff", c2: "#1561d6",
        b: 156, r: 112, fn: () => this.cb.jump() },
      { label: "PUNCH",   icon: "✊", c1: "#ffb14a", c2: "#e85a14",
        b: 86,  r: 184, fn: () => this.cb.attack("punch") },
      { label: "KICK",    icon: "🦶", c1: "#ff5d6e", c2: "#c81439",
        b: 16,  r: 112, fn: () => this.cb.attack("kick") },
      { label: "SPECIAL", icon: "✦", c1: "#c478ff", c2: "#7022d8",
        b: 86,  r: 40,  fn: () => this.cb.attack("mmaKick") },
      { label: "SPRINT",  icon: "»", c1: "#ffd84a", c2: "#d49a00",
        b: 86,  r: 268, fn: () => {}, isToggle: true },
    ];

    for (const def of btns) {
      const btn = document.createElement("div");
      btn.className = "ge-btn";
      Object.assign(btn.style, {
        bottom: `max(${def.b}px, calc(${def.b}px + env(safe-area-inset-bottom,0px)))`,
        right:  `max(${def.r}px, calc(${def.r}px + env(safe-area-inset-right,0px)))`,
        width:  `${BTN}px`, height: `${BTN}px`,
        background: `radial-gradient(circle at 30% 25%, ${def.c1}, ${def.c2} 75%)`,
        boxShadow: `0 6px 20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset, 0 -4px 10px ${def.c2}66 inset`,
      } as CSSStyleDeclaration);

      const icon = document.createElement("span");
      icon.textContent = def.icon;
      Object.assign(icon.style, {
        fontSize: "22px", lineHeight: "1", pointerEvents: "none",
      } as CSSStyleDeclaration);

      const lbl = document.createElement("span");
      lbl.textContent = def.label;
      Object.assign(lbl.style, {
        fontSize: "8px", letterSpacing: "0.1em",
        color: "rgba(255,255,255,.92)", pointerEvents: "none",
      } as CSSStyleDeclaration);

      btn.appendChild(icon);
      btn.appendChild(lbl);

      if (def.isToggle) {
        btn.addEventListener("touchstart", (e) => {
          e.preventDefault();
          this.sprintActive = !this.sprintActive;
          this.input.sprint = this.sprintActive;
          btn.style.boxShadow = this.sprintActive
            ? `0 0 24px ${def.c1}cc, 0 6px 20px rgba(0,0,0,.5), 0 0 0 2px ${def.c1} inset`
            : `0 6px 20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset, 0 -4px 10px ${def.c2}66 inset`;
          btn.style.filter = this.sprintActive ? "brightness(1.2) saturate(1.2)" : "";
        }, { passive: false });
      } else {
        btn.addEventListener("touchstart", (e) => { e.preventDefault(); def.fn(); }, { passive: false });
      }
      ui.appendChild(btn);
    }
  }

  dispose() {
    window.removeEventListener("touchmove", this.touchMoveHandler);
    window.removeEventListener("touchend",  this.touchEndHandler);
    this.rendererEl.removeEventListener("touchstart", this.rendererTouchStart);
    this.root.parentElement?.removeChild(this.root);
    document.getElementById("__game-rotate-overlay")?.remove();
  }
}
