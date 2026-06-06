import type { CharacterDef } from "./characters";

const STYLE_ID = "__game-engine-style";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes ge-pulse { 0%,100%{ opacity:.85 } 50%{ opacity:1 } }
    @keyframes ge-pop { 0%{ transform:translateX(-50%) scale(.6); opacity:0 } 40%{ transform:translateX(-50%) scale(1.15); opacity:1 } 100%{ transform:translateX(-50%) scale(1); opacity:1 } }
    @keyframes ge-spin90 { from{transform:rotate(0)} to{transform:rotate(90deg)} }
    @media screen and (orientation: portrait) and (max-width: 900px) {
      #__game-rotate-overlay { display:flex !important; }
    }
    .ge-btn {
      position:absolute; border-radius:50%;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:2px; pointer-events:all; touch-action:none;
      font-family: ui-sans-serif, system-ui, sans-serif; font-weight:800;
      color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.45);
      border:1.5px solid rgba(255,255,255,.35);
      transition: transform .08s ease, box-shadow .12s ease, filter .12s ease;
      -webkit-tap-highlight-color: transparent;
      user-select:none; -webkit-user-select:none;
      will-change: transform;
    }
    .ge-btn::before {
      content:""; position:absolute; inset:3px; border-radius:50%;
      background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.35), rgba(255,255,255,0) 55%);
      pointer-events:none;
    }
    .ge-btn:active { transform: scale(.9); filter: brightness(1.15); }
    .ge-card {
      background: linear-gradient(180deg, rgba(20,24,36,.72), rgba(12,14,22,.62));
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      border:1px solid rgba(255,255,255,.10);
      box-shadow: 0 8px 28px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06);
      border-radius: 14px;
      color:#eaf0ff; font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .ge-bar-track {
      height:8px; border-radius:999px; overflow:hidden;
      background: rgba(255,255,255,.08);
      box-shadow: inset 0 1px 2px rgba(0,0,0,.45);
    }
    .ge-bar-fill { height:100%; border-radius:999px; transition: width .25s ease; }
    .ge-key {
      display:inline-flex; align-items:center; justify-content:center;
      min-width:18px; height:18px; padding:0 5px;
      font-size:10px; font-weight:800; color:#0a0d17;
      background: linear-gradient(180deg,#f5f7ff,#c4cce0);
      border:1px solid rgba(0,0,0,.2);
      border-radius:4px; box-shadow: 0 1px 0 rgba(0,0,0,.35);
      font-family: ui-monospace, monospace;
    }
  `;
  document.head.appendChild(s);
}

export class HUD {
  private root: HTMLElement;
  private staminaFill: HTMLElement | null = null;
  private hpFill: HTMLElement | null = null;
  private compassNeedle: HTMLElement | null = null;
  private comboEl: HTMLElement | null = null;

  constructor(container: HTMLElement, character: CharacterDef, isMobile: boolean) {
    injectStyles();

    const hud = document.createElement("div");
    Object.assign(hud.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
      zIndex: "5", overflow: "hidden",
    } as CSSStyleDeclaration);
    container.appendChild(hud);
    this.root = hud;

    this.buildCharacterCard(hud, character);
    this.buildCompass(hud);
    this.buildComboLabel(hud);
    if (!isMobile) {
      this.buildControlsHint(hud);
      this.buildCrosshair(hud);
    }
  }

  private buildCharacterCard(hud: HTMLElement, character: CharacterDef) {
    const card = document.createElement("div");
    card.className = "ge-card";
    Object.assign(card.style, {
      position: "absolute",
      top: "max(14px, env(safe-area-inset-top,14px))",
      left: "max(14px, env(safe-area-inset-left,14px))",
      padding: "10px 14px 12px",
      minWidth: "210px",
      pointerEvents: "none",
    } as CSSStyleDeclaration);

    const name = character?.name ?? "Player";
    const avatarColor = "#" + (character?.color ?? 0xffaa44).toString(16).padStart(6, "0");

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="
          width:36px; height:36px; border-radius:10px;
          background: linear-gradient(135deg, ${avatarColor}, #1a1f2e);
          border:1px solid rgba(255,255,255,.18);
          display:flex; align-items:center; justify-content:center;
          font-weight:900; font-size:16px; color:#fff;
          text-shadow:0 1px 2px rgba(0,0,0,.5);
        ">${name.charAt(0).toUpperCase()}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:800; letter-spacing:.04em;">${name}</div>
          <div style="font-size:10px; opacity:.6; letter-spacing:.12em;">LV.1 · WARRIOR</div>
        </div>
      </div>
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
        <div>
          <div style="display:flex; justify-content:space-between; font-size:9px; letter-spacing:.1em; opacity:.7; margin-bottom:3px;">
            <span>HP</span><span id="__ge_hp_txt">100 / 100</span>
          </div>
          <div class="ge-bar-track"><div id="__ge_hp_fill" class="ge-bar-fill" style="width:100%; background:linear-gradient(90deg,#ff5577,#ff8855);"></div></div>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; font-size:9px; letter-spacing:.1em; opacity:.7; margin-bottom:3px;">
            <span>STAMINA</span><span id="__ge_st_txt">100</span>
          </div>
          <div class="ge-bar-track"><div id="__ge_st_fill" class="ge-bar-fill" style="width:100%; background:linear-gradient(90deg,#5ad1ff,#5ee6a8);"></div></div>
        </div>
      </div>
    `;
    hud.appendChild(card);
    this.hpFill      = card.querySelector("#__ge_hp_fill");
    this.staminaFill = card.querySelector("#__ge_st_fill");
  }

  private buildCompass(hud: HTMLElement) {
    const compass = document.createElement("div");
    compass.className = "ge-card";
    Object.assign(compass.style, {
      position: "absolute",
      top: "max(14px, env(safe-area-inset-top,14px))",
      right: "max(14px, env(safe-area-inset-right,14px))",
      width: "56px", height: "56px", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "0",
    } as CSSStyleDeclaration);
    compass.innerHTML = `
      <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:800; opacity:.55;">
        <span style="position:absolute; top:4px;">N</span>
        <span style="position:absolute; bottom:4px;">S</span>
        <span style="position:absolute; left:5px;">W</span>
        <span style="position:absolute; right:5px;">E</span>
      </div>
      <div id="__ge_needle" style="
        width:3px; height:24px; border-radius:2px;
        background:linear-gradient(180deg,#ff4d6d 0 50%, #f5f7ff 50% 100%);
        box-shadow:0 0 8px rgba(255,77,109,.6);
        transform-origin:center center;
      "></div>
    `;
    hud.appendChild(compass);
    this.compassNeedle = compass.querySelector("#__ge_needle");
  }

  private buildComboLabel(hud: HTMLElement) {
    const combo = document.createElement("div");
    Object.assign(combo.style, {
      position: "absolute",
      top: "max(24px, env(safe-area-inset-top,24px))",
      left: "50%", transform: "translateX(-50%)",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontWeight: "900", fontSize: "28px",
      color: "#ffd75e",
      textShadow: "0 0 18px rgba(255,180,40,.85), 0 2px 6px rgba(0,0,0,.6)",
      letterSpacing: ".05em",
      opacity: "0", pointerEvents: "none",
    } as CSSStyleDeclaration);
    hud.appendChild(combo);
    this.comboEl = combo;
  }

  private buildControlsHint(hud: HTMLElement) {
    const hint = document.createElement("div");
    hint.className = "ge-card";
    Object.assign(hint.style, {
      position: "absolute",
      bottom: "16px", left: "16px",
      padding: "10px 14px",
      fontSize: "11px", lineHeight: "1.75",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    hint.innerHTML = `
      <div style="font-size:10px; letter-spacing:.18em; opacity:.55; margin-bottom:4px;">CONTROLS</div>
      <div><span class="ge-key">W</span><span class="ge-key">A</span><span class="ge-key">S</span><span class="ge-key">D</span> Move</div>
      <div><span class="ge-key">⇧</span> Sprint &nbsp; <span class="ge-key">␣</span> Jump</div>
      <div><span class="ge-key">Z</span><span class="ge-key">X</span><span class="ge-key">C</span><span class="ge-key">V</span> Combat</div>
      <div style="opacity:.55; margin-top:2px;">Drag = camera · Wheel = zoom</div>
    `;
    hud.appendChild(hint);
  }

  private buildCrosshair(hud: HTMLElement) {
    const ch = document.createElement("div");
    Object.assign(ch.style, {
      position: "absolute", left: "50%", top: "50%",
      width: "6px", height: "6px", marginLeft: "-3px", marginTop: "-3px",
      borderRadius: "50%", background: "rgba(255,255,255,.35)",
      boxShadow: "0 0 0 1px rgba(0,0,0,.45)",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    hud.appendChild(ch);
  }

  setStamina(v01: number) {
    if (this.staminaFill) this.staminaFill.style.width = `${Math.round(v01 * 100)}%`;
  }
  setHP(v01: number) {
    if (this.hpFill) this.hpFill.style.width = `${Math.round(v01 * 100)}%`;
  }
  setCompassYaw(yaw: number) {
    if (!this.compassNeedle) return;
    const deg = -yaw * (180 / Math.PI);
    this.compassNeedle.style.transform = `rotate(${deg}deg)`;
  }
  flashCombo(count: number) {
    if (!this.comboEl) return;
    if (count < 2) { this.comboEl.style.opacity = "0"; return; }
    this.comboEl.textContent = `${count}× COMBO`;
    this.comboEl.style.animation = "none";
    void this.comboEl.offsetWidth; // force reflow
    this.comboEl.style.animation = "ge-pop .35s ease-out forwards";
    this.comboEl.style.opacity = "1";
  }

  dispose() {
    this.root.parentElement?.removeChild(this.root);
    document.getElementById(STYLE_ID)?.remove();
  }
}
