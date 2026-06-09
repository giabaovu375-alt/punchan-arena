
export interface InputCallbacks {
  onRotate:    (dYaw: number, dPitch: number) => void;
  onZoom:      (delta: number) => void;
  onAttack:    () => void;
  isIntroActive:  () => boolean;
  onResize:     (w: number, h: number) => void;
  onTouchStart?: (e: TouchEvent) => void;
  onTouchMove?:  (e: TouchEvent) => void;
}

// ─── InputController ──────────────────────────────────────────────────────────
// Centralise tất cả DOM event — mouse, wheel, touch, resize
export class InputController {
  private isRotating    = false;
  private lastMouse     = { x: 0, y: 0 };

  private readonly isMobile: boolean;

  constructor(
    private canvas:    HTMLElement,
    private container: HTMLElement,
    private cbs:       InputCallbacks,
    isMobile:          boolean,
  ) {
    this.isMobile = isMobile;
    this._bind();
  }

  // ─── Bind / Unbind ──────────────────────────────────────────────────────────
  private _bind() {
    if (!this.isMobile) {
      this.canvas.addEventListener("mousedown",    this._onMouseDown);
      window.addEventListener("mouseup",           this._onMouseUp);
      window.addEventListener("mousemove",         this._onMouseMove);
      this.canvas.addEventListener("wheel",        this._onWheel, { passive: false });
      this.canvas.addEventListener("contextmenu",  (e) => e.preventDefault());
    } else {
      this.canvas.addEventListener("touchstart", this._onTouchStart, { passive: true });
      this.canvas.addEventListener("touchmove",  this._onTouchMove,  { passive: true });
    }
    window.addEventListener("resize", this._onResize);
  }

  dispose() {
    if (!this.isMobile) {
      this.canvas.removeEventListener("mousedown",   this._onMouseDown);
      window.removeEventListener("mouseup",          this._onMouseUp);
      window.removeEventListener("mousemove",        this._onMouseMove);
      this.canvas.removeEventListener("wheel",       this._onWheel);
    } else {
      this.canvas.removeEventListener("touchstart",  this._onTouchStart);
      this.canvas.removeEventListener("touchmove",   this._onTouchMove);
    }
    window.removeEventListener("resize", this._onResize);
  }

  // ─── Mouse ──────────────────────────────────────────────────────────────────
  private _onMouseDown = (e: MouseEvent) => {
    if (this.cbs.isIntroActive()) return;
    this.isRotating = true;
    this.lastMouse  = { x: e.clientX, y: e.clientY };
    if (e.button === 0) this.cbs.onAttack();
  };

  private _onMouseUp = () => { this.isRotating = false; };

  private _onMouseMove = (e: MouseEvent) => {
    if (!this.isRotating || this.cbs.isIntroActive()) return;
    this.cbs.onRotate(
      -(e.clientX - this.lastMouse.x) * 0.005,
      -(e.clientY - this.lastMouse.y) * 0.005,
    );
    this.lastMouse = { x: e.clientX, y: e.clientY };
  };

  private _onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.cbs.onZoom(e.deltaY * 0.012);
  };

  // ─── Touch: delegate sang CameraController.onTouchStart/Move ───────────────
  // Pinch zoom được xử lý hoàn toàn bởi CameraController — InputController
  // chỉ forward event, không tự tính toán
  private _onTouchStart = (e: TouchEvent) => this.cbs.onTouchStart?.(e);
  private _onTouchMove  = (e: TouchEvent) => this.cbs.onTouchMove?.(e);

  // ─── Resize ─────────────────────────────────────────────────────────────────
  private _onResize = () => {
    this.cbs.onResize(
      this.container.clientWidth,
      this.container.clientHeight,
    );
  };
}
