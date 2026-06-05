/**
 * ScreenManager – Cố định game ở chế độ LANDSCAPE
 * - Hiển thị overlay nếu điện thoại đang cầm dọc
 * - Yêu cầu & khóa màn hình ngang khi người chơi tương tác
 * - Chặn zoom (pinch, double‑tap)
 */
export class ScreenManager {
  private overlay: HTMLElement | null = null;
  private disposeOrientation: () => void;
  private cleanZoomPreventer: () => void;

  constructor() {
    this.injectViewportMeta();
    this.overlay = this.createOrientationOverlay();
    this.disposeOrientation = this.listenOrientation();
    this.cleanZoomPreventer = this.preventSafariZoom();

    // Khi người chơi chạm lần đầu → vào fullscreen & khóa ngang
    document.addEventListener('touchstart', this.requestLandscape, { once: true });
  }

  /** Yêu cầu fullscreen + khóa landscape (nếu trình duyệt hỗ trợ) */
  private requestLandscape = () => {
    // Toàn màn hình để có thể lock orientation
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    // Khóa hướng màn hình
    if (screen.orientation && (screen.orientation as any).lock) {
      (screen.orientation as any).lock('landscape').catch(() => {});
    }
  };

  private injectViewportMeta() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      document.head.appendChild(meta);
    }
    meta.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
    );
  }

  private createOrientationOverlay() {
    if (document.getElementById('__orientation-overlay')) return null;
    const div = document.createElement('div');
    div.id = '__orientation-overlay';
    div.innerHTML = `
      <div style="font-size:56px; margin-bottom:16px;">📱</div>
      <div style="font-size:20px; font-weight:800;">XOAY NGANG ĐIỆN THOẠI</div>
      <div style="font-size:13px; opacity:0.6;">Trải nghiệm tốt hơn ở chế độ ngang</div>
    `;
    Object.assign(div.style, {
      display: 'none',
      position: 'fixed',
      inset: '0',
      zIndex: '99999',
      background: 'rgba(10,10,20,0.95)',
      color: '#fff',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'sans-serif',
      textAlign: 'center',
    });
    document.body.appendChild(div);
    return div;
  }

  private listenOrientation() {
    const mediaQuery = window.matchMedia('(orientation: portrait)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      this.updateOverlay(e.matches);
    };
    handler(mediaQuery); // kiểm tra ngay lúc đầu
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }

  private updateOverlay(isPortrait: boolean) {
    if (!this.overlay) return;
    this.overlay.style.display = isPortrait ? 'flex' : 'none';
  }

  /** Chặn pinch‑zoom và double‑tap zoom trên iOS */
  private preventSafariZoom() {
    const touchHandler = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.documentElement.addEventListener('touchstart', touchHandler, { passive: false });

    let lastTouchTime = 0;
    const doubleTapHandler = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchTime <= 300) e.preventDefault();
      lastTouchTime = now;
    };
    document.documentElement.addEventListener('touchend', doubleTapHandler, { passive: false });

    return () => {
      document.documentElement.removeEventListener('touchstart', touchHandler);
      document.documentElement.removeEventListener('touchend', doubleTapHandler);
    };
  }

  dispose() {
    this.disposeOrientation();
    this.cleanZoomPreventer();
    this.overlay?.remove();
  }
}
