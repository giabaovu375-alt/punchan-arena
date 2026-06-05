import type { InputState, AnimKey } from "./types";

export interface MobileUICallbacks {
  jump: () => void;
  attack: (key: AnimKey) => void;
  rotateCamera: (deltaYaw: number, deltaPitch: number) => void;
}

export class MobileUI {
  private root: HTMLElement;
  private joystickKnobEl: HTMLElement | null = null;
  private joystick = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: -1 };
  private cameraTouch: { id: number; lastX: number; lastY: number } | null = null;
  private sprintActive = false;

  private touchMoveHandler: (e: TouchEvent) => void;
  private touchEndHandler: (e: TouchEvent) => void;
  private rendererTouchStart: (e: TouchEvent) => void;
  private rendererEl: HTMLElement;

  constructor(
    container: HTMLElement,
    rendererEl: HTMLElement,
    private input: InputState,
    private cb: MobileUICallbacks,
    _deprecatedSpriteUrl?: string // Bỏ qua tham số này vì cấu trúc đã đổi sang ảnh lẻ
  ) {
    this.rendererEl = rendererEl;

    // Tạo container bao ngoài cho toàn bộ UI Mobile
    const ui = document.createElement("div");
    Object.assign(ui.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "10",
      userSelect: "none",
      WebkitUserSelect: "none",
    } as CSSStyleDeclaration);
    container.appendChild(ui);
    this.root = ui;

    // Dựng các thành phần giao diện
    const joyWrap = this.buildJoystick(ui);
    this.buildActionButtons(ui);

    // ── XỬ LÝ TOUCH JOYSTICK DI CHUYỂN ───────────────────────────────────────
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

    this.touchMoveHandler = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];

        if (this.joystick.active && t.identifier === this.joystick.touchId) {
          const MAX = 42;
          let dx = t.clientX - this.joystick.startX;
          let dy = t.clientY - this.joystick.startY;
          const d = Math.hypot(dx, dy);
          
          if (d > MAX) {
            dx *= MAX / d;
            dy *= MAX / d;
          }

          this.joystick.dx = dx;
          this.joystick.dy = dy;

          if (this.joystickKnobEl) {
            this.joystickKnobEl.style.transform = `translate(${dx}px,${dy}px)`;
          }

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
        if (this.cameraTouch && t.identifier === this.cameraTouch.id) {
          this.cameraTouch = null;
        }
      }
    };
    window.addEventListener("touchend", this.touchEndHandler);

    this.rendererTouchStart = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const target = e.target as HTMLElement;
        
        if (target && target.style && window.getComputedStyle(target).pointerEvents === "all") {
          continue;
        }
        if (t.clientX > window.innerWidth / 2 && !this.cameraTouch) {
          this.cameraTouch = { id: t.identifier, lastX: t.clientX, lastY: t.clientY };
        }
      }
    };
    rendererEl.addEventListener("touchstart", this.rendererTouchStart, { passive: true });
  }

  private buildJoystick(ui: HTMLElement): HTMLElement {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "absolute",
      bottom: "max(24px, env(safe-area-inset-bottom,24px))",
      left:   "max(24px, env(safe-area-inset-left,24px))",
      width:  "110px", height: "110px", borderRadius: "50%",
      pointerEvents: "all", touchAction: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
    });

    const base = document.createElement("div");
    Object.assign(base.style, {
      position: "absolute", inset: "0", borderRadius: "50%",
      background: "radial-gradient(circle, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.45) 85%)",
      border: "2px solid rgba(255,255,255,0.2)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    });

    const knob = document.createElement("div");
    Object.assign(knob.style, {
      width: "48px", height: "48px", borderRadius: "50%",
      background: "linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)",
      border: "1.5px solid #fff",
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    });

    wrap.appendChild(base);
    wrap.appendChild(knob);
    ui.appendChild(wrap);
    this.joystickKnobEl = knob;
    return wrap;
  }

  // ── LOAD ẢNH LẺ THEO ĐÚNG REPO GITHUB THƯ MỤC /public/assets/ui/ ──
  private buildActionButtons(ui: HTMLElement) {
    const SIZE = 64;
    const GAP = 14;
    const RIGHT = 24;
    const BOTTOM = 50;

    // Chỉ định chính xác đường dẫn đến từng file ảnh đơn lẻ
    const buttons = [
      { id: "punch",   imgName: "punch.png",   color: "#a5f3fc", fn: () => this.cb.attack("punch"),   bottom: BOTTOM + SIZE/2 + GAP,     right: RIGHT + SIZE * 1.5 + GAP * 1.5 },
      { id: "kick",    imgName: "kick.png",    color: "#f472b6", fn: () => this.cb.attack("kick"),    bottom: BOTTOM,                    right: RIGHT + SIZE + GAP },
      { id: "special", imgName: "special.png", color: "#c084fc", fn: () => this.cb.attack("mmaKick"), bottom: BOTTOM + SIZE * 1.25 + GAP * 2, right: RIGHT + SIZE * 0.75 + GAP },
      { id: "sprint",  imgName: "sprint.png",  color: "#2dd4bf", fn: () => this.toggleSprint(),       bottom: BOTTOM + SIZE * 2.25 + GAP * 3, right: RIGHT },
      { id: "jump",    imgName: "jump.png",    color: "#facc15", fn: () => this.cb.jump(),            bottom: BOTTOM,                    right: RIGHT },
    ];

    for (const btn of buttons) {
      const btnEl = document.createElement("div");
      btnEl.setAttribute("data-id", btn.id);
      
      // Đổi sang background-size: contain để ảnh co vừa vặn khít nút tròn
      btnEl.style.cssText = `
        position: absolute;
        bottom: ${btn.bottom}px;
        right: ${btn.right}px;
        width: ${SIZE}px;
        height: ${SIZE}px;
        border-radius: 50%;
        background-image: url('/assets/ui/${btn.imgName}');
        background-size: contain;
        background-position: center;
        background-repeat: no-repeat;
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        pointer-events: all;
        touch-action: none;
        transition: transform 0.05s ease, filter 0.05s ease;
      `;

      btnEl.addEventListener("touchstart", (e) => {
        e.preventDefault();
        btnEl.style.transform = "scale(0.88)";
        btnEl.style.filter = `drop-shadow(0 0 12px ${btn.color}) brightness(1.3)`;
        btn.fn();
      }, { passive: false });

      btnEl.addEventListener("touchend", () => {
        btnEl.style.transform = "scale(1)";
        if (btn.id === "sprint" && this.sprintActive) return;
        btnEl.style.filter = "none";
      });

      ui.appendChild(btnEl);
    }
  }

  private toggleSprint() {
    this.sprintActive = !this.sprintActive;
    this.input.sprint = this.sprintActive;
    
    const sprintBtn = this.root.querySelector('[data-id="sprint"]') as HTMLElement;
    if (sprintBtn) {
      if (this.sprintActive) {
        sprintBtn.style.filter = `drop-shadow(0 0 16px #2dd4bf) brightness(1.4)`;
        sprintBtn.style.transform = "scale(0.92)";
      } else {
        sprintBtn.style.filter = "none";
        sprintBtn.style.transform = "scale(1)";
      }
    }
  }

  dispose() {
    window.removeEventListener("touchmove", this.touchMoveHandler);
    window.removeEventListener("touchend",  this.touchEndHandler);
    this.rendererEl.removeEventListener("touchstart", this.rendererTouchStart);
    this.root.parentElement?.removeChild(this.root);
  }
    }
