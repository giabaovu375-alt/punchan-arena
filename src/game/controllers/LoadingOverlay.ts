// ─── LoadingOverlay ───────────────────────────────────────────────────────────
// Tách riêng để GameEngine không ôm DOM logic
export class LoadingOverlay {
  private el: HTMLElement | null = null;

  constructor(private container: HTMLElement) {}

  show(text = "Đang tải...") {
    if (this.el) return;
    const el = document.createElement("div");
    el.style.cssText = [
      "position:absolute",
      "inset:0",
      "z-index:999",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "background:rgba(0,0,0,0.78)",
      "backdrop-filter:blur(8px)",
      "color:#fff",
      "gap:20px",
      "opacity:0",
      "transition:opacity 0.25s ease",
      "font-family:sans-serif",
    ].join(";");

    el.innerHTML = `
      <div style="
        width:46px; height:46px; border-radius:50%;
        border:3px solid rgba(255,255,255,0.1);
        border-top-color:#00f5d4;
        animation:spin 0.85s linear infinite;
      "></div>
      <div style="
        font-size:12px;
        letter-spacing:0.22em;
        text-transform:uppercase;
        color:rgba(255,255,255,0.7);
      ">${text}</div>
      <style>@keyframes spin { to { transform: rotate(360deg) } }</style>
    `;

    this.container.appendChild(el);
    this.el = el;
    // Fade in sau 1 frame để transition hoạt động
    requestAnimationFrame(() => { if (el.isConnected) el.style.opacity = "1"; });
  }

  hide() {
    if (!this.el) return;
    const el  = this.el;
    this.el   = null;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }

  get isVisible() { return this.el !== null; }
}
