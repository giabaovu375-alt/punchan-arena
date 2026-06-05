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
    // Đường dẫn dải ảnh sấm sét dọc (Sprite Sheet) của dự án
    private spriteSheetImage: string = "/assets/ui/1000185469.png"
  ) {
    this.rendererEl = rendererEl;

    const ui = document.createElement("div");
    Object.assign(ui.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
      zIndex: "10", userSelect: "none", WebkitUserSelect: "none",
    } as CSSStyleDeclaration);
    container.appendChild(ui);
    this.root = ui;

    const joyWrap = this.buildJoystick(ui);
    this.buildActionButtons(ui);

    // Joystick start
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

    // Touch move (Cố định tâm Joystick & Camera Drag tự nhiên)
    this.touchMoveHandler = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];

        // Xử lý di chuyển Joystick
        if (this.joystick.active && t.identifier === this.joystick.touchId) {
          const MAX = 48;
          // Tính khoảng cách delta dựa trên tâm xuất phát cố định ban đầu
          let dx = t.clientX - this.joystick.startX;
          let dy = t.clientY - this.joystick.startY;

          const d = Math.hypot(dx, dy);
          
          // Khóa biên hiển thị của núm (knob) chứ KHÔNG kéo dịch chuyển tâm startX/startY
          if (d > MAX) {
            dx *= MAX / d;
            dy *= MAX / d;
          }

          this.joystick.dx = dx;
          this.joystick.dy = dy;

          if (this.joystickKnobEl) {
            this.joystickKnobEl.style.transform = `translate(${dx}px,${dy}px)`;
          }

          const nx = dx / MAX, ny = dy / MAX, DZ = 0.18;
          this.input.forward  = ny < -DZ;
          this.input.backward = ny >  DZ;
          this.input.left     = nx < -DZ;
          this.input.right    = nx >  DZ;
        }

        // Xử lý góc xoay Camera
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

    // Touch end
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

    // Camera touch start
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

  // ── Giao diện Joystick ────────────────────────────────────────────────
  private buildJoystick(ui: HTMLElement): HTMLElement {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "absolute",
      bottom: "max(32px, env(safe-area-inset-bottom,32px))",
      left:   "max(32px, env(safe-area-inset-left,32px))",
      width:  "120px", height: "120px", borderRadius: "50%",
      pointerEvents: "all", touchAction: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
    });

    const base = document.createElement("div");
    Object.assign(base.style, {
      position: "absolute", inset: "0", borderRadius: "50%",
      background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 80%)",
      border: "1.5px solid rgba(255,255,255,0.1)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 0 16px rgba(0,0,0,0.3)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    });

    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "absolute", inset: "10px", borderRadius: "50%",
      border: "1px dashed rgba(255,255,255,0.15)",
    });

    const knob = document.createElement("div");
    Object.assign(knob.style, {
      width: "52px", height: "52px", borderRadius: "50%",
      background: "radial-gradient(circle at 35% 30%, #ffffff 0%, #899bb0 90%)",
      border: "1.5px solid rgba(255,255,255,0.8)",
      boxShadow: "0 6px 16px rgba(0,0,0,0.6), inset 0 -3px 6px rgba(0,0,0,0.3)",
      transition: "transform 0.04s ease-out",
    });

    wrap.appendChild(base);
    wrap.appendChild(ring);
    wrap.appendChild(knob);
    ui.appendChild(wrap);
    this.joystickKnobEl = knob;
    return wrap;
  }

  // ── Nút chiêu thức (Cắt tâm Sprite Sheet sấm sét) ──────────────────────
  private buildActionButtons(ui: HTMLElement) {
    const SIZE = 68;
    const GAP = 14;
    const RIGHT = 32;
    const BOTTOM = 90;

    // Tỷ lệposY tính toán chuẩn xác để ẩn viền đen/chữ số, lấy trọn lõi năng lượng sấm sét
    const buttons = [
      { id: "punch",   posY: "1.5%",  fn: () => this.cb.attack("punch"),   bottom: BOTTOM,              right: RIGHT + SIZE + GAP },
      { id: "kick",    posY: "25.8%", fn: () => this.cb.attack("kick"),    bottom: BOTTOM,              right: RIGHT },
      { id: "special", posY: "50.0%", fn: () => this.cb.attack("mmaKick"), bottom: BOTTOM + SIZE + GAP, right: RIGHT + SIZE + GAP },
      { id: "sprint",  posY: "74.3%", fn: () => this.toggleSprint(),        bottom: BOTTOM + SIZE*2 + GAP*2, right: RIGHT + SIZE/2 },
      { id: "jump",    posY: "98.5%", fn: () => this.cb.jump(),          bottom: BOTTOM + SIZE + GAP, right: RIGHT + SIZE/2 },
    ];

    for (const btn of buttons) {
      const el = document.createElement("div");
      el.setAttribute("data-id", btn.id);
      el.style.cssText = `
        position: absolute;
        bottom: ${btn.bottom}px;
        right: ${btn.right}px;
        width: ${SIZE}px;
        height: ${SIZE}px;
        border-radius: 50%;
        
        /* Trích xuất 1 ô độc lập từ Sprite Sheet dải dọc */
        background-image: url(${this.spriteSheetImage});
        background-size: 100% 510%;
        background-position: center ${btn.posY};
        background-repeat: no-repeat;
        
        background-color: rgba(10, 15, 30, 0.65);
        border: 2px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(8px);
        WebkitBackdropFilter: blur(8px);
        pointer-events: all;
        touch-action: none;
        box-shadow: 0 6px 16px rgba(0,0,0,0.4), inset 0 0 10px rgba(255,255,255,0.05);
        transition: transform 0.1s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.1s ease, border-color 0.1s ease;
      `;

      el.addEventListener("touchstart", (e) => {
        e.preventDefault();
        el.style.transform = "scale(0.88)";
        el.style.borderColor = "rgba(0, 168, 255, 0.8)";
        el.style.boxShadow = "0 0 20px rgba(0, 168, 255, 0.6), inset 0 0 12px rgba(255,255,255,0.1)";
        btn.fn();
      }, { passive: false });

      el.addEventListener("touchend", () => {
        el.style.transform = "scale(1)";
        el.style.borderColor = "rgba(255, 255, 255, 0.2)";
        el.style.boxShadow = "0 6px 16px rgba(0,0,0,0.4), inset 0 0 10px rgba(255,255,255,0.05)";
      });

      ui.appendChild(el);
    }
  }

  // ── Xử lý kích hoạt trạng thái Chạy Nhanh (Sprint) ──────────────────────
  private toggleSprint() {
    this.sprintActive = !this.sprintActive;
    this.input.sprint = this.sprintActive;
    
    const sprintBtn = this.root.querySelector('[data-id="sprint"]') as HTMLElement;
    if (sprintBtn) {
      if (this.sprintActive) {
        sprintBtn.style.backgroundColor = "rgba(0, 168, 255, 0.25)";
        sprintBtn.style.borderColor = "#00a8ff";
        sprintBtn.style.boxShadow = "0 0 24px rgba(0, 140, 255, 0.7), inset 0 0 8px rgba(255,255,255,0.2)";
      } else {
        sprintBtn.style.backgroundColor = "rgba(10, 15, 30, 0.6)";
        sprintBtn.style.borderColor = "rgba(255, 255, 255, 0.2)";
        sprintBtn.style.boxShadow = "0 6px 16px rgba(0,0,0,0.4), inset 0 0 10px rgba(255,255,255,0.05)";
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
