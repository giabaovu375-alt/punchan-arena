import * as THREE from "three";

/**
 * ScreenManager – Tự động xoay canvas để game luôn hiển thị ngang
 * - Khi điện thoại dọc → canvas tự xoay 90° (landscape)
 * - Giữ nguyên UI (joystick, nút bấm) không bị xoay
 * - Chặn zoom trình duyệt (pinch, double-tap)
 * - Cung cấp cờ isCanvasRotated để đồng bộ với MobileUI
 */
export class ScreenManager {
  private overlay: HTMLElement | null = null;
  private disposeOrientation: () => void;
  private cleanZoomPreventer: () => void;

  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private canvasWrapper: HTMLElement | null = null;

  /** true nếu canvas đang bị xoay cưỡng ép (portrait → landscape) */
  public isCanvasRotated = false;

  constructor() {
    this.injectViewportMeta();
    this.overlay = this.createOrientationOverlay();
    this.disposeOrientation = this.listenOrientation();
    this.cleanZoomPreventer = this.preventSafariZoom();
  }

  /**
   * Gắn renderer, camera và container để quản lý xoay.
   * Gọi sau khi tạo renderer và camera.
   */
  setupForcedLandscape(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    canvasContainer: HTMLElement
  ) {
    this.renderer = renderer;
    this.camera = camera;

    // Tạo wrapper để xoay canvas
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      transformOrigin: "center center",
      overflow: "hidden",
    });
    canvasContainer.insertBefore(wrapper, renderer.domElement);
    wrapper.appendChild(renderer.domElement);
    this.canvasWrapper = wrapper;

    this.applyOrientation();
  }

  /** Tính toán lại kích thước renderer và camera, xoay canvas nếu cần */
  private applyOrientation() {
    if (!this.renderer || !this.camera || !this.canvasWrapper) return;

    const isPortrait = window.innerHeight > window.innerWidth;
    this.isCanvasRotated = isPortrait;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    if (isPortrait) {
      // Xoay canvas để hiển thị landscape
      this.canvasWrapper.style.width = `${screenH}px`;
      this.canvasWrapper.style.height = `${screenW}px`;
      this.canvasWrapper.style.transform = "translate(-50%, -50%) rotate(90deg)";
      this.renderer.setSize(screenH, screenW);
      this.camera.aspect = screenH / screenW;
    } else {
      // Màn hình ngang tự nhiên
      this.canvasWrapper.style.width = `${screenW}px`;
      this.canvasWrapper.style.height = `${screenH}px`;
      this.canvasWrapper.style.transform = "translate(-50%, -50%) rotate(0deg)";
      this.renderer.setSize(screenW, screenH);
      this.camera.aspect = screenW / screenH;
    }

    this.camera.updateProjectionMatrix();
  }

  // ── Các hàm nội bộ ────────────────────────────────────────────────

  private injectViewportMeta() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "viewport");
      document.head.appendChild(meta);
    }
    meta.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    );
  }

  private createOrientationOverlay() {
    if (document.getElementById("__orientation-overlay")) return null;
    const div = document.createElement("div");
    div.id = "__orientation-overlay";
    div.innerHTML = `
      <div style="font-size:44px; margin-bottom:12px;">🔄</div>
      <div style="font-size:16px; font-weight:bold;">ĐANG XOAY KHÔNG GIAN GAME...</div>
    `;
    Object.assign(div.style, {
      display: "none",
      position: "fixed",
      inset: "0",
      zIndex: "99999",
      background: "#0a0a14",
      color: "#fff",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "sans-serif",
    });
    document.body.appendChild(div);
    return div;
  }

  private listenOrientation() {
    const handler = () => this.applyOrientation();
    window.addEventListener("resize", handler);
    // Trả về cleanup function
    return () => window.removeEventListener("resize", handler);
  }

  private preventSafariZoom() {
    const touchHandler = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.documentElement.addEventListener("touchstart", touchHandler, { passive: false });

    let lastTouchTime = 0;
    const doubleTapHandler = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchTime <= 300) e.preventDefault();
      lastTouchTime = now;
    };
    document.documentElement.addEventListener("touchend", doubleTapHandler, { passive: false });

    return () => {
      document.documentElement.removeEventListener("touchstart", touchHandler);
      document.documentElement.removeEventListener("touchend", doubleTapHandler);
    };
  }

  dispose() {
    this.disposeOrientation();        // Gỡ listener resize
    this.cleanZoomPreventer();        // Gỡ chặn zoom
    this.overlay?.remove();
    this.canvasWrapper?.remove();
  }
}
