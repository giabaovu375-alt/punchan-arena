import type { InputState, AnimKey } from "./types";
import type { ScreenManager } from "./core/ScreenManager";

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
  private screenManager: ScreenManager;

  constructor(
    container: HTMLElement,
    rendererEl: HTMLElement,
    private input: InputState,
    private cb: MobileUICallbacks,
    screenManager: ScreenManager,
    // Đường dẫn ảnh cho từng nút (tùy nhân vật)
    private buttonImages?: {
      jump?: string;
      punch?: string;
      kick?: string;
      special?: string;
      sprint?: string;
      sprintActive?: string; // ảnh khi sprint đang bật
    }
  ) {
    this.rendererEl = rendererEl;
    this.screenManager = screenManager;

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

    // Touch move (joystick + camera drag)
    this.touchMoveHandler = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];

        if (this.joystick.active && t.identifier === this.joystick.touchId) {
          const MAX = 48;
          let rawDx = t.clientX - this.joystick.startX;
          let rawDy = t.clientY - this.joystick.startY;

          const d = Math.hypot(rawDx, rawDy);
          if (d > MAX) {
            rawDx *= MAX / d;
            rawDy *= MAX / d;
            this.joystick.startX = t.clientX - rawDx;
            this.joystick.startY = t.clientY - rawDy;
          }

          if (this.joystickKnobEl) {
            this.joystickKnobEl.style.transform = `translate(${rawDx}px,${rawDy}px)`;
          }

          let dx = rawDx;
          let dy = rawDy;
          if (this.screenManager.isCanvasRotated) {
            dx = rawDy;
            dy = -rawDx;
          }

          this.joystick.dx = dx;
          this.joystick.dy = dy;

          const nx = dx / MAX, ny = dy / MAX, DZ = 0.18;
          this.input.forward  = ny < -DZ;
          this.input.backward = ny >  DZ;
          this.input.left     = nx < -DZ;
          this.input.right    = nx >  DZ;
        }

        if (this.cameraTouch && t.identifier === this.cameraTouch.id) {
          let dYaw   = -(t.clientX - this.cameraTouch.lastX) * 0.006;
          let dPitch = -(t.clientY - this.cameraTouch.lastY) * 0.006;

          if (this.screenManager.isCanvasRotated) {
            const temp = dYaw;
            dYaw = -dPitch;
            dPitch = temp;
          }

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

  // ── Joystick ─────────────────────────────────────────────────────────
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
      background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 80%)",
      border: "1.5px solid rgba(255,255,255,0.12)",
      boxShadow: "0 8px 24px rgba(0,0,0,0.4), inset 0 0 12px rgba(0,0,0,0.2)",
      backdropFilter: "blur(10px)",
    });

    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "absolute", inset: "8px", borderRadius: "50%",
      border: "1px dashed rgba(255,255,255,0.12)",
    });

    const knob = document.createElement("div");
    Object.assign(knob.style, {
      width: "56px", height: "56px", borderRadius: "50%",
      background: "radial-gradient(circle at 35% 30%, #ffffff 0%, #aab4cc 90%)",
      border: "2px solid rgba(255,255,255,0.8)",
      boxShadow: "0 4px 12px rgba(0,0,0,0.5), inset 0 -2px 4px rgba(0,0,0,0.2)",
      transition: "transform 0.05s ease-out",
    });

    wrap.appendChild(base);
    wrap.appendChild(ring);
    wrap.appendChild(knob);
    ui.appendChild(wrap);
    this.joystickKnobEl = knob;
    return wrap;
  }

  // ── Nút hành động (dùng ảnh) ─────────────────────────────────────────
  private buildActionButtons(ui: HTMLElement) {
    const SIZE = 64;
    const GAP = 12;
    const RIGHT = 24;
    const BOTTOM = 100;

    // Mặc định ảnh (nếu không truyền)
    const imgs = this.buttonImages || {};

    const buttons = [
      { id: "jump",    img: imgs.jump    || "/assets/ui/jump.png",    fn: () => this.cb.jump(),          bottom: BOTTOM + SIZE + GAP, right: RIGHT + SIZE/2 },
      { id: "punch",   img: imgs.punch   || "/assets/ui/punch.png",   fn: () => this.cb.attack("punch"),   bottom: BOTTOM,              right: RIGHT + SIZE + GAP },
      { id: "kick",    img: imgs.kick    || "/assets/ui/kick.png",    fn: () => this.cb.attack("kick"),    bottom: BOTTOM,              right: RIGHT },
      { id: "special", img: imgs.special || "/assets/ui/special.png", fn: () => this.cb.attack("mmaKick"), bottom: BOTTOM + SIZE + GAP, right: RIGHT + SIZE + GAP },
      { id: "sprint",  img: imgs.sprint  || "/assets/ui/sprint.png",  fn: () => this.toggleSprint(),        bottom: BOTTOM + SIZE*1.5 + GAP*2, right: RIGHT + SIZE/2, toggle: true },
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
        background-color: rgba(255,255,255,0.05);
        background-image: url(${btn.img});
        background-size: 80%;
        background-position: center;
        background-repeat: no-repeat;
        border: 1px solid rgba(255,255,255,0.18);
        backdrop-filter: blur(8px);
        pointer-events: all;
        touch-action: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.35), inset 0 0 8px rgba(255,255,255,0.05);
        transition: transform 0.1s ease, box-shadow 0.1s ease;
      `;

      el.addEventListener("touchstart", (e) => {
        e.preventDefault();
        el.style.transform = "scale(0.85)";
        el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.5)";
        btn.fn();
      }, { passive: false });

      el.addEventListener("touchend", () => {
        el.style.transform = "scale(1)";
        el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.35), inset 0 0 8px rgba(255,255,255,0.05)";
      });

      // Nếu là nút toggle (sprint), lưu lại để đổi ảnh sau
      if (btn.toggle) {
        (el as any).__toggleImg = { normal: btn.img, active: imgs.sprintActive || btn.img };
      }

      ui.appendChild(el);
    }
  }

  private toggleSprint() {
    this.sprintActive = !this.sprintActive;
    this.input.sprint = this.sprintActive;
    const sprintBtn = this.root.querySelector('[data-id="sprint"]') as HTMLElement;
    if (sprintBtn) {
      const imgs = (sprintBtn as any).__toggleImg;
      if (imgs) {
        sprintBtn.style.backgroundImage = `url(${this.sprintActive ? imgs.active : imgs.normal})`;
      }
      sprintBtn.style.background = this.sprintActive
        ? "radial-gradient(circle at 30% 25%, #ffd84a, #d49a00)"
        : "rgba(255,255,255,0.05)";
    }
  }

  dispose() {
    window.removeEventListener("touchmove", this.touchMoveHandler);
    window.removeEventListener("touchend",  this.touchEndHandler);
    this.rendererEl.removeEventListener("touchstart", this.rendererTouchStart);
    this.root.parentElement?.removeChild(this.root);
  }
    }
