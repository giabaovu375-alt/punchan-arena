/**
 * DialogueUI — hộp thoại NPC kiểu RPG
 * Gọi show() để hiện, onDone callback khi player xác nhận câu cuối
 */
export class DialogueUI {
  private el: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private promptEl: HTMLDivElement;

  private lines: string[] = [];
  private lineIndex = 0;
  private typeTimer = 0;
  private charIndex = 0;
  private typing = false;
  private visible = false;
  private onDone: (() => void) | null = null;

  constructor(private container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.style.cssText = `
      position: absolute;
      bottom: 80px; left: 50%; transform: translateX(-50%);
      width: min(560px, 90vw);
      background: rgba(10,8,6,0.88);
      border: 1px solid rgba(255,220,100,0.35);
      border-radius: 8px;
      padding: 16px 20px 14px;
      display: none;
      z-index: 100;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 32px rgba(0,0,0,0.5);
    `;

    this.nameEl = document.createElement("div");
    this.nameEl.style.cssText = `
      font-family: sans-serif; font-size: 13px; font-weight: 700;
      color: #ffdd55; letter-spacing: 0.05em; margin-bottom: 8px;
    `;

    this.textEl = document.createElement("div");
    this.textEl.style.cssText = `
      font-family: sans-serif; font-size: 15px; color: #f0e8d8;
      line-height: 1.6; min-height: 44px;
    `;

    this.promptEl = document.createElement("div");
    this.promptEl.style.cssText = `
      font-family: sans-serif; font-size: 12px; color: rgba(255,220,100,0.5);
      text-align: right; margin-top: 10px; letter-spacing: 0.05em;
    `;
    this.promptEl.textContent = "Nhấn E / Tap để tiếp tục";

    this.el.append(this.nameEl, this.textEl, this.promptEl);
    container.appendChild(this.el);

    window.addEventListener("keydown", this.onKey);
    this.el.addEventListener("click", this.advance);
  }

  show(npcName: string, lines: string[], onDone: () => void) {
    this.lines     = lines;
    this.lineIndex = 0;
    this.onDone    = onDone;
    this.nameEl.textContent = npcName;
    this.visible = true;
    this.el.style.display = "block";
    this.startLine();
  }

  hide() {
    this.visible = false;
    this.el.style.display = "none";
  }

  isVisible() { return this.visible; }

  private startLine() {
    this.charIndex = 0;
    this.typeTimer = 0;
    this.typing    = true;
    this.textEl.textContent = "";
    this.promptEl.style.opacity = "0";
  }

  /** Gọi mỗi frame với dt (giây) */
  update(dt: number) {
    if (!this.visible || !this.typing) return;
    this.typeTimer += dt;
    const charsPerSec = 40;
    const target = Math.floor(this.typeTimer * charsPerSec);
    const line = this.lines[this.lineIndex] ?? "";
    if (target >= line.length) {
      this.textEl.textContent = line;
      this.typing    = false;
      this.typeTimer = 0;
      this.promptEl.style.opacity = "1";
    } else {
      this.textEl.textContent = line.slice(0, target);
    }
  }

  private advance = () => {
    if (!this.visible) return;
    if (this.typing) {
      // Skip typewriter
      this.textEl.textContent = this.lines[this.lineIndex] ?? "";
      this.typing    = false;
      this.typeTimer = 0;
      this.promptEl.style.opacity = "1";
      return;
    }
    this.lineIndex++;
    if (this.lineIndex >= this.lines.length) {
      this.hide();
      this.onDone?.();
    } else {
      this.typeTimer = 0;
      this.startLine();
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "KeyE" || e.code === "Space") this.advance();
  };

  dispose() {
    window.removeEventListener("keydown", this.onKey);
    this.el.remove();
  }
}

/** Fade màn hình trắng rồi gọi callback */
export function fadeToWhite(container: HTMLElement, onMid: () => void, duration = 800) {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: absolute; inset: 0;
    background: white; opacity: 0;
    transition: opacity ${duration / 2}ms ease;
    z-index: 999; pointer-events: none;
  `;
  container.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    setTimeout(() => {
      onMid();
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), duration / 2);
    }, duration / 2);
  });
}
